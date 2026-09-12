import { claimMutation, releaseMutation } from '@/core/sync/mutationClaims';
import { createOutbox, subscribeOutbox, type OutboxMutation } from '@/core/sync/outbox';
import { planFailedAttempt } from '@/core/sync/retryPolicy';
import { sendServerMutation } from '@/core/sync/serverMutations';
import { getEntityChainHeads } from '@/core/sync/syncEligibility';
import {
  canManuallyRetry, CLEAR_SYNC_STATUS, projectSyncStatus, syncSafeError,
  type SyncSafeErrorCode, type SyncStatusProjection,
} from '@/core/sync/syncStatus';

/**
 * Record the one attempt a thrown send consumed, on the same durable mutation.
 * Its change event is what lets the automatic coordinator pick the retry up.
 * A storage failure here changes nothing and is never surfaced raw.
 */
async function recordThrownAttempt(accountId: string, mutationId: string, attempts: number): Promise<void> {
  try {
    await createOutbox(accountId)
      .updateMetadata(mutationId, planFailedAttempt(attempts, 'unavailable', Date.now()));
  } catch {
    // The queue is unchanged; the entry stays exactly as it was.
  }
}

/**
 * Local projection observer and the explicit one-shot action. It schedules
 * nothing itself, but it records the same durable retry metadata as the APP-037
 * coordinator and shares its claim, so one mutation always has one sender.
 */
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
      // Acquire before any await, including the durable lookup (rapid taps), and
      // take the shared claim so the automatic worker cannot send it in parallel.
      if (!claimMutation(id, mutationId)) return;
      retryingId = mutationId;
      const isActive = () => active(id, epoch);
      // Set only while a request is genuinely outstanding. A throw from here is a
      // completed attempt; a throw from the durable lookup before it never
      // reached the network and must not be counted as one.
      let dispatched: OutboxMutation | null = null;
      try {
        const outbox = createOutbox(id);
        const mutations = await outbox.list();
        if (!isActive()) return;
        // Read the full durable queue under the shared claim immediately before
        // dispatch. A direct/stale UI call cannot leapfrog an outstanding head.
        // Explicit intent may bypass nextRetryAt, but never chain ordering.
        const mutation = getEntityChainHeads(mutations).find((entry) => entry.mutationId === mutationId);
        if (!mutation || !canManuallyRetry(mutation, errors.get(mutationId))) return;
        publish(projectSyncStatus(id, { accountId: id, mutations }, errors, mutationId));
        dispatched = mutation;
        const result = await send(id, mutation, isActive);
        dispatched = null;
        if (!isActive()) return;
        if (result.ok) {
          await outbox.acknowledge(mutationId);
          if (isActive()) errors.delete(mutationId);
        } else {
          // The attempt is counted once it has completed without acknowledgement,
          // and a transient outcome leaves the timestamp the coordinator waits for.
          const code = syncSafeError(result);
          errors.set(mutationId, code);
          await outbox.updateMetadata(mutationId, planFailedAttempt(mutation.attempts, code, Date.now()));
        }
      } catch {
        // Raw storage/transport exceptions never become presentation data.
        if (!isActive()) return;
        if (!dispatched) {
          errors.set(mutationId, 'unknown');
          return;
        }
        // A sender that threw still consumed an attempt, and the coordinator
        // deliberately schedules nothing for a mutation someone else claimed —
        // so without this durable write the work would sit here until some
        // unrelated trigger happened along. Treated as transient: a thrown
        // transport error is not evidence the server refused anything.
        errors.set(mutationId, 'unavailable');
        await recordThrownAttempt(id, mutationId, dispatched.attempts);
      } finally {
        releaseMutation(id, mutationId);
        if (isActive()) {
          retryingId = null;
          await refresh();
        }
      }
    },
  };
}
