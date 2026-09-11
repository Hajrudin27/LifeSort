import AsyncStorage from '@react-native-async-storage/async-storage';
import { LOCAL_STORE_RESETS } from '@/features/localStores';
import { observeSyncStatus, reportSyncFailure, reportSyncSuccess, trackSync, useSyncStatusStore } from '@/store/useSyncStatusStore';
import { createOutbox } from '@/core/sync/outbox';
import { CLEAR_SYNC_STATUS } from '@/core/sync/syncStatus';
import { sendServerMutation } from '@/core/sync/serverMutations';

jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('@/core/sync/serverMutations', () => ({ sendServerMutation: jest.fn() }));
const input = { dataDomain: 'core.module-choice' as const, entityType: 'module-choice',
  entityId: 'habits', operation: 'upsert' as const, payload: { enabled: true } };
let account: string | null;
let change: () => void;
let stop: () => void;
const unsubscribe = jest.fn();
beforeEach(async () => {
  await AsyncStorage.clear(); account = 'a'; unsubscribe.mockClear();
  stop = observeSyncStatus(() => account, (listener) => { change = listener; return unsubscribe; });
  await createOutbox('a').list();
});
afterEach(() => stop());
it('registered logout reset clears all presentation and preserves unrelated durable data', async () => {
  const entry = await createOutbox('a').enqueue(input);
  await createOutbox('a').list();
  expect(useSyncStatusStore.getState().projection.status).toBe('pending');
  LOCAL_STORE_RESETS.find((entry) => entry.key === 'sync-status')!.reset();
  expect(useSyncStatusStore.getState().projection).toEqual(CLEAR_SYNC_STATUS);
  expect(await createOutbox('a').list()).toEqual([entry]);
});
it('account B cannot receive A status during rehydration', async () => {
  await createOutbox('a').enqueue(input); await createOutbox('a').list();
  account = 'b'; change();
  expect(useSyncStatusStore.getState().projection).toEqual(CLEAR_SYNC_STATUS);
  await createOutbox('b').list();
  expect(useSyncStatusStore.getState().projection).toMatchObject({ status: 'clear', accountId: 'b' });
});
it('legacy persisted metadata is never rehydrated, and new status writes no UI ledger', async () => {
  const legacy = JSON.stringify({ state: { lastSuccessAt: '2026-01-01', failures: { message: 'pregnancy complication' } }, version: 0 });
  await AsyncStorage.setItem('sync-status', legacy);
  stop(); stop = observeSyncStatus(() => account, (listener) => { change = listener; return unsubscribe; });
  await createOutbox('a').enqueue(input); await createOutbox('a').list();
  expect(JSON.stringify(useSyncStatusStore.getState())).not.toMatch(/pregnancy|lastSuccessAt/);
  expect(await AsyncStorage.getItem('sync-status')).toBe(legacy);
});
it('legacy callbacks cannot publish old-account failures or raw diagnostics into B', () => {
  account = 'b'; change();
  const state = useSyncStatusStore.getState().projection;
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    reportSyncFailure('pregnancy complication', 'salary 48,000', new Error('divorce-contract.pdf'));
    reportSyncSuccess('private module');
    expect(trackSync('legacy', 'save', { error: { message: 'private SQL' } })).toBe(false);
    expect(trackSync('legacy', 'save', { error: null })).toBe(true);
    expect(useSyncStatusStore.getState().projection).toEqual(state);
    expect(warn).not.toHaveBeenCalled();
  } finally { warn.mockRestore(); }
});
it('unsubscribe drops the observer and presentation', () => {
  stop(); expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(useSyncStatusStore.getState().projection).toEqual(CLEAR_SYNC_STATUS);
});
it('late retry completion cannot write after the registered reset', async () => {
  const entry = await createOutbox('a').enqueue(input);
  let complete!: (value: unknown) => void;
  (sendServerMutation as jest.Mock).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  const running = useSyncStatusStore.getState().retry('a', entry.mutationId);
  await createOutbox('a').list(); await createOutbox('a').list();
  LOCAL_STORE_RESETS.find((entry) => entry.key === 'sync-status')!.reset();
  account = 'b'; change(); await createOutbox('b').list();
  complete({ ok: false, reason: 'conflict' }); await running;
  expect(useSyncStatusStore.getState().projection).toMatchObject({ accountId: 'b', status: 'clear' });
});
