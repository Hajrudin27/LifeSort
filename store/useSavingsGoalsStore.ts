import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import { newEntityId } from '@/core/ids';
import {
  addMinorUnits,
  negateMinorUnits,
  subtractMinorUnits,
  ZERO_MINOR_UNITS,
  type MinorUnits,
} from '@/core/money/minorUnits';
import { minorUnitsToServerNumeric, serverNumericToMinorUnits } from '@/core/money/serverNumeric';
import { supportedMoney } from '@/core/money/supportedMoney';
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
  extraSavings: MinorUnits;
  addGoal: (input: {
    name: string;
    targetAmount: MinorUnits;
    icon: SavingsGoalIcon;
    deadline?: string;
  }) => string;
  updateGoal: (id: string, updates: Partial<GoalEditableFields>) => void;
  addContribution: (id: string, amount: MinorUnits) => void;
  distributeContributions: (
    allocations: { id: string; amount: MinorUnits }[],
  ) => void;
  transferBetweenGoals: (fromId: string, toId: string, amount: MinorUnits) => void;
  removeGoal: (id: string) => void;
  addExtraSavings: (amount: MinorUnits) => void;
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
    // APP-040: exact decimal DKK for numeric columns.
    target_amount: minorUnitsToServerNumeric(g.targetAmount),
    saved_amount: minorUnitsToServerNumeric(g.savedAmount),
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
    amount: minorUnitsToServerNumeric(c.amount),
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

async function syncExtraSavings(amount: MinorUnits) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase
    .from("savings_extra")
    .upsert({ user_id: userId, amount: minorUnitsToServerNumeric(amount) });
}

/** Saldo på et mål falder aldrig under nul ved ind- eller udbetaling (eksisterende regel). */
function nonNegative(amount: MinorUnits): MinorUnits {
  return amount < 0 ? ZERO_MINOR_UNITS : amount;
}

/*
 * APP-040: every amount an action persists — input, contribution, resulting
 * balance and resulting extra savings — passes `supportedMoney` BEFORE set().
 * Actions compute the complete next state from get() first, so a rejected
 * amount leaves the store (and the server) untouched.
 */

export const useSavingsGoalsStore = create<SavingsGoalsState>()(
  persist(
    (set, get) => ({
      goals: [],
      history: [],
      extraSavings: ZERO_MINOR_UNITS,

      addGoal: (input) => {
        const id = newEntityId();
        const newGoal: SavingsGoal = {
          id,
          createdAt: new Date().toISOString(),
          savedAmount: ZERO_MINOR_UNITS,
          ...input,
          targetAmount: supportedMoney(input.targetAmount),
        };
        set((state) => ({ goals: [...state.goals, newGoal] }));
        syncUpsertGoal(newGoal);
        return id;
      },

      updateGoal: (id, updates) => {
        // Et målbeløb kan ikke fjernes; er feltet med, skal det være understøttede øre.
        const checked =
          'targetAmount' in updates
            ? { ...updates, targetAmount: supportedMoney(updates.targetAmount) }
            : updates;
        set((state) => ({
          goals: state.goals.map((g) =>
            g.id === id ? { ...g, ...checked } : g,
          ),
        }));
        const updated = get().goals.find((g) => g.id === id);
        if (updated) syncUpsertGoal(updated);
      },

      addContribution: (id, amount) => {
        const contribution: SavingsContribution = {
          id: newEntityId(),
          goalId: id,
          amount: supportedMoney(amount),
          date: new Date().toISOString(),
        };
        const { goals, history } = get();
        const nextGoals = goals.map((g) =>
          g.id === id
            ? { ...g, savedAmount: supportedMoney(nonNegative(addMinorUnits(g.savedAmount, contribution.amount))) }
            : g,
        );

        set({ goals: nextGoals, history: [...history, contribution] });

        const updatedGoal = get().goals.find((g) => g.id === id);
        if (updatedGoal) syncUpsertGoal(updatedGoal);
        syncInsertContributions([contribution]);
      },

      distributeContributions: (allocations) => {
        const newContributions: SavingsContribution[] = allocations.map(
          (a) => ({
            id: newEntityId(),
            goalId: a.id,
            amount: supportedMoney(a.amount),
            date: new Date().toISOString(),
          }),
        );
        const { goals, history } = get();
        const nextGoals = goals.map((g) => {
          const allocation = newContributions.find((c) => c.goalId === g.id);
          return allocation
            ? { ...g, savedAmount: supportedMoney(addMinorUnits(g.savedAmount, allocation.amount)) }
            : g;
        });

        set({ goals: nextGoals, history: [...history, ...newContributions] });

        const touchedIds = new Set(allocations.map((a) => a.id));
        const touchedGoals = get().goals.filter((g) => touchedIds.has(g.id));
        syncUpsertGoals(touchedGoals);
        syncInsertContributions(newContributions);
      },

      transferBetweenGoals: (fromId, toId, amount) => {
        const transferred = supportedMoney(amount);
        const fromContribution: SavingsContribution = {
          id: newEntityId(),
          goalId: fromId,
          amount: negateMinorUnits(transferred),
          date: new Date().toISOString(),
        };
        const toContribution: SavingsContribution = {
          id: newEntityId(),
          goalId: toId,
          amount: transferred,
          date: new Date().toISOString(),
        };

        const { goals, history } = get();
        const nextGoals = goals.map((g) => {
          if (g.id === fromId)
            return { ...g, savedAmount: supportedMoney(nonNegative(subtractMinorUnits(g.savedAmount, transferred))) };
          if (g.id === toId)
            return { ...g, savedAmount: supportedMoney(addMinorUnits(g.savedAmount, transferred)) };
          return g;
        });

        set({ goals: nextGoals, history: [...history, fromContribution, toContribution] });

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
        const updated = supportedMoney(addMinorUnits(get().extraSavings, supportedMoney(amount)));
        set({ extraSavings: updated });
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

        // APP-040: convert and validate the complete remote savings snapshot
        // BEFORE any state change; one invalid amount rejects all of it.
        let remoteGoals: SavingsGoal[];
        let remoteHistory: SavingsContribution[];
        let remoteExtra: MinorUnits | null = null;
        try {
          remoteGoals = (goalsResult.data ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            icon: row.icon as SavingsGoalIcon,
            targetAmount: serverNumericToMinorUnits(row.target_amount),
            savedAmount: serverNumericToMinorUnits(row.saved_amount),
            deadline: row.deadline ?? undefined,
            archived: row.archived ?? false,
            createdAt: row.created_at,
          }));
          remoteHistory = (historyResult.data ?? []).map((row) => ({
            id: row.id,
            goalId: row.goal_id,
            amount: serverNumericToMinorUnits(row.amount),
            date: row.date,
          }));
          if (!extraResult.error && extraResult.data) {
            remoteExtra = serverNumericToMinorUnits(extraResult.data.amount);
          }
        } catch {
          return; // rejected: MoneyError carries only a fixed code, and nothing is logged
        }

        set((state) => {
          const existingGoalIds = new Set(state.goals.map((g) => g.id));
          const fetchedGoals = remoteGoals.filter((goal) => !existingGoalIds.has(goal.id));

          const existingHistoryIds = new Set(state.history.map((h) => h.id));
          const fetchedHistory = remoteHistory.filter((entry) => !existingHistoryIds.has(entry.id));

          const extraSavings =
            state.extraSavings === 0 && remoteExtra !== null
              ? remoteExtra
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
      // APP-040 v1: goals, history and extra savings in DKK MinorUnits.
      version: 1,
      storage: createJSONStorage(() => migrationGatedStorage(AsyncStorage)),
    },
  ),
);
