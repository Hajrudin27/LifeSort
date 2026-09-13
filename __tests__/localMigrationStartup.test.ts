import fs from 'fs';
import path from 'path';

const homeRaw = fs.readFileSync(path.join(__dirname, 'fixtures/local-migrations/home-layout/c4715e6-v0.json'), 'utf8');
const outboxRaw = fs.readFileSync(path.join(__dirname, 'fixtures/local-migrations/outbox/d417466-v1.json'), 'utf8');
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); }

beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

async function boot() {
  const storage = require('@react-native-async-storage/async-storage');
  await storage.clear();
  await storage.setItem('lifesort-home-layout', homeRaw);
  await storage.setItem('lifesort-outbox', outboxRaw);
  const blocked = deferred(); const started = deferred();
  const write = storage.setItem.bind(storage);
  storage.setItem.mockImplementation(async (key: string, value: string) => {
    if (key === 'lifesort-home-layout') { started.resolve(); await blocked.promise; }
    await storage.multiSet([[key, value]]);
  });
  const runtime = require('@/core/storage/migrations/runtime');
  return { storage, blocked, started, runtime, write };
}

describe('APP-038 startup gate and no-network integration', () => {
  it('blocks import-time hydration and a real coordinator until the migration commits', async () => {
    const { storage, blocked, started, runtime } = await boot();
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network forbidden'));
    const server = require('@/core/sync/serverMutations');
    const send = jest.spyOn(server, 'sendServerMutation').mockResolvedValue({ ok: true, status: 'applied' });
    const supabase = require('@/lib/supabase').supabase;
    const from = jest.spyOn(supabase, 'from'); const auth = jest.spyOn(supabase.auth, 'getUser');
    const home = require('@/store/useHomeLayoutStore').useHomeLayoutStore;
    const coordinator = require('@/core/sync/syncCoordinator').createSyncCoordinator({
      getActiveAccount: () => 'synthetic-account-a',
      connectivity: { getState: () => 'online', subscribe: () => () => {} },
      foreground: { isForeground: () => true, subscribe: () => () => {} },
      now: () => Date.parse('2026-09-12T12:00:00.000Z'),
    });
    try {
      coordinator.setAccount('synthetic-account-a');
      await started.promise; await flush();
      expect(home.persist.hasHydrated()).toBe(false);
      expect(home.getState().pinned).toEqual([]);
      expect(await storage.getItem('lifesort-home-layout')).toBe(homeRaw);
      expect(send).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
      expect(auth).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled();
      blocked.resolve();
      await runtime.finalizeStartupStorage(); await coordinator.settle(); await flush();
      expect(home.persist.hasHydrated()).toBe(true);
      expect(home.getState().pinned).toEqual(['tasks', 'economy']);
      expect(home.getState().detail).toEqual({});
      expect(send).toHaveBeenCalledTimes(1);
      expect((send.mock.calls[0][1] as { mutationId: string }).mutationId).toBe(JSON.parse(outboxRaw).state.mutations[0].mutationId);
      expect(from).not.toHaveBeenCalled(); expect(auth).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled();
    } finally { blocked.resolve(); coordinator.dispose(); jest.restoreAllMocks(); }
  });
  it('never mounts the ready shell or overwrites Home on migration failure', async () => {
    const { storage, runtime } = await boot();
    await storage.multiSet([['lifesort-home-layout', '{"version":99,"state":{"private":"keep"}}']]);
    const home = require('@/store/useHomeLayoutStore').useHomeLayoutStore;
    const readyShell = jest.fn();
    await expect(runtime.finalizeStartupStorage().then(readyShell)).rejects.toMatchObject({ code: 'unsupported-newer-version' });
    await flush();
    expect(readyShell).not.toHaveBeenCalled(); expect(home.persist.hasHydrated()).toBe(false);
    expect(home.getState().hasHydrated).toBe(false);
    expect(await storage.getItem('lifesort-home-layout')).toBe('{"version":99,"state":{"private":"keep"}}');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it('holds the root barrier for specialized adapter reads and closes it on failure', async () => {
    const { blocked, started, runtime } = await boot();
    const external = deferred();
    const secure = runtime.migrationGatedStorage({
      getItem: async () => { await external.promise; throw new Error('decrypted private value'); },
      setItem: jest.fn(), removeItem: jest.fn(),
    });
    const read = secure.getItem('lifesort-cycle');
    void read.catch(() => undefined);
    await started.promise; blocked.resolve();
    let ready = false;
    const startup = runtime.finalizeStartupStorage().then(() => { ready = true; });
    void startup.catch(() => undefined);
    await flush(); expect(ready).toBe(false);
    external.resolve();
    await expect(startup).rejects.toMatchObject({ code: 'read-failed' });
    await expect(read).rejects.not.toThrow('decrypted private value');
  });
  it('does not recreate data when logout invalidates writes waiting behind migration', async () => {
    const { blocked, started, runtime, storage } = await boot();
    const gated = runtime.migrationGatedStorage(storage);
    const delayed = gated.setItem('lifesort-theme', '{"version":0,"state":{"mode":"dark"}}');
    await started.promise;
    const cleanup = runtime.withMigrationStorageCleanup(async () => { await storage.clear(); });
    blocked.resolve(); await delayed; await cleanup;
    expect(await storage.getItem('lifesort-theme')).toBeNull();
    await runtime.withMigrationStorageCleanup(async () => {
      await gated.setItem('lifesort-theme', 'reset');
    });
    expect(await storage.getItem('lifesort-theme')).toBeNull();
  });
  it('shares one migration attempt among concurrent startup callers', async () => {
    const { blocked, started, runtime, storage } = await boot();
    const a = runtime.ensureLocalMigrations(); const b = runtime.ensureLocalMigrations();
    expect(a).toBe(b); await started.promise; blocked.resolve(); await Promise.all([a, b]);
    expect(storage.setItem.mock.calls.filter(([key]: [string]) => key === 'lifesort-home-layout').length).toBe(2); // seed + commit
  });
});

it.each([
  ['{', 'invalid-json'], ['{"state":{}}', 'unknown-legacy-shape'],
  ['{"state":{},"version":9}', 'unsupported-newer-version'],
  ['{"state":[],"version":0}', 'validation-failed'],
])('preserves unsupported external Zustand data: %s', async (raw, code) => {
  const storage = require('@react-native-async-storage/async-storage');
  await storage.clear(); await storage.setItem('lifesort-theme', raw);
  const runtime = require('@/core/storage/migrations/runtime');
  const adapter = runtime.migrationGatedStorage(storage);
  await expect(adapter.getItem('lifesort-theme')).rejects.toMatchObject({ code });
  await expect(adapter.setItem('lifesort-theme', 'reset')).rejects.toMatchObject({ code });
  expect(await storage.getItem('lifesort-theme')).toBe(raw);
});

async function readBarrierScenario() {
  const storage = require('@react-native-async-storage/async-storage');
  await storage.clear();
  const runtime = require('@/core/storage/migrations/runtime');
  const a = deferred(); const b = deferred();
  const register = (pending: Promise<void>, fail = false) => runtime.migrationGatedStorage({
    getItem: async () => { await pending; if (fail) throw new Error('private detail'); return null; },
    setItem: jest.fn(), removeItem: jest.fn(),
  }).getItem('lifesort-cycle');
  return { runtime, a, b, register };
}

it('drains late B after A with two waiters and concurrent finalizers, then seals lazy reads out of boot', async () => {
  const { runtime, a, b, register } = await readBarrierScenario();
  const readA = register(a.promise);
  const readyShell = jest.fn(); const authContinuation = jest.fn();
  const waiter1 = runtime.waitForStartupStorage().then(readyShell);
  const waiter2 = runtime.waitForStartupStorage().then(authContinuation);
  const finalizing = runtime.finalizeStartupStorage();
  expect(runtime.finalizeStartupStorage()).toBe(finalizing);
  await flush(); // finalizer is waiting on A
  const readB = register(b.promise);
  a.resolve(); await readA; await flush();
  expect(readyShell).not.toHaveBeenCalled(); expect(authContinuation).not.toHaveBeenCalled();
  b.resolve(); await readB; await Promise.all([finalizing, waiter1, waiter2]);
  expect(readyShell).toHaveBeenCalledTimes(1); expect(authContinuation).toHaveBeenCalledTimes(1);

  const lazy = deferred(); const lazyRead = register(lazy.promise, true);
  const laterAuth = jest.fn();
  await runtime.waitForStartupStorage().then(laterAuth);
  expect(laterAuth).toHaveBeenCalledTimes(1); // no retroactive reopening
  lazy.resolve(); await expect(lazyRead).rejects.toMatchObject({ code: 'read-failed' });
  await expect(runtime.waitForStartupStorage()).resolves.toBeUndefined();
});

it('rejects all startup waiters when late B fails after A succeeds', async () => {
  const { runtime, a, b, register } = await readBarrierScenario();
  const readA = register(a.promise);
  const readyShell = jest.fn(); const authContinuation = jest.fn();
  const startup = runtime.finalizeStartupStorage();
  const shell = startup.then(readyShell); const auth = runtime.waitForStartupStorage().then(authContinuation);
  void shell.catch(() => undefined); void auth.catch(() => undefined);
  await flush();
  const readB = register(b.promise, true);
  void readB.catch(() => undefined);
  a.resolve(); await readA; await flush();
  expect(readyShell).not.toHaveBeenCalled(); expect(authContinuation).not.toHaveBeenCalled();
  b.resolve();
  await expect(readB).rejects.toMatchObject({ code: 'read-failed' });
  await expect(shell).rejects.toMatchObject({ code: 'read-failed' });
  await expect(auth).rejects.toMatchObject({ code: 'read-failed' });
  expect(readyShell).not.toHaveBeenCalled(); expect(authContinuation).not.toHaveBeenCalled();
});
