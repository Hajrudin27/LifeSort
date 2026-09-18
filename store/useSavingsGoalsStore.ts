import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import { newEntityId } from '@/core/ids';
import {
  addMinorUnits,
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
import {
  allocationMovements,
  applySavingsMovements,
  contributionMovements,
  savingsDeadline,
  savingsTarget,
  transferMovements,
  type SavingsMovement,
} from "@/utils/savings/savingsGoalRules";

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

/**
 * APP-043: history is attempted only after the goal upsert has SUCCEEDED, so the
 * (user_id, goal_id) foreign key never sees history ahead of its goal, and a
 * refused goal write cannot leave server history describing a balance change the
 * server balance never got. Supabase reports query failures as `{ error }`
 * rather than throwing. Still the legacy best-effort path: nothing is retried or
 * logged, and a history insert that fails after its goal succeeded is not rolled
 * back (known sync debt, see docs/app-043-savings-goals.md).
 */
async function syncMovements(goals: SavingsGoal[], contributions: SavingsContribution[]) {
  const userId = await getUserId();
  if (!userId) return;
  const { error } = await supabase
    .from("savings_goals")
    .upsert(goals.map((g) => goalToRow(userId, g)));
  if (error) return;
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

type Movable = Pick<SavingsGoalsState, "goals" | "history">;

/**
 * APP-043: the only way a balance changes. Movements are validated against the
 * current goals first (utils/savings/savingsGoalRules.ts); then each is applied
 * to its goal AND appended as history with the same amount, in one set().
 */
function commitMovements(
  current: Movable,
  set: (next: Movable) => void,
  movements: readonly SavingsMovement[],
) {
  const nextGoals = applySavingsMovements(current.goals, movements);
  const date = new Date().toISOString();
  const entries: SavingsContribution[] = movements.map((movement) => ({
    id: newEntityId(),
    goalId: movement.goalId,
    amount: movement.amount,
    date,
  }));

  set({ goals: nextGoals, history: [...current.history, ...entries] });

  const touchedIds = new Set(movements.map((movement) => movement.goalId));
  syncMovements(nextGoals.filter((g) => touchedIds.has(g.id)), entries);
}

/*
 * APP-040: every amount an action persists — input, contribution, resulting
 * balance and resulting extra savings — passes `supportedMoney` BEFORE set().
 * APP-043: target, deadline and every balance movement are validated by
 * utils/savings/savingsGoalRules.ts. Actions compute the complete next state
 * from get() first, so a rejected operation leaves the store, the persisted
 * bytes and the server untouched.
 */

export const useSavingsGoalsStore = create<SavingsGoalsState>()(
  persist(
    (set, get) => ({
      goals: [],
      history: [],
      extraSavings: ZERO_MINOR_UNITS,

      addGoal: (input) => {
        const targetAmount = savingsTarget(input.targetAmount);
        const deadline = savingsDeadline(input.deadline);
        const id = newEntityId();
        const newGoal: SavingsGoal = {
          id,
          createdAt: new Date().toISOString(),
          savedAmount: ZERO_MINOR_UNITS,
          name: input.name,
          targetAmount,
          icon: input.icon,
          ...(deadline === undefined ? {} : { deadline }),
        };
        set((state) => ({ goals: [...state.goals, newGoal] }));
        syncUpsertGoal(newGoal);
        return id;
      },

      updateGoal: (id, updates) => {
        // Et målbeløb kan ikke fjernes; er feltet med, skal det være understøttede,
        // positive øre. Kun de redigerbare felter kopieres, så savedAmount aldrig
        // kan ændres herfra. En deadline kan fjernes (undefined).
        const checked: Partial<GoalEditableFields> = {};
        if (updates.name !== undefined) checked.name = updates.name;
        if (updates.icon !== undefined) checked.icon = updates.icon;
        if ('targetAmount' in updates) checked.targetAmount = savingsTarget(updates.targetAmount);
        if ('deadline' in updates) checked.deadline = savingsDeadline(updates.deadline);
        set((state) => ({
          goals: state.goals.map((g) =>
            g.id === id ? { ...g, ...checked } : g,
          ),
        }));
        const updated = get().goals.find((g) => g.id === id);
        if (updated) syncUpsertGoal(updated);
      },

      // Signed: positive deposits, negative withdrawals. A withdrawal larger than
      // the balance is refused, never clamped.
      addContribution: (id, amount) => {
        commitMovements(get(), set, contributionMovements(id, amount));
      },

      distributeContributions: (allocations) => {
        commitMovements(get(), set, allocationMovements(allocations));
      },

      transferBetweenGoals: (fromId, toId, amount) => {
        commitMovements(get(), set, transferMovements(fromId, toId, amount));
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
