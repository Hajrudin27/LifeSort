import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import {
  anchorDayFromIsoDate,
  coherentRecurrence,
  isRecurrenceAnchorDay,
  isRecurrenceFrequency,
  occurrenceDateForMonth,
  type RecurrenceFrequency,
} from '@/core/economy/recurrence';
import { newEntityId } from '@/core/ids';
import type { MinorUnits } from '@/core/money/minorUnits';
import { minorUnitsToServerNumeric, serverNumericToMinorUnits } from '@/core/money/serverNumeric';
import { supportedMoney } from '@/core/money/supportedMoney';
import {
  combineTravelProjectionInvalidations,
  invalidateTravelProjectionForExpense,
  refreshTravelProjectionAfterEconomyCommit,
} from '@/features/travel/economyMutationInvalidation';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { documentMetadataEncryptedStorage } from '@/core/storage/documentCacheStorage';
import { supabase } from '@/lib/supabase';
import { Attachment } from '@/types/attachment';
import { Expense, ExpenseCategory } from '@/types/expense';
import { cleanupAttachments, deleteCachedAttachmentFile } from '@/utils/shared/attachmentStorage';
import { deleteAttachmentRemote, fetchAttachmentsFor, uploadAttachment } from '@/utils/shared/attachmentSync';

interface ExpensesState {
  expenses: Expense[];
  seriesStoppedAt: Record<string, string>; // seriesId -> måned den er stoppet fra
  categoryBudgets: Record<string, MinorUnits>; // kategori -> månedligt loft i øre
  addExpense: (input: {
    name: string;
    amount: MinorUnits;
    category: ExpenseCategory;
    nextPaymentDate: string;
    isRecurring: boolean;
    // APP-042: must be null for a one-time cost and a frequency for a recurring one.
    // The day anchor is derived from nextPaymentDate, never supplied by a caller.
    recurrenceFrequency: RecurrenceFrequency | null;
  }) => string;
  updateExpense: (
    id: string,
    // recurrenceAnchorDay is deliberately not part of the payload: the store owns it.
    updates: Partial<Omit<Expense, 'id' | 'seriesId' | 'createdAt' | 'attachments' | 'recurrenceAnchorDay'>>,
  ) => void;
  removeExpense: (id: string) => void;
  deleteRecurringFromMonth: (seriesId: string, fromMonthKey: string) => void;
  rollForwardMonth: (monthKey: string) => void;
  setCategoryBudget: (category: string, limit: MinorUnits) => void;
  removeCategoryBudget: (category: string) => void;
  addAttachment: (expenseId: string, attachment: Attachment) => void;
  removeAttachment: (expenseId: string, attachmentId: string) => void;
  fetchFromSupabase: () => Promise<void>;
}

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

/** Read synchronously only when an ordered mutation is initiated. Keeping this lazy
 * avoids making every Economy read-model import initialize the complete auth flow. */
function initiatingAccountId(): string | null {
  const { useAuthStore } = require('@/store/useAuthStore') as typeof import('@/store/useAuthStore');
  return useAuthStore.getState().session?.user.id ?? null;
}

// Bemærk: "attachments" sendes ALDRIG med i selve expense-raden — de synkroniseres
// separat til den delte `attachments`-tabel + Storage-bucket (se utils/shared/attachmentSync.ts).
function toRow(userId: string, e: Expense) {
  return {
    id: e.id,
    user_id: userId,
    series_id: e.seriesId ?? null,
    is_recurring: e.isRecurring,
    // APP-042: null for one-time costs; the column's CHECK mirrors this invariant.
    recurrence_frequency: e.recurrenceFrequency,
    recurrence_anchor_day: e.recurrenceAnchorDay,
    name: e.name,
    // APP-040: exact decimal DKK for the numeric column, never amount / 100.
    amount: minorUnitsToServerNumeric(e.amount),
    category: e.category,
    next_payment_date: e.nextPaymentDate,
    created_at: e.createdAt,
  };
}

async function syncUpsertExpense(expense: Expense): Promise<boolean> {
  try {
    const userId = await getUserId();
    if (!userId) return false;
    const result = await supabase.from('expenses').upsert(toRow(userId, expense));
    return !result?.error;
  } catch { return false; }
}

async function syncUpsertExpenseForAccount(accountId: string | null, expense: Expense): Promise<boolean> {
  try {
    const userId = await getUserId();
    if (!accountId || userId !== accountId) return false;
    const result = await supabase.from('expenses').upsert(toRow(accountId, expense));
    return !result?.error;
  } catch { return false; }
}

async function syncUpsertExpenses(expenses: Expense[]): Promise<boolean> {
  try {
    const userId = await getUserId();
    if (!userId || expenses.length === 0) return false;
    const result = await supabase.from('expenses').upsert(expenses.map((e) => toRow(userId, e)));
    return !result?.error;
  } catch { return false; }
}

async function syncDeleteExpense(accountId: string | null, id: string): Promise<boolean> {
  try {
    const userId = await getUserId();
    if (!accountId || userId !== accountId) return false;
    const result = await supabase.from('expenses').delete().eq('user_id', accountId).eq('id', id);
    return !result?.error;
  } catch { return false; }
}

async function syncDeleteExpenses(accountId: string | null, ids: string[]): Promise<boolean> {
  try {
    const userId = await getUserId();
    if (!accountId || userId !== accountId || ids.length === 0) return false;
    const result = await supabase.from('expenses').delete().eq('user_id', accountId).in('id', ids);
    return !result?.error;
  } catch { return false; }
}

const expenseMutationLanes = new Map<string, Promise<void>>();

/** Preserve server mutation order for repeated edits/deletes of one canonical expense. */
function runExpenseMutation(expenseId: string, mutation: () => Promise<void>): void {
  const predecessor = expenseMutationLanes.get(expenseId) ?? Promise.resolve();
  const current = predecessor.catch(() => undefined).then(mutation);
  expenseMutationLanes.set(expenseId, current);
  void current.finally(() => {
    if (expenseMutationLanes.get(expenseId) === current) expenseMutationLanes.delete(expenseId);
  }).catch(() => undefined);
}

async function syncUpsertCategoryBudget(userId: string, category: string, limit: MinorUnits) {
  await supabase
    .from('expense_category_budgets')
    .upsert({ user_id: userId, category, monthly_limit: minorUnitsToServerNumeric(limit) });
}

async function syncDeleteCategoryBudget(userId: string, category: string) {
  await supabase.from('expense_category_budgets').delete().eq('user_id', userId).eq('category', category);
}

type ExpenseRow = {
  id: string;
  series_id: string | null;
  is_recurring: boolean;
  recurrence_frequency: unknown;
  recurrence_anchor_day: unknown;
  name: string;
  amount: unknown;
  category: string;
  next_payment_date: string;
  created_at: string;
};

function expenseFromRow(row: ExpenseRow): Expense {
  return {
    id: row.id,
    seriesId: row.series_id ?? row.id,
    isRecurring: row.is_recurring,
    // APP-042: an unknown or contradictory server value throws, which rejects the
    // whole fetch in fetchFromSupabase rather than letting it reach app state.
    ...coherentRecurrence(
      row.is_recurring,
      isRecurrenceFrequency(row.recurrence_frequency) ? row.recurrence_frequency : null,
      isRecurrenceAnchorDay(row.recurrence_anchor_day) ? row.recurrence_anchor_day : null,
    ),
    name: row.name,
    amount: serverNumericToMinorUnits(row.amount),
    category: row.category as ExpenseCategory,
    nextPaymentDate: row.next_payment_date,
    attachments: [],
    createdAt: row.created_at,
  };
}

export const useExpensesStore = create<ExpensesState>()(
  persist(
    (set, get) => ({
      expenses: [],
      seriesStoppedAt: {},
      categoryBudgets: {},

      addExpense: (input) => {
        const id = newEntityId();
        const newExpense: Expense = {
          id,
          seriesId: id, // ny udgift starter sin egen serie
          attachments: [],
          createdAt: new Date().toISOString(),
          ...input,
          // APP-040: kun beløb der kan gemmes, synkroniseres og vises præcist — før set().
          amount: supportedMoney(input.amount),
          // APP-042: en gentagelse uden gyldig frekvens afvises før set(), og
          // dagsankeret udledes af den dato brugeren valgte — ikke af en parameter.
          // Datoen skal være en rigtig kalenderdato: "2026-02-31" afvises her,
          // selv om migrering og gamle backups må reparere den slags historik.
          ...coherentRecurrence(
            input.isRecurring,
            input.recurrenceFrequency,
            input.isRecurring ? anchorDayFromIsoDate(input.nextPaymentDate) : null,
          ),
        };
        set((state) => ({ expenses: [...state.expenses, newExpense] }));
        syncUpsertExpense(newExpense);
        return id;
      },

      updateExpense: (id, updates) => {
        const accountId = initiatingAccountId();
        const target = get().expenses.find((e) => e.id === id);
        if (!target) return;

        const editedMonth = target.nextPaymentDate.slice(0, 7);
        // Beløbet valideres altid før set(): en ikke-beløbsændring bevarer det eksisterende øre-beløb uændret.
        const merged = { ...target, ...updates };
        // APP-042: ankeret følger den valgte betalingsdato — men kun når datoen
        // faktisk ændres. Redigeringsskærmen sender altid datoen med, så en februar-
        // forekomst på den 28. med anker 31 ville ellers blive omankret til 28 ved en
        // ren navne- eller frekvensændring og glide i marts. En engangsudgift der
        // bliver fast, eller en ny dato, sætter ankeret (streng dato); alt andet
        // bevarer det. Slås gentagelsen fra, ryger begge dele.
        const dateChanged =
          updates.nextPaymentDate !== undefined && updates.nextPaymentDate !== target.nextPaymentDate;
        const keepsAnchor =
          target.isRecurring && isRecurrenceAnchorDay(target.recurrenceAnchorDay) && !dateChanged;
        const anchorDay = keepsAnchor
          ? target.recurrenceAnchorDay
          : anchorDayFromIsoDate(merged.nextPaymentDate);
        const updatedExpense = {
          ...merged,
          amount: supportedMoney(updates.amount ?? target.amount),
          ...coherentRecurrence(
            merged.isRecurring,
            merged.isRecurring ? merged.recurrenceFrequency : null,
            merged.isRecurring ? anchorDay : null,
          ),
        };

        const updated = get().expenses.map((e) => (e.id === id ? updatedExpense : e));
        const removedExpenses = updated.filter(
          (e) =>
            (e.seriesId ?? e.id) === (target.seriesId ?? target.id) &&
            e.id !== id &&
            e.nextPaymentDate.slice(0, 7) > editedMonth
        );
        const removedIds = removedExpenses.map((e) => e.id);
        const invalidation = combineTravelProjectionInvalidations(
          [id, ...removedIds].map((expenseId) => invalidateTravelProjectionForExpense(expenseId, accountId)),
        );
        set({ expenses: updated.filter((e) => !removedIds.includes(e.id)) });

        runExpenseMutation(id, async () => {
          const updatedOnServer = await syncUpsertExpenseForAccount(accountId, updatedExpense);
          const removedOnServer = removedIds.length === 0 || await syncDeleteExpenses(accountId, removedIds);
          if (updatedOnServer && removedOnServer) {
            await refreshTravelProjectionAfterEconomyCommit(invalidation);
          }
        });
        for (const expense of removedExpenses) cleanupAttachments(expense.attachments);
      },

      removeExpense: (id) => {
        const accountId = initiatingAccountId();
        const target = get().expenses.find((e) => e.id === id);
        if (!target) return;
        const invalidation = invalidateTravelProjectionForExpense(id, accountId);
        set((state) => ({
          expenses: state.expenses.filter((e) => e.id !== id),
        }));
        cleanupAttachments(target?.attachments);
        runExpenseMutation(id, async () => {
          if (await syncDeleteExpense(accountId, id)) {
            await refreshTravelProjectionAfterEconomyCommit(invalidation);
          }
        });
      },

      deleteRecurringFromMonth: (seriesId, fromMonthKey) => {
        const accountId = initiatingAccountId();
        const removedExpenses = get().expenses.filter(
          (e) => e.seriesId === seriesId && e.nextPaymentDate.slice(0, 7) >= fromMonthKey,
        );
        const removedIds = removedExpenses.map((e) => e.id);
        const invalidation = combineTravelProjectionInvalidations(
          removedIds.map((expenseId) => invalidateTravelProjectionForExpense(expenseId, accountId)),
        );

        set((state) => ({
          expenses: state.expenses.filter(
            (e) => !(e.seriesId === seriesId && e.nextPaymentDate.slice(0, 7) >= fromMonthKey)
          ),
          seriesStoppedAt: { ...state.seriesStoppedAt, [seriesId]: fromMonthKey },
        }));

        if (removedIds.length > 0) {
          runExpenseMutation(removedIds[0], async () => {
            if (await syncDeleteExpenses(accountId, removedIds)) {
              await refreshTravelProjectionAfterEconomyCommit(invalidation);
            }
          });
        }
        for (const expense of removedExpenses) cleanupAttachments(expense.attachments);
      },

      rollForwardMonth: (monthKey) => {
        let createdInstances: Expense[] = [];

        set((state) => {
          const seriesIds = Array.from(new Set(state.expenses.map((e) => e.seriesId ?? e.id)));
          const newInstances: Expense[] = [];

          for (const seriesId of seriesIds) {
            const stoppedAt = state.seriesStoppedAt[seriesId];
            if (stoppedAt && stoppedAt <= monthKey) continue;

            const instancesInSeries = state.expenses
              .filter((e) => (e.seriesId ?? e.id) === seriesId)
              .sort((a, b) => a.nextPaymentDate.localeCompare(b.nextPaymentDate));

            const alreadyExists = instancesInSeries.some(
              (e) => e.nextPaymentDate.slice(0, 7) === monthKey
            );
            if (alreadyExists) continue;

            const latestBefore = instancesInSeries
              .filter((e) => e.nextPaymentDate.slice(0, 7) < monthKey)
              .pop();
            if (!latestBefore) continue;
            if (!latestBefore.isRecurring) continue;
            // APP-042: frekvensen bestemmer hvilke måneder der forfalder, og ankeret
            // bestemmer dagen — en kort måned klipper kun denne ene forekomst.
            // Uden gyldig frekvens og anker dannes ingenting.
            if (!isRecurrenceFrequency(latestBefore.recurrenceFrequency)) continue;
            if (!isRecurrenceAnchorDay(latestBefore.recurrenceAnchorDay)) continue;
            const nextPaymentDate = occurrenceDateForMonth(
              latestBefore.nextPaymentDate,
              latestBefore.recurrenceFrequency,
              latestBefore.recurrenceAnchorDay,
              monthKey,
            );
            if (!nextPaymentDate) continue;

            newInstances.push({
              // Beløbet er allerede i øre og kopieres uændret — aldrig skaleret igen.
              ...latestBefore,
              id: newEntityId(),
              seriesId, // også når en ældre rod kun har id og intet seriesId
              nextPaymentDate,
              attachments: [], // en ny måneds instans arver ALDRIG forrige måneds kvittering
              createdAt: new Date().toISOString(),
            });
          }

          if (newInstances.length === 0) return state;
          createdInstances = newInstances;
          return { expenses: [...state.expenses, ...newInstances] };
        });

        if (createdInstances.length > 0) syncUpsertExpenses(createdInstances);
      },

      setCategoryBudget: (category, limit) => {
        const canonical = supportedMoney(limit);
        set((state) => ({
          categoryBudgets: { ...state.categoryBudgets, [category]: canonical },
        }));
        getUserId().then((userId) => {
          if (userId) syncUpsertCategoryBudget(userId, category, canonical);
        });
      },

      removeCategoryBudget: (category) => {
        set((state) => {
          const next = { ...state.categoryBudgets };
          delete next[category];
          return { categoryBudgets: next };
        });
        getUserId().then((userId) => {
          if (userId) syncDeleteCategoryBudget(userId, category);
        });
      },

      addAttachment: (expenseId, attachment) => {
        set((state) => ({
          expenses: state.expenses.map((e) =>
            e.id === expenseId ? { ...e, attachments: [...e.attachments, attachment] } : e,
          ),
        }));
        // Upload sker i baggrunden — brugeren ser billedet med det samme lokalt.
        uploadAttachment('expense', expenseId, attachment).then((result) => {
          if (!result) return;
          set((state) => ({
            expenses: state.expenses.map((e) =>
              e.id === expenseId
                ? {
                    ...e,
                    attachments: e.attachments.map((a) =>
                      a.id === attachment.id ? { ...a, storagePath: result.storagePath } : a,
                    ),
                  }
                : e,
            ),
          }));
        });
      },
      removeAttachment: (expenseId, attachmentId) => {
        const expense = get().expenses.find((e) => e.id === expenseId);
        const attachment = expense?.attachments.find((a) => a.id === attachmentId);
        set((state) => ({
          expenses: state.expenses.map((e) =>
            e.id === expenseId
              ? { ...e, attachments: e.attachments.filter((a) => a.id !== attachmentId) }
              : e,
          ),
        }));
        if (attachment?.uri) deleteCachedAttachmentFile(attachment.uri);
        deleteAttachmentRemote(attachmentId, attachment?.storagePath);
      },

      fetchFromSupabase: async () => {
        const userId = await getUserId();
        if (!userId) return;

        const [expensesResult, budgetsResult] = await Promise.all([
          supabase
            .from('expenses')
            .select('id, series_id, is_recurring, recurrence_frequency, recurrence_anchor_day, name, amount, category, next_payment_date, created_at')
            .eq('user_id', userId),
          supabase
            .from('expense_category_budgets')
            .select('category, monthly_limit')
            .eq('user_id', userId),
        ]);

        // APP-040: convert and validate the complete remote snapshot BEFORE any
        // state change. One invalid amount rejects the whole fetch, so invalid
        // server money can never overwrite or mix into valid local data.
        let remoteExpenses: Expense[] | null = null;
        let remoteBudgets: { category: string; limit: MinorUnits }[] | null = null;
        try {
          if (!expensesResult.error && expensesResult.data) {
            remoteExpenses = (expensesResult.data as ExpenseRow[]).map(expenseFromRow);
          }
          if (!budgetsResult.error && budgetsResult.data) {
            remoteBudgets = (budgetsResult.data as { category: string; monthly_limit: unknown }[]).map((row) => ({
              category: row.category,
              limit: serverNumericToMinorUnits(row.monthly_limit),
            }));
          }
        } catch {
          return; // rejected: MoneyError carries only a fixed code, and nothing is logged
        }

        let newExpenseIds: string[] = [];

        set((state) => {
          const next: Partial<ExpensesState> = {};

          if (remoteExpenses) {
            const existingIds = new Set(state.expenses.map((e) => e.id));
            const fetched = remoteExpenses.filter((expense) => !existingIds.has(expense.id));
            newExpenseIds = fetched.map((expense) => expense.id);
            next.expenses = [...state.expenses, ...fetched];
          }

          if (remoteBudgets) {
            const merged = { ...state.categoryBudgets };
            for (const budget of remoteBudgets) {
              if (!(budget.category in merged)) merged[budget.category] = budget.limit;
            }
            next.categoryBudgets = merged;
          }

          return next;
        });

        // Hent vedhæftninger for de nye udgifter (fx på et andet device) —
        // sker efter set() ovenfor, så listen viser sig med det samme uden billeder,
        // og billederne popper ind, når de signerede URL'er er hentet.
        // The answer is merged by id rather than replacing the list: a local-only
        // attachment added meanwhile (an APP-059 legacy Travel handoff, or one the
        // user just added) is not on the server and must not be dropped.
        for (const expenseId of newExpenseIds) {
          fetchAttachmentsFor('expense', expenseId).then((attachments) => {
            if (attachments.length === 0) return;
            const remoteIds = new Set(attachments.map((attachment) => attachment.id));
            set((state) => ({
              expenses: state.expenses.map((e) => (e.id === expenseId
                ? { ...e, attachments: [...attachments, ...e.attachments.filter((local) => !remoteIds.has(local.id))] }
                : e)),
            }));
          });
        }
      },
    }),
    {
      name: 'lifesort-expenses',
      // APP-040 v1: money in DKK MinorUnits. APP-042 v2: explicit recurrenceFrequency.
      // The encrypted adapter runs both upgrades before hydration.
      version: 2,
      storage: createJSONStorage(() => migrationGatedStorage(documentMetadataEncryptedStorage)),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const seenIds = new Set<string>();
        state.expenses = state.expenses.filter((e) => {
          if (seenIds.has(e.id)) return false;
          seenIds.add(e.id);
          return true;
        });
        state.expenses = state.expenses.map((e) => ({ ...e, attachments: e.attachments ?? [] }));
      },
    }
  )
);
