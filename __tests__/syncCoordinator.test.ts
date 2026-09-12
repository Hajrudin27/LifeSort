import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ConnectivityState } from '@/core/sync/connectivity';
import { createManualSyncStatus } from '@/core/sync/manualSyncStatus';
import { isMutationClaimed, releaseAllMutationClaims } from '@/core/sync/mutationClaims';
import { createOutbox, OUTBOX_STORAGE_KEY, withOutboxCleanup, type OutboxMutation } from '@/core/sync/outbox';
import { RETRY_MAX_DELAY_MS, SYNC_CONTINUATION_DELAY_MS } from '@/core/sync/retryPolicy';
import type { ServerMutationResult } from '@/core/sync/serverMutations';
import { createSyncCoordinator } from '@/core/sync/syncCoordinator';

/**
 * APP-037 — the automatic sender.
 *
 * The clock, the random source, the timers, connectivity, the lifecycle and the
 * transport are all injected, so every assertion here is about the decision the
 * coordinator made and never about how long a machine happened to take.
 */

// The supported envelope allows only the ten toggleable modules, which is fewer
// entities than the batch cap. Widening the allowlist — and nothing else — lets
// the batching rules be exercised beyond today's module list.
jest.mock('@/core/sync/mutationSupport', () => {
  const actual = jest.requireActual('@/core/sync/mutationSupport');
  return {
    supportsServerMutation: (mutation: OutboxMutation) =>
      actual.supportsServerMutation(mutation) ||
      (mutation.entityId.startsWith('batch-') &&
        actual.supportsServerMutation({ ...mutation, entityId: 'habits' })),
  };
});

const START = Date.parse('2026-09-11T10:00:00.000Z');
const choice = (entityId: string, enabled = true) => ({
  dataDomain: 'core.module-choice' as const,
  entityType: 'module-choice',
  entityId,
  operation: 'upsert' as const,
  payload: { enabled },
});

function fakeConnectivity(initial: ConnectivityState = 'online') {
  let state = initial;
  const listeners = new Set<(next: ConnectivityState) => void>();
  return {
    getState: () => state,
    subscribe(listener: (next: ConnectivityState) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    listenerCount: () => listeners.size,
    /** Report a state, whether or not it changed — as a flaky radio would. */
    emit(next: ConnectivityState) {
      state = next;
      for (const listener of [...listeners]) listener(next);
    },
    /** Change the state silently, the way a getter read between events behaves. */
    set(next: ConnectivityState) { state = next; },
  };
}

function fakeForeground(initial = true) {
  let foreground = initial;
  const listeners = new Set<(next: boolean) => void>();
  return {
    isForeground: () => foreground,
    subscribe(listener: (next: boolean) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    listenerCount: () => listeners.size,
    emit(next: boolean) {
      foreground = next;
      for (const listener of [...listeners]) listener(next);
    },
    set(next: boolean) { foreground = next; },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}

let clock = START;
let account: string | null;
let connectivity: ReturnType<typeof fakeConnectivity>;
let foreground: ReturnType<typeof fakeForeground>;
let send: jest.Mock;
let coordinator: ReturnType<typeof createSyncCoordinator>;

function build(overrides: Partial<Parameters<typeof createSyncCoordinator>[0]> = {}) {
  return createSyncCoordinator({
    getActiveAccount: () => account,
    connectivity,
    foreground,
    send: send as unknown as Parameters<typeof createSyncCoordinator>[0]['send'],
    now: () => clock,
    // Longest jitter: the window's ceiling is the easiest boundary to assert on.
    random: () => 1,
    ...overrides,
  });
}

/** Let a started cycle reach its pending request without waiting for it to end. */
async function flush(rounds = 30) {
  for (let round = 0; round < rounds; round += 1) await Promise.resolve();
}

/** Move the injected clock and the fake timers together, then drain the cycle. */
async function advance(ms: number) {
  clock += ms;
  jest.advanceTimersByTime(ms);
  await coordinator.settle();
}

beforeEach(async () => {
  jest.useFakeTimers();
  releaseAllMutationClaims();
  await withOutboxCleanup(async () => { await AsyncStorage.clear(); });
  clock = START;
  account = 'a';
  connectivity = fakeConnectivity('online');
  foreground = fakeForeground(true);
  send = jest.fn().mockResolvedValue({ ok: true, status: 'applied' });
  coordinator = build();
});

afterEach(() => {
  coordinator.dispose();
  jest.useRealTimers();
});

async function bind(id: string | null = 'a') {
  coordinator.setAccount(id);
  await coordinator.settle();
}

describe('triggers', () => {
  it('sends queued work when the account binds while foreground and online', async () => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    await bind();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0].slice(0, 2)).toEqual(['a', entry]);
    expect(await createOutbox('a').list()).toEqual([]);
  });

  it('sends nothing at all while offline, and no timer waits for the network', async () => {
    connectivity = fakeConnectivity('offline');
    coordinator.dispose();
    coordinator = build();
    await createOutbox('a').enqueue(choice('habits'));
    await bind();
    expect(send).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    await advance(RETRY_MAX_DELAY_MS * 4);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends due work after the network comes back, once', async () => {
    connectivity = fakeConnectivity('offline');
    coordinator.dispose();
    coordinator = build();
    await createOutbox('a').enqueue(choice('habits'));
    await bind();
    expect(send).not.toHaveBeenCalled();

    connectivity.emit('online');
    await coordinator.settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await createOutbox('a').list()).toEqual([]);
  });

  it('treats an unknown link as worth one attempt, but never as a reason to retry', async () => {
    connectivity = fakeConnectivity('unknown');
    coordinator.dispose();
    coordinator = build();
    await createOutbox('a').enqueue(choice('habits'));
    await bind();
    expect(send).toHaveBeenCalledTimes(1);

    await createOutbox('a').enqueue(choice('food'));
    await coordinator.settle();
    send.mockClear();
    for (let repeat = 0; repeat < 5; repeat += 1) connectivity.emit('unknown');
    await coordinator.settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('repeated connectivity and lifecycle callbacks do not start parallel cycles', async () => {
    await createOutbox('a').enqueue(choice('habits'));
    const pending = deferred<ServerMutationResult>();
    send.mockReturnValue(pending.promise);
    coordinator.setAccount('a');
    await flush();

    connectivity.emit('online');
    connectivity.emit('online');
    foreground.emit(true);
    await createOutbox('a').enqueue(choice('food'));
    await flush();
    expect(send).toHaveBeenCalledTimes(1);

    pending.resolve({ ok: true, status: 'applied' });
    await coordinator.settle();
    // The second mutation is picked up by one scheduled continuation, not a race.
    expect(send).toHaveBeenCalledTimes(1);
    await advance(SYNC_CONTINUATION_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('sends a mutation queued while the app is already open', async () => {
    await bind();
    expect(send).not.toHaveBeenCalled();
    await createOutbox('a').enqueue(choice('habits'));
    await coordinator.settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of enqueues into one sequence of bounded passes', async () => {
    await bind();
    let inFlight = 0;
    let peak = 0;
    send.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { ok: true, status: 'applied' };
    });

    const ids = ['economy', 'food', 'home', 'goals', 'habits', 'tasks', 'travel', 'warranties'];
    for (const id of ids) await createOutbox('a').enqueue(choice(id));
    await coordinator.settle();
    // Enqueues during a running cycle do not each start a worker; they are
    // picked up by one scheduled continuation.
    expect(send.mock.calls.length).toBeLessThanOrEqual(ids.length);
    await advance(SYNC_CONTINUATION_DELAY_MS);
    await advance(SYNC_CONTINUATION_DELAY_MS);

    expect(send).toHaveBeenCalledTimes(8);
    expect(new Set(send.mock.calls.map((call) => call[1].mutationId)).size).toBe(8);
    expect(peak).toBe(1);
    expect(await createOutbox('a').list()).toEqual([]);
  });

  it('reconnecting never resets the attempt count or the wait', async () => {
    await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await bind();
    await advance(5_000);
    const [failed] = await createOutbox('a').list();
    expect(failed.attempts).toBe(2);

    connectivity.emit('offline');
    connectivity.emit('online');
    await coordinator.settle();
    // Airplane mode is not a way past backoff.
    expect(send).toHaveBeenCalledTimes(2);
    expect(await createOutbox('a').list()).toEqual([failed]);

    await advance(10_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect((await createOutbox('a').list())[0].attempts).toBe(3);
  });

  it('queues but does not send while offline, then syncs on reconnect', async () => {
    await bind();
    connectivity.set('offline');
    const entry = await createOutbox('a').enqueue(choice('habits'));
    await coordinator.settle();
    expect(send).not.toHaveBeenCalled();
    expect(await createOutbox('a').list()).toEqual([entry]);

    connectivity.emit('online');
    await coordinator.settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await createOutbox('a').list()).toEqual([]);
  });
});

describe('foreground only', () => {
  it('starts no network work while backgrounded, including on enqueue', async () => {
    foreground = fakeForeground(false);
    coordinator.dispose();
    coordinator = build();
    await createOutbox('a').enqueue(choice('habits'));
    await bind();
    await createOutbox('a').enqueue(choice('food'));
    await coordinator.settle();
    expect(send).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('scans durable state again when the app comes forward', async () => {
    foreground = fakeForeground(false);
    coordinator.dispose();
    coordinator = build();
    await bind();
    await createOutbox('a').enqueue(choice('habits'));
    await coordinator.settle();
    expect(send).not.toHaveBeenCalled();

    foreground.emit(true);
    await coordinator.settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('respects a waiting retry on return to foreground instead of retrying everything', async () => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await bind();
    expect(send).toHaveBeenCalledTimes(1);

    foreground.emit(false);
    clock += 1_000;
    foreground.emit(true);
    await coordinator.settle();
    expect(send).toHaveBeenCalledTimes(1);

    // Only once the persisted timestamp is actually due.
    await advance(5_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1].mutationId).toBe(entry.mutationId);
  });

  it('stops before the next mutation when the app leaves the foreground mid-batch', async () => {
    await createOutbox('a').enqueue(choice('habits'));
    await createOutbox('a').enqueue(choice('food'));
    const pending = deferred<ServerMutationResult>();
    send.mockReturnValueOnce(pending.promise);
    coordinator.setAccount('a');
    await flush();
    expect(send).toHaveBeenCalledTimes(1);

    foreground.emit(false);
    pending.resolve({ ok: true, status: 'applied' });
    await coordinator.settle();
    // The in-flight request finished and was recorded; the next never started.
    expect(send).toHaveBeenCalledTimes(1);
    expect(await createOutbox('a').list()).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels a scheduled retry while backgrounded and rebuilds it on return', async () => {
    await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await bind();
    expect(jest.getTimerCount()).toBe(1);

    foreground.emit(false);
    expect(jest.getTimerCount()).toBe(0);
    await advance(RETRY_MAX_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);

    foreground.emit(true);
    await coordinator.settle();
    // The wait had long since expired, so returning is itself enough.
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('batching', () => {
  it('attempts at most ten mutations in one cycle and continues after a delay', async () => {
    const entries: OutboxMutation[] = [];
    for (let index = 0; index < 11; index += 1) {
      entries.push(await createOutbox('a').enqueue(choice(`batch-${index}`)));
    }
    await bind();
    expect(send).toHaveBeenCalledTimes(10);
    expect(send.mock.calls.map((call) => call[1].entityId)).toEqual(
      entries.slice(0, 10).map((entry) => entry.entityId),
    );
    expect(await createOutbox('a').list()).toHaveLength(1);

    // The eleventh waits for a scheduled pass rather than a synchronous drain.
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(SYNC_CONTINUATION_DELAY_MS - 1);
    await coordinator.settle();
    expect(send).toHaveBeenCalledTimes(10);
    await advance(1);
    expect(send).toHaveBeenCalledTimes(11);
    expect(await createOutbox('a').list()).toEqual([]);
  });

  it('sends sequentially, never as one parallel burst', async () => {
    for (const id of ['economy', 'food', 'home']) await createOutbox('a').enqueue(choice(id));
    let inFlight = 0;
    let peak = 0;
    send.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { ok: true, status: 'applied' };
    });
    await bind();
    expect(send).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
  });

  it('uses no interval and no unbounded drain loop', async () => {
    const intervals = jest.spyOn(global, 'setInterval');
    for (const id of ['economy', 'food']) await createOutbox('a').enqueue(choice(id));
    await bind();
    expect(intervals).not.toHaveBeenCalled();
    // Everything sent, nothing waiting: the coordinator stops completely.
    expect(jest.getTimerCount()).toBe(0);
    await advance(RETRY_MAX_DELAY_MS * 10);
    expect(send).toHaveBeenCalledTimes(2);
    intervals.mockRestore();
  });
});

describe('per-entity ordering', () => {
  it('does not resend stale A from a batch after manual A acknowledgement and B dispatch', async () => {
    const outbox = createOutbox('a');
    const other = await outbox.enqueue(choice('food'));
    const a = await outbox.enqueue(choice('habits', false));
    const b = await outbox.enqueue(choice('habits', true));
    const otherResponse = deferred<ServerMutationResult>();
    const bResponse = deferred<ServerMutationResult>();
    send.mockImplementation(async (_id: string, mutation: OutboxMutation) => {
      if (mutation.mutationId === other.mutationId) return otherResponse.promise;
      if (mutation.mutationId === b.mutationId) return bResponse.promise;
      return { ok: true, status: 'applied' };
    });
    const manual = createManualSyncStatus(() => account, () => {}, send);
    manual.setAccount('a');
    try {
      coordinator.setAccount('a');
      await flush();
      expect(send.mock.calls.map((call) => call[1].mutationId)).toEqual([other.mutationId]);
      await manual.retry('a', a.mutationId);
      expect((await outbox.list()).map((entry) => entry.mutationId)).toEqual([other.mutationId, b.mutationId]);
      const tapB = manual.retry('a', b.mutationId);
      await flush();
      otherResponse.resolve({ ok: true, status: 'applied' });
      await coordinator.settle();
      expect(send.mock.calls.filter((call) => call[1].entityId === 'habits').map((call) => call[1].mutationId))
        .toEqual([a.mutationId, b.mutationId]);
      bResponse.resolve({ ok: true, status: 'applied' });
      await tapB;
      await coordinator.settle();
      expect(await outbox.list()).toEqual([]);
      expect(send).toHaveBeenCalledTimes(3);
    } finally { manual.dispose(); }
  });

  it.each(['manual', 'automatic'])('%s owns A while overlapping Retry of B cannot leapfrog it', async (owner) => {
    const outbox = createOutbox('a');
    const a = await outbox.enqueue(choice('habits', false));
    const b = await outbox.enqueue(choice('habits', true));
    const response = deferred<ServerMutationResult>();
    let inFlight = 0;
    let peak = 0;
    let aAcknowledgedBeforeB = false;
    send.mockImplementation(async (_id: string, mutation: OutboxMutation) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      if (mutation.mutationId === a.mutationId) await response.promise;
      else aAcknowledgedBeforeB = !(await outbox.list()).some((entry) => entry.mutationId === a.mutationId);
      inFlight -= 1;
      return { ok: true, status: 'applied' };
    });
    const manual = createManualSyncStatus(() => account, () => {}, send);
    manual.setAccount('a');
    try {
      const tap = owner === 'manual' ? manual.retry('a', a.mutationId) : Promise.resolve();
      await flush();
      coordinator.setAccount('a');
      await flush();
      await manual.retry('a', b.mutationId);
      expect(send.mock.calls.map((call) => call[1].mutationId)).toEqual([a.mutationId]);
      expect(await outbox.list()).toEqual([a, b]);
      response.resolve({ ok: true, status: 'applied' });
      await tap;
      await coordinator.settle();
      await advance(SYNC_CONTINUATION_DELAY_MS);
      expect(send.mock.calls.map((call) => call[1].mutationId)).toEqual([a.mutationId, b.mutationId]);
      expect(peak).toBe(1);
      expect(aAcknowledgedBeforeB).toBe(true);
      expect(await outbox.list()).toEqual([]);
    } finally { manual.dispose(); }
  });

  it('keeps a chain in order and never lets a newer mutation overtake', async () => {
    const off = await createOutbox('a').enqueue(choice('habits', false));
    const on = await createOutbox('a').enqueue(choice('habits', true));
    const other = await createOutbox('a').enqueue(choice('food'));

    const pending = deferred<ServerMutationResult>();
    send.mockReturnValueOnce(pending.promise);
    coordinator.setAccount('a');
    await flush();
    // The unrelated module goes in the same batch; the same module does not.
    expect(send).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true, status: 'applied' });
    await coordinator.settle();
    expect(send.mock.calls.map((call) => call[1].mutationId)).toEqual([off.mutationId, other.mutationId]);

    await advance(SYNC_CONTINUATION_DELAY_MS);
    expect(send.mock.calls.map((call) => call[1].mutationId)).toEqual([
      off.mutationId, other.mutationId, on.mutationId,
    ]);
  });

  it('blocks the chain behind a waiting retry, but not other chains', async () => {
    await createOutbox('a').enqueue(choice('habits', false));
    const behind = await createOutbox('a').enqueue(choice('habits', true));
    const other = await createOutbox('a').enqueue(choice('food'));
    send.mockImplementation(async (_id: string, mutation: OutboxMutation) =>
      mutation.entityId === 'habits' ? { ok: false, reason: 'unavailable' } : { ok: true, status: 'applied' });

    await bind();
    expect(send).toHaveBeenCalledTimes(2);
    const remaining = await createOutbox('a').list();
    expect(remaining.map((entry) => entry.mutationId)).toEqual([
      remaining[0].mutationId, behind.mutationId,
    ]);
    expect(remaining.some((entry) => entry.mutationId === other.mutationId)).toBe(false);

    // Only the head is retried when the wait expires.
    await advance(5_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][1].mutationId).toBe(remaining[0].mutationId);
  });

  it('blocks the chain behind a permanent failure without discarding anything', async () => {
    const head = await createOutbox('a').enqueue(choice('habits', false));
    const behind = await createOutbox('a').enqueue(choice('habits', true));
    send.mockResolvedValue({ ok: false, reason: 'validation' });
    await bind();

    expect(send).toHaveBeenCalledTimes(1);
    await advance(RETRY_MAX_DELAY_MS * 2);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await createOutbox('a').list()).map((entry) => entry.mutationId))
      .toEqual([head.mutationId, behind.mutationId]);
  });

  it('automatically syncs an unrelated entity while another entity remains permanently blocked', async () => {
    const outbox = createOutbox('a');
    const head = await outbox.enqueue(choice('habits', false));
    const behind = await outbox.enqueue(choice('habits', true));
    await outbox.updateMetadata(head.mutationId, { status: 'failed', attempts: 1 });
    const blocked = await outbox.list();
    const other = await outbox.enqueue(choice('food'));

    await bind();

    expect(send.mock.calls.map((call) => call[1].mutationId)).toEqual([other.mutationId]);
    expect(await outbox.list()).toEqual(blocked);
    expect(blocked.map((entry) => entry.mutationId)).toEqual([head.mutationId, behind.mutationId]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves an upsert/delete chain and its order across a restart', async () => {
    const upsert = await createOutbox('a').enqueue(choice('habits', false));
    const remove = await createOutbox('a').enqueue({ ...choice('habits'), operation: 'delete', payload: undefined });
    const disk = await AsyncStorage.getItem(OUTBOX_STORAGE_KEY);

    coordinator.dispose();
    coordinator = build();
    await bind();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1].mutationId).toBe(upsert.mutationId);
    await advance(SYNC_CONTINUATION_DELAY_MS);
    expect(send.mock.calls.map((call) => call[1].mutationId)).toEqual([upsert.mutationId, remove.mutationId]);
    expect(JSON.parse(disk!).state.mutations.map((entry: OutboxMutation) => entry.mutationId))
      .toEqual([upsert.mutationId, remove.mutationId]);
  });
});

describe('transient failure', () => {
  it.each([['a dropped connection', 'unavailable']])(
    '%s counts exactly one attempt and schedules the next',
    async () => {
      const entry = await createOutbox('a').enqueue(choice('habits'));
      send.mockResolvedValue({ ok: false, reason: 'unavailable' });
      await bind();

      expect(send).toHaveBeenCalledTimes(1);
      expect(await createOutbox('a').list()).toEqual([{
        ...entry, status: 'failed', attempts: 1, nextRetryAt: new Date(START + 5_000).toISOString(),
      }]);
      expect(jest.getTimerCount()).toBe(1);
    },
  );

  it('grows the wait on each failure and keeps the same mutation identity', async () => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await bind();

    // The wait before attempt n doubles: 5s, then 10s, then 20s.
    for (const [attempt, wait] of [[2, 5_000], [3, 10_000], [4, 20_000]] as const) {
      await advance(wait - 1);
      expect(send).toHaveBeenCalledTimes(attempt - 1);
      await advance(1);
      const [stored] = await createOutbox('a').list();
      expect(stored.mutationId).toBe(entry.mutationId);
      expect(stored.attempts).toBe(attempt);
      expect(stored.nextRetryAt).toBe(new Date(clock + wait * 2).toISOString());
      expect(send).toHaveBeenCalledTimes(attempt);
    }
    // Every retry resent the original envelope, not a new one.
    for (const call of send.mock.calls) expect(call[1].mutationId).toBe(entry.mutationId);
  });

  it('schedules the earliest due chain first', async () => {
    await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await bind();
    await advance(5_000);
    expect(send).toHaveBeenCalledTimes(2);

    // A newly queued module is due now, ahead of the failing chain's longer wait.
    await createOutbox('a').enqueue(choice('food'));
    send.mockResolvedValue({ ok: true, status: 'applied' });
    await coordinator.settle();
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][1].entityId).toBe('food');
  });
});

describe('permanent failure', () => {
  it.each(['authorization', 'validation', 'conflict'])(
    '%s stops the automatic schedule and leaves the work for a person',
    async (reason) => {
      const entry = await createOutbox('a').enqueue(choice('habits'));
      send.mockResolvedValue({ ok: false, reason });
      await bind();

      expect(await createOutbox('a').list()).toEqual([{ ...entry, status: 'failed', attempts: 1 }]);
      expect(jest.getTimerCount()).toBe(0);
      await advance(RETRY_MAX_DELAY_MS * 5);
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it('never sends an unsupported envelope, and counts no attempt for it', async () => {
    const entry = await createOutbox('a').enqueue({ ...choice('habits'), baseRevision: 2 });
    await bind();
    expect(send).not.toHaveBeenCalled();
    expect(await createOutbox('a').list()).toEqual([entry]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not repeatedly hammer an authorization failure', async () => {
    await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'authorization' });
    await bind();

    foreground.emit(false);
    foreground.emit(true);
    connectivity.emit('offline');
    connectivity.emit('online');
    await coordinator.settle();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('idempotency', () => {
  it.each(['applied', 'replayed'])('%s acknowledges the durable entry', async (status) => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: true, status });
    await bind();
    expect(send.mock.calls[0][1].mutationId).toBe(entry.mutationId);
    expect(await createOutbox('a').list()).toEqual([]);
  });

  it('recovers a lost response by replaying the same mutation ID', async () => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    const server = new Set<string>();
    send.mockImplementation(async (_id: string, mutation: OutboxMutation) => {
      // The server commits, then the response is lost on the way back.
      if (!server.has(mutation.mutationId)) {
        server.add(mutation.mutationId);
        return { ok: false, reason: 'unavailable' };
      }
      return { ok: true, status: 'replayed' };
    });

    await bind();
    expect([...server]).toEqual([entry.mutationId]);
    await advance(5_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1].mutationId).toBe(entry.mutationId);
    expect(server.size).toBe(1);
    expect(await createOutbox('a').list()).toEqual([]);
  });
});

describe('restart', () => {
  it('rebuilds a future wait from disk without resetting the attempt count', async () => {
    await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await bind();
    await advance(5_000);
    const [stored] = await createOutbox('a').list();
    expect(stored.attempts).toBe(2);

    coordinator.dispose();
    coordinator = build();
    await bind();
    // Restarting is not an excuse to skip the wait the last failure earned.
    expect(send).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(1);
    await advance(10_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect((await createOutbox('a').list())[0].attempts).toBe(3);
  });

  it('runs an overdue retry as soon as the app is open again', async () => {
    await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await bind();

    coordinator.dispose();
    clock += 60_000;
    coordinator = build();
    await bind();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rebuilds no timer for a permanent failure', async () => {
    await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'conflict' });
    await bind();

    coordinator.dispose();
    coordinator = build();
    await bind();
    expect(send).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('account lifecycle', () => {
  it('never sends another account\'s durable work', async () => {
    await createOutbox('a').enqueue(choice('habits'));
    account = 'b';
    await bind('b');
    expect(send).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels the timer and stops the cycle when the account signs out', async () => {
    await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await bind();
    expect(jest.getTimerCount()).toBe(1);

    account = null;
    await bind(null);
    expect(jest.getTimerCount()).toBe(0);
    await advance(RETRY_MAX_DELAY_MS * 3);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('lets a late response from the old account change nothing for the new one', async () => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    const pending = deferred<ServerMutationResult>();
    send.mockReturnValue(pending.promise);
    coordinator.setAccount('a');
    await flush();
    expect(send).toHaveBeenCalledTimes(1);

    // Signing out clears local account data while A's request is still open.
    await withOutboxCleanup(async () => {});
    account = 'b';
    coordinator.setAccount('b');
    send.mockResolvedValue({ ok: true, status: 'applied' });
    const theirs = await createOutbox('b').enqueue(choice('food'));
    await coordinator.settle();

    pending.resolve({ ok: true, status: 'applied' });
    await coordinator.settle();
    // B's own work ran; A's completion acknowledged nothing of B's and left no
    // timer, and the claim it held is gone.
    expect(send.mock.calls.map((call) => [call[0], call[1].mutationId]))
      .toEqual([['a', entry.mutationId], ['b', theirs.mutationId]]);
    expect(await createOutbox('b').list()).toEqual([]);
    expect(isMutationClaimed('a', entry.mutationId)).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops entirely when local account data is cleared', async () => {
    await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await bind();
    expect(jest.getTimerCount()).toBe(1);

    await withOutboxCleanup(async () => {});
    expect(jest.getTimerCount()).toBe(0);
    await advance(RETRY_MAX_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('serves the next account normally after a switch', async () => {
    await bind();
    account = 'b';
    coordinator.setAccount('b');
    await coordinator.settle();
    await createOutbox('b').enqueue(choice('habits'));
    await coordinator.settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('b');
  });
});

describe('shared claim and teardown', () => {
  it('holds the claim for exactly as long as the send, and releases it on failure', async () => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    const pending = deferred<ServerMutationResult>();
    send.mockReturnValue(pending.promise);
    coordinator.setAccount('a');
    await flush();
    expect(isMutationClaimed('a', entry.mutationId)).toBe(true);

    pending.resolve({ ok: false, reason: 'unavailable' });
    await coordinator.settle();
    expect(isMutationClaimed('a', entry.mutationId)).toBe(false);
  });

  it('releases the claim when the sender throws, and spaces out the next attempt', async () => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    const other = await createOutbox('a').enqueue(choice('food'));
    send.mockRejectedValue(new Error('file:///private/health.pdf'));
    await bind();

    expect(isMutationClaimed('a', entry.mutationId)).toBe(false);
    // Recorded as a completed failed attempt, so it cannot be retried on every
    // continuation; the rest of the batch waits, since the fault may be general.
    expect(await createOutbox('a').list()).toEqual([
      { ...entry, status: 'failed', attempts: 1, nextRetryAt: new Date(START + 5_000).toISOString() },
      other,
    ]);
    expect(send).toHaveBeenCalledTimes(1);

    await advance(SYNC_CONTINUATION_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1].mutationId).toBe(other.mutationId);
    await advance(4_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect((await createOutbox('a').list())[0].attempts).toBe(2);
  });

  it('skips a mutation another sender already claimed', async () => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    const other = await createOutbox('a').enqueue(choice('food'));
    const { claimMutation } = jest.requireActual('@/core/sync/mutationClaims');
    expect(claimMutation('a', entry.mutationId)).toBe(true);

    await bind();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1].mutationId).toBe(other.mutationId);
    // No timer spins waiting for someone else's request to finish.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not strand a claimed mutation when the manual sender throws', async () => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    let failSend!: (error: Error) => void;
    const inFlight = new Promise<never>((_, reject) => { failSend = reject; });
    const manual = createManualSyncStatus(() => account, () => {}, jest.fn(() => inFlight) as never);
    manual.setAccount('a');
    try {
      // The tap claims it first and its request is still open, so the coordinator
      // must leave it alone — and deliberately schedules no continuation for work
      // it did not take.
      const tap = manual.retry('a', entry.mutationId);
      await flush();
      await bind();
      expect(send).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);

      failSend(new Error('file:///private/health.pdf'));
      await tap;
      // The throw wrote durable retry metadata, and its change event is what
      // lets the coordinator schedule the work again instead of forgetting it.
      const [stored] = await createOutbox('a').list();
      expect(stored).toMatchObject({ mutationId: entry.mutationId, status: 'failed', attempts: 1 });
      expect(stored.nextRetryAt).toEqual(expect.any(String));

      await coordinator.settle();
      expect(jest.getTimerCount()).toBe(1);
      const dueAt = Date.parse(stored.nextRetryAt!);
      clock = dueAt;
      jest.advanceTimersByTime(dueAt - START);
      await coordinator.settle();
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][1].mutationId).toBe(entry.mutationId);
      expect(await createOutbox('a').list()).toEqual([]);
    } finally {
      manual.dispose();
    }
  });

  it('leaves no connectivity or lifecycle listener behind after disposal', async () => {
    await bind();
    expect(connectivity.listenerCount()).toBe(1);
    expect(foreground.listenerCount()).toBe(1);

    coordinator.dispose();
    expect(connectivity.listenerCount()).toBe(0);
    expect(foreground.listenerCount()).toBe(0);

    await createOutbox('a').enqueue(choice('habits'));
    connectivity.emit('online');
    foreground.emit(true);
    await advance(RETRY_MAX_DELAY_MS);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('unknown connectivity', () => {
  beforeEach(() => {
    coordinator.dispose();
    connectivity = fakeConnectivity('unknown');
    coordinator = build();
  });

  it('records the transient failure but arms nothing of its own', async () => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await bind();

    // One pass, because the user's own action asked for it.
    expect(send).toHaveBeenCalledTimes(1);
    const [stored] = await createOutbox('a').list();
    expect(stored).toMatchObject({ ...entry, status: 'failed', attempts: 1 });
    expect(Date.parse(stored.nextRetryAt!)).toBe(START + 5_000);

    // But nothing schedules itself on a link the platform cannot describe:
    // a retry there would fail, earn another retry, and become a series.
    expect(jest.getTimerCount()).toBe(0);
    await advance(RETRY_MAX_DELAY_MS * 20);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await createOutbox('a').list())[0].attempts).toBe(1);
  });

  it('keeps the first pass bounded without arming a continuation', async () => {
    for (let index = 0; index < 11; index += 1) {
      await createOutbox('a').enqueue(choice(`batch-${index}`));
    }
    await bind();
    expect(send).toHaveBeenCalledTimes(10);
    expect(jest.getTimerCount()).toBe(0);

    await advance(SYNC_CONTINUATION_DELAY_MS * 30);
    expect(send).toHaveBeenCalledTimes(10);
    expect(await createOutbox('a').list()).toHaveLength(1);
  });

  it('arms no continuation for work another sender claimed', async () => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    const { claimMutation } = jest.requireActual('@/core/sync/mutationClaims');
    expect(claimMutation('a', entry.mutationId)).toBe(true);
    await bind();

    expect(send).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('runs an overdue retry as soon as the link is known again', async () => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await bind();
    expect(send).toHaveBeenCalledTimes(1);

    await advance(5_000);
    expect(send).toHaveBeenCalledTimes(1);

    connectivity.emit('online');
    await coordinator.settle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1].mutationId).toBe(entry.mutationId);
    expect((await createOutbox('a').list())[0].attempts).toBe(2);
  });

  it('schedules exactly the remaining wait when the link is known again', async () => {
    await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await bind();
    const dueAt = Date.parse((await createOutbox('a').list())[0].nextRetryAt!);

    await advance(2_000);
    connectivity.emit('online');
    await coordinator.settle();
    // Nothing was due yet, so the timer holds the rest of the original wait —
    // not a fresh one, and not a shortened one.
    expect(send).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);

    await advance(dueAt - clock - 1);
    expect(send).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('still refuses to send anything at all while offline', async () => {
    await createOutbox('a').enqueue(choice('habits'));
    connectivity.emit('offline');
    await bind();
    expect(send).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('local bookkeeping never rewrites the server outcome', () => {
  it.each(['applied', 'replayed'])('a %s receipt that cannot be recorded is not a failed attempt', async (status) => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    send.mockImplementation(async () => {
      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('file:///private/health.pdf'));
      return { ok: true, status };
    });
    await bind();

    // The server accepted it; only our own note-keeping failed. Counting an
    // attempt here would be recording a network failure that never happened.
    expect(await createOutbox('a').list()).toEqual([entry]);
    expect(jest.getTimerCount()).toBe(0);
    expect(JSON.stringify(await AsyncStorage.getItem(OUTBOX_STORAGE_KEY))).not.toMatch(/private|health/);
  });

  it('replays the same mutation ID afterwards and clears it once storage works', async () => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    send.mockImplementationOnce(async () => {
      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('file:///private/disk'));
      return { ok: true, status: 'applied' };
    }).mockResolvedValue({ ok: true, status: 'replayed' });
    await bind();
    expect(await createOutbox('a').list()).toEqual([entry]);

    // A later trigger reaches the same durable entry, not a new one.
    foreground.emit(false);
    foreground.emit(true);
    await coordinator.settle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1].mutationId).toBe(entry.mutationId);
    expect(await createOutbox('a').list()).toEqual([]);
  });

  it.each(['conflict', 'validation', 'authorization'])(
    'a %s that cannot be recorded does not become something worth retrying',
    async (reason) => {
      const entry = await createOutbox('a').enqueue(choice('habits'));
      send.mockImplementation(async () => {
        (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('file:///private/disk'));
        return { ok: false, reason };
      });
      await bind();

      // The refusal stands as a refusal: no invented transport failure, no
      // attempt count, and above all no retry timestamp.
      expect(await createOutbox('a').list()).toEqual([entry]);
      expect(jest.getTimerCount()).toBe(0);
      await advance(RETRY_MAX_DELAY_MS * 5);
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it('records a typed transient failure exactly once', async () => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await bind();
    expect(await createOutbox('a').list()).toEqual([{
      ...entry, status: 'failed', attempts: 1, nextRetryAt: new Date(START + 5_000).toISOString(),
    }]);
  });

  it.each(['conflict', 'validation', 'authorization'])('records a typed %s exactly once', async (reason) => {
    const entry = await createOutbox('a').enqueue(choice('habits'));
    send.mockResolvedValue({ ok: false, reason });
    await bind();
    expect(await createOutbox('a').list()).toEqual([{ ...entry, status: 'failed', attempts: 1 }]);
  });
});
