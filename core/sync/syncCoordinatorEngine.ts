import type { ConnectivitySource } from '@/core/sync/connectivity';
import type { ForegroundSource } from '@/core/sync/appForeground';
import { claimMutation, isMutationClaimed, releaseMutation } from '@/core/sync/mutationClaims';
import { SYNC_BATCH_LIMIT, SYNC_CONTINUATION_DELAY_MS } from '@/core/sync/retryPolicy';

type TimerHandle = ReturnType<typeof setTimeout>;

/** Payload-free invalidation only. Backend implementations must never put domain data here. */
export type SyncBackendEvent =
  | { readonly kind: 'changed'; readonly accountId: string }
  /** Account-wide: every backend, every in-flight send. */
  | { readonly kind: 'cleanup' }
  /**
   * Backend-scoped: only the named backend's sessions and deferred work die. Carries
   * no entity, mutation, consent or payload identity. An omitted account means the
   * account the engine is currently bound to.
   */
  | { readonly kind: 'backend-invalidated'; readonly backendId: string; readonly accountId?: string };

export type BackendWorkPlan = { readonly due: readonly unknown[]; readonly nextRetryAtMs: number | null };

/**
 * Safe, process-local description of a server success whose durable resolution is
 * still outstanding. It is deliberately payload-free: identity and revision only.
 */
export type DeferredSuccess = {
  readonly mutationId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly revision: number;
  readonly deleted: boolean;
  readonly changeSeq?: number;
};

/**
 * What a backend did with a result. Success is a three-way question, not a boolean:
 * - `resolved`: the backend durably completed its success handling.
 * - `deferred`: the server succeeded, but durable canonical resolution is incomplete.
 *   The engine neither fails, resends nor busy-loops on it; the backend settles it
 *   from its inbound pass.
 * - `unresolved`: success bookkeeping could not be persisted.
 * `not-success` means the result was not a success at all: run failure handling.
 */
export type SyncSuccessResolution =
  | { readonly outcome: 'resolved' }
  | { readonly outcome: 'deferred'; readonly deferred: DeferredSuccess }
  | { readonly outcome: 'unresolved' }
  | { readonly outcome: 'not-success' };

export type SyncInboundContext = {
  /** Safe metadata of this backend's server successes awaiting durable resolution. */
  readonly deferred: readonly DeferredSuccess[];
};

/**
 * `caught-up`: this backend's remote state is current, so its sends may proceed.
 * `continue`: a bounded page was handled and more remote work is known; sends wait.
 * `blocked`: nothing could be reconciled this pass; sends wait (optionally with a retry time).
 * `halted`: a durable recovery halt is in force; this backend stops, others continue.
 */
export type SyncInboundResult =
  | { readonly outcome: 'caught-up'; readonly resolved?: readonly string[] }
  | { readonly outcome: 'continue'; readonly resolved?: readonly string[] }
  | { readonly outcome: 'blocked'; readonly retryAtMs?: number }
  | { readonly outcome: 'halted' };

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
  resolveSuccess(mutation: unknown, result: unknown): Promise<SyncSuccessResolution>;
  /**
   * Optional bounded inbound step, run only inside an active coordinator cycle and
   * never from `list`, `plan` or rescheduling. At most one page of remote work per
   * call. A backend without it (the ordinary outbox) is unaffected.
   */
  inbound?(context: SyncInboundContext): Promise<SyncInboundResult>;
  /**
   * `isActive` is the engine's liveness check (account, generation and this session).
   * Anything a backend does after its durable write — such as announcing a permanent
   * refusal — must still be gated on it, exactly as the pre-extraction coordinator did.
   * `reconcile` asks for a prompt, bounded continuation (which runs the inbound step first).
   */
  resolveFailure(mutation: unknown, result: unknown | null, thrown: boolean, isActive: () => boolean): Promise<{
    readonly recorded: boolean;
    readonly permanent: boolean;
    readonly reconcile?: boolean;
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

type FailureResolution = { readonly recorded: boolean; readonly permanent: boolean; readonly reconcile?: boolean };

/** A backend whose failure bookkeeping throws has recorded nothing, and must not earn a continuation. */
async function resolveFailureSafely(
  session: SyncCoordinatorBackendSession, mutation: unknown, result: unknown | null, thrown: boolean, isActive: () => boolean,
): Promise<FailureResolution> {
  try { return await session.resolveFailure(mutation, result, thrown, isActive); } catch { return { recorded: false, permanent: false }; }
}

type PlannedBackend = {
  backend: SyncCoordinatorBackend;
  session: SyncCoordinatorBackendSession;
  plan: BackendWorkPlan;
  /** The backend's invalidation epoch when this session was opened. */
  backendEpoch: number;
};
type PlannedWork = PlannedBackend & { mutation: unknown };

const deferredKey = (backendId: string, mutationId: string) => `${backendId}\u0000${mutationId}`;

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
  /** Per-backend invalidation epochs: bumping one never touches another backend's work. */
  const backendEpochs = new Map<string, number>();
  /** Process-local only; the durable mutation survives a restart and idempotent replay recovers it. */
  const deferred = new Map<string, DeferredSuccess>();
  /** A backend was invalidated while a cycle ran; run exactly one fresh cycle afterwards. */
  let rerunRequested = false;

  const epochOf = (backendId: string) => backendEpochs.get(backendId) ?? 0;
  /** Account-wide invalidation: every backend, every deferral, every in-flight send. */
  function bumpGeneration() { generation += 1; runningGeneration = null; rerunRequested = false; deferred.clear(); clearTimer(); }

  const alive = (id: string, epoch: number, session?: SyncCoordinatorBackendSession) =>
    !disposed && accountId === id && generation === epoch && getActiveAccount() === id && (session?.isActive() ?? true);
  const aliveFor = (id: string, epoch: number, entry: PlannedBackend) =>
    alive(id, epoch, entry.session) && epochOf(entry.backend.id) === entry.backendEpoch;
  const mayRun = (id: string, epoch: number) => alive(id, epoch) && foreground.isForeground() && connectivity.getState() !== 'offline';
  const maySchedule = (id: string, epoch: number) => alive(id, epoch) && foreground.isForeground() && connectivity.getState() === 'online';

  function clearTimer() { if (timer !== null) { stopTimer(timer); timer = null; } }
  function trigger() {
    if (disposed || accountId === null || runningGeneration === generation) return;
    running = cycle();
  }
  function invalidateBackend(backendId: string) {
    if (disposed || accountId === null) return;
    backendEpochs.set(backendId, epochOf(backendId) + 1);
    for (const key of [...deferred.keys()]) if (key.startsWith(`${backendId}\u0000`)) deferred.delete(key);
    // An in-flight cycle keeps serving other backends; this one just earns a fresh pass.
    if (runningGeneration === generation) rerunRequested = true;
    else { clearTimer(); trigger(); }
  }

  function pruneDeferred(backendId: string, session: SyncCoordinatorBackendSession, mutations: readonly unknown[]) {
    const live = new Set(mutations.map((mutation) => deferredKey(backendId, session.mutationId(mutation))));
    for (const key of [...deferred.keys()]) if (key.startsWith(`${backendId}\u0000`) && !live.has(key)) deferred.delete(key);
  }

  async function plans(id: string, epoch: number): Promise<readonly PlannedBackend[]> {
    const result: PlannedBackend[] = [];
    for (const backend of backends) {
      if (!alive(id, epoch)) break;
      const backendEpoch = epochOf(backend.id);
      try {
        const session = await backend.open(id);
        const entry = { backend, session, backendEpoch, plan: { due: [], nextRetryAtMs: null } } as PlannedBackend;
        if (!aliveFor(id, epoch, entry)) continue;
        const mutations = await session.list();
        if (!aliveFor(id, epoch, entry)) continue;
        pruneDeferred(backend.id, session, mutations);
        result.push({ ...entry, plan: session.plan(mutations, now(), SYNC_BATCH_LIMIT) });
      } catch {
        // A queue that cannot be read must not manufacture an empty queue or a timer.
      }
    }
    return result;
  }

  const isDeferred = (entry: PlannedBackend, mutation: unknown) => deferred.has(deferredKey(entry.backend.id, entry.session.mutationId(mutation)));

  function dueWork(entries: readonly PlannedBackend[], blocked: ReadonlySet<string>): readonly PlannedWork[] {
    // A backend still catching up, blocked or halted contributes no sends; a deferred
    // mutation is never due again in this process.
    const sendable = entries.filter((entry) => !blocked.has(entry.backend.id));
    const ordered = sendable.length === 0 ? [] : sendable.map((_, offset) => sendable[(nextBackendIndex + offset) % sendable.length]);
    const result: PlannedWork[] = [];
    // Round-robin gives a later backend a bounded opportunity without changing the
    // ordinary one-backend wrapper's persisted ordering.
    for (let position = 0; result.length < SYNC_BATCH_LIMIT; position += 1) {
      let added = false;
      for (const entry of ordered) {
        const due = entry.plan.due.filter((mutation) => !isDeferred(entry, mutation));
        const mutation = due[position];
        if (!mutation) continue;
        result.push({ ...entry, mutation });
        added = true;
        if (result.length === SYNC_BATCH_LIMIT) break;
      }
      if (!added) break;
    }
    return result;
  }

  type InboundSummary = { blocked: Set<string>; continuation: boolean; retryAtMs: number | null };

  /** One bounded inbound opportunity per backend that has one, before any send. */
  async function inboundPhase(id: string, epoch: number, entries: readonly PlannedBackend[]): Promise<InboundSummary> {
    const summary: InboundSummary = { blocked: new Set(), continuation: false, retryAtMs: null };
    for (const entry of entries) {
      if (!entry.session.inbound) continue;
      if (!mayRun(id, epoch) || !aliveFor(id, epoch, entry)) { summary.blocked.add(entry.backend.id); continue; }
      const pending = [...deferred.entries()].filter(([key]) => key.startsWith(`${entry.backend.id}\u0000`)).map(([, value]) => value);
      let result: SyncInboundResult;
      try { result = await entry.session.inbound({ deferred: pending }); } catch { result = { outcome: 'blocked' }; }
      // A stale result neither unblocks sends nor installs deferral changes.
      if (!aliveFor(id, epoch, entry)) { summary.blocked.add(entry.backend.id); continue; }
      if (result.outcome === 'caught-up' || result.outcome === 'continue') {
        for (const mutationId of result.resolved ?? []) deferred.delete(deferredKey(entry.backend.id, mutationId));
      }
      if (result.outcome === 'caught-up') continue;
      summary.blocked.add(entry.backend.id);
      if (result.outcome === 'continue') summary.continuation = true;
      else if (result.outcome === 'blocked' && result.retryAtMs !== undefined) {
        summary.retryAtMs = summary.retryAtMs === null ? result.retryAtMs : Math.min(summary.retryAtMs, result.retryAtMs);
      } else if (result.outcome === 'halted') {
        for (const key of [...deferred.keys()]) if (key.startsWith(`${entry.backend.id}\u0000`)) deferred.delete(key);
      }
    }
    return summary;
  }

  async function cycle(): Promise<void> {
    const id = accountId;
    const epoch = generation;
    if (!id) return;
    runningGeneration = epoch;
    clearTimer();
    let recorded = true;
    let continuation = false;
    let inboundRetryAtMs: number | null = null;
    let inboundBlocked: ReadonlySet<string> = new Set();
    try {
      if (!mayRun(id, epoch)) return;
      const initial = await plans(id, epoch);
      if (!mayRun(id, epoch)) return;
      const inbound = await inboundPhase(id, epoch, initial);
      continuation = inbound.continuation;
      inboundRetryAtMs = inbound.retryAtMs;
      inboundBlocked = inbound.blocked;
      if (!mayRun(id, epoch)) return;
      for (const candidate of dueWork(initial, inbound.blocked)) {
        const live = () => aliveFor(id, epoch, candidate);
        if (!mayRun(id, epoch)) break;
        // Only this backend lost its session (account-wide loss was just ruled out by
        // mayRun): other backends' work is unaffected.
        if (!live()) continue;
        const mutationId = candidate.session.mutationId(candidate.mutation);
        if (!claimMutation(id, mutationId, candidate.backend.id)) continue;
        try {
          const current = await candidate.session.list();
          if (!mayRun(id, epoch)) return;
          if (!live()) continue;
          const currentMutation = candidate.session.plan(current, now(), SYNC_BATCH_LIMIT).due
            .find((item) => candidate.session.mutationId(item) === mutationId);
          if (!currentMutation) continue;
          if (deferred.has(deferredKey(candidate.backend.id, mutationId))) continue;
          let result: unknown;
          try {
            result = await candidate.session.send(currentMutation, live);
          } catch {
            if (!live()) { if (alive(id, epoch)) continue; return; }
            const resolution = await resolveFailureSafely(candidate.session, currentMutation, null, true, live);
            recorded = resolution.recorded;
            if (resolution.reconcile) continuation = true;
            // A thrown send may describe a shared transport failure; retain the
            // APP-037 rule that the rest of this bounded pass waits.
            break;
          }
          if (!live()) { if (alive(id, epoch)) continue; return; }
          // The backend, not the engine, owns the distinction between a safe ACK,
          // a success that still needs reconciliation, and a failure.
          let resolution: SyncSuccessResolution;
          try {
            resolution = await candidate.session.resolveSuccess(currentMutation, result);
          } catch {
            // A successful server response is never rewritten as a transport
            // failure when local acknowledgement bookkeeping cannot persist.
            recorded = false;
            break;
          }
          if (resolution.outcome === 'deferred') {
            // Never failed, never resent, never a busy loop: the next bounded inbound
            // pass owns it. A stale session installs nothing.
            if (live()) {
              deferred.set(deferredKey(candidate.backend.id, mutationId), resolution.deferred);
              continuation = true;
            }
          } else if (resolution.outcome === 'unresolved') {
            recorded = false;
          } else if (resolution.outcome === 'not-success') {
            const failure = await resolveFailureSafely(candidate.session, currentMutation, result, false, live);
            recorded = failure.recorded;
            if (failure.reconcile) continuation = true;
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
      if (!disposed && accountId === id && generation === epoch) {
        if (rerunRequested) { rerunRequested = false; trigger(); }
        else await reschedule(recorded, continuation && recorded, inboundRetryAtMs, inboundBlocked);
      }
    }
  }

  async function reschedule(
    allowContinuation = true, forceContinuation = false, extraRetryAtMs: number | null = null, blocked: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    const id = accountId;
    const epoch = generation;
    if (!id || disposed || runningGeneration !== null) return;
    clearTimer();
    if (!maySchedule(id, epoch)) return;
    const entries = await plans(id, epoch);
    if (!maySchedule(id, epoch) || runningGeneration !== null || timer !== null) return;
    let earliest: number | null = extraRetryAtMs;
    let ready = false;
    for (const entry of entries) {
      if (entry.plan.nextRetryAtMs !== null) earliest = earliest === null ? entry.plan.nextRetryAtMs : Math.min(earliest, entry.plan.nextRetryAtMs);
      // A backend whose inbound step is behind, blocked or halted holds its sends; counting
      // that held work as "ready" would turn a blocked backend into a one-second poll.
      if (blocked.has(entry.backend.id)) continue;
      if (entry.plan.due.some((mutation) => !isDeferred(entry, mutation) && !isMutationClaimed(id, entry.session.mutationId(mutation), entry.backend.id))) ready = true;
    }
    const delay = allowContinuation && (ready || forceContinuation)
      ? SYNC_CONTINUATION_DELAY_MS
      : earliest === null ? null : Math.max(earliest - now(), 1);
    if (delay === null) return;
    timer = startTimer(() => { timer = null; if (maySchedule(id, epoch)) trigger(); }, delay);
  }

  const stops = backends.map((backend) => backend.subscribe((event) => {
    if (disposed) return;
    if (event.kind === 'cleanup') {
      bumpGeneration(); accountId = null;
    } else if (event.kind === 'backend-invalidated') {
      if (event.accountId === undefined || event.accountId === accountId) invalidateBackend(event.backendId);
    } else if (event.accountId === accountId) trigger();
  }));
  const stopConnectivity = connectivity.subscribe((state) => { if (state !== 'online') clearTimer(); else trigger(); });
  const stopForeground = foreground.subscribe((foregroundNow) => { if (!foregroundNow) clearTimer(); else trigger(); });

  return {
    setAccount(id: string | null): void {
      if (disposed || id === accountId) return;
      bumpGeneration(); accountId = id;
      if (id !== null) trigger();
    },
    async settle(): Promise<void> {
      for (let guard = 0; guard < 50 && running !== null; guard += 1) {
        const current = running; await current; if (running === current) running = null;
      }
    },
    dispose(): void {
      disposed = true; bumpGeneration(); accountId = null;
      stops.forEach((stop) => stop()); stopConnectivity(); stopForeground();
    },
  };
}
