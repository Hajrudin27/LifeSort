import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * APP-065. Which habits the user has chosen to see a streak for.
 *
 * Per habit, explicit opt-in, off by default, on this device only: it is not synced, not part of
 * a backup and is cleared on logout. The habit itself carries no streak field, because nothing
 * about a habit says whether a streak would be welcome (the title is never read to guess), so
 * the choice is a separate list of habit ids. The streak number is never stored.
 *
 * The list fails closed. Anything on disk that is not a list of non-empty strings is treated as
 * "no habit has streaks"; an id that matches no habit is harmless.
 */
interface HabitPreferencesState {
  streakEnabledHabitIds: string[];
  isStreakEnabled: (habitId: string) => boolean;
  setStreakEnabled: (habitId: string, enabled: boolean) => void;
  /** Called when a habit is deleted, so its choice does not outlive it. */
  removeHabitPreferences: (habitId: string) => void;
  clearLocal: () => void;
}

/** Only real habit ids survive; no truthy coercion, no duplicates. */
export function sanitizeStreakEnabledHabitIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) return [];
    ids.add(entry);
  }
  return [...ids];
}

export const useHabitPreferencesStore = create<HabitPreferencesState>()(
  persist(
    (set, get) => ({
      streakEnabledHabitIds: [],

      isStreakEnabled: (habitId) => get().streakEnabledHabitIds.includes(habitId),

      setStreakEnabled: (habitId, enabled) =>
        set((state) => {
          const without = state.streakEnabledHabitIds.filter((id) => id !== habitId);
          return { streakEnabledHabitIds: enabled ? [...without, habitId] : without };
        }),

      removeHabitPreferences: (habitId) =>
        set((state) =>
          state.streakEnabledHabitIds.includes(habitId)
            ? { streakEnabledHabitIds: state.streakEnabledHabitIds.filter((id) => id !== habitId) }
            : state,
        ),

      clearLocal: () => set({ streakEnabledHabitIds: [] }),
    }),
    {
      name: 'lifesort-habit-preferences',
      storage: createJSONStorage(() => migrationGatedStorage(AsyncStorage)),
      partialize: (state) => ({ streakEnabledHabitIds: state.streakEnabledHabitIds }),
      merge: (persisted, current) => ({
        ...current,
        streakEnabledHabitIds: sanitizeStreakEnabledHabitIds(
          (persisted as { streakEnabledHabitIds?: unknown } | null | undefined)?.streakEnabledHabitIds,
        ),
      }),
    },
  ),
);
