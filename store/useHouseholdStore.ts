import { newEntityId } from '@/core/ids';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { supabase } from '@/lib/supabase';
import i18n from '@/localization/i18n';
import {
  HouseholdItem,
  HouseholdTask,
  MovingItem,
  TaskAssignee,
  TaskFrequency,
  TaskKind,
} from '@/types/household';
import { createSyncQueue } from '@/utils/shared/syncQueue';
import { todayIso } from '@/utils/shared/localDate';

function otherAssignee(assignee: TaskAssignee): TaskAssignee {
  return assignee === 'me' ? 'partner' : 'me';
}

const DEFAULT_MOVING_KEYS = ['addressChange', 'internet', 'electricity', 'mailForwarding', 'insurance'];

interface HouseholdState {
  tasks: HouseholdTask[];
  addTask: (input: {
    kind: TaskKind;
    title: string;
    frequency: TaskFrequency;
    assignedTo?: TaskAssignee;
    rotates?: boolean;
  }) => void;
  updateTask: (
    id: string,
    updates: Partial<Pick<HouseholdTask, 'title' | 'frequency' | 'assignedTo' | 'rotates'>>,
  ) => void;
  markTaskDone: (id: string) => void;
  removeTask: (id: string) => void;

  shoppingItems: HouseholdItem[];
  addShoppingItem: (label: string) => void;
  toggleShoppingItem: (id: string) => void;
  removeShoppingItem: (id: string) => void;

  movingItems: MovingItem[];
  addMovingItem: (label: string) => void;
  toggleMovingItem: (id: string) => void;
  removeMovingItem: (id: string) => void;

  fetchFromSupabase: () => Promise<void>;
}

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

function taskToRow(userId: string, t: HouseholdTask) {
  return {
    id: t.id,
    user_id: userId,
    kind: t.kind,
    title: t.title,
    frequency: t.frequency,
    last_done: t.lastDone ?? null,
    assigned_to: t.assignedTo,
    rotates: t.rotates,
    created_at: t.createdAt,
  };
}

function shoppingItemToRow(userId: string, i: HouseholdItem) {
  return { id: i.id, user_id: userId, label: i.label, checked: i.checked };
}

function movingItemToRow(userId: string, i: MovingItem) {
  return { id: i.id, user_id: userId, label: i.label, checked: i.checked };
}

async function syncUpsertTask(task: HouseholdTask) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('household_tasks').upsert(taskToRow(userId, task));
}
async function syncDeleteTask(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('household_tasks').delete().eq('user_id', userId).eq('id', id);
}

async function syncUpsertShoppingItem(item: HouseholdItem) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('household_shopping_items').upsert(shoppingItemToRow(userId, item));
}
async function syncDeleteShoppingItem(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('household_shopping_items').delete().eq('user_id', userId).eq('id', id);
}

// Bruges kun til toggleShoppingItem — at krydse flere varer af i træk skal ikke
// sende ét netværkskald pr. klik.
const shoppingItemToggleQueue = createSyncQueue<HouseholdItem>(async (items) => {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('household_shopping_items').upsert(items.map((i) => shoppingItemToRow(userId, i)));
});

async function syncUpsertMovingItem(item: MovingItem) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('household_moving_items').upsert(movingItemToRow(userId, item));
}
async function syncDeleteMovingItem(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('household_moving_items').delete().eq('user_id', userId).eq('id', id);
}

export const useHouseholdStore = create<HouseholdState>()(
  persist(
    (set, get) => ({
      tasks: [],
      addTask: (input) => {
        const newTask: HouseholdTask = {
          id: newEntityId(),
          createdAt: new Date().toISOString(),
          assignedTo: input.assignedTo ?? 'me',
          rotates: input.rotates ?? false,
          ...input,
        };
        set((state) => ({ tasks: [...state.tasks, newTask] }));
        syncUpsertTask(newTask);
      },
      updateTask: (id, updates) => {
        set((state) => ({ tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)) }));
        const target = get().tasks.find((t) => t.id === id);
        if (target) syncUpsertTask(target);
      },
      markTaskDone: (id) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  lastDone: todayIso(),
                  assignedTo: t.rotates ? otherAssignee(t.assignedTo) : t.assignedTo,
                }
              : t,
          ),
        }));
        const target = get().tasks.find((t) => t.id === id);
        if (target) syncUpsertTask(target);
      },
      removeTask: (id) => {
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
        syncDeleteTask(id);
      },

      shoppingItems: [],
      addShoppingItem: (label) => {
        const newItem: HouseholdItem = { id: newEntityId(), label, checked: false };
        set((state) => ({ shoppingItems: [...state.shoppingItems, newItem] }));
        syncUpsertShoppingItem(newItem);
      },
      toggleShoppingItem: (id) => {
        set((state) => ({
          shoppingItems: state.shoppingItems.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)),
        }));
        const target = get().shoppingItems.find((i) => i.id === id);
        if (target) shoppingItemToggleQueue.enqueue(target);
      },
      removeShoppingItem: (id) => {
        set((state) => ({ shoppingItems: state.shoppingItems.filter((i) => i.id !== id) }));
        syncDeleteShoppingItem(id);
      },

      movingItems: [],
      addMovingItem: (label) => {
        const newItem: MovingItem = { id: newEntityId(), label, checked: false };
        set((state) => ({ movingItems: [...state.movingItems, newItem] }));
        syncUpsertMovingItem(newItem);
      },
      toggleMovingItem: (id) => {
        set((state) => ({
          movingItems: state.movingItems.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)),
        }));
        const target = get().movingItems.find((i) => i.id === id);
        if (target) syncUpsertMovingItem(target);
      },
      removeMovingItem: (id) => {
        set((state) => ({ movingItems: state.movingItems.filter((i) => i.id !== id) }));
        syncDeleteMovingItem(id);
      },

      fetchFromSupabase: async () => {
        const userId = await getUserId();
        if (!userId) return;

        const [tasksResult, shoppingResult, movingResult] = await Promise.all([
          supabase
            .from('household_tasks')
            .select('id, kind, title, frequency, last_done, assigned_to, rotates, created_at')
            .eq('user_id', userId),
          supabase.from('household_shopping_items').select('id, label, checked').eq('user_id', userId),
          supabase.from('household_moving_items').select('id, label, checked').eq('user_id', userId),
        ]);

        if (tasksResult.error || shoppingResult.error || movingResult.error) return;

        set((state) => {
          const existingTaskIds = new Set(state.tasks.map((t) => t.id));
          const fetchedTasks: HouseholdTask[] = (tasksResult.data ?? [])
            .filter((row) => !existingTaskIds.has(row.id))
            .map((row) => ({
              id: row.id,
              kind: row.kind as TaskKind,
              title: row.title,
              frequency: row.frequency as TaskFrequency,
              lastDone: row.last_done ?? undefined,
              assignedTo: (row.assigned_to as TaskAssignee) ?? 'me',
              rotates: row.rotates ?? false,
              createdAt: row.created_at,
            }));

          const existingShoppingIds = new Set(state.shoppingItems.map((i) => i.id));
          const fetchedShoppingItems: HouseholdItem[] = (shoppingResult.data ?? [])
            .filter((row) => !existingShoppingIds.has(row.id))
            .map((row) => ({ id: row.id, label: row.label, checked: row.checked }));

          // Kun merg hentede flytte-elementer, hvis vi allerede har NOGET lokalt
          // (dvs. de lokale standardelementer er allerede seedet af onRehydrateStorage) —
          // det undgår at overskrive/duplikere den lokale seedning unødvendigt.
          const existingMovingIds = new Set(state.movingItems.map((i) => i.id));
          const fetchedMovingItems: MovingItem[] = (movingResult.data ?? [])
            .filter((row) => !existingMovingIds.has(row.id))
            .map((row) => ({ id: row.id, label: row.label, checked: row.checked }));

          return {
            tasks: [...state.tasks, ...fetchedTasks],
            shoppingItems: [...state.shoppingItems, ...fetchedShoppingItems],
            movingItems: [...state.movingItems, ...fetchedMovingItems],
          };
        });
      },
    }),
    {
      name: 'lifesort-household',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.movingItems.length === 0) {
          state.movingItems = DEFAULT_MOVING_KEYS.map((key) => ({
            id: `default-${key}`,
            label: i18n.t(`household.movingDefaults.${key}`),
            checked: false,
          }));
        }
        // Bagudkompatibilitet: opgaver oprettet før rotationsfunktionen fik felterne.
        state.tasks = state.tasks.map((t) => ({
          ...t,
          assignedTo: t.assignedTo ?? 'me',
          rotates: t.rotates ?? false,
        }));
      },
    }
  )
);