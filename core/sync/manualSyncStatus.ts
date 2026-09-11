import { createOutbox, subscribeOutbox } from '@/core/sync/outbox';
import { sendServerMutation } from '@/core/sync/serverMutations';
import {
  canManuallyRetry, CLEAR_SYNC_STATUS, projectSyncStatus, syncSafeError,
  type SyncSafeErrorCode, type SyncStatusProjection,
} from '@/core/sync/syncStatus';

/** Local projection observer and explicit one-shot action. No worker or scheduling. */
export function createManualSyncStatus(
  getActiveAccount: () => string | null,
  publish: (projection: SyncStatusProjection) => void,
  send: typeof sendServerMutation = sendServerMutation,
) {
  let accountId: string | null = null;
  let generation = 0;
  let readSequence = 0;
  let retryingId: string | null = null;
  let errors = new Map<string, SyncSafeErrorCode>();
  let disposed = false;

  function active(id: string, epoch: number) {
    return !disposed && accountId === id && generation === epoch && getActiveAccount() === id;
  }
  function reset() {
    generation += 1;
    readSequence += 1;
    accountId = null;
    retryingId = null;
    errors = new Map();
    publish(CLEAR_SYNC_STATUS);
  }
  async function refresh() {
    const id = accountId;
    const epoch = generation;
    const sequence = ++readSequence;
    if (!id || !active(id, epoch)) return;
    try {
      const mutations = await createOutbox(id).list();
      if (!active(id, epoch) || sequence !== readSequence) return;
      const ids = new Set(mutations.map((entry) => entry.mutationId));
      for (const key of errors.keys()) if (!ids.has(key)) errors.delete(key);
      publish(projectSyncStatus(id, { accountId: id, mutations }, errors, retryingId));
    } catch {
      if (active(id, epoch) && sequence === readSequence) {
        publish({ ...CLEAR_SYNC_STATUS, accountId: id, status: 'needs-attention', errorCode: 'unknown' });
      }
    }
  }
  const unsubscribe = subscribeOutbox((event) => {
    if (event.kind === 'cleanup') reset();
    else if (event.accountId === accountId) void refresh();
  });

  return {
    reset,
    refresh,
    setAccount(id: string | null) {
      if (disposed || id === accountId) return;
      reset();
      accountId = id;
      void refresh();
    },
    dispose() { reset(); disposed = true; unsubscribe(); },
    async retry(id: string, mutationId: string): Promise<void> {
      const epoch = generation;
      if (!active(id, epoch) || retryingId !== null) return;
      // Acquire before any await, including the durable lookup (rapid taps).
      retryingId = mutationId;
      const isActive = () => active(id, epoch);
      try {
        const outbox = createOutbox(id);
        const mutations = await outbox.list();
        if (!isActive()) return;
        const mutation = mutations.find((entry) => entry.mutationId === mutationId);
        if (!mutation || !canManuallyRetry(mutation, errors.get(mutationId))) return;
        publish(projectSyncStatus(id, { accountId: id, mutations }, errors, mutationId));
        const updated = await outbox.updateMetadata(mutationId, { attempts: mutation.attempts + 1 });
        if (!updated || !isActive()) return;
        const result = await send(id, mutation, isActive);
        if (!isActive()) return;
        if (result.ok) {
          await outbox.acknowledge(mutationId);
          if (isActive()) errors.delete(mutationId);
        } else {
          errors.set(mutationId, syncSafeError(result));
          await outbox.updateMetadata(mutationId, { status: 'failed' });
        }
      } catch {
        // Raw storage/transport exceptions never become presentation data.
        if (isActive()) errors.set(mutationId, 'unknown');
      } finally {
        if (isActive()) {
          retryingId = null;
          await refresh();
        }
      }
    },
  };
}
