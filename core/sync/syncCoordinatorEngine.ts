import type { ConnectivitySource } from '@/core/sync/connectivity';
import type { ForegroundSource } from '@/core/sync/appForeground';
import { claimMutation, isMutationClaimed, releaseMutation } from '@/core/sync/mutationClaims';
import { SYNC_BATCH_LIMIT, SYNC_CONTINUATION_DELAY_MS } from '@/core/sync/retryPolicy';

type TimerHandle = ReturnType<typeof setTimeout>;

/** Payload-free invalidation only. Backend implementations must never put domain data here. */
export type SyncBackendEvent =
  | { readonly kind: 'changed'; readonly accountId: string }
  | { readonly kind: 'cleanup' }
  | { readonly kind: 'epoch-invalidated'; readonly accountId?: string };

export type BackendWorkPlan = { readonly due: readonly unknown[]; readonly nextRetryAtMs: number | null };

/**
 * The deliberately small seam between the event-driven lifecycle and a durable
 * queue. In particular, success is backend-owned: encrypted domains cannot be
 * assumed safe to acknowledge just because a mutation RPC returned success.
 */
export interface SyncCoordinatorBackendSession {
  isActive(): boolean;
  list(): Promise<readonly unknown[]>;
  plan(mutations: readonly unknown[], nowMs: number, limit: number): BackendWorkPlan;
  mutationId(mutation: unknown): string;
  send(mutation: unknown, isActive: () => boolean): Promise<unknown>;
  resolveSuccess(mutation: unknown, result: unknown): Promise<boolean>;
  /**
   * `isActive` is the engine's liveness check (account, generation and this session).
   * Anything a backend does after its durable write — such as announcing a permanent
   * refusal — must still be gated on it, exactly as the pre-extraction coordinator did.
   */
  resolveFailure(mutation: unknown, result: unknown | null, thrown: boolean, isActive: () => boolean): Promise<{
    readonly recorded: boolean;
    readonly permanent: boolean;
  }>;
}

export interface SyncCoordinatorBackend {
  /** Stable namespace for process-local claims as well as diagnostics-free routing. */
  readonly id: string;
  open(accountId: string): Promise<SyncCoordinatorBackendSession>;
  subscribe(listener: (event: SyncBackendEvent) => void): () => void;
}

export interface SyncCoordinatorEngineOptions {
  connectivity: ConnectivitySource;
  foreground: ForegroundSource;
  getActiveAccount: () => string | null;
  backends: readonly SyncCoordinatorBackend[];
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
}

/** A backend whose failure bookkeeping throws has recorded nothing, and must not earn a continuation. */
async function resolveFailureSafely(
  session: SyncCoordinatorBackendSession, mutation: unknown, result: unknown | null, thrown: boolean, isActive: () => boolean,
): Promise<{ readonly recorded: boolean; readonly permanent: boolean }> {
  try { return await session.resolveFailure(mutation, result, thrown, isActive); } catch { return { recorded: false, permanent: false }; }
}

type PlannedBackend = { backend: SyncCoordinatorBackend; session: SyncCoordinatorBackendSession; plan: BackendWorkPlan };
type PlannedWork = PlannedBackend & { mutation: unknown };

/** Shared APP-037 lifecycle engine. `createSyncCoordinator` keeps the ordinary wrapper. */
export function createSyncCoordinatorEngine(options: SyncCoordinatorEngineOptions) {
  const { connectivity, foreground, getActiveAccount, backends } = options;
  const now = options.now ?? (() => Date.now());
  const startTimer = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const stopTimer = options.cancel ?? ((handle: TimerHandle) => clearTimeout(handle));

  let accountId: string | null = null;
  let generation = 0;
  let runningGeneration: number | null = null;
  let running: Promise<void> | null = null;
  let timer: TimerHandle | null = null;
  let disposed = false;
  let nextBackendIndex = 0;

  const alive = (id: string, epoch: number, session?: SyncCoordinatorBackendSession) =>
    !disposed && accountId === id && generation === epoch && getActiveAccount() === id && (session?.isActive() ?? true);
  const mayRun = (id: string, epoch: number) => alive(id, epoch) && foreground.isForeground() && connectivity.getState() !== 'offline';
  const maySchedule = (id: string, epoch: number) => alive(id, epoch) && foreground.isForeground() && connectivity.getState() === 'online';

  function clearTimer() { if (timer !== null) { stopTimer(timer); timer = null; } }
  function trigger() {
    if (disposed || accountId === null || runningGeneration === generation) return;
    running = cycle();
  }
  function invalidateAndTrigger() {
    if (disposed || accountId === null) return;
    generation += 1;
    runningGeneration = null;
    clearTimer();
    trigger();
  }

  async function plans(id: string, epoch: number): Promise<readonly PlannedBackend[]> {
    const result: PlannedBackend[] = [];
    for (const backend of backends) {
      if (!alive(id, epoch)) break;
      try {
        const session = await backend.open(id);
        if (!alive(id, epoch, session)) continue;
        const mutations = await session.list();
        if (!alive(id, epoch, session)) continue;
        result.push({ backend, session, plan: session.plan(mutations, now(), SYNC_BATCH_LIMIT) });
      } catch {
        // A queue that cannot be read must not manufacture an empty queue or a timer.
      }
    }
    return result;
  }

  function dueWork(entries: readonly PlannedBackend[]): readonly PlannedWork[] {
    const ordered = entries.length === 0 ? [] : entries.map((_, offset) => entries[(nextBackendIndex + offset) % entries.length]);
    const result: PlannedWork[] = [];
    // Round-robin gives a later backend a bounded opportunity without changing the
    // ordinary one-backend wrapper's persisted ordering.
    for (let position = 0; result.length < SYNC_BATCH_LIMIT; position += 1) {
      let added = false;
      for (const entry of ordered) {
        const mutation = entry.plan.due[position];
        if (!mutation) continue;
        result.push({ ...entry, mutation });
        added = true;
        if (result.length === SYNC_BATCH_LIMIT) break;
      }
      if (!added) break;
    }
    return result;
  }

  async function cycle(): Promise<void> {
    const id = accountId;
    const epoch = generation;
    if (!id) return;
    runningGeneration = epoch;
    clearTimer();
    let recorded = true;
    try {
      if (!mayRun(id, epoch)) return;
      const initial = await plans(id, epoch);
      if (!mayRun(id, epoch)) return;
      for (const candidate of dueWork(initial)) {
        if (!mayRun(id, epoch) || !candidate.session.isActive()) break;
        const mutationId = candidate.session.mutationId(candidate.mutation);
        if (!claimMutation(id, mutationId, candidate.backend.id)) continue;
        try {
          const current = await candidate.session.list();
          if (!mayRun(id, epoch) || !candidate.session.isActive()) return;
          const currentMutation = candidate.session.plan(current, now(), SYNC_BATCH_LIMIT).due
            .find((item) => candidate.session.mutationId(item) === mutationId);
          if (!currentMutation) continue;
          let result: unknown;
          try {
            result = await candidate.session.send(currentMutation, () => alive(id, epoch, candidate.session));
          } catch {
            if (!alive(id, epoch, candidate.session)) return;
            const resolution = await resolveFailureSafely(
              candidate.session, currentMutation, null, true, () => alive(id, epoch, candidate.session),
            );
            recorded = resolution.recorded;
            // A thrown send may describe a shared transport failure; retain the
            // APP-037 rule that the rest of this bounded pass waits.
            break;
          }
          if (!alive(id, epoch, candidate.session)) return;
          // The backend, not the engine, owns the distinction between a safe ACK
          // and a success that still needs reconciliation.
          let success: boolean;
          try {
            success = await candidate.session.resolveSuccess(currentMutation, result);
          } catch {
            // A successful server response is never rewritten as a transport
            // failure when local acknowledgement bookkeeping cannot persist.
            recorded = false;
            break;
          }
          if (!success) {
            const resolution = await resolveFailureSafely(
              candidate.session, currentMutation, result, false, () => alive(id, epoch, candidate.session),
            );
            recorded = resolution.recorded;
          }
          if (!recorded) break;
        } finally {
          releaseMutation(id, mutationId, candidate.backend.id);
        }
        if (!alive(id, epoch)) return;
      }
      nextBackendIndex = backends.length === 0 ? 0 : (nextBackendIndex + 1) % backends.length;
    } catch {
      // Durable/storage/transport details are intentionally not surfaced here.
    } finally {
      if (runningGeneration === epoch) runningGeneration = null;
      if (!disposed && accountId === id && generation === epoch) await reschedule(recorded);
    }
  }

  async function reschedule(allowContinuation = true): Promise<void> {
    const id = accountId;
    const epoch = generation;
    if (!id || disposed || runningGeneration !== null) return;
    clearTimer();
    if (!maySchedule(id, epoch)) return;
    const entries = await plans(id, epoch);
    if (!maySchedule(id, epoch) || runningGeneration !== null || timer !== null) return;
    let earliest: number | null = null;
    let ready = false;
    for (const entry of entries) {
      if (entry.plan.nextRetryAtMs !== null) earliest = earliest === null ? entry.plan.nextRetryAtMs : Math.min(earliest, entry.plan.nextRetryAtMs);
      if (entry.plan.due.some((mutation) => !isMutationClaimed(id, entry.session.mutationId(mutation), entry.backend.id))) ready = true;
    }
    const delay = allowContinuation && ready ? SYNC_CONTINUATION_DELAY_MS : earliest === null ? null : Math.max(earliest - now(), 1);
    if (delay === null) return;
    timer = startTimer(() => { timer = null; if (maySchedule(id, epoch)) trigger(); }, delay);
  }

  const stops = backends.map((backend) => backend.subscribe((event) => {
    if (disposed) return;
    if (event.kind === 'cleanup') {
      generation += 1; runningGeneration = null; clearTimer(); accountId = null;
    } else if (event.kind === 'epoch-invalidated') {
      if (event.accountId === undefined || event.accountId === accountId) invalidateAndTrigger();
    } else if (event.accountId === accountId) trigger();
  }));
  const stopConnectivity = connectivity.subscribe((state) => { if (state !== 'online') clearTimer(); else trigger(); });
  const stopForeground = foreground.subscribe((foregroundNow) => { if (!foregroundNow) clearTimer(); else trigger(); });

  return {
    setAccount(id: string | null): void {
      if (disposed || id === accountId) return;
      generation += 1; runningGeneration = null; clearTimer(); accountId = id;
      if (id !== null) trigger();
    },
    async settle(): Promise<void> {
      for (let guard = 0; guard < 50 && running !== null; guard += 1) {
        const current = running; await current; if (running === current) running = null;
      }
    },
    dispose(): void {
      disposed = true; generation += 1; runningGeneration = null; clearTimer(); accountId = null;
      stops.forEach((stop) => stop()); stopConnectivity(); stopForeground();
    },
  };
}
