import { newEntityId } from '@/core/ids';
import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import { resolveConflict, type ConfirmedConflictEntity } from '@/core/sync/conflictPolicies';
import { createOutbox, type JsonValue, type NewOutboxMutation, type OutboxMutation } from '@/core/sync/outbox';
import { registerPermanentFailureHandler } from '@/core/sync/refusalHandlers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { supabase } from '@/lib/supabase';
import i18n from '@/localization/i18n';
import {
  HouseholdItem,
  HouseholdTask,
  HouseholdTaskSyncState,
  MovingItem,
  TaskAssignee,
  TaskFrequency,
  TaskKind,
} from '@/types/household';
import { calendarDateForTask, isValidTimeZone, resolvedDeviceTimeZone } from '@/utils/household/householdTaskSchedule';
import { createSyncQueue } from '@/utils/shared/syncQueue';
import { parseCalendarDate } from '@/utils/shared/localDate';

function otherAssignee(assignee: TaskAssignee): TaskAssignee {
  return assignee === 'me' ? 'partner' : 'me';
}

const DEFAULT_MOVING_KEYS = ['addressChange', 'internet', 'electricity', 'mailForwarding', 'insurance'];
const HOME_DOMAIN = 'home.household' as const;
const HOME_ENTITY = 'home-task' as const;

interface HouseholdState {
  tasks: HouseholdTask[];
  /** Persisted revision cache, excluded from user backups and editable task content. */
  taskSync: Record<string, HouseholdTaskSyncState>;
  /** Runtime-only account binding. */
  myUserId: string | null;
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

  /** Runtime-only: tasks whose refused change needs an explicit user choice. */
  taskConflicts: Record<string, TaskConflict>;
  /** Retire the refused chain, keeping the server version or reapplying mine on it. */
  resolveTaskConflict: (id: string, choice: 'server' | 'mine') => Promise<boolean>;

  fetchFromSupabase: () => Promise<void>;
  restoreBackup: (partial: Partial<Pick<HouseholdState, 'tasks' | 'shoppingItems' | 'movingItems'>>) => void;
  clearLocal: () => void;
}

type TaskAction = 'create' | 'edit' | 'complete' | 'delete';
type RemoteTask = { task: HouseholdTask; sync: HouseholdTaskSyncState };
export type TaskConflict = { accountId: string; remote: HouseholdTask; sync: HouseholdTaskSyncState };
type TaskWrite = {
  action: TaskAction;
  taskId: string;
  task?: HouseholdTask;
  completedOn?: string;
};
type TaskWriteChain = {
  accountId: string;
  latest: number;
  stableSequence: number;
  activitySequence: number;
  stableTask: HouseholdTask | null;
  pendingWrites: number;
};

const writeChains = new Map<string, TaskWriteChain>();
let writeSequence = 0;
let datasetEpoch = 0;
let queueTail: Promise<unknown> = Promise.resolve();

function serializeQueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueTail.then(operation);
  queueTail = result.catch(() => undefined);
  return result;
}

function incrementRevision(revision: string): string {
  const digits = revision.split('').reverse();
  let carry = 1;
  for (let i = 0; i < digits.length && carry; i += 1) {
    const next = Number(digits[i]) + carry;
    digits[i] = String(next % 10);
    carry = next > 9 ? 1 : 0;
  }
  if (carry) digits.push('1');
  return digits.reverse().join('');
}

function safeBaseRevision(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1 || String(numeric) !== value) {
    throw new Error('Home task revision is unavailable.');
  }
  return numeric;
}

function taskPayload(write: TaskWrite): JsonValue | undefined {
  if (write.action === 'delete') return undefined;
  if (write.action === 'complete') return { action: 'complete', completedOn: write.completedOn! };
  return { action: write.action, task: write.task as unknown as JsonValue };
}

async function queueTaskWrite(accountId: string, write: TaskWrite): Promise<string> {
  return serializeQueue(async () => {
    const sync = useHouseholdStore.getState().taskSync[write.taskId];
    const outbox = createOutbox(accountId);
    const chain = (await outbox.list()).filter((mutation) => isHomeTask(mutation, write.taskId));
    // A create that is already queued or confirmed (its planned revision may have been
    // lost to a crash before it persisted) makes this write an edit, never a second create.
    const action = write.action === 'create' && (chain.length > 0 || sync) ? 'edit' : write.action;
    let baseText: string | undefined;
    if (action === 'create') baseText = undefined;
    else if (chain.length > 0) {
      // Each queued mutation advances the server revision once: derive from the chain.
      const last = chain[chain.length - 1];
      baseText = last.baseRevision === undefined ? '1' : incrementRevision(String(last.baseRevision));
    } else {
      const confirmed = sync?.revision && sync.revision !== '0' ? sync.revision : '0';
      const planned = sync?.plannedRevision;
      baseText = !planned || revisionOrder(confirmed, planned) > 0 ? confirmed : planned;
      if (baseText === '0') baseText = undefined;
    }
    const baseRevision = safeBaseRevision(baseText);
    if (action !== 'create' && baseRevision === undefined) {
      throw new Error('Home task revision is unavailable.');
    }
    await outbox.enqueue({
      dataDomain: HOME_DOMAIN,
      entityType: HOME_ENTITY,
      entityId: write.taskId,
      operation: action === 'delete' ? 'delete' : 'upsert',
      payload: taskPayload({ ...write, action }),
      baseRevision,
    });
    return baseRevision === undefined ? '1' : incrementRevision(String(baseRevision));
  });
}

const isHomeTask = (mutation: OutboxMutation, taskId?: string) => mutation.dataDomain === HOME_DOMAIN &&
  mutation.entityType === HOME_ENTITY && (taskId === undefined || mutation.entityId === taskId);
/** A refusal the platform will not retry: only reconciliation or the user moves it. */
const isBlocked = (mutation: OutboxMutation) => mutation.status === 'failed' && mutation.nextRetryAt === undefined;
const TASK_KEYS = ['id', 'kind', 'title', 'frequency', 'lastDone', 'assignedTo', 'rotates', 'createdAt', 'timeZone'] as const;
const sameTask = (a: HouseholdTask, b: HouseholdTask) => TASK_KEYS.every((key) => a[key] === b[key]);
/** Exact transport shape: declared keys only, no undefined values. */
function portableTask(task: HouseholdTask): HouseholdTask {
  return {
    id: task.id, kind: task.kind, title: task.title, frequency: task.frequency,
    ...(task.lastDone === undefined ? {} : { lastDone: task.lastDone }),
    assignedTo: task.assignedTo, rotates: task.rotates, createdAt: task.createdAt, timeZone: task.timeZone,
  };
}
function homeMutation(taskId: string, task: HouseholdTask | null, action: 'create' | 'edit' | 'delete',
  baseRevision?: number): NewOutboxMutation {
  return {
    dataDomain: HOME_DOMAIN, entityType: HOME_ENTITY, entityId: taskId,
    operation: action === 'delete' ? 'delete' : 'upsert',
    ...(task === null ? {} : { payload: { action, task: portableTask(task) as unknown as JsonValue } }),
    ...(baseRevision === undefined ? {} : { baseRevision }),
  };
}

type ChainPlan =
  | { kind: 'none' | 'manual' | 'accept' }
  | { kind: 'replace'; mutation: NewOutboxMutation; value: HouseholdTask | null; plannedRevision: string };

/**
 * APP-061 runtime conflict handling for one refused (blocked) Home-task chain, against
 * a complete authoritative read. Pure: the caller supersedes the chain atomically.
 * - tombstone: server wins; nothing that could recreate the task is ever queued;
 * - no row (never created; tombstones are retained): the local task is created;
 * - same revision as the refused base: not a revision conflict, left alone;
 * - otherwise the home-task-coupled policy decides; unresolved means a user choice.
 */
function planBlockedChain(
  chain: readonly OutboxMutation[],
  remote: RemoteTask | undefined,
  current: HouseholdTask | undefined,
  sync: HouseholdTaskSyncState | undefined,
): ChainPlan {
  const head = chain[0];
  const isCreate = head.operation === 'upsert' &&
    (head.payload as { action?: unknown } | undefined)?.action === 'create';
  const deleting = chain[chain.length - 1].operation === 'delete';
  // A chain without a local task and without a delete was orphaned by an explicit
  // backup restore that replaced the local dataset; the server row is shown again.
  const local = deleting || !current ? null : portableTask(current);
  if (remote?.sync.deletedAt != null) return { kind: 'accept' };
  if (!remote) {
    if (isCreate) return { kind: 'none' };
    return local
      ? { kind: 'replace', mutation: homeMutation(head.entityId, local, 'create'), value: local, plannedRevision: '1' }
      : { kind: 'accept' };
  }
  if (!deleting && !current) return { kind: 'accept' };
  if (!isCreate && head.baseRevision !== undefined && String(head.baseRevision) === remote.sync.revision) {
    return { kind: 'none' };
  }
  if (local && sameTask(local, remote.task)) return { kind: 'accept' };
  let base: number;
  try { base = safeBaseRevision(remote.sync.revision)!; } catch { return { kind: 'manual' }; }
  const next = incrementRevision(remote.sync.revision);
  const snapshot = (value: HouseholdTask, revision: string, updatedAt: string): ConfirmedConflictEntity<HouseholdTask> =>
    ({ entityId: head.entityId, revision, updatedAt, deletedAt: null, value: portableTask(value) });
  const confirmed = snapshot(remote.task, remote.sync.revision, remote.sync.updatedAt);
  // A refused create whose row is still at revision 1 is this device's own earlier create
  // (the duplicate-create window): that row is the base. Otherwise the base is the last
  // confirmed content, and only if the refused head was built on exactly that revision.
  const baseSnapshot = isCreate
    ? (remote.sync.revision === '1' ? confirmed : null)
    : sync?.confirmed && sync.updatedAt && sync.revision === String(head.baseRevision)
      ? snapshot(sync.confirmed, sync.revision, sync.updatedAt) : null;
  if (!baseSnapshot) return { kind: 'manual' };
  if (!local) {
    // No reviewed rule merges a delete with a remote change: only an unchanged row is safe.
    return baseSnapshot.revision === remote.sync.revision && sameTask(baseSnapshot.value, remote.task)
      ? { kind: 'replace', mutation: homeMutation(head.entityId, null, 'delete', base), value: null, plannedRevision: next }
      : { kind: 'manual' };
  }
  const result = resolveConflict({
    dataDomain: HOME_DOMAIN, entityType: HOME_ENTITY, entityId: head.entityId, base: baseSnapshot,
    local: { operation: 'upsert', baseRevision: baseSnapshot.revision, value: local }, remote: confirmed,
  });
  if (result.kind === 'accept-remote') return { kind: 'accept' };
  if (result.kind !== 'rebase-local' && result.kind !== 'merged') return { kind: 'manual' };
  const value = portableTask(result.value as HouseholdTask);
  return sameTask(value, remote.task)
    ? { kind: 'accept' }
    : { kind: 'replace', mutation: homeMutation(head.entityId, value, 'edit', base), value, plannedRevision: next };
}

function shoppingItemToRow(userId: string, item: HouseholdItem) {
  return { id: item.id, user_id: userId, label: item.label, checked: item.checked };
}
function movingItemToRow(userId: string, item: MovingItem) {
  return { id: item.id, user_id: userId, label: item.label, checked: item.checked };
}
async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
/** Resolve the account only when a task mutation or guarded fetch runs.
 * Read-only Household imports therefore do not initialize the full auth flow. */
function initiatingAccountId(): string | null {
  const { useAuthStore } = require('@/store/useAuthStore') as typeof import('@/store/useAuthStore');
  return useAuthStore.getState().session?.user.id ?? null;
}
async function syncUpsertShoppingItem(item: HouseholdItem) {
  const userId = await getUserId();
  if (userId) await supabase.from('household_shopping_items').upsert(shoppingItemToRow(userId, item));
}
async function syncDeleteShoppingItem(id: string) {
  const userId = await getUserId();
  if (userId) await supabase.from('household_shopping_items').delete().eq('user_id', userId).eq('id', id);
}
const shoppingItemToggleQueue = createSyncQueue<HouseholdItem>(async (items) => {
  const userId = await getUserId();
  if (userId) await supabase.from('household_shopping_items').upsert(items.map((item) => shoppingItemToRow(userId, item)));
});
async function syncUpsertMovingItem(item: MovingItem) {
  const userId = await getUserId();
  if (userId) await supabase.from('household_moving_items').upsert(movingItemToRow(userId, item));
}
async function syncDeleteMovingItem(id: string) {
  const userId = await getUserId();
  if (userId) await supabase.from('household_moving_items').delete().eq('user_id', userId).eq('id', id);
}

const revisionOrder = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
function parseTaskRows(rows: unknown): { task: HouseholdTask; sync: HouseholdTaskSyncState }[] {
  if (!Array.isArray(rows)) throw new Error('Invalid Home task response.');
  return rows.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('Invalid Home task response.');
    const value = row as Record<string, unknown>;
    const revision = String(value.revision);
    const timeZone = value.time_zone;
    if (typeof value.id !== 'string' || !value.id || !['cleaning', 'maintenance'].includes(String(value.kind)) ||
      typeof value.title !== 'string' || !['weekly', 'monthly', 'quarterly', 'yearly'].includes(String(value.frequency)) ||
      (value.last_done !== null && !parseCalendarDate(value.last_done)) ||
      !['me', 'partner'].includes(String(value.assigned_to)) || typeof value.rotates !== 'boolean' ||
      typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at)) ||
      (timeZone !== null && !isValidTimeZone(timeZone)) || !/^[1-9][0-9]*$/.test(revision) ||
      typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at)) ||
      (value.deleted_at !== null && (typeof value.deleted_at !== 'string' || !Number.isFinite(Date.parse(value.deleted_at))))) {
      throw new Error('Invalid Home task response.');
    }
    return {
      task: {
        id: value.id,
        kind: value.kind as TaskKind,
        title: value.title,
        frequency: value.frequency as TaskFrequency,
        ...(value.last_done === null ? {} : { lastDone: value.last_done as string }),
        assignedTo: value.assigned_to as TaskAssignee,
        rotates: value.rotates,
        createdAt: value.created_at,
        timeZone: timeZone as string | null,
      },
      sync: { revision, plannedRevision: revision, updatedAt: value.updated_at, deletedAt: value.deleted_at as string | null },
    };
  });
}

export const useHouseholdStore = create<HouseholdState>()(
  persist(
    (set, get) => {
      const active = (accountId: string, epoch: number) =>
        epoch === datasetEpoch && initiatingAccountId() === accountId;
      const chainFor = (taskId: string, accountId: string, epoch: number) => {
        if (!active(accountId, epoch)) return null;
        const chain = writeChains.get(taskId);
        return chain?.accountId === accountId ? chain : null;
      };
      const replaceTask = (taskId: string, task: HouseholdTask | null) => set((state) => ({
        tasks: task === null
          ? state.tasks.filter((item) => item.id !== taskId)
          : state.tasks.some((item) => item.id === taskId)
            ? state.tasks.map((item) => item.id === taskId ? task : item)
            : [...state.tasks, task],
      }));

      const mutateTask = (taskId: string, next: HouseholdTask | null, write: TaskWrite) => {
        const previous = get().tasks.find((task) => task.id === taskId) ?? null;
        const accountId = initiatingAccountId();
        replaceTask(taskId, next);
        if (!accountId) return;
        const epoch = datasetEpoch;
        const sequence = ++writeSequence;
        const current = chainFor(taskId, accountId, epoch);
        writeChains.set(taskId, current
          ? { ...current, latest: sequence, activitySequence: sequence, pendingWrites: current.pendingWrites + 1 }
          : { accountId, latest: sequence, stableSequence: 0, activitySequence: sequence,
            stableTask: previous, pendingWrites: 1 });
        void queueTaskWrite(accountId, write).then((plannedRevision) => {
          const chain = chainFor(taskId, accountId, epoch);
          if (!chain) return;
          chain.pendingWrites -= 1;
          if (sequence > chain.stableSequence) {
            chain.stableSequence = sequence;
            chain.stableTask = next;
            set((state) => ({ taskSync: {
              ...state.taskSync,
              [taskId]: {
                // Keep the confirmed snapshot: it is the conflict base for this chain.
                ...state.taskSync[taskId],
                revision: state.taskSync[taskId]?.revision ?? '0',
                plannedRevision,
                updatedAt: state.taskSync[taskId]?.updatedAt ?? '',
                // The database owns deletion/update timestamps. Optimistic UI
                // state never fabricates confirmed server metadata.
                deletedAt: state.taskSync[taskId]?.deletedAt ?? null,
              },
            } }));
          }
        }, () => {
          const chain = chainFor(taskId, accountId, epoch);
          if (!chain) return;
          chain.pendingWrites -= 1;
          if (chain.latest === sequence) {
            chain.latest = chain.stableSequence;
            replaceTask(taskId, chain.stableTask);
          }
        });
      };

      const reconcileBlocked = (
        accountId: string, epoch: number, remoteById: Map<string, RemoteTask>, complete: boolean,
      ) => serializeQueue(async () => {
        if (!active(accountId, epoch)) return;
        const outbox = createOutbox(accountId);
        const chains = new Map<string, OutboxMutation[]>();
        for (const mutation of await outbox.list()) {
          if (isHomeTask(mutation)) chains.set(mutation.entityId, [...(chains.get(mutation.entityId) ?? []), mutation]);
        }
        const conflicts: Record<string, TaskConflict> = {};
        for (const [taskId, chain] of chains) {
          if (!active(accountId, epoch)) return;
          if (!isBlocked(chain[0])) continue;
          const remote = remoteById.get(taskId);
          // Absence only proves "never created" when the read was complete.
          if (!remote && !complete) continue;
          const plan = planBlockedChain(chain, remote, get().tasks.find((task) => task.id === taskId),
            get().taskSync[taskId]);
          if (plan.kind === 'none') continue;
          if (plan.kind === 'manual') {
            conflicts[taskId] = { accountId, remote: remote!.task, sync: remote!.sync };
            // A refused local delete keeps the server row visible so the choice is reachable.
            if (!get().tasks.some((task) => task.id === taskId)) replaceTask(taskId, remote!.task);
            continue;
          }
          const written = await outbox.supersedeChain(chain.map((mutation) => mutation.mutationId),
            plan.kind === 'replace' ? [plan.mutation] : []);
          // A changed chain (a new local write) is reconsidered on the next refusal or fetch.
          if (!written || !active(accountId, epoch)) continue;
          writeChains.delete(taskId);
          if (plan.kind === 'replace') {
            replaceTask(taskId, plan.value);
            set((state) => ({ taskSync: { ...state.taskSync, [taskId]: remote
              ? { ...remote.sync, plannedRevision: plan.plannedRevision, confirmed: remote.task }
              : { revision: '0', plannedRevision: plan.plannedRevision, updatedAt: '', deletedAt: null } } }));
          } else if (remote) {
            const tombstone = remote.sync.deletedAt !== null;
            replaceTask(taskId, tombstone ? null : remote.task);
            set((state) => ({ taskSync: { ...state.taskSync,
              [taskId]: tombstone ? remote.sync : { ...remote.sync, confirmed: remote.task } } }));
          } else {
            replaceTask(taskId, null);
            set((state) => {
              const { [taskId]: _gone, ...taskSync } = state.taskSync;
              return { taskSync };
            });
          }
        }
        if (active(accountId, epoch)) set({ taskConflicts: conflicts });
      });

      return {
        tasks: [],
        taskSync: {},
        taskConflicts: {},
        myUserId: null,
        resolveTaskConflict: (taskId, choice) => {
          const conflict = get().taskConflicts[taskId];
          const accountId = initiatingAccountId();
          if (!conflict || !accountId || conflict.accountId !== accountId) return Promise.resolve(false);
          const epoch = datasetEpoch;
          return serializeQueue(async () => {
            if (!active(accountId, epoch) || get().taskConflicts[taskId] !== conflict) return false;
            const outbox = createOutbox(accountId);
            const chain = (await outbox.list()).filter((mutation) => isHomeTask(mutation, taskId));
            if (chain.length === 0 || !isBlocked(chain[0]) || !active(accountId, epoch)) return false;
            let value: HouseholdTask | null = conflict.remote;
            let replacement: NewOutboxMutation | null = null;
            let plannedRevision = conflict.sync.revision;
            if (choice === 'mine') {
              let base: number;
              // Beyond the exact JS integer range only "keep server" is offered safely.
              try { base = safeBaseRevision(conflict.sync.revision)!; } catch { return false; }
              const current = get().tasks.find((task) => task.id === taskId);
              if (chain[chain.length - 1].operation === 'delete') {
                value = null;
                replacement = homeMutation(taskId, null, 'delete', base);
              } else {
                if (!current) return false;
                // Explicit overwrite on the latest revision. Immutable identity comes from
                // the server; lastDone/assignedTo are set, never rotated again.
                value = portableTask({ ...current, kind: conflict.remote.kind,
                  createdAt: conflict.remote.createdAt, timeZone: conflict.remote.timeZone });
                replacement = homeMutation(taskId, value, 'edit', base);
              }
              plannedRevision = incrementRevision(conflict.sync.revision);
            }
            const written = await outbox.supersedeChain(chain.map((mutation) => mutation.mutationId),
              replacement ? [replacement] : []);
            if (!written || !active(accountId, epoch)) return false;
            writeChains.delete(taskId);
            replaceTask(taskId, value);
            set((state) => {
              const { [taskId]: _resolved, ...taskConflicts } = state.taskConflicts;
              return { taskConflicts, taskSync: { ...state.taskSync,
                [taskId]: { ...conflict.sync, plannedRevision, confirmed: conflict.remote } } };
            });
            return true;
          });
        },
        addTask: (input) => {
          let timeZone: string;
          try { timeZone = resolvedDeviceTimeZone(); } catch { return; }
          const task: HouseholdTask = {
            id: newEntityId(),
            createdAt: new Date().toISOString(),
            assignedTo: input.assignedTo ?? 'me',
            rotates: input.rotates ?? false,
            timeZone,
            ...input,
          };
          mutateTask(task.id, task, { action: 'create', taskId: task.id, task });
        },
        updateTask: (id, updates) => {
          const current = get().tasks.find((task) => task.id === id);
          if (!current) return;
          const task = { ...current, ...updates };
          mutateTask(id, task, {
            action: get().taskSync[id] || writeChains.has(id) ? 'edit' : 'create',
            taskId: id,
            task,
          });
        },
        markTaskDone: (id) => {
          const current = get().tasks.find((task) => task.id === id);
          if (!current) return;
          let completedOn: string;
          try { completedOn = calendarDateForTask(current); } catch { return; }
          if (current.lastDone === completedOn) return;
          const task = {
            ...current,
            lastDone: completedOn,
            assignedTo: current.rotates ? otherAssignee(current.assignedTo) : current.assignedTo,
          };
          mutateTask(id, task, { action: 'complete', taskId: id, completedOn });
        },
        removeTask: (id) => {
          const current = get().tasks.find((task) => task.id === id);
          if (current) mutateTask(id, null, { action: 'delete', taskId: id });
        },

        shoppingItems: [],
        addShoppingItem: (label) => {
          const item = { id: newEntityId(), label, checked: false };
          set((state) => ({ shoppingItems: [...state.shoppingItems, item] }));
          void syncUpsertShoppingItem(item);
        },
        toggleShoppingItem: (id) => {
          set((state) => ({ shoppingItems: state.shoppingItems.map((item) =>
            item.id === id ? { ...item, checked: !item.checked } : item) }));
          const item = get().shoppingItems.find((candidate) => candidate.id === id);
          if (item) shoppingItemToggleQueue.enqueue(item);
        },
        removeShoppingItem: (id) => {
          set((state) => ({ shoppingItems: state.shoppingItems.filter((item) => item.id !== id) }));
          void syncDeleteShoppingItem(id);
        },

        movingItems: [],
        addMovingItem: (label) => {
          const item = { id: newEntityId(), label, checked: false };
          set((state) => ({ movingItems: [...state.movingItems, item] }));
          void syncUpsertMovingItem(item);
        },
        toggleMovingItem: (id) => {
          set((state) => ({ movingItems: state.movingItems.map((item) =>
            item.id === id ? { ...item, checked: !item.checked } : item) }));
          const item = get().movingItems.find((candidate) => candidate.id === id);
          if (item) void syncUpsertMovingItem(item);
        },
        removeMovingItem: (id) => {
          set((state) => ({ movingItems: state.movingItems.filter((item) => item.id !== id) }));
          void syncDeleteMovingItem(id);
        },

        fetchFromSupabase: async () => {
          const accountId = initiatingAccountId();
          const epoch = datasetEpoch;
          const startingSequence = writeSequence;
          if (!accountId) return;
          const stillActive = () => active(accountId, epoch);
          const protectedIds = new Set<string>();
          for (const [id, chain] of writeChains) {
            if (chain.accountId === accountId && chain.pendingWrites > 0) protectedIds.add(id);
          }
          const captureQueued = async () => {
            for (const mutation of await createOutbox(accountId).list()) {
              if (mutation.dataDomain === HOME_DOMAIN && mutation.entityType === HOME_ENTITY) protectedIds.add(mutation.entityId);
            }
          };
          try { await captureQueued(); } catch { return; }
          if (!stillActive()) return;
          const session = await supabase.auth.getSession();
          if (!stillActive() || session.error || session.data.session?.user.id !== accountId) return;
          const [tasksResult, shoppingResult, movingResult] = await Promise.all([
            supabase.from('household_tasks')
              .select('id, kind, title, frequency, last_done, assigned_to, rotates, created_at, time_zone, revision::text, updated_at, deleted_at')
              .eq('user_id', accountId),
            supabase.from('household_shopping_items').select('id, label, checked').eq('user_id', accountId),
            supabase.from('household_moving_items').select('id, label, checked').eq('user_id', accountId),
          ]);
          const currentSession = await supabase.auth.getSession();
          if (!stillActive() || currentSession.error || currentSession.data.session?.user.id !== accountId ||
            tasksResult.error || shoppingResult.error || movingResult.error) return;
          let remote;
          try { remote = parseTaskRows(tasksResult.data); await captureQueued(); } catch { return; }
          if (!stillActive()) return;
          // Refused chains are reconciled against this authoritative read before the
          // generic merge, which keeps protecting every entity that still has queued work.
          try {
            await reconcileBlocked(accountId, epoch, new Map(remote.map((entity) => [entity.task.id, entity])),
              remote.length < 1000);
          } catch { /* Durable state is unchanged; the next fetch retries. */ }
          if (!stillActive()) return;
          for (const [id, chain] of writeChains) {
            if (chain.accountId === accountId && chain.activitySequence > startingSequence) protectedIds.add(id);
          }
          set((state) => {
            const tasks = new Map(state.tasks.map((task) => [task.id, task]));
            const taskSync = { ...state.taskSync };
            for (const entity of remote) {
              if (protectedIds.has(entity.task.id)) continue;
              const current = taskSync[entity.task.id];
              if (current && current.revision !== '0' && revisionOrder(entity.sync.revision, current.revision) < 0) continue;
              if (entity.sync.deletedAt !== null) tasks.delete(entity.task.id);
              else tasks.set(entity.task.id, entity.task);
              taskSync[entity.task.id] = entity.sync.deletedAt === null
                ? { ...entity.sync, confirmed: entity.task } : entity.sync;
            }
            const existingShoppingIds = new Set(state.shoppingItems.map((item) => item.id));
            const existingMovingIds = new Set(state.movingItems.map((item) => item.id));
            return {
              tasks: [...tasks.values()], taskSync, myUserId: accountId,
              shoppingItems: [...state.shoppingItems, ...(shoppingResult.data ?? [])
                .filter((row) => !existingShoppingIds.has(row.id))
                .map((row) => ({ id: row.id, label: row.label, checked: row.checked }))],
              movingItems: [...state.movingItems, ...(movingResult.data ?? [])
                .filter((row) => !existingMovingIds.has(row.id))
                .map((row) => ({ id: row.id, label: row.label, checked: row.checked }))],
            };
          });
          // Tombstones are retained, so a task absent from a complete owner read was never
          // created remotely (restored backup, pre-APP-061 offline write). Without adoption it
          // has no base revision and completion/deletion would always roll back. A response at
          // PostgREST's default row cap may be truncated, so absence is not trusted there.
          if (remote.length >= 1000) return;
          const remoteIds = new Set(remote.map((entity) => entity.task.id));
          for (const task of get().tasks) {
            if (remoteIds.has(task.id) || protectedIds.has(task.id) || get().taskSync[task.id] ||
              writeChains.has(task.id)) continue;
            mutateTask(task.id, task, { action: 'create', taskId: task.id, task });
          }
        },

        restoreBackup: (partial) => {
          datasetEpoch += 1;
          writeChains.clear();
          // A field missing from the backup keeps the current value (parser contract).
          set((state) => ({
            tasks: partial.tasks ?? state.tasks,
            shoppingItems: partial.shoppingItems ?? state.shoppingItems,
            movingItems: partial.movingItems ?? state.movingItems,
            taskSync: {},
            taskConflicts: {},
            myUserId: null,
          }));
        },

        clearLocal: () => {
          datasetEpoch += 1;
          writeChains.clear();
          set({ tasks: [], taskSync: {}, taskConflicts: {}, myUserId: null, shoppingItems: [], movingItems: [] });
        },
      };
    },
    {
      name: 'lifesort-household',
      version: 1,
      storage: createJSONStorage(() => migrationGatedStorage(AsyncStorage)),
      partialize: (state) => ({
        tasks: state.tasks,
        taskSync: state.taskSync,
        shoppingItems: state.shoppingItems,
        movingItems: state.movingItems,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.movingItems.length === 0) {
          state.movingItems = DEFAULT_MOVING_KEYS.map((key) => ({
            id: `default-${key}`,
            label: i18n.t(`household.movingDefaults.${key}`),
            checked: false,
          }));
        }
      },
    },
  ),
);

/**
 * Registered with both senders' permanent-refusal hook: a refused Home-task mutation
 * triggers an authoritative read that reconciles it. Never sends; other accounts no-op.
 */
export function reconcileHomeTasksAfterRefusal(accountId: string, mutation: OutboxMutation): void {
  if (!isHomeTask(mutation) || initiatingAccountId() !== accountId) return;
  void useHouseholdStore.getState().fetchFromSupabase();
}
registerPermanentFailureHandler(HOME_DOMAIN, reconcileHomeTasksAfterRefusal);
