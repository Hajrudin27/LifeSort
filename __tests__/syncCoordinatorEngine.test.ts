import AsyncStorage from '@react-native-async-storage/async-storage';

import { isMutationClaimed, releaseAllMutationClaims } from '@/core/sync/mutationClaims';
import { createOutbox, withOutboxCleanup } from '@/core/sync/outbox';
import { createSyncCoordinator } from '@/core/sync/syncCoordinator';
import { createSyncCoordinatorEngine, type SyncBackendEvent, type SyncCoordinatorBackend, type SyncCoordinatorBackendSession } from '@/core/sync/syncCoordinatorEngine';

function signal<T>() {
  const listeners = new Set<(value: T) => void>();
  return { subscribe: (listener: (value: T) => void) => { listeners.add(listener); return () => listeners.delete(listener); }, emit: (value: T) => listeners.forEach((listener) => listener(value)) };
}

function backend(id: string, mutations: Array<{ mutationId: string }>, trace: string[], resolveSuccess = true): SyncCoordinatorBackend {
  const events = signal<{ kind: 'changed'; accountId: string }>();
  const session: SyncCoordinatorBackendSession = {
    isActive: () => true,
    list: async () => mutations,
    plan: (items) => ({ due: items, nextRetryAtMs: null }),
    mutationId: (item) => (item as { mutationId: string }).mutationId,
    send: async (item) => { trace.push(`send:${id}:${(item as { mutationId: string }).mutationId}`); return { ok: true }; },
    resolveSuccess: async (item) => { trace.push(`success:${id}:${(item as { mutationId: string }).mutationId}`); return resolveSuccess; },
    resolveFailure: async (item, _result, _thrown, isActive) => {
      expect(isActive()).toBe(true);
      trace.push(`failure:${id}:${(item as { mutationId: string }).mutationId}`);
      return { recorded: true, permanent: true };
    },
  };
  return { id, open: async () => session, subscribe: events.subscribe };
}

describe('APP-076 B2A backend-neutral coordinator engine', () => {
  it('runs backends sequentially in a bounded round-robin pass', async () => {
    const connectivity = signal<'online' | 'offline' | 'unknown'>();
    const foreground = signal<boolean>();
    const trace: string[] = [];
    const coordinator = createSyncCoordinatorEngine({
      connectivity: { getState: () => 'online', subscribe: connectivity.subscribe },
      foreground: { isForeground: () => true, subscribe: foreground.subscribe },
      getActiveAccount: () => 'account-a',
      backends: [backend('ordinary', [{ mutationId: 'o1' }, { mutationId: 'o2' }], trace), backend('sealed', [{ mutationId: 's1' }], trace)],
    });
    coordinator.setAccount('account-a');
    await coordinator.settle();
    expect(trace).toEqual(['send:ordinary:o1', 'success:ordinary:o1', 'send:sealed:s1', 'success:sealed:s1', 'send:ordinary:o2', 'success:ordinary:o2']);
    coordinator.dispose();
  });

  it('never auto-acknowledges a backend success: a backend must explicitly resolve it', async () => {
    const connectivity = signal<'online' | 'offline' | 'unknown'>();
    const foreground = signal<boolean>();
    const trace: string[] = [];
    const coordinator = createSyncCoordinatorEngine({
      connectivity: { getState: () => 'online', subscribe: connectivity.subscribe },
      foreground: { isForeground: () => true, subscribe: foreground.subscribe },
      getActiveAccount: () => 'account-a',
      backends: [backend('sealed', [{ mutationId: 'p1' }], trace, false)],
    });
    coordinator.setAccount('account-a');
    await coordinator.settle();
    expect(trace).toEqual(['send:sealed:p1', 'success:sealed:p1', 'failure:sealed:p1']);
    coordinator.dispose();
  });
});


type Item = { mutationId: string; retryAt?: number; terminal?: boolean };
const START = Date.parse('2026-10-14T12:00:00.000Z');

/** A queue-backed fake: its mutations stay due until its own resolver removes them. */
function queueBackend(id: string, items: Item[], hooks: Partial<SyncCoordinatorBackendSession> & { log?: string[] } = {}) {
  const events = signal<SyncBackendEvent>();
  const log = hooks.log ?? [];
  const session: SyncCoordinatorBackendSession = {
    isActive: () => true,
    list: async () => items.map((item) => ({ ...item })),
    plan: (list, nowMs, limit) => {
      const due: Item[] = [];
      let next: number | null = null;
      for (const item of list as Item[]) {
        if (item.terminal) continue;
        if (item.retryAt === undefined || item.retryAt <= nowMs) due.push(item);
        else next = next === null ? item.retryAt : Math.min(next, item.retryAt);
      }
      return { due: due.slice(0, limit), nextRetryAtMs: next };
    },
    mutationId: (item) => (item as Item).mutationId,
    send: async (item) => { log.push(`send:${id}:${(item as Item).mutationId}`); return { ok: true }; },
    resolveSuccess: async (item) => {
      log.push(`ok:${id}:${(item as Item).mutationId}`);
      items.splice(items.findIndex((entry) => entry.mutationId === (item as Item).mutationId), 1);
      return true;
    },
    resolveFailure: async (item) => { log.push(`fail:${id}:${(item as Item).mutationId}`); return { recorded: true, permanent: true }; },
    ...hooks,
  };
  const instance: SyncCoordinatorBackend = { id, open: async () => session, subscribe: events.subscribe };
  return { instance, events, log };
}

function engineFor(backends: SyncCoordinatorBackend[], live: { account: string | null } = { account: 'account-a' }, clock = { now: START }) {
  const connectivity = signal<'online' | 'offline' | 'unknown'>();
  const foreground = signal<boolean>();
  const coordinator = createSyncCoordinatorEngine({
    connectivity: { getState: () => 'online', subscribe: connectivity.subscribe },
    foreground: { isForeground: () => true, subscribe: foreground.subscribe },
    getActiveAccount: () => live.account,
    backends, now: () => clock.now,
  });
  return { coordinator, live, clock };
}

async function microtasks(rounds = 40) { for (let round = 0; round < rounds; round += 1) await Promise.resolve(); }

describe('APP-076 B2A engine: multi-backend lifecycle', () => {
  beforeEach(() => { jest.useFakeTimers(); releaseAllMutationClaims(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('arms exactly one timer for the earliest retry across every backend, and none for terminal-only queues', async () => {
    const log: string[] = [];
    const ordinary = queueBackend('ordinary', [{ mutationId: 'o1', retryAt: START + 60_000 }], { log });
    const sealed = queueBackend('sealed', [{ mutationId: 's1', retryAt: START + 10_000 }, { mutationId: 's2', terminal: true }], { log });
    const clock = { now: START };
    const { coordinator } = engineFor([ordinary.instance, sealed.instance], { account: 'account-a' }, clock);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    expect(jest.getTimerCount()).toBe(1);
    clock.now += 9_999;
    jest.advanceTimersByTime(9_999);
    await coordinator.settle();
    expect(log).toEqual([]);
    clock.now += 1;
    jest.advanceTimersByTime(1);
    await coordinator.settle();
    // The 10s retry of the other backend ran; the 60s one and the terminal item did not.
    expect(log).toEqual(['send:sealed:s1', 'ok:sealed:s1']);
    expect(jest.getTimerCount()).toBe(1);
    coordinator.dispose();

    const terminalOnly = queueBackend('terminal-only', [{ mutationId: 't1', terminal: true }]);
    const quiet = engineFor([terminalOnly.instance]);
    quiet.coordinator.setAccount('account-a');
    await quiet.coordinator.settle();
    expect(jest.getTimerCount()).toBe(0);
    quiet.coordinator.dispose();
  });

  it('wakes the one engine from the second backend and coalesces a burst of events into a single pass', async () => {
    const log: string[] = [];
    const first = queueBackend('first', [], { log });
    const items: Item[] = [];
    const second = queueBackend('second', items, { log });
    const { coordinator } = engineFor([first.instance, second.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    items.push({ mutationId: 's1' });
    for (let index = 0; index < 5; index += 1) second.events.emit({ kind: 'changed', accountId: 'account-a' });
    await coordinator.settle();
    expect(log.filter((entry) => entry.startsWith('send'))).toEqual(['send:second:s1']);
    coordinator.dispose();
  });

  it('discards the late result of every backend after an account switch', async () => {
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const live = { account: 'account-a' as string | null };
    const mk = (id: string): SyncCoordinatorBackend => {
      const events = signal<SyncBackendEvent>();
      return { id, subscribe: events.subscribe, open: async (accountId) => ({
        isActive: () => true,
        list: async () => (accountId === 'account-a' ? [{ mutationId: `${id}-1` }] : []),
        plan: (list) => ({ due: list as Item[], nextRetryAtMs: null }),
        mutationId: (item) => (item as Item).mutationId,
        send: async () => { log.push(`send:${accountId}:${id}`); await gate; return { ok: true }; },
        resolveSuccess: async () => { log.push(`ok:${accountId}:${id}`); return true; },
        resolveFailure: async () => { log.push(`fail:${accountId}:${id}`); return { recorded: true, permanent: true }; },
      }) };
    };
    const { coordinator } = engineFor([mk('ordinary'), mk('sealed')], live);
    coordinator.setAccount('account-a');
    await microtasks();
    live.account = 'account-b';
    coordinator.setAccount('account-b');
    release();
    await coordinator.settle();
    expect(log).toEqual(['send:account-a:ordinary']);
    expect(jest.getTimerCount()).toBe(0);
    coordinator.dispose();
  });

  it('rereads durable state after the bound account\'s epoch invalidation, ignores another account\'s, and stops after cleanup', async () => {
    const log: string[] = [];
    const items: Item[] = [];
    const sealed = queueBackend('sealed', items, { log });
    const { coordinator } = engineFor([sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    items.push({ mutationId: 'pending-work' });
    sealed.events.emit({ kind: 'epoch-invalidated', accountId: 'account-b' });
    await coordinator.settle();
    expect(log).toEqual([]);
    sealed.events.emit({ kind: 'epoch-invalidated', accountId: 'account-a' });
    await coordinator.settle();
    expect(log).toEqual(['send:sealed:pending-work', 'ok:sealed:pending-work']);
    sealed.events.emit({ kind: 'cleanup' });
    items.push({ mutationId: 'after-cleanup' });
    sealed.events.emit({ kind: 'changed', accountId: 'account-a' });
    await coordinator.settle();
    expect(log).toEqual(['send:sealed:pending-work', 'ok:sealed:pending-work']);
    coordinator.dispose();
  });

  it('does not arm a continuation when failure bookkeeping itself throws, and releases the claim', async () => {
    const log: string[] = [];
    const sealed = queueBackend('sealed', [{ mutationId: 's1' }], {
      log,
      send: async () => { throw new Error('transport'); },
      resolveFailure: async () => { log.push('fail-throws'); throw new Error('storage'); },
    });
    const { coordinator } = engineFor([sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(10_000);
    await coordinator.settle();
    expect(log).toEqual(['fail-throws']);
    expect(isMutationClaimed('account-a', 's1', 'sealed')).toBe(false);
    coordinator.dispose();
  });
});

describe('APP-076 B2A ordinary wrapper parity', () => {
  beforeEach(async () => { jest.useFakeTimers(); releaseAllMutationClaims(); await withOutboxCleanup(async () => { await AsyncStorage.clear(); }); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('announces a permanent refusal only while the account that earned it is still live (pre-extraction guard)', async () => {
    const live = { account: 'account-a' as string | null };
    let sent = false;
    const notified: string[] = [];
    await createOutbox('account-a').enqueue({ dataDomain: 'core.module-choice', entityType: 'module-choice', entityId: 'habits', operation: 'upsert', payload: { enabled: true } });
    const connectivity = signal<'online' | 'offline' | 'unknown'>();
    const foreground = signal<boolean>();
    const coordinator = createSyncCoordinator({
      getActiveAccount: () => live.account,
      connectivity: { getState: () => 'online', subscribe: connectivity.subscribe },
      foreground: { isForeground: () => true, subscribe: foreground.subscribe },
      send: (async () => { sent = true; return { ok: false, reason: 'validation' }; }) as never,
      // The refusal is recorded using the clock; the session flips while that write is in flight.
      now: () => { if (sent) live.account = 'account-b'; return START; },
      random: () => 1,
      onPermanentFailure: (accountId, mutation) => { notified.push(`${accountId}:${mutation.entityId}`); },
    });
    coordinator.setAccount('account-a');
    await coordinator.settle();
    expect(sent).toBe(true);
    expect(live.account).toBe('account-b');
    expect((await createOutbox('account-a').list())[0]).toMatchObject({ status: 'failed', attempts: 1 });
    expect(notified).toEqual([]);
    coordinator.dispose();
  });
});
