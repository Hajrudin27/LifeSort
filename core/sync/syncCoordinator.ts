import type { ConnectivitySource } from '@/core/sync/connectivity';
import type { ForegroundSource } from '@/core/sync/appForeground';
import { claimMutation, isMutationClaimed, releaseMutation } from '@/core/sync/mutationClaims';
import { createOutbox, subscribeOutbox } from '@/core/sync/outbox';
import {
  planFailedAttempt,
  SYNC_BATCH_LIMIT,
  SYNC_CONTINUATION_DELAY_MS,
} from '@/core/sync/retryPolicy';
import { sendServerMutation } from '@/core/sync/serverMutations';
import { planSyncWork } from '@/core/sync/syncEligibility';
import { syncSafeError } from '@/core/sync/syncStatus';

/**
 * APP-037 — the automatic sender.
 *
 * Everything here is a reaction to something that actually happened: the user
 * signed in, the app came forward, the network came back, a mutation was
 * queued, or a scheduled retry came due. Nothing is checked "every so often".
 * That is the whole point — a poll costs battery on every device that has
 * nothing to send, which is almost all of them almost all of the time.
 *
 * One cycle per account at a time, a bounded batch, and a single timer for the
 * earliest thing that still has to wait. Triggers that arrive during a cycle
 * are not queued into more workers; the cycle ends by rereading durable state,
 * which is more truthful than anything a trigger could have told it.
 */

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
}

export function createSyncCoordinator(options: SyncCoordinatorOptions) {
  const { connectivity, foreground, getActiveAccount } = options;
  const send = options.send ?? sendServerMutation;
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const startTimer = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const stopTimer = options.cancel ?? ((handle: TimerHandle) => clearTimeout(handle));

  let accountId: string | null = null;
  let generation = 0;
  let runningGeneration: number | null = null;
  let running: Promise<void> | null = null;
  let timer: TimerHandle | null = null;
  let disposed = false;

  /** The bound account must still be the signed-in one, at this generation. */
  function alive(id: string, epoch: number): boolean {
    return !disposed && accountId === id && generation === epoch && getActiveAccount() === id;
  }

  /**
   * Work the user's own actions caused. Offline never sends; background never
   * starts a send. An unknown link may be tried, because refusing outright would
   * strand every device whose platform reports nothing — but see below: being
   * allowed to try is not the same as being allowed to come back on its own.
   */
  function mayRunEventTriggeredPass(id: string, epoch: number): boolean {
    return alive(id, epoch) && foreground.isForeground() && connectivity.getState() !== 'offline';
  }

  /**
   * Work the app would schedule for itself. This needs a link we actually know
   * about: an unknown one that is really offline would otherwise fail, earn a
   * retry, fail again, and turn a single hopeful attempt into a series of them.
   * Nothing is lost by waiting — the durable timestamp survives, and connectivity
   * turning online is itself a trigger that reads it back.
   */
  function mayScheduleAutomaticWork(id: string, epoch: number): boolean {
    return alive(id, epoch) && foreground.isForeground() && connectivity.getState() === 'online';
  }

  function clearTimer(): void {
    if (timer === null) return;
    stopTimer(timer);
    timer = null;
  }

  function trigger(): void {
    if (disposed || accountId === null) return;
    // A cycle is already reading the same durable state this trigger describes.
    if (runningGeneration === generation) return;
    running = cycle();
  }

  /**
   * Local bookkeeping, kept apart from the send it follows. Storage can fail
   * independently of the server, and when it does the client loses its record of
   * what happened — it does not get to rewrite what actually happened.
   */
  async function record(write: () => Promise<unknown>): Promise<boolean> {
    try {
      await write();
      return true;
    } catch {
      // Storage faults carry paths and payload fragments. Never surfaced.
      return false;
    }
  }

  /**
   * One bounded pass. Sequential on purpose: ten parallel requests are a burst
   * the radio pays for, and they would also let a later mutation overtake an
   * earlier one.
   */
  async function cycle(): Promise<void> {
    const id = accountId;
    const epoch = generation;
    if (id === null) return;
    runningGeneration = epoch;
    clearTimer();
    // A local write that could not be made is not a reason to come straight
    // back and try the same thing again a second later.
    let recorded = true;
    try {
      if (!mayRunEventTriggeredPass(id, epoch)) return;
      const outbox = createOutbox(id);
      const mutations = await outbox.list();
      if (!mayRunEventTriggeredPass(id, epoch)) return;

      for (const candidate of planSyncWork(mutations, now(), SYNC_BATCH_LIMIT).due) {
        // Rechecked before every send: connectivity or the lifecycle may have
        // changed mid-batch, and the rest of the batch must not be spent on it.
        if (!mayRunEventTriggeredPass(id, epoch)) break;
        if (!claimMutation(id, candidate.mutationId)) continue;
        try {
          // A manual action may have acknowledged this candidate while another
          // entity in the batch was sending. Never dispatch a stale chain head.
          const current = await outbox.list();
          if (!mayRunEventTriggeredPass(id, epoch)) return;
          const mutation = planSyncWork(current, now(), SYNC_BATCH_LIMIT).due
            .find((entry) => entry.mutationId === candidate.mutationId);
          if (!mutation) continue;
          let result;
          try {
            // The same durable mutation ID is resent, so the server can recognise
            // a repeat of a request whose response we never saw (APP-032).
            result = await send(id, mutation, () => alive(id, epoch));
          } catch {
            // The request itself failed, which is one completed unacknowledged
            // attempt. Backoff spaces out the next one, and the batch stops
            // because the fault may not belong to this mutation at all.
            if (!alive(id, epoch)) return;
            recorded = await record(() => outbox.updateMetadata(
              mutation.mutationId,
              planFailedAttempt(mutation.attempts, 'unavailable', now(), random),
            ));
            break;
          }
          if (!alive(id, epoch)) return;

          if (result.ok) {
            // The server has it. Dropping our copy is bookkeeping: if that
            // cannot be written the mutation stays, and replaying the same ID
            // later is answered `replayed` rather than applied twice.
            recorded = await record(() => outbox.acknowledge(mutation.mutationId));
          } else {
            // Exactly one classification for this outcome, written once. If it
            // cannot be written, the outcome is still what the server said —
            // it does not become a transport failure, and a permanent refusal
            // does not become something worth retrying.
            recorded = await record(() => outbox.updateMetadata(
              mutation.mutationId,
              planFailedAttempt(mutation.attempts, syncSafeError(result), now(), random),
            ));
          }
          if (!recorded) break;
        } finally {
          releaseMutation(id, candidate.mutationId);
        }
        if (!alive(id, epoch)) return;
      }
    } catch {
      // Storage or transport faults carry payload fragments and paths. The pass
      // ends; the durable queue is unchanged and a later trigger tries again.
    } finally {
      if (runningGeneration === epoch) runningGeneration = null;
      if (!disposed && accountId === id && generation === epoch) await reschedule(recorded);
    }
  }

  /**
   * Exactly one timer, for the earliest thing that has to wait. Rereads durable
   * state rather than trusting what the cycle remembered, so a restart and a
   * running app arrive at the same schedule.
   */
  async function reschedule(allowContinuation = true): Promise<void> {
    const id = accountId;
    const epoch = generation;
    if (id === null || disposed || runningGeneration !== null) return;
    clearTimer();
    // Backgrounded, offline or on a link we know nothing about: no timer at all,
    // rather than one that wakes the device to discover it may not do anything.
    if (!mayScheduleAutomaticWork(id, epoch)) return;
    try {
      const mutations = await createOutbox(id).list();
      if (!mayScheduleAutomaticWork(id, epoch) || runningGeneration !== null || timer !== null) return;
      const plan = planSyncWork(mutations, now(), SYNC_BATCH_LIMIT);
      // Work someone else is already sending is not work this timer can do.
      const ready = allowContinuation
        && plan.due.some((mutation) => !isMutationClaimed(id, mutation.mutationId));
      const delayMs = ready
        ? SYNC_CONTINUATION_DELAY_MS
        : plan.nextRetryAtMs === null
          ? null
          : Math.max(plan.nextRetryAtMs - now(), 1);
      if (delayMs === null) return;
      timer = startTimer(() => {
        timer = null;
        // A timer is the app's own initiative, so the conditions for it must
        // still hold when it fires — not only when it was set.
        if (mayScheduleAutomaticWork(id, epoch)) trigger();
      }, delayMs);
    } catch {
      // A durable read that fails schedules nothing and reports nothing. The
      // next lifecycle, connectivity or enqueue event re-evaluates from disk.
    }
  }

  const stopOutbox = subscribeOutbox((event) => {
    if (disposed) return;
    if (event.kind === 'cleanup') {
      // Local account data is being erased: no further sends, no timer, and
      // any in-flight response becomes unpublishable.
      generation += 1;
      runningGeneration = null;
      clearTimer();
      accountId = null;
      return;
    }
    if (event.accountId === accountId) trigger();
  });

  const stopConnectivity = connectivity.subscribe((state) => {
    if (disposed) return;
    if (state !== 'online') {
      // Offline, or a link the platform can no longer describe: the app stops
      // scheduling anything for itself. The durable timestamp is what remembers.
      clearTimer();
      return;
    }
    // Regaining the network makes queued work sendable again — it does not make
    // a waiting retry due. Toggling airplane mode is not a way past backoff.
    trigger();
  });

  const stopForeground = foreground.subscribe((isForeground) => {
    if (disposed) return;
    if (!isForeground) {
      clearTimer();
      return;
    }
    trigger();
  });

  return {
    /** Binding an account is itself a trigger; unbinding stops everything. */
    setAccount(id: string | null): void {
      if (disposed || id === accountId) return;
      generation += 1;
      runningGeneration = null;
      clearTimer();
      accountId = id;
      if (id !== null) trigger();
    },

    /** Lifecycle and test seam: resolves once no cycle is in progress. */
    async settle(): Promise<void> {
      for (let guard = 0; guard < 50 && running !== null; guard += 1) {
        const current = running;
        await current;
        if (running === current) running = null;
      }
    },

    dispose(): void {
      disposed = true;
      generation += 1;
      runningGeneration = null;
      clearTimer();
      accountId = null;
      stopOutbox();
      stopConnectivity();
      stopForeground();
    },
  };
}
