import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import { newEntityId } from '@/core/ids';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  buildHabit,
  updateHabitFields,
  withDateCompleted,
  withSchedule,
  type HabitUpdate,
  type NewHabitInput,
} from '@/features/habits/domain/habitCommands';
import { decodeRemoteHabitRow, habitToRow } from '@/features/habits/domain/habitRow';
import { supabase } from '@/lib/supabase';
import { trackSync } from '@/store/useSyncStatusStore';
import type { Habit, HabitSchedule } from '@/types/life';
import { todayIso } from '@/utils/shared/localDate';

/**
 * APP-064. Canonical habits; every mutation is validated by the domain before it is stored and
 * throws a fixed `HabitError` code, leaving state untouched.
 *
 * Sync is still the original best-effort model (whole-row upsert, append-only refresh). That is
 * a known, deliberately deferred limitation (ADR-0052): until the "Habits durable sync"
 * follow-up lands, two devices marking or clearing different dates, a title edit against a
 * completion, a schedule change against a completion, delete against edit, offline writes and
 * stale-client resurrection can all lose or resurrect data — the whole `logs` array and
 * `schedule_history` travel in one row. Only account binding and stale-fetch are fixed here.
 * Habits are NOT PRODUCTION-SYNC-READY.
 */
interface HabitsState {
  habits: Habit[];
  /** Validates `input` and returns the new habit's id. Throws `HabitError`. */
  addHabit: (input: NewHabitInput) => string;
  /** Title, and direction while the habit has no entries. */
  updateHabit: (id: string, updates: HabitUpdate) => void;
  /** Effective from today, or from the next Monday when a weekly schedule is involved. */
  setHabitSchedule: (id: string, schedule: HabitSchedule) => void;
  /** Idempotent: states the wanted outcome for one local date, never a flip. */
  setHabitDateCompleted: (id: string, date: string, completed: boolean) => void;
  removeHabit: (id: string) => void;

  fetchFromSupabase: () => Promise<void>;
  restoreBackup: (partial: { habits?: Habit[] }) => void;
  clearLocal: () => void;
}

let datasetEpoch = 0;

/**
 * Called with the id of every habit deleted by `removeHabit`. A store may not import another
 * domain's store (architectureBoundaries R3), so device-local data keyed by habit id registers
 * here instead — see features/habits/habitRemoval.ts.
 */
const habitRemovedListeners = new Set<(habitId: string) => void>();
export function onHabitRemoved(listener: (habitId: string) => void): () => void {
  habitRemovedListeners.add(listener);
  return () => habitRemovedListeners.delete(listener);
}

/** Resolved only when an action or fetch runs, so a read-only import does not start the auth flow. */
function initiatingAccountId(): string | null {
  const { useAuthStore } = require('@/store/useAuthStore') as typeof import('@/store/useAuthStore');
  return useAuthStore.getState().session?.user.id ?? null;
}

/**
 * The owner is captured when the user acts and travels with the write. After the only await
 * the live session must still be that account; if it switched, the write is dropped. A request
 * that still reaches the server under another session carries the initiator's `user_id`, so the
 * owner RLS refuses it instead of re-owning the habit.
 */
async function sessionStillOwnedBy(accountId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getSession();
    return !error && data.session?.user.id === accountId;
  } catch {
    return false;
  }
}

/** `today` is captured when the user acts, like the account: the mirror column reflects that day, not the moment the request is built. */
async function syncUpsertHabit(accountId: string | null, habit: Habit, today: string) {
  if (!accountId || !(await sessionStillOwnedBy(accountId))) return;
  await supabase.from('habits').upsert(habitToRow(accountId, habit, today));
}

async function syncDeleteHabit(accountId: string | null, id: string) {
  if (!accountId || !(await sessionStillOwnedBy(accountId))) return;
  await supabase.from('habits').delete().eq('user_id', accountId).eq('id', id);
}

const COLUMNS = 'id, title, direction, target_per_week, logs, created_at, start_date, schedule_history';

export const useHabitsStore = create<HabitsState>()(
  persist(
    (set, get) => {
      /** Apply one validated change to one habit, then sync that habit as its initiator. */
      const change = (id: string, transform: (habit: Habit, today: string) => Habit) => {
        const accountId = initiatingAccountId();
        const current = get().habits.find((habit) => habit.id === id);
        if (!current) return;
        const today = todayIso();
        const next = transform(current, today); // throws before any state change
        if (next === current) return; // nothing changed: no write, no sync
        set((state) => ({ habits: state.habits.map((habit) => (habit.id === id ? next : habit)) }));
        void syncUpsertHabit(accountId, next, today);
      };

      return {
        habits: [],

        addHabit: (input) => {
          const accountId = initiatingAccountId();
          const today = todayIso();
          const habit = buildHabit(input, newEntityId(), new Date().toISOString(), today);
          set((state) => ({ habits: [...state.habits, habit] }));
          void syncUpsertHabit(accountId, habit, today);
          return habit.id;
        },
        updateHabit: (id, updates) => change(id, (habit) => updateHabitFields(habit, updates)),
        setHabitSchedule: (id, schedule) => change(id, (habit, today) => withSchedule(habit, schedule, today)),
        setHabitDateCompleted: (id, date, completed) =>
          change(id, (habit, today) => withDateCompleted(habit, date, completed, today, newEntityId)),
        removeHabit: (id) => {
          const accountId = initiatingAccountId();
          set((state) => ({ habits: state.habits.filter((habit) => habit.id !== id) }));
          // The cloud delete is queued first and each listener is isolated, so cleanup of device-local
          // data keyed by this habit (APP-065: its streak choice) can never block or undo the deletion.
          void syncDeleteHabit(accountId, id);
          habitRemovedListeners.forEach((listener) => {
            try {
              listener(id);
            } catch (error) {
              console.warn('Habit removal listener failed', error instanceof Error ? error.name : 'unknown');
            }
          });
        },

        fetchFromSupabase: async () => {
          const accountId = initiatingAccountId();
          const epoch = datasetEpoch;
          if (!accountId) return;
          const stillActive = () => epoch === datasetEpoch && initiatingAccountId() === accountId;
          if (!(await sessionStillOwnedBy(accountId)) || !stillActive()) return;

          const { data, error } = await supabase.from('habits').select(COLUMNS).eq('user_id', accountId);
          // The response belongs to the account that asked. If it logged out or another account
          // signed in while the request was in flight, nothing of it may reach the store.
          if (!stillActive() || !(await sessionStillOwnedBy(accountId)) || !stillActive()) return;
          if (!trackSync('habits', 'fetch', { error })) return;
          if (!data) return;

          set((state) => {
            const existingIds = new Set(state.habits.map((habit) => habit.id));
            // Rows that fail validation are dropped, never rendered and never guessed at.
            const fetched = data.flatMap((row) => {
              const habit = decodeRemoteHabitRow(row);
              return habit && !existingIds.has(habit.id) ? [habit] : [];
            });
            return { habits: [...state.habits, ...fetched] };
          });
        },

        restoreBackup: (partial) => {
          datasetEpoch += 1;
          set((state) => ({ habits: partial.habits ?? state.habits }));
        },

        clearLocal: () => {
          datasetEpoch += 1;
          set({ habits: [] });
        },
      };
    },
    {
      name: 'lifesort-habits',
      version: 1,
      storage: createJSONStorage(() => migrationGatedStorage(AsyncStorage)),
      partialize: (state) => ({ habits: state.habits }),
    },
  ),
);
