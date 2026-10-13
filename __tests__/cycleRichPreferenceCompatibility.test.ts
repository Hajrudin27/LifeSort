import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import fs from 'fs';
import path from 'path';

jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ session: null }) },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null }, error: null }) } },
}));

import { useCycleStore } from '@/store/useCycleStore';

const STORAGE_KEY = 'lifesort-cycle';
const KEY_NAME = 'lifesort-cycle-health-key';
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/local-migrations/cycle/94f39eb-plaintext-v0.json'), 'utf8');

const settle = async () => {
  for (let i = 0; i < 30; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

describe('APP-073 retained Cycle v0 storage compatibility', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await SecureStore.deleteItemAsync(KEY_NAME);
    // This is the new store's initial privacy-safe value at ordinary startup.
    useCycleStore.setState({ richNotificationCopyEnabled: false });
  });

  it('hydrates the retained real v0 payload with the missing consent field safely false, without changing the envelope version', async () => {
    expect(JSON.parse(fixture).state).not.toHaveProperty('richNotificationCopyEnabled');
    await AsyncStorage.setItem(STORAGE_KEY, fixture);
    await useCycleStore.persist.rehydrate();
    await settle();

    expect(useCycleStore.getState().richNotificationCopyEnabled).toBe(false);
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!).version).toBe(1);
    expect(raw).not.toContain('richNotificationCopyEnabled');
  });

  it('keeps an explicit local opt-in across a same-device restart, encrypted, and clears it with the account', async () => {
    useCycleStore.getState().setRichNotificationCopyEnabled(true);
    await settle();
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('richNotificationCopyEnabled');

    // A restart: in-memory state is gone, the encrypted disk copy is read back.
    useCycleStore.setState({ richNotificationCopyEnabled: false });
    await useCycleStore.persist.rehydrate();
    await settle();
    expect(useCycleStore.getState().richNotificationCopyEnabled).toBe(true);

    // Logout / account switch: the existing lifecycle resets memory and the persisted copy.
    useCycleStore.getState().clearLocal();
    await settle();
    useCycleStore.setState({ richNotificationCopyEnabled: true });
    await useCycleStore.persist.rehydrate();
    await settle();
    expect(useCycleStore.getState().richNotificationCopyEnabled).toBe(false);
  });
});

describe('APP-073 rich lock-screen consent has no server surface', () => {
  const root = path.join(__dirname, '..');
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx|js|sql|json)$/.test(entry.name) ? [full] : [];
  });

  it('is never named in production code, migrations or edge functions', () => {
    const roots = ['app', 'components', 'core', 'lib', 'store', 'types', 'utils', 'hooks', 'services', 'supabase']
      .map((name) => path.join(root, name)).filter((dir) => fs.existsSync(dir));
    const offenders = roots.flatMap(walk).filter((file) => /rich_notification_copy/i.test(fs.readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('adds no APP-073 migration or DB harness', () => {
    expect(fs.readdirSync(path.join(root, 'supabase/migrations')).filter((name) => /app073/i.test(name))).toEqual([]);
    expect(fs.existsSync(path.join(root, 'tests/db/app073.test.cjs'))).toBe(false);
  });

  it('keeps the setter and the store free of any cycle_settings write for the preference', () => {
    const source = fs.readFileSync(path.join(root, 'store/useCycleStore.ts'), 'utf8');
    const setter = source.slice(source.indexOf('setRichNotificationCopyEnabled: (enabled)'), source.indexOf('fetchFromSupabase: async'));
    expect(setter).not.toMatch(/syncCycleSettings|supabase/);
  });
});
