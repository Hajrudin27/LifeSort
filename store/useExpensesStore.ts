import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import { newEntityId } from '@/core/ids';
import type { MinorUnits } from '@/core/money/minorUnits';
import { minorUnitsToServerNumeric, serverNumericToMinorUnits } from '@/core/money/serverNumeric';
import { supportedMoney } from '@/core/money/supportedMoney';
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
  }) => string;
  updateExpense: (id: string, updates: Partial<Omit<Expense, 'id' | 'seriesId' | 'createdAt' | 'attachments'>>) => void;
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

// Bemærk: "attachments" sendes ALDRIG med i selve expense-raden — de synkroniseres
// separat til den delte `attachments`-tabel + Storage-bucket (se utils/shared/attachmentSync.ts).
function toRow(userId: string, e: Expense) {
  return {
    id: e.id,
    user_id: userId,
    series_id: e.seriesId ?? null,
    is_recurring: e.isRecurring,
    name: e.name,
    // APP-040: exact decimal DKK for the numeric column, never amount / 100.
    amount: minorUnitsToServerNumeric(e.amount),
    category: e.category,
    next_payment_date: e.nextPaymentDate,
    created_at: e.createdAt,
  };
}

async function syncUpsertExpense(expense: Expense) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('expenses').upsert(toRow(userId, expense));
}

async function syncUpsertExpenses(expenses: Expense[]) {
  const userId = await getUserId();
  if (!userId || expenses.length === 0) return;
  await supabase.from('expenses').upsert(expenses.map((e) => toRow(userId, e)));
}

async function syncDeleteExpense(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('expenses').delete().eq('user_id', userId).eq('id', id);
}

async function syncDeleteExpenses(ids: string[]) {
  const userId = await getUserId();
  if (!userId || ids.length === 0) return;
  await supabase.from('expenses').delete().eq('user_id', userId).in('id', ids);
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
        };
        set((state) => ({ expenses: [...state.expenses, newExpense] }));
        syncUpsertExpense(newExpense);
        return id;
      },

      updateExpense: (id, updates) => {
        const target = get().expenses.find((e) => e.id === id);
        if (!target) return;

        const editedMonth = target.nextPaymentDate.slice(0, 7);
        // Beløbet valideres altid før set(): en ikke-beløbsændring bevarer det eksisterende øre-beløb uændret.
        const updatedExpense = { ...target, ...updates, amount: supportedMoney(updates.amount ?? target.amount) };

        let removedExpenses: Expense[] = [];

        set((state) => {
          const updated = state.expenses.map((e) => (e.id === id ? updatedExpense : e));

          const removed = updated.filter(
            (e) =>
              (e.seriesId ?? e.id) === (target.seriesId ?? target.id) &&
              e.id !== id &&
              e.nextPaymentDate.slice(0, 7) > editedMonth
          );
          removedExpenses = removed;
          const removedIds = removedExpenses.map((e) => e.id);

          const cleaned = updated.filter((e) => !removedIds.includes(e.id));
          return { expenses: cleaned };
        });

        syncUpsertExpense(updatedExpense);
        const removedIds = removedExpenses.map((e) => e.id);
        if (removedIds.length > 0) syncDeleteExpenses(removedIds);
        for (const expense of removedExpenses) cleanupAttachments(expense.attachments);
      },

      removeExpense: (id) => {
        const target = get().expenses.find((e) => e.id === id);
        set((state) => ({
          expenses: state.expenses.filter((e) => e.id !== id),
        }));
        cleanupAttachments(target?.attachments);
        syncDeleteExpense(id);
      },

      deleteRecurringFromMonth: (seriesId, fromMonthKey) => {
        const removedExpenses = get().expenses.filter(
          (e) => e.seriesId === seriesId && e.nextPaymentDate.slice(0, 7) >= fromMonthKey,
        );
        const removedIds = removedExpenses.map((e) => e.id);

        set((state) => ({
          expenses: state.expenses.filter(
            (e) => !(e.seriesId === seriesId && e.nextPaymentDate.slice(0, 7) >= fromMonthKey)
          ),
          seriesStoppedAt: { ...state.seriesStoppedAt, [seriesId]: fromMonthKey },
        }));

        if (removedIds.length > 0) syncDeleteExpenses(removedIds);
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

            newInstances.push({
              // Beløbet er allerede i øre og kopieres uændret — aldrig skaleret igen.
              ...latestBefore,
              id: newEntityId(),
              seriesId, // også når en ældre rod kun har id og intet seriesId
              nextPaymentDate: `${monthKey}-${latestBefore.nextPaymentDate.slice(8)}`,
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
            .select('id, series_id, is_recurring, name, amount, category, next_payment_date, created_at')
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
        for (const expenseId of newExpenseIds) {
          fetchAttachmentsFor('expense', expenseId).then((attachments) => {
            if (attachments.length === 0) return;
            set((state) => ({
              expenses: state.expenses.map((e) => (e.id === expenseId ? { ...e, attachments } : e)),
            }));
          });
        }
      },
    }),
    {
      name: 'lifesort-expenses',
      // APP-040 v1: money in DKK MinorUnits. The encrypted adapter upgrades v0.
      version: 1,
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
