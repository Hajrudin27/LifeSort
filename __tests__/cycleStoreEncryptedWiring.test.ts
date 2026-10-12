import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * APP-072 - the REAL useCycleStore persists through the REAL encrypted adapter.
 *
 * cycleHealthEncryptedStorage.test.ts proves the adapter in isolation, and other store tests mock it
 * as plain AsyncStorage. Neither would notice if store/useCycleStore.ts were re-wired to plaintext
 * persistence. This one drives the store itself and reads the raw bytes on disk. Only the native
 * crypto and SecureStore modules are the shared test doubles from jest.setup.js.
 */

jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ session: null }) },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null }, error: null }) } },
}));

import { useCycleStore } from '@/store/useCycleStore';

const STORAGE_KEY = 'lifesort-cycle';
const KEY_NAME = 'lifesort-cycle-health-key';
const SENTINEL_DATE = '2031-03-17';
const SENTINEL_END = '2031-03-22';
const SENTINEL_NOTE = 'sentinel-health-note-7f3a9c';

const settle = async () => {
  for (let i = 0; i < 25; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

async function persistedRaw(): Promise<string> {
  await settle();
  return (await AsyncStorage.getItem(STORAGE_KEY)) ?? '';
}

describe('APP-072 useCycleStore -> cycleHealthEncryptedStorage wiring', () => {
  beforeAll(async () => {
    await AsyncStorage.clear();
    await useCycleStore.persist.rehydrate();
  });

  it('writes an authenticated envelope that contains no health value in the clear', async () => {
    useCycleStore.getState().startPeriod(SENTINEL_DATE);
    const id = useCycleStore.getState().cycles[0].id;
    useCycleStore.getState().endPeriod(id, SENTINEL_END);
    useCycleStore.getState().logSymptoms(SENTINEL_DATE, ['cramps'], 'heavy', SENTINEL_NOTE);
    useCycleStore.getState().setAvgCycleLength(33);
    useCycleStore.getState().setReminderEnabled(true);

    const raw = await persistedRaw();

    expect(raw).not.toBe('');
    const envelope = JSON.parse(raw);
    expect(envelope).toMatchObject({
      marker: '__lifesort_encrypted_cycle_store__',
      version: 1,
      algorithm: 'AES-256-GCM',
      ivLength: 12,
      tagLength: 16,
    });
    // The store's own Zustand shape (`state`, `cycles`, field names) is not on disk either.
    expect(Object.keys(envelope).sort()).toEqual(['algorithm', 'ciphertext', 'ivLength', 'marker', 'tagLength', 'version']);
    for (const secret of [SENTINEL_DATE, SENTINEL_END, SENTINEL_NOTE, 'cramps', 'heavy', 'symptomLogs', 'startDate', 'avgCycleLength', 'reminderEnabled']) {
      expect(raw).not.toContain(secret);
    }
    // The ciphertext is not merely the JSON in base64.
    const decodedCiphertext = Buffer.from(envelope.ciphertext, 'base64').toString('latin1');
    expect(decodedCiphertext).not.toContain(SENTINEL_NOTE);
    expect(decodedCiphertext).not.toContain(SENTINEL_DATE);
  });

  it('keeps its key in SecureStore and never beside the data', async () => {
    expect(await SecureStore.getItemAsync(KEY_NAME)).toEqual(expect.any(String));
    const key = (await SecureStore.getItemAsync(KEY_NAME)) as string;
    expect(await persistedRaw()).not.toContain(key);
    expect(await AsyncStorage.getAllKeys()).not.toContain(KEY_NAME);
  });

  it('hydrates the canonical values back through the same store and adapter', async () => {
    const raw = await persistedRaw();
    expect(raw).not.toBe('');

    // Forget memory, then restore exactly the bytes the store wrote.
    useCycleStore.setState({ cycles: [], symptomLogs: [], avgCycleLength: 28, reminderEnabled: false });
    await settle();
    await AsyncStorage.setItem(STORAGE_KEY, raw);
    await useCycleStore.persist.rehydrate();

    const state = useCycleStore.getState();
    expect(state.cycles).toHaveLength(1);
    expect(state.cycles[0]).toMatchObject({ startDate: SENTINEL_DATE, endDate: SENTINEL_END });
    expect(state.symptomLogs).toEqual([
      expect.objectContaining({ date: SENTINEL_DATE, symptoms: ['cramps'], flow: 'heavy', notes: SENTINEL_NOTE }),
    ]);
    expect(state.avgCycleLength).toBe(33);
    expect(state.reminderEnabled).toBe(true);
  });

  it('fails closed on tampered bytes: nothing is hydrated and the ciphertext is not overwritten', async () => {
    const raw = await persistedRaw();
    const tampered = JSON.stringify({ ...JSON.parse(raw), ciphertext: Buffer.from('not the real ciphertext at all').toString('base64') });
    await AsyncStorage.setItem(STORAGE_KEY, tampered);
    useCycleStore.setState({ cycles: [], symptomLogs: [] });
    await settle();
    await AsyncStorage.setItem(STORAGE_KEY, tampered);

    await useCycleStore.persist.rehydrate();
    expect(useCycleStore.getState().cycles).toEqual([]);

    // A later mutation must not replace the protected bytes with defaults.
    useCycleStore.getState().setReminderDaysBefore(5);
    expect(await persistedRaw()).toBe(tampered);
  });
});
