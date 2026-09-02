import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { supabase } from '@/lib/supabase';
import { Habit, HabitDirection } from '@/types/life';

function newId() {
  return `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

interface HabitsState {
  habits: Habit[];
  addHabit: (input: { title: string; direction: HabitDirection; targetPerWeek?: number }) => void;
  updateHabit: (id: string, updates: Partial<Pick<Habit, 'title' | 'direction' | 'targetPerWeek'>>) => void;
  removeHabit: (id: string) => void;
  toggleLogForDate: (id: string, dateKey: string) => void;
  fetchFromSupabase: () => Promise<void>;
}

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

function toRow(userId: string, h: Habit) {
  return {
    id: h.id,
    user_id: userId,
    title: h.title,
    direction: h.direction,
    target_per_week: h.targetPerWeek ?? null,
    logs: h.logs, // gemmes direkte som JSON, hele log-listen på én gang
    created_at: h.createdAt,
  };
}

async function syncUpsertHabit(habit: Habit) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('habits').upsert(toRow(userId, habit));
}

async function syncDeleteHabit(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('habits').delete().eq('user_id', userId).eq('id', id);
}

export const useHabitsStore = create<HabitsState>()(
  persist(
    (set, get) => ({
      habits: [],

      addHabit: (input) => {
        const newHabit: Habit = { id: newId(), logs: [], createdAt: new Date().toISOString(), ...input };
        set((state) => ({ habits: [...state.habits, newHabit] }));
        syncUpsertHabit(newHabit);
      },

      updateHabit: (id, updates) => {
        set((state) => ({
          habits: state.habits.map((h) => (h.id === id ? { ...h, ...updates } : h)),
        }));
        const target = get().habits.find((h) => h.id === id);
        if (target) syncUpsertHabit(target);
      },

      removeHabit: (id) => {
        set((state) => ({ habits: state.habits.filter((h) => h.id !== id) }));
        syncDeleteHabit(id);
      },

      toggleLogForDate: (id, dateKey) => {
        set((state) => ({
          habits: state.habits.map((h) => {
            if (h.id !== id) return h;
            const alreadyLogged = h.logs.some((l) => l.date.slice(0, 10) === dateKey);
            return {
              ...h,
              logs: alreadyLogged
                ? h.logs.filter((l) => l.date.slice(0, 10) !== dateKey)
                : [...h.logs, { id: newId(), date: dateKey }],
            };
          }),
        }));
        const target = get().habits.find((h) => h.id === id);
        if (target) syncUpsertHabit(target);
      },

      fetchFromSupabase: async () => {
        const userId = await getUserId();
        if (!userId) return;

        const { data, error } = await supabase
          .from('habits')
          .select('id, title, direction, target_per_week, logs, created_at')
          .eq('user_id', userId);

        if (error || !data) return;

        set((state) => {
          const existingIds = new Set(state.habits.map((h) => h.id));
          const fetched: Habit[] = data
            .filter((row) => !existingIds.has(row.id))
            .map((row) => ({
              id: row.id,
              title: row.title,
              direction: row.direction as HabitDirection,
              targetPerWeek: row.target_per_week ?? undefined,
              logs: row.logs ?? [],
              createdAt: row.created_at,
            }));

          return { habits: [...state.habits, ...fetched] };
        });
      },
    }),
    {
      name: 'lifesort-habits',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);