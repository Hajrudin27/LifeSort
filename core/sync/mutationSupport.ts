import { TOGGLEABLE_MODULE_IDS } from '@/core/modules/moduleEnablement';
import type { OutboxMutation } from '@/core/sync/outbox';

/** The APP-032/034 transport contract, shared by the sender and status selector. */
export function supportsServerMutation(mutation: OutboxMutation): boolean {
  const payload = mutation.payload;
  const validPayload = mutation.operation === 'delete'
    ? payload === undefined || payload === null
    : mutation.operation === 'upsert' && payload !== null && typeof payload === 'object' &&
      !Array.isArray(payload) && typeof payload.enabled === 'boolean' && Object.keys(payload).length === 1;
  return mutation.baseRevision === undefined && mutation.dataDomain === 'core.module-choice' &&
    mutation.entityType === 'module-choice' && validPayload &&
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(mutation.mutationId) &&
    TOGGLEABLE_MODULE_IDS.some((id) => id === mutation.entityId);
}
