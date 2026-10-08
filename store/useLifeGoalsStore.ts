import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import { newEntityId } from '@/core/ids';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  buildGoal,
  decodeRemoteGoalRow,
  goalToRow,
  GoalError,
  updateGoalFields,
  withCompleted,
  withCurrent,
  withMilestone,
  withMilestoneToggled,
  withoutMilestone,
  type GoalUpdate,
  type NewGoalInput,
} from '@/features/goals/domain/goal';
import { supabase } from '@/lib/supabase';
import { trackSync } from '@/store/useSyncStatusStore';
import type { LifeGoal } from '@/types/life';

/**
 * APP-063. Canonical goals with explicit types; every mutation is validated by the domain
 * before it is stored and throws a fixed `GoalError` code, leaving state untouched.
 *
 * Sync is still the original best-effort model (whole-row upsert, append-only refresh).
 * That is a known, deliberately deferred limitation (ADR-0051): until the "Goals durable
 * sync" follow-up lands, concurrent numeric changes, the target/current pair, title versus
 * completion, the whole milestone list, delete versus edit, offline writes and stale-client
 * resurrection can all lose or resurrect data. Only account binding and stale-fetch are fixed.
 */
interface LifeGoalsState {
  goals: LifeGoal[];
  /** Validates `input` and returns the new goal's id. Throws `GoalError`. */
  addGoal: (input: NewGoalInput) => string;
  updateGoal: (id: string, updates: GoalUpdate) => void;
  /** Absolute value, never a delta. Numeric goals only. */
  setGoalCurrent: (id: string, current: number) => void;
  /** Binary goals only: mark as done / reopen. */
  setGoalCompleted: (id: string, completed: boolean) => void;
  removeGoal: (id: string) => void;

  addMilestone: (goalId: string, title: string) => void;
  toggleMilestone: (goalId: string, milestoneId: string) => void;
  removeMilestone: (goalId: string, milestoneId: string) => void;

  fetchFromSupabase: () => Promise<void>;
  restoreBackup: (partial: { goals?: LifeGoal[] }) => void;
  clearLocal: () => void;
}

let datasetEpoch = 0;

/** Resolved only when an action or fetch runs, so a read-only import does not start the auth flow. */
function initiatingAccountId(): string | null {
  const { useAuthStore } = require('@/store/useAuthStore') as typeof import('@/store/useAuthStore');
  return useAuthStore.getState().session?.user.id ?? null;
}

/**
 * The owner is captured when the user acts and travels with the write. After the only
 * await the live session must still be that account; if it switched, the write is dropped.
 * A request that still reaches the server under another session carries the initiator's
 * `user_id`, so the owner RLS refuses it instead of re-owning the goal.
 */
async function sessionStillOwnedBy(accountId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getSession();
    return !error && data.session?.user.id === accountId;
  } catch {
    return false;
  }
}

async function syncUpsertGoal(accountId: string | null, goal: LifeGoal) {
  if (!accountId || !(await sessionStillOwnedBy(accountId))) return;
  await supabase.from('life_goals').upsert(goalToRow(accountId, goal));
}

async function syncDeleteGoal(accountId: string | null, id: string) {
  if (!accountId || !(await sessionStillOwnedBy(accountId))) return;
  await supabase.from('life_goals').delete().eq('user_id', accountId).eq('id', id);
}

const COLUMNS = 'id, title, description, deadline, sub_goals, created_at, goal_type, target_value, current_value, unit, completed';

export const useLifeGoalsStore = create<LifeGoalsState>()(
  persist(
    (set, get) => {
      /** Apply one validated change to one goal, then sync that goal as its initiator. */
      const change = (id: string, transform: (goal: LifeGoal) => LifeGoal) => {
        const accountId = initiatingAccountId();
        const current = get().goals.find((goal) => goal.id === id);
        if (!current) return;
        const next = transform(current); // throws before any state change
        set((state) => ({ goals: state.goals.map((goal) => (goal.id === id ? next : goal)) }));
        void syncUpsertGoal(accountId, next);
      };

      return {
        goals: [],

        addGoal: (input) => {
          const accountId = initiatingAccountId();
          const goal = buildGoal(input, newEntityId(), new Date().toISOString());
          set((state) => ({ goals: [...state.goals, goal] }));
          void syncUpsertGoal(accountId, goal);
          return goal.id;
        },
        updateGoal: (id, updates) => change(id, (goal) => updateGoalFields(goal, updates)),
        setGoalCurrent: (id, current) => change(id, (goal) => withCurrent(goal, current)),
        setGoalCompleted: (id, completed) => change(id, (goal) => withCompleted(goal, completed)),
        removeGoal: (id) => {
          const accountId = initiatingAccountId();
          set((state) => ({ goals: state.goals.filter((goal) => goal.id !== id) }));
          void syncDeleteGoal(accountId, id);
        },

        addMilestone: (goalId, title) => change(goalId, (goal) => {
          const trimmed = typeof title === 'string' ? title.trim() : '';
          if (!trimmed) throw new GoalError('goal_milestone_invalid');
          return withMilestone(goal, { id: newEntityId(), title: trimmed, completed: false });
        }),
        toggleMilestone: (goalId, milestoneId) => change(goalId, (goal) => withMilestoneToggled(goal, milestoneId)),
        removeMilestone: (goalId, milestoneId) => change(goalId, (goal) => withoutMilestone(goal, milestoneId)),

        fetchFromSupabase: async () => {
          const accountId = initiatingAccountId();
          const epoch = datasetEpoch;
          if (!accountId) return;
          const stillActive = () => epoch === datasetEpoch && initiatingAccountId() === accountId;
          if (!(await sessionStillOwnedBy(accountId)) || !stillActive()) return;

          const { data, error } = await supabase.from('life_goals').select(COLUMNS).eq('user_id', accountId);
          // The response belongs to the account that asked. If it logged out or another account
          // signed in while the request was in flight, nothing of it may reach the store.
          if (!stillActive() || !(await sessionStillOwnedBy(accountId)) || !stillActive()) return;
          if (!trackSync('lifeGoals', 'fetch', { error })) return;
          if (!data) return;

          set((state) => {
            const existingIds = new Set(state.goals.map((goal) => goal.id));
            // Rows that fail validation are dropped, never rendered and never guessed at.
            const fetched = data.flatMap((row) => {
              const goal = decodeRemoteGoalRow(row);
              return goal && !existingIds.has(goal.id) ? [goal] : [];
            });
            return { goals: [...state.goals, ...fetched] };
          });
        },

        restoreBackup: (partial) => {
          datasetEpoch += 1;
          set((state) => ({ goals: partial.goals ?? state.goals }));
        },

        clearLocal: () => {
          datasetEpoch += 1;
          set({ goals: [] });
        },
      };
    },
    {
      name: 'lifesort-life-goals',
      version: 1,
      storage: createJSONStorage(() => migrationGatedStorage(AsyncStorage)),
      partialize: (state) => ({ goals: state.goals }),
    },
  ),
);
