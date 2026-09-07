import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { supabase } from '@/lib/supabase';
import { trackSync } from '@/store/useSyncStatusStore';
import { LifeGoal } from '@/types/life';

function newId() {
  return `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

interface LifeGoalsState {
  goals: LifeGoal[];
  addGoal: (input: { title: string; description?: string; deadline?: string }) => string;
  updateGoal: (id: string, updates: Partial<Pick<LifeGoal, 'title' | 'description' | 'deadline'>>) => void;
  removeGoal: (id: string) => void;

  addSubGoal: (goalId: string, title: string) => void;
  toggleSubGoal: (goalId: string, subGoalId: string) => void;
  removeSubGoal: (goalId: string, subGoalId: string) => void;

  fetchFromSupabase: () => Promise<void>;
}

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

function toRow(userId: string, g: LifeGoal) {
  return {
    id: g.id,
    user_id: userId,
    title: g.title,
    description: g.description ?? null,
    deadline: g.deadline ?? null,
    sub_goals: g.subGoals, // gemmes direkte som JSON, hele delmåls-listen på én gang
    created_at: g.createdAt,
  };
}

async function syncUpsertGoal(goal: LifeGoal) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('life_goals').upsert(toRow(userId, goal));
}

async function syncDeleteGoal(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('life_goals').delete().eq('user_id', userId).eq('id', id);
}

export const useLifeGoalsStore = create<LifeGoalsState>()(
  persist(
    (set, get) => ({
      goals: [],

      addGoal: (input) => {
        const id = newId();
        const newGoal: LifeGoal = { id, subGoals: [], createdAt: new Date().toISOString(), ...input };
        set((state) => ({ goals: [...state.goals, newGoal] }));
        syncUpsertGoal(newGoal);
        return id;
      },
      updateGoal: (id, updates) => {
        set((state) => ({
          goals: state.goals.map((g) => (g.id === id ? { ...g, ...updates } : g)),
        }));
        const target = get().goals.find((g) => g.id === id);
        if (target) syncUpsertGoal(target);
      },
      removeGoal: (id) => {
        set((state) => ({ goals: state.goals.filter((g) => g.id !== id) }));
        syncDeleteGoal(id);
      },

      addSubGoal: (goalId, title) => {
        set((state) => ({
          goals: state.goals.map((g) =>
            g.id === goalId ? { ...g, subGoals: [...g.subGoals, { id: newId(), title, completed: false }] } : g
          ),
        }));
        const target = get().goals.find((g) => g.id === goalId);
        if (target) syncUpsertGoal(target);
      },
      toggleSubGoal: (goalId, subGoalId) => {
        set((state) => ({
          goals: state.goals.map((g) =>
            g.id === goalId
              ? { ...g, subGoals: g.subGoals.map((sg) => (sg.id === subGoalId ? { ...sg, completed: !sg.completed } : sg)) }
              : g
          ),
        }));
        const target = get().goals.find((g) => g.id === goalId);
        if (target) syncUpsertGoal(target);
      },
      removeSubGoal: (goalId, subGoalId) => {
        set((state) => ({
          goals: state.goals.map((g) =>
            g.id === goalId ? { ...g, subGoals: g.subGoals.filter((sg) => sg.id !== subGoalId) } : g
          ),
        }));
        const target = get().goals.find((g) => g.id === goalId);
        if (target) syncUpsertGoal(target);
      },

      fetchFromSupabase: async () => {
        const userId = await getUserId();
        if (!userId) return;

        const { data, error } = await supabase
          .from('life_goals')
          .select('id, title, description, deadline, sub_goals, created_at')
          .eq('user_id', userId);

        if (!trackSync('lifeGoals', 'fetch', { error })) return;
        if (!data) return;

        set((state) => {
          const existingIds = new Set(state.goals.map((g) => g.id));
          const fetched: LifeGoal[] = data
            .filter((row) => !existingIds.has(row.id))
            .map((row) => ({
              id: row.id,
              title: row.title,
              description: row.description ?? undefined,
              deadline: row.deadline ?? undefined,
              subGoals: row.sub_goals ?? [],
              createdAt: row.created_at,
            }));

          return { goals: [...state.goals, ...fetched] };
        });
      },
    }),
    {
      name: 'lifesort-life-goals',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);