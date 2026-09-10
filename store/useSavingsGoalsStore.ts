import { newEntityId } from '@/core/ids';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { supabase } from "@/lib/supabase";
import {
  SavingsContribution,
  SavingsGoal,
  SavingsGoalIcon,
} from "@/types/savingsGoal";

type GoalEditableFields = Pick<
  SavingsGoal,
  "name" | "targetAmount" | "icon" | "deadline"
>;

interface SavingsGoalsState {
  goals: SavingsGoal[];
  history: SavingsContribution[];
  extraSavings: number;
  addGoal: (input: {
    name: string;
    targetAmount: number;
    icon: SavingsGoalIcon;
    deadline?: string;
  }) => string;
  updateGoal: (id: string, updates: Partial<GoalEditableFields>) => void;
  addContribution: (id: string, amount: number) => void;
  distributeContributions: (
    allocations: { id: string; amount: number }[],
  ) => void;
  transferBetweenGoals: (fromId: string, toId: string, amount: number) => void;
  removeGoal: (id: string) => void;
  addExtraSavings: (amount: number) => void;
  archiveGoal: (id: string) => void;
  unarchiveGoal: (id: string) => void;
  fetchFromSupabase: () => Promise<void>;
}

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

function goalToRow(userId: string, g: SavingsGoal) {
  return {
    id: g.id,
    user_id: userId,
    name: g.name,
    icon: g.icon,
    target_amount: g.targetAmount,
    saved_amount: g.savedAmount,
    deadline: g.deadline ?? null,
    archived: g.archived ?? false,
    created_at: g.createdAt,
  };
}

function contributionToRow(userId: string, c: SavingsContribution) {
  return {
    id: c.id,
    user_id: userId,
    goal_id: c.goalId,
    amount: c.amount,
    date: c.date,
  };
}

async function syncUpsertGoal(goal: SavingsGoal) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from("savings_goals").upsert(goalToRow(userId, goal));
}

async function syncUpsertGoals(goals: SavingsGoal[]) {
  const userId = await getUserId();
  if (!userId || goals.length === 0) return;
  await supabase
    .from("savings_goals")
    .upsert(goals.map((g) => goalToRow(userId, g)));
}

async function syncInsertContributions(contributions: SavingsContribution[]) {
  const userId = await getUserId();
  if (!userId || contributions.length === 0) return;
  await supabase
    .from("savings_history")
    .insert(contributions.map((c) => contributionToRow(userId, c)));
}

async function syncDeleteGoal(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase
    .from("savings_goals")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  await supabase
    .from("savings_history")
    .delete()
    .eq("user_id", userId)
    .eq("goal_id", id);
}

async function syncExtraSavings(amount: number) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from("savings_extra").upsert({ user_id: userId, amount });
}

export const useSavingsGoalsStore = create<SavingsGoalsState>()(
  persist(
    (set, get) => ({
      goals: [],
      history: [],
      extraSavings: 0,

      addGoal: (input) => {
        const id = newEntityId();
        const newGoal: SavingsGoal = {
          id,
          createdAt: new Date().toISOString(),
          savedAmount: 0,
          ...input,
        };
        set((state) => ({ goals: [...state.goals, newGoal] }));
        syncUpsertGoal(newGoal);
        return id;
      },

      updateGoal: (id, updates) => {
        set((state) => ({
          goals: state.goals.map((g) =>
            g.id === id ? { ...g, ...updates } : g,
          ),
        }));
        const updated = get().goals.find((g) => g.id === id);
        if (updated) syncUpsertGoal(updated);
      },

      addContribution: (id, amount) => {
        const contribution: SavingsContribution = {
          id: newEntityId(),
          goalId: id,
          amount,
          date: new Date().toISOString(),
        };

        set((state) => ({
          goals: state.goals.map((g) =>
            g.id === id
              ? { ...g, savedAmount: Math.max(0, g.savedAmount + amount) }
              : g,
          ),
          history: [...state.history, contribution],
        }));

        const updatedGoal = get().goals.find((g) => g.id === id);
        if (updatedGoal) syncUpsertGoal(updatedGoal);
        syncInsertContributions([contribution]);
      },

      distributeContributions: (allocations) => {
        const newContributions: SavingsContribution[] = allocations.map(
          (a) => ({
            id: newEntityId(),
            goalId: a.id,
            amount: a.amount,
            date: new Date().toISOString(),
          }),
        );

        set((state) => ({
          goals: state.goals.map((g) => {
            const allocation = allocations.find((a) => a.id === g.id);
            return allocation
              ? { ...g, savedAmount: g.savedAmount + allocation.amount }
              : g;
          }),
          history: [...state.history, ...newContributions],
        }));

        const touchedIds = new Set(allocations.map((a) => a.id));
        const touchedGoals = get().goals.filter((g) => touchedIds.has(g.id));
        syncUpsertGoals(touchedGoals);
        syncInsertContributions(newContributions);
      },

      transferBetweenGoals: (fromId, toId, amount) => {
        const fromContribution: SavingsContribution = {
          id: newEntityId(),
          goalId: fromId,
          amount: -amount,
          date: new Date().toISOString(),
        };
        const toContribution: SavingsContribution = {
          id: newEntityId(),
          goalId: toId,
          amount,
          date: new Date().toISOString(),
        };

        set((state) => ({
          goals: state.goals.map((g) => {
            if (g.id === fromId)
              return { ...g, savedAmount: Math.max(0, g.savedAmount - amount) };
            if (g.id === toId)
              return { ...g, savedAmount: g.savedAmount + amount };
            return g;
          }),
          history: [...state.history, fromContribution, toContribution],
        }));

        const touchedGoals = get().goals.filter(
          (g) => g.id === fromId || g.id === toId,
        );
        syncUpsertGoals(touchedGoals);
        syncInsertContributions([fromContribution, toContribution]);
      },

      removeGoal: (id) => {
        set((state) => ({
          goals: state.goals.filter((g) => g.id !== id),
          history: state.history.filter((h) => h.goalId !== id),
        }));
        syncDeleteGoal(id);
      },

      addExtraSavings: (amount) => {
        set((state) => ({ extraSavings: state.extraSavings + amount }));
        const updated = get().extraSavings;
        syncExtraSavings(updated);
      },

      archiveGoal: (id) => {
        set((state) => ({
          goals: state.goals.map((g) =>
            g.id === id ? { ...g, archived: true } : g,
          ),
        }));
        const updated = get().goals.find((g) => g.id === id);
        if (updated) syncUpsertGoal(updated);
      },

      unarchiveGoal: (id) => {
        set((state) => ({
          goals: state.goals.map((g) =>
            g.id === id ? { ...g, archived: false } : g,
          ),
        }));
        const updated = get().goals.find((g) => g.id === id);
        if (updated) syncUpsertGoal(updated);
      },

      fetchFromSupabase: async () => {
        const userId = await getUserId();
        if (!userId) return;

        const [goalsResult, historyResult, extraResult] = await Promise.all([
          supabase
            .from("savings_goals")
            .select(
              "id, name, icon, target_amount, saved_amount, deadline, archived, created_at",
            )
            .eq("user_id", userId),
          supabase
            .from("savings_history")
            .select("id, goal_id, amount, date")
            .eq("user_id", userId),
          supabase
            .from("savings_extra")
            .select("amount")
            .eq("user_id", userId)
            .single(),
        ]);

        if (goalsResult.error || historyResult.error) return;

        set((state) => {
          const existingGoalIds = new Set(state.goals.map((g) => g.id));
          const fetchedGoals: SavingsGoal[] = (goalsResult.data ?? [])
            .filter((row) => !existingGoalIds.has(row.id))
            .map((row) => ({
              id: row.id,
              name: row.name,
              icon: row.icon as SavingsGoalIcon,
              targetAmount: Number(row.target_amount),
              savedAmount: Number(row.saved_amount),
              deadline: row.deadline ?? undefined,
              archived: row.archived ?? false,
              createdAt: row.created_at,
            }));

          const existingHistoryIds = new Set(state.history.map((h) => h.id));
          const fetchedHistory: SavingsContribution[] = (
            historyResult.data ?? []
          )
            .filter((row) => !existingHistoryIds.has(row.id))
            .map((row) => ({
              id: row.id,
              goalId: row.goal_id,
              amount: Number(row.amount),
              date: row.date,
            }));

          const extraSavings =
            state.extraSavings === 0 && !extraResult.error && extraResult.data
              ? Number(extraResult.data.amount)
              : state.extraSavings;

          return {
            goals: [...state.goals, ...fetchedGoals],
            history: [...state.history, ...fetchedHistory],
            extraSavings,
          };
        });
      },
    }),
    {
      name: "lifesort-savings-goals",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
