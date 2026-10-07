import { decodeMovingItems, decodeMovingTemplateMarker, LEGACY_MOVING_MARKER } from '@/core/home/moving';
import type { LocalMigrationDefinition } from './harness';
import { parseCalendarDate } from '@/utils/shared/localDate';
import { isValidIanaTimeZone } from '@/utils/shared/timeZone';

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const STATE_KEYS = ['tasks', 'shoppingItems', 'movingItems', 'taskSync'];
// Z2 (APP-062) adds the explicit Moving template marker.
const STATE_KEYS_Z2 = [...STATE_KEYS, 'movingTemplate'];

function envelope(value: unknown, version: number): Json | null {
  if (!record(value) || value.version !== version || !record(value.state)) return null;
  if (!Object.keys(value).every((key) => key === 'state' || key === 'version')) return null;
  const allowed = version >= 2 ? STATE_KEYS_Z2 : STATE_KEYS;
  if (!Object.keys(value.state).every((key) => allowed.includes(key))) return null;
  const { tasks, shoppingItems, movingItems } = value.state;
  return Array.isArray(tasks) && Array.isArray(shoppingItems) && Array.isArray(movingItems) ? value.state : null;
}

function legacyTask(value: unknown): value is Json {
  if (!record(value)) return false;
  const keys = ['id', 'kind', 'title', 'frequency', 'lastDone', 'assignedTo', 'rotates', 'createdAt'];
  return Object.keys(value).every((key) => keys.includes(key)) &&
    typeof value.id === 'string' && ['cleaning', 'maintenance'].includes(String(value.kind)) &&
    typeof value.title === 'string' && ['weekly', 'monthly', 'quarterly', 'yearly'].includes(String(value.frequency)) &&
    (value.lastDone === undefined || parseCalendarDate(value.lastDone) !== null) &&
    ['me', 'partner'].includes(String(value.assignedTo)) && typeof value.rotates === 'boolean' &&
    typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt));
}

function currentTask(value: unknown): boolean {
  if (!record(value)) return false;
  const allowed = ['id', 'kind', 'title', 'frequency', 'lastDone', 'assignedTo', 'rotates', 'createdAt', 'timeZone'];
  const legacy = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'timeZone'));
  return Object.keys(value).every((key) => allowed.includes(key)) && legacyTask(legacy) &&
    (value.timeZone === null || isValidIanaTimeZone(value.timeZone));
}

function syncMap(value: unknown): boolean {
  return record(value) && Object.values(value).every((entry) => {
    if (!record(entry) || !Object.keys(entry).every((key) =>
      ['revision', 'plannedRevision', 'updatedAt', 'deletedAt', 'confirmed'].includes(key))) return false;
    if (entry.confirmed !== undefined && !currentTask(entry.confirmed)) return false;
    return typeof entry.revision === 'string' && /^(0|[1-9][0-9]*)$/.test(entry.revision) &&
      typeof entry.plannedRevision === 'string' && /^[1-9][0-9]*$/.test(entry.plannedRevision) &&
      typeof entry.updatedAt === 'string' &&
      (entry.updatedAt === '' || Number.isFinite(Date.parse(entry.updatedAt))) &&
      (entry.deletedAt === null || (typeof entry.deletedAt === 'string' && Number.isFinite(Date.parse(entry.deletedAt))));
  });
}

export const householdMigration: LocalMigrationDefinition = {
  storeId: 'async-storage:lifesort-household',
  storageKey: 'lifesort-household',
  currentVersion: 2,
  detectVersion: (value) => record(value) && typeof value.version === 'number' ? value.version : null,
  steps: {
    0: (value) => {
      const state = envelope(value, 0);
      if (!state || !(state.tasks as unknown[]).every(record)) throw new Error('unknown-legacy-shape');
      // Tasks persisted before rotation lack assignedTo/rotates; Z0 hydration
      // defaulted them in memory only, so the bytes may still omit them.
      const tasks = (state.tasks as Json[]).map((task) => ({
        ...task, assignedTo: task.assignedTo ?? 'me', rotates: task.rotates ?? false,
      }));
      if (!tasks.every(legacyTask)) throw new Error('unknown-legacy-shape');
      return {
        ...(value as Json),
        version: 1,
        state: {
          ...state,
          tasks: tasks.map((task) => ({ ...task, timeZone: null })),
          taskSync: {},
        },
      };
    },
    // APP-062: validate every Moving row, attach provenance only to the five fixed legacy
    // seed ids, keep everything else byte-for-byte, and record the v1 marker that the old
    // automatic seeding implied for every historical envelope. An empty list stays empty.
    1: (value) => {
      const state = envelope(value, 1);
      const moving = state ? decodeMovingItems(state.movingItems, 'legacy') : null;
      if (!state || !moving || !(state.tasks as unknown[]).every(currentTask) || !syncMap(state.taskSync)) {
        throw new Error('unknown-legacy-shape');
      }
      return {
        ...(value as Json),
        version: 2,
        state: { ...state, movingItems: moving, movingTemplate: { ...LEGACY_MOVING_MARKER } },
      };
    },
  },
  validateCurrent: (value) => {
    const state = envelope(value, 2);
    if (!state || !(state.tasks as unknown[]).every(currentTask) || !syncMap(state.taskSync)) return false;
    const moving = decodeMovingItems(state.movingItems, 'current');
    if (!moving) return false;
    return state.movingTemplate === null || decodeMovingTemplateMarker(state.movingTemplate) !== null;
  },
};
