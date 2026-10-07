import { TOGGLEABLE_MODULE_IDS } from '@/core/modules/moduleEnablement';
import type { OutboxMutation } from '@/core/sync/outbox';
import { parseCalendarDate } from '@/utils/shared/localDate';
import { isValidIanaTimeZone } from '@/utils/shared/timeZone';

const uuid = (value: unknown) => typeof value === 'string' &&
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
// Home tasks created before crypto UUIDs (APP-030) kept `${Date.now()}-${random}` IDs.
const homeTaskId = (value: unknown) => uuid(value) ||
  (typeof value === 'string' && /^[0-9]{13}-[0-9]{1,7}$/.test(value));
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

function validHomeTask(value: unknown, entityId: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const task = value as Record<string, unknown>;
  const keys = ['id', 'kind', 'title', 'frequency', 'assignedTo', 'rotates', 'createdAt', 'timeZone'];
  if (task.lastDone !== undefined) keys.push('lastDone');
  return exactKeys(task, keys) && task.id === entityId &&
    ['cleaning', 'maintenance'].includes(String(task.kind)) &&
    typeof task.title === 'string' && task.title.trim().length > 0 && task.title.length <= 500 &&
    ['weekly', 'monthly', 'quarterly', 'yearly'].includes(String(task.frequency)) &&
    (task.lastDone === undefined || parseCalendarDate(task.lastDone) !== null) &&
    ['me', 'partner'].includes(String(task.assignedTo)) && typeof task.rotates === 'boolean' &&
    typeof task.createdAt === 'string' && Number.isFinite(Date.parse(task.createdAt)) &&
    (task.timeZone === null || isValidIanaTimeZone(task.timeZone));
}

function supportsHomeTask(mutation: OutboxMutation): boolean {
  if (mutation.dataDomain !== 'home.household' || mutation.entityType !== 'home-task' ||
    !homeTaskId(mutation.entityId)) return false;
  if (mutation.operation === 'delete') {
    return Number.isSafeInteger(mutation.baseRevision) && mutation.baseRevision! > 0 &&
      (mutation.payload === undefined || mutation.payload === null);
  }
  if (mutation.operation !== 'upsert' || !mutation.payload || typeof mutation.payload !== 'object' ||
    Array.isArray(mutation.payload)) return false;
  const payload = mutation.payload as Record<string, unknown>;
  if (payload.action === 'complete') {
    return exactKeys(payload, ['action', 'completedOn']) &&
      parseCalendarDate(payload.completedOn) !== null &&
      Number.isSafeInteger(mutation.baseRevision) && mutation.baseRevision! > 0;
  }
  if (payload.action !== 'create' && payload.action !== 'edit') return false;
  return exactKeys(payload, ['action', 'task']) && validHomeTask(payload.task, mutation.entityId) &&
    (payload.action === 'create'
      ? mutation.baseRevision === undefined
      : Number.isSafeInteger(mutation.baseRevision) && mutation.baseRevision! > 0);
}

/** The APP-032/034 transport contract, shared by the sender and status selector. */
export function supportsServerMutation(mutation: OutboxMutation): boolean {
  if (!uuid(mutation.mutationId)) return false;
  if (supportsHomeTask(mutation)) return true;
  const payload = mutation.payload;
  const validPayload = mutation.operation === 'delete'
    ? payload === undefined || payload === null
    : mutation.operation === 'upsert' && payload !== null && typeof payload === 'object' &&
      !Array.isArray(payload) && typeof payload.enabled === 'boolean' && Object.keys(payload).length === 1;
  return mutation.baseRevision === undefined && mutation.dataDomain === 'core.module-choice' &&
    mutation.entityType === 'module-choice' && validPayload &&
    TOGGLEABLE_MODULE_IDS.some((id) => id === mutation.entityId);
}
