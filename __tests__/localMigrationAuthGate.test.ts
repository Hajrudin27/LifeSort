jest.unmock('@/lib/supabase');
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({})) }));
jest.mock('@/utils/auth/secureSessionStorage', () => ({ secureSessionStorage: {
  getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn(),
} }));

it('APP-038 delays the actual Supabase configuration session read until specialized hydration finishes', async () => {
  const storage = require('@react-native-async-storage/async-storage');
  await storage.clear();
  const runtime = require('@/core/storage/migrations/runtime');
  let release!: () => void;
  const pending = new Promise<void>((done) => { release = done; });
  const read = runtime.migrationGatedStorage({
    getItem: async () => { await pending; return null; }, setItem: jest.fn(), removeItem: jest.fn(),
  }).getItem('lifesort-cycle');
  require('@/lib/supabase');
  const createClient = require('@supabase/supabase-js').createClient;
  const adapter = createClient.mock.calls[0][2].auth.storage;
  const secureRead = require('@/utils/auth/secureSessionStorage').secureSessionStorage.getItem;
  const refreshNetwork = jest.fn();
  const initialization = adapter.getItem('synthetic-session-key').then(refreshNetwork);
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(secureRead).not.toHaveBeenCalled(); expect(refreshNetwork).not.toHaveBeenCalled();
  release(); await read; await runtime.finalizeStartupStorage(); await initialization;
  expect(secureRead).toHaveBeenCalledTimes(1); expect(refreshNetwork).toHaveBeenCalledTimes(1);
});


it('eager auth first cannot finalize registration before later import-time reads', async () => {
  jest.resetModules();
  const storage = require('@react-native-async-storage/async-storage');
  await storage.clear();
  const runtime = require('@/core/storage/migrations/runtime');
  require('@/lib/supabase');
  const createClient = require('@supabase/supabase-js').createClient;
  const adapter = createClient.mock.calls[0][2].auth.storage;
  const secureRead = require('@/utils/auth/secureSessionStorage').secureSessionStorage.getItem;
  const refreshNetwork = jest.fn();
  const auth = adapter.getItem('synthetic-session-key').then(refreshNetwork);
  await runtime.ensureLocalMigrations();
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(secureRead).not.toHaveBeenCalled();
  expect(refreshNetwork).not.toHaveBeenCalled();

  let release!: () => void;
  const pending = new Promise<void>((done) => { release = done; });
  const lateImport = runtime.migrationGatedStorage({
    getItem: async () => { await pending; return null; }, setItem: jest.fn(), removeItem: jest.fn(),
  }).getItem('lifesort-cycle');
  const rootStartup = runtime.finalizeStartupStorage();
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(secureRead).not.toHaveBeenCalled(); expect(refreshNetwork).not.toHaveBeenCalled();
  release(); await lateImport; await rootStartup; await auth;
  expect(secureRead).toHaveBeenCalledTimes(1); expect(refreshNetwork).toHaveBeenCalledTimes(1);
});
