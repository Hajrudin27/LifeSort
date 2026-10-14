import { buildPregnancyRemoteSnapshots } from '@/core/pregnancy/canonicalMappers';
import { readPregnancyCanonicalStates, type PregnancyCanonicalRequest } from '@/core/pregnancy/canonicalReaders';
import {
  createPregnancyProtectedRepository, PregnancyProtectedRepositoryError, subscribePregnancyQueue,
  type PregnancyQueuedMutation,
} from '@/core/pregnancy/protectedRepository';
import type { PregnancySuccessProof } from '@/core/pregnancy/reconciliation';
import { planPregnancySyncWork, pregnancyFailureIsTransient, recordPregnancySyncFailure, type PregnancyFailureReason } from '@/core/pregnancy/syncQueue';
import { PREGNANCY_PULL_PAGE_LIMIT, pullPregnancyChanges } from '@/core/pregnancy/syncPull';
import { sendPregnancyMutation, type PregnancyMutationResult } from '@/core/pregnancy/syncTransport';
import { retryDelayMs } from '@/core/sync/retryPolicy';
import type { SyncCoordinatorBackend, SyncCoordinatorBackendSession } from '@/core/sync/syncCoordinatorEngine';

/** The engine namespace for claims, deferrals and backend-scoped invalidation. */
export const PREGNANCY_SYNC_BACKEND_ID = 'pregnancy';

export interface PregnancySyncBackendOptions {
  getActiveAccount: () => string | null;
  send?: typeof sendPregnancyMutation;
  pull?: typeof pullPregnancyChanges;
  readCanonical?: typeof readPregnancyCanonicalStates;
  now?: () => number;
  random?: () => number;
}

/**
 * INTERNAL (APP-076 B2B1). This backend proves, in tests, the full Pregnancy sync contract:
 * pull before send, one bounded page per cycle, canonical reconciliation, and a success that is
 * acknowledged only by the protected commit which proves it. It is deliberately registered
 * nowhere in production: no startup path can reach the Pregnancy network yet.
 *
 * Nothing here reaches into protected state directly. Every durable effect goes through the
 * repository's narrow operations, and nothing in this file logs, throws or returns a clinical value,
 * a mutation id, an entity id or a raw server message.
 */
export function createPregnancySyncBackend(options: PregnancySyncBackendOptions): SyncCoordinatorBackend {
  const send = options.send ?? sendPregnancyMutation;
  const pull = options.pull ?? pullPregnancyChanges;
  const readCanonical = options.readCanonical ?? readPregnancyCanonicalStates;
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  /** Process-local pull backoff per account: it bounds retries, and is never durable or surfaced. */
  const pullBackoff = new Map<string, { failures: number; notBeforeMs: number }>();

  return {
    id: PREGNANCY_SYNC_BACKEND_ID,
    subscribe(listener) {
      return subscribePregnancyQueue((event) => {
        if (event.kind === 'cleanup') listener({ kind: 'cleanup' });
        else if (event.kind === 'changed') listener({ kind: 'changed', accountId: event.accountId });
        // Only Pregnancy is invalidated: an ordinary in-flight send must survive a dataset epoch change.
        else listener({ kind: 'backend-invalidated', backendId: PREGNANCY_SYNC_BACKEND_ID, accountId: event.accountId });
      });
    },
    async open(accountId): Promise<SyncCoordinatorBackendSession> {
      const discovery = createPregnancyProtectedRepository({ accountId, getActiveAccount: options.getActiveAccount });
      const state = await discovery.hydrate();
      if (state === null) throw new Error('Pregnancy protected dataset is unavailable.');
      // Pinned to the dataset epoch discovered now: a later rebaseline makes this session inert.
      const repository = createPregnancyProtectedRepository({ accountId, getActiveAccount: options.getActiveAccount, datasetEpoch: state.datasetEpoch });
      await repository.hydrate();
      const isActive = () => repository.isActive();

      function backoff(): number {
        const entry = pullBackoff.get(accountId) ?? { failures: 0, notBeforeMs: 0 };
        const failures = entry.failures + 1;
        const notBeforeMs = now() + retryDelayMs(failures, random);
        pullBackoff.set(accountId, { failures, notBeforeMs });
        return notBeforeMs;
      }

      return {
        isActive,
        async list() {
          const view = await repository.readSyncView();
          // A halted (or missing) dataset lists no work: its mutations stay durable and untouched.
          return view === null || view.halt !== null ? [] : view.mutations;
        },
        plan: (mutations, nowMs, limit) => planPregnancySyncWork(mutations as PregnancyQueuedMutation[], nowMs, limit),
        mutationId: (mutation) => (mutation as PregnancyQueuedMutation).mutationId,
        send: (mutation, active) => send(accountId, mutation as PregnancyQueuedMutation, active),

        async resolveSuccess(mutation, result) {
          const outcome = result as PregnancyMutationResult;
          if (!outcome.ok) return { outcome: 'not-success' };
          const item = mutation as PregnancyQueuedMutation;
          const deferred = {
            mutationId: item.mutationId, entityType: outcome.entityType, entityId: outcome.entityId,
            revision: outcome.revision, deleted: outcome.deleted,
            ...(outcome.changeSeq === undefined ? {} : { changeSeq: outcome.changeSeq }),
          };
          // A first application has a ledger position the next pull must reconcile in order. Only a
          // replay can be proven by state that is already local, in the protected commit that checks it.
          if (outcome.status === 'applied') return { outcome: 'deferred', deferred };
          const view = await repository.readSyncView();
          if (view === null || view.halt !== null) return { outcome: 'deferred', deferred };
          const proof: PregnancySuccessProof = {
            mutationId: item.mutationId, entityType: outcome.entityType, entityId: outcome.entityId, serverRevision: outcome.revision, deleted: outcome.deleted,
          };
          const committed = await repository.commitRemoteReconciliation({ fromCursor: view.cursor, toCursor: view.cursor, caughtUp: false, snapshots: [], proofs: [proof] });
          return committed.acknowledged.includes(item.mutationId) ? { outcome: 'resolved' } : { outcome: 'deferred', deferred };
        },

        async inbound(context) {
          const view = await repository.readSyncView();
          if (view === null) return { outcome: 'blocked' };
          if (view.halt !== null) return { outcome: 'halted' };
          const waiting = pullBackoff.get(accountId);
          if (waiting && now() < waiting.notBeforeMs) return { outcome: 'blocked', retryAtMs: waiting.notBeforeMs };

          const pulled = await pull(accountId, view.cursor, isActive);
          if (!pulled.ok) {
            // A session the server refused is not retried in a loop; anything else backs off.
            return pulled.reason === 'authorization' ? { outcome: 'blocked' } : { outcome: 'blocked', retryAtMs: backoff() };
          }
          const { changes } = pulled;
          const proofs: PregnancySuccessProof[] = context.deferred.map((entry) => ({
            mutationId: entry.mutationId, entityType: entry.entityType as PregnancySuccessProof['entityType'], entityId: entry.entityId,
            serverRevision: entry.revision, deleted: entry.deleted,
          }));
          const caughtUp = changes.length < PREGNANCY_PULL_PAGE_LIMIT;
          // Nothing to apply and nothing that a caught-up pass could settle: no write, no churn.
          if (changes.length === 0 && proofs.length === 0 && !view.mutations.some((item) => item.awaiting !== undefined)) {
            pullBackoff.delete(accountId);
            return { outcome: 'caught-up' };
          }

          let snapshots: ReturnType<typeof buildPregnancyRemoteSnapshots> = [];
          if (changes.length > 0) {
            const request: PregnancyCanonicalRequest = {
              pregnancy: changes.filter((change) => change.entityType === 'pregnancy').map((change) => change.entityId),
              log: changes.filter((change) => change.entityType === 'log').map((change) => change.entityId),
              appointment: changes.filter((change) => change.entityType === 'appointment').map((change) => change.entityId),
              settings: changes.some((change) => change.entityType === 'settings'),
            };
            const read = await readCanonical(accountId, request, isActive);
            if (!read.ok) return read.reason === 'authorization' ? { outcome: 'blocked' } : { outcome: 'blocked', retryAtMs: backoff() };
            // An announced entity that no valid row or tombstone explains fails the page closed: no cursor move.
            snapshots = buildPregnancyRemoteSnapshots(changes, read.states);
            if (snapshots === null) return { outcome: 'blocked', retryAtMs: backoff() };
          }

          try {
            const committed = await repository.commitRemoteReconciliation({
              fromCursor: view.cursor, toCursor: pulled.nextChangeSeq, caughtUp, snapshots, proofs,
            });
            if (committed.halted) return { outcome: 'halted' };
            pullBackoff.delete(accountId);
            return { outcome: caughtUp ? 'caught-up' : 'continue', resolved: committed.acknowledged };
          } catch (error) {
            if (error instanceof PregnancyProtectedRepositoryError && error.code === 'backend-halted') return { outcome: 'halted' };
            // A stale session, a lost cursor race or a failed protected write leaves old state, cursor and queue intact.
            return { outcome: 'blocked', retryAtMs: backoff() };
          }
        },

        async resolveFailure(mutation, result, thrown, active) {
          if (!active()) return { recorded: false, permanent: false };
          const item = mutation as PregnancyQueuedMutation;
          const failure = thrown ? null : (result as Extract<PregnancyMutationResult, { ok: false }>);
          let reason: PregnancyFailureReason = failure?.reason ?? 'unavailable';
          const attempted = failure?.attempted ?? true;
          if (reason === 'parent-unavailable') {
            // A child can outrun its own not-yet-confirmed root. That is waiting, not a halt.
            const view = await repository.readSyncView();
            const parentId = typeof item.payload?.pregnancyId === 'string' ? item.payload.pregnancyId : undefined;
            const rootPending = !!view && view.mutations.some((queued) => queued.entityType === 'pregnancy' && queued.entityId === parentId
              && queued.operation === 'upsert' && queued.terminalReason === undefined);
            if (rootPending) reason = 'unavailable';
          }
          const recorded = await recordPregnancySyncFailure(repository, item, reason, attempted, now(), random);
          return { recorded: recorded.recorded, permanent: !pregnancyFailureIsTransient(reason), reconcile: recorded.needsInbound };
        },
      };
    },
  };
}
