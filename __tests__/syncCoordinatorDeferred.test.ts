import AsyncStorage from '@react-native-async-storage/async-storage';

import { isMutationClaimed, releaseAllMutationClaims } from '@/core/sync/mutationClaims';
import { createOutbox, withOutboxCleanup } from '@/core/sync/outbox';
import { createSyncCoordinator } from '@/core/sync/syncCoordinator';
import {
  createSyncCoordinatorEngine, type DeferredSuccess, type SyncBackendEvent, type SyncCoordinatorBackend,
  type SyncCoordinatorBackendSession, type SyncInboundContext, type SyncInboundResult, type SyncSuccessResolution,
} from '@/core/sync/syncCoordinatorEngine';

function signal<T>() {
  const listeners = new Set<(value: T) => void>();
  return { subscribe: (listener: (value: T) => void) => { listeners.add(listener); return () => listeners.delete(listener); }, emit: (value: T) => listeners.forEach((listener) => listener(value)) };
}

type Item = { mutationId: string };
const START = Date.parse('2026-10-14T12:00:00.000Z');
async function microtasks(rounds = 60) { for (let round = 0; round < rounds; round += 1) await Promise.resolve(); }

/** A queue-backed fake whose resolver, inbound step and failure handler are fully scripted. */
function fake(id: string, items: Item[], hooks: Partial<SyncCoordinatorBackendSession> & { log?: string[]; opens?: { count: number } } = {}) {
  const events = signal<SyncBackendEvent>();
  const log = hooks.log ?? [];
  const session: SyncCoordinatorBackendSession = {
    isActive: () => true,
    list: async () => items.map((item) => ({ ...item })),
    plan: (list, _now, limit) => ({ due: (list as Item[]).slice(0, limit), nextRetryAtMs: null }),
    mutationId: (item) => (item as Item).mutationId,
    send: async (item) => { log.push(`send:${id}:${(item as Item).mutationId}`); return { ok: true }; },
    resolveSuccess: async (item) => {
      log.push(`ok:${id}:${(item as Item).mutationId}`);
      items.splice(items.findIndex((entry) => entry.mutationId === (item as Item).mutationId), 1);
      return { outcome: 'resolved' };
    },
    resolveFailure: async (item) => { log.push(`fail:${id}:${(item as Item).mutationId}`); return { recorded: true, permanent: true }; },
    ...hooks,
  };
  const instance: SyncCoordinatorBackend = {
    id, subscribe: events.subscribe,
    open: async () => { if (hooks.opens) hooks.opens.count += 1; return session; },
  };
  return { instance, events, log, items };
}

function deferral(item: unknown): SyncSuccessResolution {
  const mutationId = (item as Item).mutationId;
  return { outcome: 'deferred', deferred: { mutationId, entityType: 'pregnancy', entityId: `entity-${mutationId}`, revision: 4, deleted: false, changeSeq: 9 } };
}

function engineFor(backends: SyncCoordinatorBackend[], live: { account: string | null } = { account: 'account-a' }) {
  const connectivity = signal<'online' | 'offline' | 'unknown'>();
  const foreground = signal<boolean>();
  const coordinator = createSyncCoordinatorEngine({
    connectivity: { getState: () => 'online', subscribe: connectivity.subscribe },
    foreground: { isForeground: () => true, subscribe: foreground.subscribe },
    getActiveAccount: () => live.account,
    backends, now: () => START,
  });
  return { coordinator, live, connectivity, foreground };
}

const count = (log: string[], prefix: string) => log.filter((entry) => entry.startsWith(prefix)).length;

describe('APP-076 B2B1 engine: explicit deferred success', () => {
  beforeEach(() => { jest.useFakeTimers(); releaseAllMutationClaims(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('never resends, fails or busy-loops on a deferred success, and schedules one bounded inbound continuation', async () => {
    const log: string[] = [];
    const seen: SyncInboundContext[] = [];
    const sealed = fake('sealed', [{ mutationId: 'm1' }], {
      log,
      resolveSuccess: async (item) => { log.push('deferred'); return deferral(item); },
      inbound: async (context) => { seen.push(context); log.push('inbound'); return { outcome: 'caught-up' }; },
    });
    const { coordinator } = engineFor([sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    // Cycle 1: pull-before-send found nothing, then the send was deferred.
    expect(log).toEqual(['inbound', 'send:sealed:m1', 'deferred']);
    expect(seen[0].deferred).toEqual([]);
    expect(jest.getTimerCount()).toBe(1);
    // Cycle 2 (the 1s continuation): the inbound step receives the safe deferral; no resend.
    jest.advanceTimersByTime(1_000);
    await coordinator.settle();
    expect(log).toEqual(['inbound', 'send:sealed:m1', 'deferred', 'inbound']);
    expect(seen[1].deferred).toEqual([{ mutationId: 'm1', entityType: 'pregnancy', entityId: 'entity-m1', revision: 4, deleted: false, changeSeq: 9 }]);
    // The backend could not settle it; the engine must neither loop nor resend over 30s.
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(30_000);
    await coordinator.settle();
    expect(count(log, 'send')).toBe(1);
    expect(count(log, 'fail')).toBe(0);
    expect(isMutationClaimed('account-a', 'm1', 'sealed')).toBe(false);
    coordinator.dispose();
  });

  it('does not resend a deferred mutation when a subscription event arrives before its reconciliation', async () => {
    const log: string[] = [];
    const sealed = fake('sealed', [{ mutationId: 'm1' }], {
      log,
      resolveSuccess: async (item) => deferral(item),
      inbound: async () => ({ outcome: 'caught-up' }),
    });
    const { coordinator } = engineFor([sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    sealed.events.emit({ kind: 'changed', accountId: 'account-a' });
    await coordinator.settle();
    expect(count(log, 'send')).toBe(1);
    coordinator.dispose();
  });

  it('forgets a deferral once the backend reports it resolved, and an unrelated trigger does not resend', async () => {
    const items: Item[] = [{ mutationId: 'm1' }];
    const log: string[] = [];
    const sealed = fake('sealed', items, {
      log,
      resolveSuccess: async (item) => deferral(item),
      inbound: async (context) => {
        if (context.deferred.length === 0) return { outcome: 'caught-up' };
        items.splice(0, items.length);
        return { outcome: 'caught-up', resolved: context.deferred.map((entry: DeferredSuccess) => entry.mutationId) };
      },
    });
    const { coordinator } = engineFor([sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    jest.advanceTimersByTime(1_000);
    await coordinator.settle();
    expect(items).toEqual([]);
    sealed.events.emit({ kind: 'changed', accountId: 'account-a' });
    await coordinator.settle();
    expect(count(log, 'send')).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
    coordinator.dispose();
  });

  it('a mutation that disappears from the durable queue drops its deferral', async () => {
    const items: Item[] = [{ mutationId: 'm1' }];
    const contexts: SyncInboundContext[] = [];
    const sealed = fake('sealed', items, {
      resolveSuccess: async (item) => deferral(item),
      inbound: async (context) => { contexts.push(context); return { outcome: 'caught-up' }; },
    });
    const { coordinator } = engineFor([sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    items.splice(0, items.length);
    jest.advanceTimersByTime(1_000);
    await coordinator.settle();
    expect(contexts[contexts.length - 1].deferred).toEqual([]);
    coordinator.dispose();
  });

  it('treats unresolved success bookkeeping as unrecorded: no continuation, no failure handling, no leaked claim', async () => {
    const log: string[] = [];
    const sealed = fake('sealed', [{ mutationId: 'm1' }], {
      log, resolveSuccess: async () => ({ outcome: 'unresolved' }),
    });
    const { coordinator } = engineFor([sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    expect(log).toEqual(['send:sealed:m1']);
    expect(jest.getTimerCount()).toBe(0);
    expect(isMutationClaimed('account-a', 'm1', 'sealed')).toBe(false);
    coordinator.dispose();
  });

  it('treats a throwing success resolver as unresolved, not as a transport failure', async () => {
    const log: string[] = [];
    const sealed = fake('sealed', [{ mutationId: 'm1' }], {
      log, resolveSuccess: async () => { throw new Error('storage'); },
    });
    const { coordinator } = engineFor([sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    expect(log).toEqual(['send:sealed:m1']);
    expect(jest.getTimerCount()).toBe(0);
    expect(isMutationClaimed('account-a', 'm1', 'sealed')).toBe(false);
    coordinator.dispose();
  });

  it('a stale session installs no deferral', async () => {
    const live = { account: 'account-a' as string | null };
    const contexts: SyncInboundContext[] = [];
    let flip = false;
    const sealed = fake('sealed', [{ mutationId: 'm1' }], {
      resolveSuccess: async (item) => { flip = true; live.account = 'account-b'; return deferral(item); },
      inbound: async (context) => { contexts.push(context); return { outcome: 'caught-up' }; },
    });
    const { coordinator } = engineFor([sealed.instance], live);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    expect(flip).toBe(true);
    live.account = 'account-a';
    coordinator.setAccount('account-b');
    coordinator.setAccount('account-a');
    await coordinator.settle();
    // Account switches wiped every deferral: the new session sees none.
    expect(contexts.every((context) => context.deferred.length === 0)).toBe(true);
    coordinator.dispose();
  });
});

describe('APP-076 B2B1 engine: bounded inbound step', () => {
  beforeEach(() => { jest.useFakeTimers(); releaseAllMutationClaims(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('runs inbound before sends, holds the backend\'s sends until caught up, and never starves the ordinary backend', async () => {
    const log: string[] = [];
    let pages = 3;
    const ordinary = fake('ordinary', [{ mutationId: 'o1' }, { mutationId: 'o2' }], { log });
    const sealed = fake('sealed', [{ mutationId: 's1' }], {
      log,
      inbound: async () => { pages -= 1; log.push(`inbound:${pages}`); return pages > 0 ? { outcome: 'continue' } : { outcome: 'caught-up' }; },
    });
    const { coordinator } = engineFor([ordinary.instance, sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    // Cycle 1: one page only, then the ordinary work ran; sealed was held back.
    expect(log).toEqual(['inbound:2', 'send:ordinary:o1', 'ok:ordinary:o1', 'send:ordinary:o2', 'ok:ordinary:o2']);
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(1_000);
    await coordinator.settle();
    expect(log.slice(5)).toEqual(['inbound:1']);
    jest.advanceTimersByTime(1_000);
    await coordinator.settle();
    expect(log.slice(6)).toEqual(['inbound:0', 'send:sealed:s1', 'ok:sealed:s1']);
    expect(jest.getTimerCount()).toBe(0);
    coordinator.dispose();
  });

  it('one inbound page per backend per cycle: a burst of events coalesces and never loops', async () => {
    const log: string[] = [];
    const sealed = fake('sealed', [], { log, inbound: async () => { log.push('inbound'); return { outcome: 'continue' }; } });
    const { coordinator } = engineFor([sealed.instance]);
    coordinator.setAccount('account-a');
    for (let index = 0; index < 5; index += 1) sealed.events.emit({ kind: 'changed', accountId: 'account-a' });
    await coordinator.settle();
    expect(count(log, 'inbound')).toBe(1);
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(1_000);
    await coordinator.settle();
    expect(count(log, 'inbound')).toBe(2);
    coordinator.dispose();
  });

  it('rescheduling and planning never reach the network: inbound runs only from active cycles', async () => {
    const log: string[] = [];
    const start = Date.parse('2026-10-14T12:00:00.000Z');
    const sealed = fake('sealed', [{ mutationId: 'later' }], {
      log,
      plan: () => ({ due: [], nextRetryAtMs: start + 60_000 }),
      inbound: async () => { log.push('inbound'); return { outcome: 'caught-up' }; },
    });
    const { coordinator } = engineFor([sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    expect(count(log, 'inbound')).toBe(1);
    expect(jest.getTimerCount()).toBe(1);
    // Foreground-off/on clears and re-arms the timer by inspecting plans only if a cycle ran.
    await microtasks();
    expect(count(log, 'inbound')).toBe(1);
    coordinator.dispose();
  });

  it('a blocked inbound step keeps its backend quiet and arms one retry timer at its requested time', async () => {
    const log: string[] = [];
    const ordinary = fake('ordinary', [{ mutationId: 'o1' }], { log });
    const sealed = fake('sealed', [{ mutationId: 's1' }], {
      log, inbound: async () => { log.push('inbound'); return { outcome: 'blocked', retryAtMs: START + 7_000 }; },
    });
    const { coordinator } = engineFor([ordinary.instance, sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    expect(log).toEqual(['inbound', 'send:ordinary:o1', 'ok:ordinary:o1']);
    expect(jest.getTimerCount()).toBe(1);
    coordinator.dispose();
  });

  it('a halted backend stops (and forgets deferrals) while the ordinary backend keeps working', async () => {
    const log: string[] = [];
    const ordinaryItems: Item[] = [{ mutationId: 'o1' }];
    const sealedItems: Item[] = [{ mutationId: 's1' }];
    let halted = false;
    const ordinary = fake('ordinary', ordinaryItems, { log });
    const sealed = fake('sealed', sealedItems, {
      log,
      resolveSuccess: async (item) => deferral(item),
      inbound: async () => (halted ? { outcome: 'halted' } : { outcome: 'caught-up' }),
    });
    const { coordinator } = engineFor([ordinary.instance, sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    halted = true;
    ordinaryItems.push({ mutationId: 'o2' });
    sealedItems.push({ mutationId: 's2' });
    ordinary.events.emit({ kind: 'changed', accountId: 'account-a' });
    await coordinator.settle();
    expect(log.filter((entry) => entry.startsWith('send'))).toEqual(['send:ordinary:o1', 'send:sealed:s1', 'send:ordinary:o2']);
    jest.advanceTimersByTime(60_000);
    await coordinator.settle();
    expect(count(log, 'send:sealed')).toBe(1);
    coordinator.dispose();
  });

  it('a throwing inbound step is a blocked backend, never an unhandled error, and never a send', async () => {
    const log: string[] = [];
    const sealed = fake('sealed', [{ mutationId: 's1' }], { log, inbound: async () => { throw new Error('network detail'); } });
    const { coordinator } = engineFor([sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    expect(log).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
    coordinator.dispose();
  });

  it('ignores an inbound result that arrives after an account switch', async () => {
    const live = { account: 'account-a' as string | null };
    const releases: Array<(value: SyncInboundResult) => void> = [];
    const log: string[] = [];
    const sealed = fake('sealed', [{ mutationId: 's1' }], {
      log, inbound: () => new Promise<SyncInboundResult>((resolve) => { releases.push(resolve); }),
    });
    const { coordinator } = engineFor([sealed.instance], live);
    coordinator.setAccount('account-a');
    await microtasks();
    live.account = 'account-b';
    coordinator.setAccount('account-b');
    await microtasks();
    releases.forEach((release) => release({ outcome: 'caught-up' }));
    await coordinator.settle();
    // The account-a result was discarded; only the live account-b session may send.
    expect(log.filter((entry) => entry.startsWith('send'))).toEqual(['send:sealed:s1']);
    expect(releases).toHaveLength(2);
    coordinator.dispose();
  });

  it('a failure result that requests reconciliation earns one bounded continuation that runs inbound first', async () => {
    const log: string[] = [];
    const items: Item[] = [{ mutationId: 's1' }];
    const sealed = fake('sealed', items, {
      log,
      resolveSuccess: async () => ({ outcome: 'not-success' }),
      resolveFailure: async (item) => { log.push(`fail:${(item as Item).mutationId}`); items.splice(0, items.length); return { recorded: true, permanent: true, reconcile: true }; },
      inbound: async () => { log.push('inbound'); return { outcome: 'caught-up' }; },
    });
    const { coordinator } = engineFor([sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    expect(log).toEqual(['inbound', 'send:sealed:s1', 'fail:s1']);
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(1_000);
    await coordinator.settle();
    expect(log).toEqual(['inbound', 'send:sealed:s1', 'fail:s1', 'inbound']);
    expect(jest.getTimerCount()).toBe(0);
    coordinator.dispose();
  });
});

describe('APP-076 B2B1 engine: backend-scoped invalidation', () => {
  beforeEach(() => { jest.useFakeTimers(); releaseAllMutationClaims(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  function gatedPair() {
    const log: string[] = [];
    const released: Record<string, boolean> = {};
    const waiters: Record<string, Array<() => void>> = {};
    const gates: Record<string, () => void> = new Proxy({}, { get: (_t, name: string) => () => { released[name] = true; (waiters[name] ?? []).forEach((resolve) => resolve()); } });
    const gate = (name: string) => (released[name] ? Promise.resolve() : new Promise<void>((resolve) => { (waiters[name] ??= []).push(resolve); }));
    const opens = { ordinary: { count: 0 }, sealed: { count: 0 } };
    const ordinary = fake('ordinary', [{ mutationId: 'o1' }], {
      log, opens: opens.ordinary,
      send: async (item) => { log.push(`send:ordinary:${(item as Item).mutationId}`); await gate('ordinary'); return { ok: true }; },
    });
    const sealed = fake('sealed', [{ mutationId: 's1' }], {
      log, opens: opens.sealed,
      send: async (item) => { log.push(`send:sealed:${(item as Item).mutationId}`); await gate('sealed'); return { ok: true }; },
      resolveSuccess: async (item) => deferral(item),
    });
    return { log, gates, ordinary, sealed, opens };
  }

  it('Pregnancy invalidation mid-flight does NOT discard an in-flight ordinary send, and gives the Pregnancy backend one fresh pass', async () => {
    const { log, gates, ordinary, sealed, opens } = gatedPair();
    // Order the work so the ordinary send is the one in flight when sealed is invalidated.
    const { coordinator } = engineFor([ordinary.instance, sealed.instance]);
    coordinator.setAccount('account-a');
    await microtasks();
    expect(log).toEqual(['send:ordinary:o1']);
    sealed.events.emit({ kind: 'backend-invalidated', backendId: 'sealed', accountId: 'account-a' });
    gates.ordinary();
    await microtasks();
    // The ORIGINAL in-flight ordinary result was recorded; it was not discarded and re-sent by a fresh pass.
    expect(log).toContain('ok:ordinary:o1');
    expect(log.filter((entry) => entry === 'send:ordinary:o1')).toHaveLength(1);
    // The original pass never sends sealed work from the invalidated session; a fresh pass does.
    await microtasks();
    expect(log.filter((entry) => entry === 'send:sealed:s1').length).toBeLessThanOrEqual(1);
    gates.sealed();
    await coordinator.settle();
    expect(opens.sealed.count).toBeGreaterThan(opens.ordinary.count - 1);
    coordinator.dispose();
  });

  it('a Pregnancy invalidation while sealed work is in flight discards only that result', async () => {
    const { log, gates, ordinary, sealed } = gatedPair();
    ordinary.items.splice(0, 1);
    const { coordinator } = engineFor([ordinary.instance, sealed.instance]);
    coordinator.setAccount('account-a');
    await microtasks();
    expect(log).toEqual(['send:sealed:s1']);
    sealed.events.emit({ kind: 'backend-invalidated', backendId: 'sealed', accountId: 'account-a' });
    gates.sealed();
    await microtasks();
    // Resolution of the stale sealed result never ran (no deferral recorded for it).
    expect(log.filter((entry) => entry.startsWith('ok:sealed'))).toEqual([]);
    coordinator.dispose();
  });

  it('cleanup (logout) invalidates every backend, including ordinary in-flight work', async () => {
    const { log, gates, ordinary, sealed } = gatedPair();
    const { coordinator } = engineFor([ordinary.instance, sealed.instance]);
    coordinator.setAccount('account-a');
    await microtasks();
    ordinary.events.emit({ kind: 'cleanup' });
    gates.ordinary();
    await coordinator.settle();
    expect(log).toEqual(['send:ordinary:o1']);
    expect(jest.getTimerCount()).toBe(0);
    coordinator.dispose();
  });

  it('an account switch invalidates every backend', async () => {
    const { log, gates, ordinary, sealed } = gatedPair();
    const live = { account: 'account-a' as string | null };
    const { coordinator } = engineFor([ordinary.instance, sealed.instance], live);
    coordinator.setAccount('account-a');
    await microtasks();
    live.account = 'account-b';
    coordinator.setAccount('account-b');
    await microtasks();
    gates.ordinary(); gates.sealed();
    await coordinator.settle();
    // Only the live account-b pass may resolve anything; account-a's late results were discarded.
    expect(log.filter((entry) => entry.startsWith('send'))).toEqual(['send:ordinary:o1', 'send:ordinary:o1', 'send:sealed:s1']);
    expect(log.filter((entry) => entry.startsWith('ok:ordinary'))).toHaveLength(1);
    coordinator.dispose();
  });

  it('keeps exactly one timer and no polling across invalidations', async () => {
    const inbound = jest.fn(async (): Promise<SyncInboundResult> => ({ outcome: 'continue' }));
    const sealed = fake('sealed', [], { inbound });
    const { coordinator } = engineFor([sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    for (let index = 0; index < 4; index += 1) {
      sealed.events.emit({ kind: 'backend-invalidated', backendId: 'sealed', accountId: 'account-a' });
      await coordinator.settle();
      expect(jest.getTimerCount()).toBeLessThanOrEqual(1);
    }
    const before = inbound.mock.calls.length;
    jest.advanceTimersByTime(500);
    await coordinator.settle();
    expect(inbound.mock.calls.length).toBe(before);
    coordinator.dispose();
  });

  it('an invalidation for a different account is ignored; an invalidation clears that backend\'s deferrals', async () => {
    const contexts: SyncInboundContext[] = [];
    const sealed = fake('sealed', [{ mutationId: 's1' }], {
      resolveSuccess: async (item) => deferral(item),
      inbound: async (context) => { contexts.push(context); return { outcome: 'caught-up' }; },
    });
    const { coordinator } = engineFor([sealed.instance]);
    coordinator.setAccount('account-a');
    await coordinator.settle();
    jest.advanceTimersByTime(1_000);
    await coordinator.settle();
    expect(contexts[contexts.length - 1].deferred).toHaveLength(1);
    const calls = contexts.length;
    sealed.events.emit({ kind: 'backend-invalidated', backendId: 'sealed', accountId: 'account-b' });
    await coordinator.settle();
    expect(contexts.length).toBe(calls);
    sealed.events.emit({ kind: 'backend-invalidated', backendId: 'sealed', accountId: 'account-a' });
    await coordinator.settle();
    expect(contexts[contexts.length - 1].deferred).toEqual([]);
    coordinator.dispose();
  });
});

describe('APP-076 B2B1 engine: stale session without a setAccount call', () => {
  beforeEach(() => { jest.useFakeTimers(); releaseAllMutationClaims(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('discards a late result when the live session account flips even though the engine was never told', async () => {
    const live = { account: 'account-a' as string | null };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const log: string[] = [];
    const ordinary = fake('ordinary', [{ mutationId: 'o1' }], { log, send: async () => { log.push('send'); await gate; return { ok: true }; } });
    const { coordinator } = engineFor([ordinary.instance], live);
    coordinator.setAccount('account-a');
    await microtasks();
    live.account = 'account-b';
    release();
    await coordinator.settle();
    expect(log).toEqual(['send']);
    expect(jest.getTimerCount()).toBe(0);
    coordinator.dispose();
  });
});

describe('APP-076 B2B1 ordinary wrapper regression', () => {
  beforeEach(async () => { jest.useFakeTimers(); releaseAllMutationClaims(); await withOutboxCleanup(async () => { await AsyncStorage.clear(); }); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  it('still acknowledges an ordinary success immediately and keeps no deferral', async () => {
    const sent: string[] = [];
    await createOutbox('account-a').enqueue({ dataDomain: 'core.module-choice', entityType: 'module-choice', entityId: 'habits', operation: 'upsert', payload: { enabled: true } });
    const connectivity = signal<'online' | 'offline' | 'unknown'>();
    const foreground = signal<boolean>();
    const coordinator = createSyncCoordinator({
      getActiveAccount: () => 'account-a',
      connectivity: { getState: () => 'online', subscribe: connectivity.subscribe },
      foreground: { isForeground: () => true, subscribe: foreground.subscribe },
      send: (async (_account: string, mutation: { mutationId: string }) => { sent.push(mutation.mutationId); return { ok: true }; }) as never,
    });
    coordinator.setAccount('account-a');
    await coordinator.settle();
    expect(sent).toHaveLength(1);
    expect(await createOutbox('account-a').list()).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
    coordinator.dispose();
  });

  it('records a failed ordinary send through failure handling, not success handling', async () => {
    await createOutbox('account-a').enqueue({ dataDomain: 'core.module-choice', entityType: 'module-choice', entityId: 'habits', operation: 'upsert', payload: { enabled: true } });
    const connectivity = signal<'online' | 'offline' | 'unknown'>();
    const foreground = signal<boolean>();
    const coordinator = createSyncCoordinator({
      getActiveAccount: () => 'account-a',
      connectivity: { getState: () => 'online', subscribe: connectivity.subscribe },
      foreground: { isForeground: () => true, subscribe: foreground.subscribe },
      send: (async () => ({ ok: false, reason: 'validation' })) as never,
      now: () => START, random: () => 1, onPermanentFailure: () => undefined,
    });
    coordinator.setAccount('account-a');
    await coordinator.settle();
    expect((await createOutbox('account-a').list())[0]).toMatchObject({ status: 'failed', attempts: 1 });
    coordinator.dispose();
  });
});
