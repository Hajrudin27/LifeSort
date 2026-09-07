import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { supabase } from '@/lib/supabase';
import { trackSync } from '@/store/useSyncStatusStore';
import { TodoImportance, TodoItem } from '@/types/life';
import { createSyncQueue } from '@/utils/shared/syncQueue';

function newId() {
  return `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

interface TodoState {
  todos: TodoItem[];
  addTodo: (input: { title: string; description?: string; importance: TodoImportance; dueDate?: string }) => void;
  updateTodo: (id: string, updates: Partial<Pick<TodoItem, 'title' | 'description' | 'importance' | 'dueDate'>>) => void;
  toggleTodo: (id: string) => void;
  removeTodo: (id: string) => void;
  fetchFromSupabase: () => Promise<void>;
}

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

function toRow(userId: string, t: TodoItem) {
  return {
    id: t.id,
    user_id: userId,
    title: t.title,
    description: t.description ?? null,
    importance: t.importance,
    due_date: t.dueDate ?? null,
    completed: t.completed,
    created_at: t.createdAt,
  };
}

async function syncUpsertTodo(todo: TodoItem) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('todos').upsert(toRow(userId, todo));
}

async function syncDeleteTodo(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('todos').delete().eq('user_id', userId).eq('id', id);
}

// Bruges kun til toggleTodo — at afkrydse flere gøremål hurtigt i træk skal ikke
// sende ét netværkskald pr. klik. Andre handlinger (opret/redigér/slet) er sjældnere
// og sender stadig med det samme, så brugeren ser fejl hurtigt, hvis noget går galt.
const todoToggleQueue = createSyncQueue<TodoItem>(async (items) => {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('todos').upsert(items.map((t) => toRow(userId, t)));
});

export const useTodoStore = create<TodoState>()(
  persist(
    (set, get) => ({
      todos: [],

      addTodo: (input) => {
        const newTodo: TodoItem = { id: newId(), completed: false, createdAt: new Date().toISOString(), ...input };
        set((state) => ({ todos: [...state.todos, newTodo] }));
        syncUpsertTodo(newTodo);
      },

      updateTodo: (id, updates) => {
        set((state) => ({
          todos: state.todos.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        }));
        const target = get().todos.find((t) => t.id === id);
        if (target) syncUpsertTodo(target);
      },

      toggleTodo: (id) => {
        set((state) => ({
          todos: state.todos.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)),
        }));
        const target = get().todos.find((t) => t.id === id);
        if (target) todoToggleQueue.enqueue(target);
      },

      removeTodo: (id) => {
        set((state) => ({ todos: state.todos.filter((t) => t.id !== id) }));
        syncDeleteTodo(id);
      },

      fetchFromSupabase: async () => {
        const userId = await getUserId();
        if (!userId) return;

        const { data, error } = await supabase
          .from('todos')
          .select('id, title, description, importance, due_date, completed, created_at')
          .eq('user_id', userId);

        if (!trackSync('todos', 'fetch', { error })) return;
        if (!data) return;

        set((state) => {
          const existingIds = new Set(state.todos.map((t) => t.id));
          const fetched: TodoItem[] = data
            .filter((row) => !existingIds.has(row.id))
            .map((row) => ({
              id: row.id,
              title: row.title,
              description: row.description ?? undefined,
              importance: row.importance as TodoImportance,
              dueDate: row.due_date ?? undefined,
              completed: row.completed,
              createdAt: row.created_at,
            }));

          return { todos: [...state.todos, ...fetched] };
        });
      },
    }),
    {
      name: 'lifesort-todos',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);