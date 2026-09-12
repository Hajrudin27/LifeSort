import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ConnectivityState } from '@/core/sync/connectivity';
import { createOutbox, OUTBOX_STORAGE_KEY, withOutboxCleanup, type OutboxMutation } from '@/core/sync/outbox';
import { SYNC_CONTINUATION_DELAY_MS } from '@/core/sync/retryPolicy';
import { createSyncCoordinator } from '@/core/sync/syncCoordinator';
import { useEnabledModulesStore } from '@/store/useEnabledModulesStore';

/**
 * APP-037 — the first production domain to leave the fire-and-forget path.
 *
 * A module switch is small enough to be honest about: one row, one boolean, and
 * a user who will notice immediately if it does not stick. The point of moving
 * it into the outbox is not speed — it is that turning a module off on a train
 * still means something when the train comes out of the tunnel.
 */

const mockUpsert = jest.fn(() => Promise.resolve({ error: null }));
const mockRows = jest.fn(() => Promise.resolve({ data: [] as unknown[], error: null as unknown }));
const mockGetUser = jest.fn(() => Promise.resolve({ data: { user: { id: 'a' } } }));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => mockGetUser() },
    from: () => ({
      select: () => ({ eq: () => mockRows() }),
      upsert: (...args: unknown[]) => mockUpsert(...(args as [])),
    }),
  },
}));

jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ session: { user: { id: mockAccount } } }) },
}));

let mockAccount: string | null = 'a';
let connectivityState: ConnectivityState;
let connectivityListeners: Set<(state: ConnectivityState) => void>;
let send: jest.Mock;
let coordinator: ReturnType<typeof createSyncCoordinator>;

const moduleChoices = async (accountId = 'a') =>
  (await createOutbox(accountId).list()).filter((entry) => entry.dataDomain === 'core.module-choice');

function build() {
  return createSyncCoordinator({
    getActiveAccount: () => mockAccount,
    connectivity: {
      getState: () => connectivityState,
      subscribe(listener) {
        connectivityListeners.add(listener);
        return () => { connectivityListeners.delete(listener); };
      },
    },
    foreground: { isForeground: () => true, subscribe: () => () => {} },
    send: send as never,
  });
}

function goOnline() {
  connectivityState = 'online';
  for (const listener of [...connectivityListeners]) listener('online');
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'a' } } });
  mockRows.mockReset().mockResolvedValue({ data: [], error: null });
  await withOutboxCleanup(async () => { await AsyncStorage.clear(); });
  mockAccount = 'a';
  connectivityState = 'online';
  connectivityListeners = new Set();
  send = jest.fn().mockResolvedValue({ ok: true, status: 'applied' });
  // Same reset logout uses: it clears the ephemeral write tracking too.
  useEnabledModulesStore.getState().clearLocal();
  coordinator = build();
  coordinator.setAccount('a');
  await coordinator.settle();
});

afterEach(() => {
  coordinator.dispose();
  jest.useRealTimers();
});

/** Durable enqueue is asynchronous; the switch itself is not. */
async function drain() {
  for (let round = 0; round < 20; round += 1) await Promise.resolve();
  await coordinator.settle();
}

/**
 * Takes over the durable enqueue so the order of settlement can be chosen. The
 * real outbox settles strictly FIFO, which is exactly why the guards below
 * cannot be exercised through it.
 */
function controlledEnqueue() {
  const settle: { queued: () => void; refused: () => void }[] = [];
  const enqueue = jest.fn((_input: { payload?: unknown }) => new Promise<void>((resolve, reject) => {
    settle.push({ queued: () => resolve(), refused: () => reject(new Error('file:///private/disk')) });
  }));
  const spy = jest.spyOn(require('@/core/sync/outbox'), 'createOutbox').mockReturnValue({ enqueue } as never);
  return { settle, enqueue, restore: () => spy.mockRestore() };
}

const choiceOf = (moduleId: string) =>
  (useEnabledModulesStore.getState().enablement as Record<string, boolean | undefined>)[moduleId];

it('applies the choice locally without waiting for storage or the network', async () => {
  useEnabledModulesStore.getState().setModuleEnabled('habits', false);

  // Asserted in the same tick as the tap: nothing has been awaited, the durable
  // write has not completed, and no request exists yet.
  expect(useEnabledModulesStore.getState().enablement.habits).toBe(false);
  expect(send).not.toHaveBeenCalled();

  await drain();
  expect(useEnabledModulesStore.getState().enablement.habits).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);
});

it('puts the switch back when the durable queue refuses the choice', async () => {
  await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, 'not an outbox at all');
  useEnabledModulesStore.getState().setModuleEnabled('habits', false);

  // Local-first is still local-first: the switch moves immediately.
  expect(useEnabledModulesStore.getState().enablement.habits).toBe(false);
  await drain();

  // But a choice that reached no queue cannot be sent, cannot be retried and
  // would be overwritten by the next fetch — so it fails closed rather than
  // sitting on screen pretending to hold.
  expect(useEnabledModulesStore.getState().enablement.habits).toBeUndefined();
  expect(send).not.toHaveBeenCalled();
});

it('restores the previous explicit value, not just the default', async () => {
  useEnabledModulesStore.getState().setModuleEnabled('habits', false);
  await drain();
  expect(useEnabledModulesStore.getState().enablement.habits).toBe(false);

  await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, 'not an outbox at all');
  useEnabledModulesStore.getState().setModuleEnabled('habits', true);
  await drain();
  expect(useEnabledModulesStore.getState().enablement.habits).toBe(false);
});

it('cannot roll back a newer choice with an older enqueue failure', async () => {
  const outboxModule = require('@/core/sync/outbox');
  let failFirst!: (error: Error) => void;
  const first = new Promise<never>((_, reject) => { failFirst = reject; });
  const enqueue = jest.fn()
    .mockReturnValueOnce(first)
    .mockResolvedValueOnce(undefined);
  const spy = jest.spyOn(outboxModule, 'createOutbox').mockReturnValue({ enqueue } as never);

  try {
    // true (default) -> false, then false -> true before the first write settles.
    useEnabledModulesStore.getState().setModuleEnabled('habits', false);
    useEnabledModulesStore.getState().setModuleEnabled('habits', true);
    await drain();
    expect(useEnabledModulesStore.getState().enablement.habits).toBe(true);

    failFirst(new Error('file:///private/disk'));
    await drain();

    // The failure describes a value the user has already replaced. Rolling back
    // to it would undo a newer, successfully queued choice.
    expect(useEnabledModulesStore.getState().enablement.habits).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(2);
  } finally {
    spy.mockRestore();
  }
});

it('keeps two same-tick toggles of one module in the order they were made', async () => {
  connectivityState = 'offline';
  // No await between them: the durable order must come from the queue itself.
  useEnabledModulesStore.getState().setModuleEnabled('habits', false);
  useEnabledModulesStore.getState().setModuleEnabled('habits', true);
  await drain();

  expect((await moduleChoices()).map((entry) => entry.payload))
    .toEqual([{ enabled: false }, { enabled: true }]);
  expect(useEnabledModulesStore.getState().enablement.habits).toBe(true);
});

it('queues the exact supported envelope with a cryptographic mutation ID', async () => {
  useEnabledModulesStore.getState().setModuleEnabled('habits', false);
  await drain();

  expect(send).toHaveBeenCalledTimes(1);
  const [accountId, mutation] = send.mock.calls[0] as [string, OutboxMutation];
  expect(accountId).toBe('a');
  expect(mutation).toMatchObject({
    dataDomain: 'core.module-choice',
    entityType: 'module-choice',
    entityId: 'habits',
    operation: 'upsert',
    payload: { enabled: false },
    status: 'pending',
    attempts: 0,
  });
  expect(mutation.baseRevision).toBeUndefined();
  expect(mutation.mutationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

it.each(['applied', 'replayed'])('a %s receipt clears the durable entry', async (status) => {
  send.mockResolvedValue({ ok: true, status });
  useEnabledModulesStore.getState().setModuleEnabled('food', true);
  await drain();
  expect(await moduleChoices()).toEqual([]);
});

it('never writes the row directly any more', async () => {
  useEnabledModulesStore.getState().setModuleEnabled('habits', false);
  await drain();
  expect(mockUpsert).not.toHaveBeenCalled();
});

it('keeps an offline choice usable, and sends it when the network returns', async () => {
  connectivityState = 'offline';
  useEnabledModulesStore.getState().setModuleEnabled('travel', false);
  await drain();

  expect(useEnabledModulesStore.getState().enablement.travel).toBe(false);
  expect(send).not.toHaveBeenCalled();
  const queued = await moduleChoices();
  expect(queued).toHaveLength(1);

  goOnline();
  await coordinator.settle();
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][1].mutationId).toBe(queued[0].mutationId);
  expect(await moduleChoices()).toEqual([]);
});

it('sends two changes to the same module in the order they were made', async () => {
  connectivityState = 'offline';
  useEnabledModulesStore.getState().setModuleEnabled('habits', false);
  await drain();
  useEnabledModulesStore.getState().setModuleEnabled('habits', true);
  await drain();

  const queued = await moduleChoices();
  expect(queued.map((entry) => entry.payload)).toEqual([{ enabled: false }, { enabled: true }]);

  goOnline();
  await coordinator.settle();
  // The second one waits for the first to be acknowledged, never overtakes it.
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][1].payload).toEqual({ enabled: false });

  jest.advanceTimersByTime(SYNC_CONTINUATION_DELAY_MS);
  await coordinator.settle();
  expect(send.mock.calls.map((call) => call[1].payload)).toEqual([{ enabled: false }, { enabled: true }]);
  expect(useEnabledModulesStore.getState().enablement.habits).toBe(true);
});

it('queues nothing for a module that cannot be switched off', async () => {
  useEnabledModulesStore.getState().setModuleEnabled('core-shell', false);
  await drain();
  expect(useEnabledModulesStore.getState().enablement['core-shell']).toBeUndefined();
  expect(await moduleChoices()).toEqual([]);
});

it('queues nothing when nobody is signed in, and leaves the local choice alone', async () => {
  mockAccount = null;
  useEnabledModulesStore.getState().setModuleEnabled('habits', false);
  await drain();
  expect(useEnabledModulesStore.getState().enablement.habits).toBe(false);
  expect(await moduleChoices()).toEqual([]);
});

it('does not let a server row roll back a choice that is still queued', async () => {
  connectivityState = 'offline';
  useEnabledModulesStore.getState().setModuleEnabled('habits', false);
  await drain();

  // The server still holds the value from before the switch was flipped.
  mockRows.mockResolvedValue({ data: [{ module_id: 'habits', enabled: true }, { module_id: 'food', enabled: false }], error: null });
  await useEnabledModulesStore.getState().fetchFromSupabase();

  expect(useEnabledModulesStore.getState().enablement).toEqual({ habits: false, food: false });
  expect(await moduleChoices()).toHaveLength(1);
});

it('accepts server rows for modules with nothing queued', async () => {
  mockRows.mockResolvedValue({ data: [{ module_id: 'food', enabled: false }], error: null });
  await useEnabledModulesStore.getState().fetchFromSupabase();
  expect(useEnabledModulesStore.getState().enablement).toEqual({ food: false });
});

it('migrates only the module-choice domain', async () => {
  useEnabledModulesStore.getState().setModuleEnabled('habits', false);
  useEnabledModulesStore.getState().setModuleEnabled('economy', false);
  await drain();

  const everything = await createOutbox('a').list();
  const sent = send.mock.calls.map((call) => call[1] as OutboxMutation);
  for (const mutation of [...everything, ...sent]) {
    expect(mutation.dataDomain).toBe('core.module-choice');
    expect(mutation.entityType).toBe('module-choice');
  }
});

describe('a chain of writes rolls back to something that is actually durable', () => {
  it('leaves the value from before the chain when both enqueues fail', async () => {
    const { settle, restore } = controlledEnqueue();
    try {
      // Stable value: no explicit choice, so the module defaults to enabled.
      useEnabledModulesStore.getState().setModuleEnabled('habits', false);
      useEnabledModulesStore.getState().setModuleEnabled('habits', true);
      await drain();

      settle[0].refused();
      settle[1].refused();
      await drain();

      // `false` was only ever on screen. Rolling back to it would recreate the
      // unqueued-but-visible state this whole rule exists to prevent.
      expect(choiceOf('habits')).toBeUndefined();
    } finally { restore(); }
  });

  it('rolls back to the first value when it was queued and the second was not', async () => {
    const { settle, restore } = controlledEnqueue();
    try {
      useEnabledModulesStore.getState().setModuleEnabled('habits', false);
      useEnabledModulesStore.getState().setModuleEnabled('habits', true);
      await drain();

      settle[0].queued();
      settle[1].refused();
      await drain();

      // `false` is durable queued intent now, so that is what the switch shows.
      expect(choiceOf('habits')).toBe(false);
    } finally { restore(); }
  });

  it('keeps the second value when only the first failed', async () => {
    const { settle, restore } = controlledEnqueue();
    try {
      useEnabledModulesStore.getState().setModuleEnabled('habits', false);
      useEnabledModulesStore.getState().setModuleEnabled('habits', true);
      await drain();

      settle[0].refused();
      settle[1].queued();
      await drain();

      expect(choiceOf('habits')).toBe(true);
    } finally { restore(); }
  });

  it('keeps the latest value when both were queued', async () => {
    const { settle, enqueue, restore } = controlledEnqueue();
    try {
      useEnabledModulesStore.getState().setModuleEnabled('habits', false);
      useEnabledModulesStore.getState().setModuleEnabled('habits', true);
      await drain();

      settle[0].queued();
      settle[1].queued();
      await drain();

      expect(choiceOf('habits')).toBe(true);
      expect(enqueue.mock.calls.map((call) => call[0].payload))
        .toEqual([{ enabled: false }, { enabled: true }]);
    } finally { restore(); }
  });

  it('lets a rolled-back switch follow an older write that did reach the queue', async () => {
    const { settle, restore } = controlledEnqueue();
    try {
      useEnabledModulesStore.getState().setModuleEnabled('habits', false);
      useEnabledModulesStore.getState().setModuleEnabled('habits', true);
      await drain();

      // Out of order on purpose: the newer write fails first and rolls back,
      // then the older one turns out to have been queued after all.
      settle[1].refused();
      await drain();
      expect(choiceOf('habits')).toBeUndefined();

      settle[0].queued();
      await drain();
      expect(choiceOf('habits')).toBe(false);
    } finally { restore(); }
  });
});

describe('account lifecycle', () => {
  it('a failure from before logout cannot put the old value back', async () => {
    const { settle, restore } = controlledEnqueue();
    try {
      useEnabledModulesStore.getState().setModuleEnabled('habits', false);
      await drain();
      expect(choiceOf('habits')).toBe(false);

      useEnabledModulesStore.getState().clearLocal();
      expect(useEnabledModulesStore.getState().enablement).toEqual({});

      settle[0].refused();
      await drain();
      expect(useEnabledModulesStore.getState().enablement).toEqual({});
    } finally { restore(); }
  });

  it('a late failure from account A cannot alter account B', async () => {
    const { settle, restore } = controlledEnqueue();
    try {
      useEnabledModulesStore.getState().setModuleEnabled('habits', false);
      await drain();

      // Signing in as someone else clears local account data first.
      useEnabledModulesStore.getState().clearLocal();
      mockAccount = 'b';
      useEnabledModulesStore.getState().setModuleEnabled('habits', true);
      await drain();
      settle[1].queued();
      await drain();
      expect(choiceOf('habits')).toBe(true);

      settle[0].refused();
      await drain();
      expect(choiceOf('habits')).toBe(true);
    } finally { restore(); }
  });

  it('a late success from account A cannot become account B\'s durable baseline', async () => {
    const { settle, restore } = controlledEnqueue();
    try {
      useEnabledModulesStore.getState().setModuleEnabled('habits', false);
      await drain();

      useEnabledModulesStore.getState().clearLocal();
      mockAccount = 'b';
      useEnabledModulesStore.getState().setModuleEnabled('habits', false);
      await drain();

      settle[0].queued();   // A's stale receipt
      settle[1].refused();  // B's own write is refused
      await drain();

      // If A's receipt had been accepted into B's chain, B would roll back to
      // `false` and keep showing a choice that reached no queue.
      expect(choiceOf('habits')).toBeUndefined();
    } finally { restore(); }
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}

/** Hold an actual durable snapshot after its read, without blocking the queue. */
function holdFetchBoundary(boundary: 'initial outbox' | 'auth' | 'remote' | 'final outbox') {
  const entered = deferred<void>();
  const gate = deferred<void>();
  let restore = () => {};
  if (boundary === 'auth') {
    mockGetUser.mockImplementationOnce(async () => {
      entered.resolve(); await gate.promise;
      return { data: { user: { id: 'a' } } };
    });
  } else if (boundary === 'remote') {
    mockRows.mockImplementationOnce(async () => {
      entered.resolve(); await gate.promise;
      return { data: [{ module_id: 'habits', enabled: true }], error: null };
    });
  } else {
    const actual = createOutbox;
    let reads = 0;
    const spy = jest.spyOn(require('@/core/sync/outbox'), 'createOutbox').mockImplementation((id: unknown) => {
      const outbox = actual(id as string);
      return { ...outbox, list: async () => {
        const snapshot = await outbox.list();
        reads += 1;
        if (reads === (boundary === 'initial outbox' ? 1 : 2)) {
          entered.resolve(); await gate.promise;
        }
        return snapshot;
      } };
    });
    restore = () => spy.mockRestore();
  }
  return { entered: entered.promise, release: () => gate.resolve(), restore };
}

describe('fetch account and epoch safety at every await', () => {
  it.each(['initial outbox', 'auth', 'remote', 'final outbox'] as const)(
    'A → logout stays cleared after the %s resolves', async (boundary) => {
      connectivityState = 'offline';
      mockRows.mockResolvedValue({ data: [{ module_id: 'habits', enabled: true }], error: null });
      const held = holdFetchBoundary(boundary);
      try {
        const fetching = useEnabledModulesStore.getState().fetchFromSupabase();
        await held.entered;
        useEnabledModulesStore.getState().clearLocal();
        mockAccount = null;
        const publish = jest.fn();
        const stop = useEnabledModulesStore.subscribe(publish);
        held.release(); await fetching;
        stop();
        expect(publish).not.toHaveBeenCalled();
        expect(useEnabledModulesStore.getState().enablement).toEqual({});
      } finally { held.restore(); }
    },
  );

  it.each([
    ['initial outbox', 'b'], ['auth', 'b'], ['remote', 'b'], ['final outbox', 'b'],
    ['initial outbox', 'a'], ['auth', 'a'], ['remote', 'a'], ['final outbox', 'a'],
  ] as const)('old A fetch at %s cannot change a fresh %s session', async (boundary, nextAccount) => {
    connectivityState = 'offline';
    mockRows.mockResolvedValue({ data: [{ module_id: 'habits', enabled: true }], error: null });
    const held = holdFetchBoundary(boundary);
    try {
      const fetching = useEnabledModulesStore.getState().fetchFromSupabase();
      await held.entered;
      mockAccount = null;
      useEnabledModulesStore.getState().clearLocal();
      mockAccount = nextAccount;
      useEnabledModulesStore.getState().setModuleEnabled('habits', false);
      await drain();
      const current = useEnabledModulesStore.getState().enablement;
      const publish = jest.fn();
      const stop = useEnabledModulesStore.subscribe(publish);
      held.release(); await fetching;
      stop();
      expect(publish).not.toHaveBeenCalled();
      expect(useEnabledModulesStore.getState().enablement).toBe(current);
    } finally { held.restore(); }
  });

  it('app account B rejects Supabase identity A without publishing or querying rows', async () => {
    mockAccount = 'b';
    const publish = jest.fn();
    const stop = useEnabledModulesStore.subscribe(publish);
    await useEnabledModulesStore.getState().fetchFromSupabase();
    stop();
    expect(mockRows).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(useEnabledModulesStore.getState().enablement).toEqual({});
  });
});

describe('fetch preserves overlapping local intent', () => {
  it('a newer non-overlapping fetch cannot erase an older fetch\'s local-write evidence', async () => {
    const held = holdFetchBoundary('remote');
    const olderFetch = useEnabledModulesStore.getState().fetchFromSupabase();
    await held.entered;
    useEnabledModulesStore.getState().setModuleEnabled('habits', false);
    await drain();
    expect(await moduleChoices()).toEqual([]);
    mockRows.mockResolvedValue({ data: [{ module_id: 'habits', enabled: false }], error: null });
    await useEnabledModulesStore.getState().fetchFromSupabase();
    held.release(); await olderFetch;
    expect(choiceOf('habits')).toBe(false);
  });

  it.each([true, false])('protects a write begun during the final outbox read; enqueue finishes first=%s', async (enqueueFirst) => {
    connectivityState = 'offline';
    useEnabledModulesStore.setState({ enablement: { habits: true } });
    mockRows.mockResolvedValue({ data: [{ module_id: 'habits', enabled: true }], error: null });
    const held = holdFetchBoundary('final outbox');
    const fetching = useEnabledModulesStore.getState().fetchFromSupabase();
    await held.entered; // This snapshot contains no habits mutation.
    held.restore();
    const actual = createOutbox;
    const enqueueGate = deferred<void>();
    const spy = jest.spyOn(require('@/core/sync/outbox'), 'createOutbox').mockImplementation((id: unknown) => {
      const outbox = actual(id as string);
      return { ...outbox, enqueue: async (input: Parameters<typeof outbox.enqueue>[0]) => {
        await enqueueGate.promise;
        return outbox.enqueue(input);
      } };
    });
    try {
      useEnabledModulesStore.getState().setModuleEnabled('habits', false);
      expect(choiceOf('habits')).toBe(false);
      if (enqueueFirst) { enqueueGate.resolve(); await drain(); }
      held.release(); await fetching;
      expect(choiceOf('habits')).toBe(false);
      enqueueGate.resolve(); await drain();
      expect((await moduleChoices()).map((entry) => entry.payload)).toEqual([{ enabled: false }]);
      expect(choiceOf('habits')).toBe(false);
    } finally { spy.mockRestore(); }
  });

  it('keeps queued-before intent after automatic apply and acknowledge during the remote read', async () => {
    connectivityState = 'offline';
    useEnabledModulesStore.getState().setModuleEnabled('habits', false);
    await drain();
    const [queued] = await moduleChoices();
    const held = holdFetchBoundary('remote');
    const fetching = useEnabledModulesStore.getState().fetchFromSupabase();
    await held.entered;
    goOnline(); await coordinator.settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toEqual(queued);
    expect(await moduleChoices()).toEqual([]);
    held.release(); await fetching;
    expect(choiceOf('habits')).toBe(false);
  });

  it('keeps a write begun during the remote await even after it syncs and leaves the queue', async () => {
    const held = holdFetchBoundary('remote');
    const fetching = useEnabledModulesStore.getState().fetchFromSupabase();
    await held.entered;
    useEnabledModulesStore.getState().setModuleEnabled('habits', false);
    await drain();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await moduleChoices()).toEqual([]);
    held.release(); await fetching;
    expect(choiceOf('habits')).toBe(false);
  });

  it('protects enqueue already in flight at fetch start even if it syncs before rows return', async () => {
    const actual = createOutbox;
    const enqueueGate = deferred<void>();
    const spy = jest.spyOn(require('@/core/sync/outbox'), 'createOutbox').mockImplementation((id: unknown) => {
      const outbox = actual(id as string);
      return { ...outbox, enqueue: async (input: Parameters<typeof outbox.enqueue>[0]) => {
        await enqueueGate.promise;
        return outbox.enqueue(input);
      } };
    });
    try {
      useEnabledModulesStore.getState().setModuleEnabled('habits', false);
      const held = holdFetchBoundary('remote');
      const fetching = useEnabledModulesStore.getState().fetchFromSupabase();
      await held.entered;
      enqueueGate.resolve(); await drain();
      expect(send).toHaveBeenCalledTimes(1);
      expect(await moduleChoices()).toEqual([]);
      held.release(); await fetching;
      expect(choiceOf('habits')).toBe(false);
    } finally { spy.mockRestore(); }
  });

  it('accepts a later non-overlapping remote update and uses it as the next rollback baseline', async () => {
    useEnabledModulesStore.getState().setModuleEnabled('habits', false);
    await drain();
    expect(await moduleChoices()).toEqual([]);
    mockRows.mockResolvedValue({ data: [{ module_id: 'habits', enabled: true }], error: null });
    await useEnabledModulesStore.getState().fetchFromSupabase();
    expect(choiceOf('habits')).toBe(true);
    await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, 'invalid storage');
    useEnabledModulesStore.getState().setModuleEnabled('habits', false);
    await drain();
    expect(choiceOf('habits')).toBe(true);
  });

  it('preserves stable rollback when both overlapping enqueues fail before fetch finishes', async () => {
    connectivityState = 'offline';
    useEnabledModulesStore.setState({ enablement: { habits: false } });
    const held = holdFetchBoundary('remote');
    const fetching = useEnabledModulesStore.getState().fetchFromSupabase();
    await held.entered;
    const { settle, restore } = controlledEnqueue();
    useEnabledModulesStore.getState().setModuleEnabled('habits', true);
    useEnabledModulesStore.getState().setModuleEnabled('habits', false);
    settle[0].refused(); settle[1].refused();
    await drain();
    restore();
    held.release(); await fetching;
    expect(choiceOf('habits')).toBe(false);
    expect(await moduleChoices()).toEqual([]);
  });
});
