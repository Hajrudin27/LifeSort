import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { supabase } from '@/lib/supabase';
import { Attachment } from '@/types/attachment';
import { Expense, ExpenseCategory } from '@/types/expense';
import { deleteAttachmentRemote, fetchAttachmentsFor, uploadAttachment } from '@/utils/shared/attachmentSync';

interface ExpensesState {
  expenses: Expense[];
  seriesStoppedAt: Record<string, string>; // seriesId -> måned den er stoppet fra
  categoryBudgets: Record<string, number>; // kategori -> månedligt loft
  addExpense: (input: {
    name: string;
    amount: number;
    category: ExpenseCategory;
    nextPaymentDate: string;
    isRecurring: boolean;
  }) => string;
  updateExpense: (id: string, updates: Partial<Omit<Expense, 'id' | 'seriesId' | 'createdAt' | 'attachments'>>) => void;
  removeExpense: (id: string) => void;
  deleteRecurringFromMonth: (seriesId: string, fromMonthKey: string) => void;
  rollForwardMonth: (monthKey: string) => void;
  setCategoryBudget: (category: string, limit: number) => void;
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
    amount: e.amount,
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

async function syncUpsertCategoryBudget(userId: string, category: string, limit: number) {
  await supabase.from('expense_category_budgets').upsert({ user_id: userId, category, monthly_limit: limit });
}

async function syncDeleteCategoryBudget(userId: string, category: string) {
  await supabase.from('expense_category_budgets').delete().eq('user_id', userId).eq('category', category);
}

export const useExpensesStore = create<ExpensesState>()(
  persist(
    (set, get) => ({
      expenses: [],
      seriesStoppedAt: {},
      categoryBudgets: {},

      addExpense: (input) => {
        const id = Date.now().toString();
        const newExpense: Expense = {
          id,
          seriesId: id, // ny udgift starter sin egen serie
          attachments: [],
          createdAt: new Date().toISOString(),
          ...input,
        };
        set((state) => ({ expenses: [...state.expenses, newExpense] }));
        syncUpsertExpense(newExpense);
        return id;
      },

      updateExpense: (id, updates) => {
        const target = get().expenses.find((e) => e.id === id);
        if (!target) return;

        const editedMonth = target.nextPaymentDate.slice(0, 7);
        const updatedExpense = { ...target, ...updates };

        let removedIds: string[] = [];

        set((state) => {
          const updated = state.expenses.map((e) => (e.id === id ? updatedExpense : e));

          const removed = updated.filter(
            (e) =>
              (e.seriesId ?? e.id) === (target.seriesId ?? target.id) &&
              e.id !== id &&
              e.nextPaymentDate.slice(0, 7) > editedMonth
          );
          removedIds = removed.map((e) => e.id);

          const cleaned = updated.filter((e) => !removedIds.includes(e.id));
          return { expenses: cleaned };
        });

        syncUpsertExpense(updatedExpense);
        if (removedIds.length > 0) syncDeleteExpenses(removedIds);
      },

      removeExpense: (id) => {
        set((state) => ({
          expenses: state.expenses.filter((e) => e.id !== id),
        }));
        syncDeleteExpense(id);
      },

      deleteRecurringFromMonth: (seriesId, fromMonthKey) => {
        const removedIds = get()
          .expenses.filter((e) => e.seriesId === seriesId && e.nextPaymentDate.slice(0, 7) >= fromMonthKey)
          .map((e) => e.id);

        set((state) => ({
          expenses: state.expenses.filter(
            (e) => !(e.seriesId === seriesId && e.nextPaymentDate.slice(0, 7) >= fromMonthKey)
          ),
          seriesStoppedAt: { ...state.seriesStoppedAt, [seriesId]: fromMonthKey },
        }));

        if (removedIds.length > 0) syncDeleteExpenses(removedIds);
      },

      rollForwardMonth: (monthKey) => {
        let createdInstances: Expense[] = [];

        set((state) => {
          const existingIds = new Set(state.expenses.map((e) => e.id));
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

            const newId = `${seriesId}-${monthKey}`;
            if (existingIds.has(newId)) continue; // ekstra sikkerhedsnet mod dobbelt-kald

            newInstances.push({
              ...latestBefore,
              id: newId,
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
        set((state) => ({
          categoryBudgets: { ...state.categoryBudgets, [category]: limit },
        }));
        getUserId().then((userId) => {
          if (userId) syncUpsertCategoryBudget(userId, category, limit);
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

        let newExpenseIds: string[] = [];

        set((state) => {
          const next: Partial<ExpensesState> = {};

          if (!expensesResult.error && expensesResult.data) {
            const existingIds = new Set(state.expenses.map((e) => e.id));
            const newRows = expensesResult.data.filter((row) => !existingIds.has(row.id));
            newExpenseIds = newRows.map((row) => row.id);

            const fetched: Expense[] = newRows.map((row) => ({
              id: row.id,
              seriesId: row.series_id ?? row.id,
              isRecurring: row.is_recurring,
              name: row.name,
              amount: Number(row.amount),
              category: row.category as ExpenseCategory,
              nextPaymentDate: row.next_payment_date,
              attachments: [],
              createdAt: row.created_at,
            }));
            next.expenses = [...state.expenses, ...fetched];
          }

          if (!budgetsResult.error && budgetsResult.data) {
            const merged = { ...state.categoryBudgets };
            for (const row of budgetsResult.data) {
              if (!(row.category in merged)) merged[row.category] = Number(row.monthly_limit);
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
      storage: createJSONStorage(() => AsyncStorage),
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