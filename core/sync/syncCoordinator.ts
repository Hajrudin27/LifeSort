import type { ConnectivitySource } from '@/core/sync/connectivity';
import type { ForegroundSource } from '@/core/sync/appForeground';
import { createOutbox, subscribeOutbox, type OutboxMutation } from '@/core/sync/outbox';
import { isTransientSyncFailure, planFailedAttempt } from '@/core/sync/retryPolicy';
import { notifyPermanentFailure } from '@/core/sync/refusalHandlers';
import { sendServerMutation } from '@/core/sync/serverMutations';
import { planSyncWork } from '@/core/sync/syncEligibility';
import { syncSafeError } from '@/core/sync/syncStatus';
import {
  createSyncCoordinatorEngine,
  type SyncBackendEvent,
  type SyncCoordinatorBackend,
  type SyncCoordinatorEngineOptions,
} from '@/core/sync/syncCoordinatorEngine';

type TimerHandle = ReturnType<typeof setTimeout>;

export interface SyncCoordinatorOptions {
  connectivity: ConnectivitySource;
  foreground: ForegroundSource;
  /** The live session account, checked again after every await. */
  getActiveAccount: () => string | null;
  send?: typeof sendServerMutation;
  now?: () => number;
  random?: () => number;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
  onPermanentFailure?: (accountId: string, mutation: OutboxMutation) => void;
}

/** The Profile-A adapter preserves the public APP-037 coordinator contract. */
function createOrdinaryBackend(options: SyncCoordinatorOptions): SyncCoordinatorBackend {
  const send = options.send ?? sendServerMutation;
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  return {
    id: 'ordinary',
    subscribe(listener) {
      return subscribeOutbox((event) => listener(event.kind === 'cleanup'
        ? { kind: 'cleanup' }
        : { kind: 'changed', accountId: event.accountId } satisfies SyncBackendEvent));
    },
    async open(accountId) {
      const outbox = createOutbox(accountId);
      return {
        isActive: () => true,
        list: () => outbox.list(),
        plan: (mutations, time, limit) => planSyncWork(mutations as OutboxMutation[], time, limit),
        mutationId: (mutation) => (mutation as OutboxMutation).mutationId,
        send: (mutation, active) => send(accountId, mutation as OutboxMutation, active),
        async resolveSuccess(mutation, result) {
          if (!(result as { ok?: boolean }).ok) return false;
          // The durable write, not acknowledge's boolean, records the ACK attempt.
          await outbox.acknowledge((mutation as OutboxMutation).mutationId);
          return true;
        },
        async resolveFailure(mutation, result, thrown, isActive) {
          const item = mutation as OutboxMutation;
          const code = thrown ? 'unavailable' : syncSafeError(result as Parameters<typeof syncSafeError>[0]);
          try {
            await outbox.updateMetadata(item.mutationId, planFailedAttempt(item.attempts, code, now(), random));
          } catch {
            return { recorded: false, permanent: false };
          }
          const permanent = !isTransientSyncFailure(code);
          // A refusal is announced only while the account that earned it is still the live one.
          if (permanent && isActive()) {
            try { (options.onPermanentFailure ?? notifyPermanentFailure)(accountId, item); } catch { /* Presentation never faults sync. */ }
          }
          return { recorded: true, permanent };
        },
      };
    },
  };
}

/**
 * APP-037 public ordinary wrapper. Pregnancy is deliberately not supplied here:
 * B2B must first provide its canonical-reconciliation success resolver.
 */
export function createSyncCoordinator(options: SyncCoordinatorOptions) {
  const engineOptions: SyncCoordinatorEngineOptions = {
    connectivity: options.connectivity,
    foreground: options.foreground,
    getActiveAccount: options.getActiveAccount,
    backends: [createOrdinaryBackend(options)],
    now: options.now,
    schedule: options.schedule,
    cancel: options.cancel,
  };
  return createSyncCoordinatorEngine(engineOptions);
}

export { createSyncCoordinatorEngine } from '@/core/sync/syncCoordinatorEngine';
