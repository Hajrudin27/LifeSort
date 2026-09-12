import AsyncStorage from '@react-native-async-storage/async-storage';
import { createManualSyncStatus } from '@/core/sync/manualSyncStatus';
import { claimMutation, isMutationClaimed, releaseAllMutationClaims, releaseMutation } from '@/core/sync/mutationClaims';
import { createOutbox, OUTBOX_STORAGE_KEY, withOutboxCleanup } from '@/core/sync/outbox';
import { CLEAR_SYNC_STATUS, type SyncStatusProjection } from '@/core/sync/syncStatus';
import type { ServerMutationResult } from '@/core/sync/serverMutations';

const input = { dataDomain: 'core.module-choice' as const, entityType: 'module-choice',
  entityId: 'habits', operation: 'upsert' as const, payload: { enabled: true } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}
let account: string | null;
let latest: SyncStatusProjection;
let observer: ReturnType<typeof createManualSyncStatus>;
let send: jest.Mock;
beforeEach(async () => {
  await AsyncStorage.clear();
  releaseAllMutationClaims();
  account = 'a'; latest = CLEAR_SYNC_STATUS;
  send = jest.fn().mockResolvedValue({ ok: true, status: 'applied' });
  observer = createManualSyncStatus(() => account, (p) => { latest = p; }, send);
  observer.setAccount(account);
  await observer.refresh();
});
afterEach(() => { observer.dispose(); });

it('defends a direct newer-ID retry using the durable entity head, then sends the older head', async () => {
  const outbox = createOutbox('a');
  const older = await outbox.enqueue({ ...input, payload: { enabled: false } });
  const newer = await outbox.enqueue(input);
  await observer.retry('a', newer.mutationId);
  expect(send).not.toHaveBeenCalled();
  expect(await outbox.list()).toEqual([older, newer]);
  expect(latest).toMatchObject({ status: 'pending', retryMutationId: older.mutationId });
  await observer.retry('a', older.mutationId);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][1]).toEqual(older);
  expect(await outbox.list()).toEqual([newer]);
});

it.each([true, false])('a failed head blocks newer intent; transient=%s allows explicit early retry', async (transient) => {
  const outbox = createOutbox('a');
  const older = await outbox.enqueue(input);
  const newer = await outbox.enqueue(input);
  const other = await outbox.enqueue({ ...input, entityId: 'food' });
  await outbox.updateMetadata(older.mutationId, { status: 'failed', attempts: 1,
    ...(transient ? { nextRetryAt: '2099-01-01T00:00:00Z' } : {}) });
  await observer.retry('a', newer.mutationId);
  expect(send).not.toHaveBeenCalled();
  await observer.retry('a', older.mutationId);
  expect(send).toHaveBeenCalledTimes(transient ? 1 : 0);
  await observer.retry('a', other.mutationId);
  expect(send).toHaveBeenCalledTimes(transient ? 2 : 1);
  expect(send.mock.calls.at(-1)[1].mutationId).toBe(other.mutationId);
});

it('observes durable enqueue/acknowledge events without sending work', async () => {
  const outbox = createOutbox('a');
  const entry = await outbox.enqueue(input);
  await outbox.list(); // drains serialized local reads triggered by the event
  expect(latest).toMatchObject({ status: 'pending', count: 1 });
  expect(send).not.toHaveBeenCalled();
  await outbox.acknowledge(entry.mutationId);
  await outbox.list();
  expect(latest.status).toBe('clear');
});
it.each(['applied', 'replayed'])('%s response sends once and acknowledges the exact durable ID', async (status) => {
  const outbox = createOutbox('a');
  const entry = await outbox.enqueue(input);
  send.mockResolvedValue({ ok: true, status });
  await observer.retry('a', entry.mutationId);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0].slice(0, 2)).toEqual(['a', entry]);
  expect(await outbox.list()).toEqual([]);
  expect(latest.status).toBe('clear');
});
it('duplicate rapid taps, including a different mutation, cannot create parallel sends', async () => {
  const entry = await createOutbox('a').enqueue(input);
  const second = await createOutbox('a').enqueue(input);
  const result = deferred<ServerMutationResult>();
  send.mockReturnValue(result.promise);
  const first = observer.retry('a', entry.mutationId);
  const duplicate = observer.retry('a', entry.mutationId);
  const other = observer.retry('a', second.mutationId);
  await createOutbox('a').list();
  await createOutbox('a').list();
  expect(latest).toMatchObject({ status: 'retrying', retrying: true });
  result.resolve({ ok: true, status: 'applied' });
  await Promise.all([first, duplicate, other]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(await createOutbox('a').list()).toHaveLength(1);
});
it('transient failure stays durable and requires another explicit action, with no timers', async () => {
  const entry = await createOutbox('a').enqueue(input);
  jest.useFakeTimers();
  try {
    const timers = jest.getTimerCount();
    send.mockResolvedValue({ ok: false, reason: 'unavailable', message: 'salary 48,000' });
    await observer.retry('a', entry.mutationId);
    // One completed unacknowledged send, and the timestamp APP-037 waits for.
    expect(await createOutbox('a').list()).toEqual([{
      ...entry, attempts: 1, status: 'failed', nextRetryAt: expect.any(String),
    }]);
    expect(latest).toMatchObject({ status: 'failed', errorCode: 'unavailable' });
    expect(JSON.stringify(latest)).not.toContain('salary');
    expect(jest.getTimerCount()).toBe(timers);
    jest.advanceTimersByTime(86400000);
    await observer.refresh();
    expect(send).toHaveBeenCalledTimes(1);
    send.mockResolvedValue({ ok: true, status: 'replayed' });
    await observer.retry('a', entry.mutationId);
    expect(send).toHaveBeenCalledTimes(2);
    expect(latest.status).toBe('clear');
  } finally { jest.useRealTimers(); }
});
it.each(['conflict', 'validation', 'authorization'])('%s retains durable work and refuses subsequent blind retry', async (reason) => {
  const entry = await createOutbox('a').enqueue(input);
  send.mockResolvedValue({ ok: false, reason });
  await observer.retry('a', entry.mutationId);
  expect(latest).toMatchObject({ status: 'needs-attention', retryMutationId: null });
  await observer.retry('a', entry.mutationId);
  expect(send).toHaveBeenCalledTimes(1);
  // No nextRetryAt: neither a tap nor a timer may pick this up again by itself.
  expect(await createOutbox('a').list()).toEqual([{ ...entry, status: 'failed', attempts: 1 }]);
});
it('unsupported mutation fails closed before any send or attempt increment', async () => {
  const entry = await createOutbox('a').enqueue({ ...input, entityType: 'unsupported' });
  await observer.retry('a', entry.mutationId);
  expect(send).not.toHaveBeenCalled();
  expect(latest.status).toBe('needs-attention');
  expect(await createOutbox('a').list()).toEqual([entry]);
});
it.each(['b', null])('wrong/non-active account cannot retry (%s)', async (current) => {
  const entry = await createOutbox('a').enqueue(input);
  account = current;
  observer.setAccount(current);
  await observer.retry('a', entry.mutationId);
  await observer.retry('b', entry.mutationId);
  expect(send).not.toHaveBeenCalled();
  expect(await createOutbox('a').list()).toEqual([entry]);
});
it.each([{ ok: true, status: 'applied' }, { ok: false, reason: 'conflict' }])('late A completion cannot publish into B (%#)', async (response) => {
  const entry = await createOutbox('a').enqueue(input);
  const result = deferred<ServerMutationResult>();
  send.mockReturnValue(result.promise);
  const running = observer.retry('a', entry.mutationId);
  await createOutbox('a').list(); await createOutbox('a').list();
  account = 'b'; observer.setAccount(account);
  await observer.refresh();
  const b = latest;
  result.resolve(response as ServerMutationResult);
  await running;
  expect(latest).toEqual(b);
  expect(latest).toMatchObject({ accountId: 'b', status: 'clear' });
  expect(await createOutbox('a').list()).toHaveLength(1);
});
it('same-account logout/relogin invalidates the old generation', async () => {
  const entry = await createOutbox('a').enqueue(input);
  const result = deferred<ServerMutationResult>(); send.mockReturnValue(result.promise);
  const running = observer.retry('a', entry.mutationId);
  await createOutbox('a').list(); await createOutbox('a').list();
  account = null; observer.setAccount(null);
  account = 'a'; observer.setAccount(account);
  await observer.refresh();
  result.resolve({ ok: true, status: 'applied' }); await running;
  expect(await createOutbox('a').list()).toHaveLength(1);
  expect(latest.status).toBe('pending');
});
it('outbox cleanup clears presentation synchronously and revokes an in-flight attempt', async () => {
  const entry = await createOutbox('a').enqueue(input);
  const result = deferred<ServerMutationResult>(); send.mockReturnValue(result.promise);
  const running = observer.retry('a', entry.mutationId);
  await createOutbox('a').list(); await createOutbox('a').list();
  const cleanup = withOutboxCleanup(async () => {});
  expect(latest).toEqual(CLEAR_SYNC_STATUS);
  await cleanup;
  result.resolve({ ok: false, reason: 'unavailable' }); await running;
  expect(latest).toEqual(CLEAR_SYNC_STATUS);
  expect(await AsyncStorage.getItem(OUTBOX_STORAGE_KEY)).toBeNull();
});
it.each([
  ['transient', 'unavailable', 'failed', 2],
  // A permanent rejection leaves no retry timestamp, so a restart still refuses
  // to send it blindly — the fail-closed half of the rule is unchanged.
  ['permanent', 'conflict', 'needs-attention', 1],
])('restart rederives a %s failure from durable metadata alone', async (_label, reason, status, sends) => {
  const entry = await createOutbox('a').enqueue(input);
  send.mockResolvedValue({ ok: false, reason });
  await observer.retry('a', entry.mutationId);
  const disk = await AsyncStorage.getItem(OUTBOX_STORAGE_KEY);
  observer.dispose();
  observer = createManualSyncStatus(() => account, (p) => { latest = p; }, send);
  observer.setAccount('a'); await observer.refresh();
  expect(latest.status).toBe(status);
  expect(JSON.parse(disk!).version).toBe(1);
  // Only a scheduling timestamp is persisted — never a reason, message or code.
  expect(JSON.stringify(JSON.parse(disk!))).not.toMatch(/errorCode|unavailable|conflict|retrying/);
  await observer.retry('a', entry.mutationId);
  expect(send).toHaveBeenCalledTimes(sends);
});

it('shares one claim with the automatic worker, in both directions', async () => {
  const entry = await createOutbox('a').enqueue(input);
  expect(claimMutation('a', entry.mutationId)).toBe(true);

  // The worker owns this send; the tap must not become a second request.
  await observer.retry('a', entry.mutationId);
  expect(send).not.toHaveBeenCalled();
  expect(await createOutbox('a').list()).toEqual([entry]);

  releaseMutation('a', entry.mutationId);
  await observer.retry('a', entry.mutationId);
  expect(send).toHaveBeenCalledTimes(1);
  // And the tap gives the claim back, however it ended.
  expect(isMutationClaimed('a', entry.mutationId)).toBe(false);
});

it('records exactly one durable attempt when the sender itself throws', async () => {
  const entry = await createOutbox('a').enqueue(input);
  send.mockRejectedValue(new Error('file:///private/health.pdf salary 48,000'));
  const before = Date.now();
  await observer.retry('a', entry.mutationId);
  const after = Date.now();

  // The request happened and was not acknowledged, so it counts — once — and
  // leaves the timestamp the automatic coordinator schedules from. Without it
  // the coordinator, which schedules nothing for work someone else claimed,
  // would leave this mutation sitting here.
  const [stored] = await createOutbox('a').list();
  expect(stored).toMatchObject({ ...entry, status: 'failed', attempts: 1 });
  expect(Date.parse(stored.nextRetryAt!)).toBeGreaterThanOrEqual(before + 2_500);
  expect(Date.parse(stored.nextRetryAt!)).toBeLessThanOrEqual(after + 5_000);
  expect(isMutationClaimed('a', entry.mutationId)).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);

  // Nothing of the thrown error reaches disk or the screen.
  expect(JSON.stringify(await AsyncStorage.getItem(OUTBOX_STORAGE_KEY))).not.toMatch(/private|health|salary|Error/);
  expect(JSON.stringify(latest)).not.toMatch(/private|health|salary/);
  expect(latest).toMatchObject({ status: 'failed', errorCode: 'unavailable' });
});

it('does not count an attempt for a failure before anything was sent', async () => {
  const entry = await createOutbox('a').enqueue(input);
  await createOutbox('a').list();
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('file:///private/health.pdf'));

  await observer.retry('a', entry.mutationId);

  // The durable lookup never reached the network, so the queue is untouched.
  expect(send).not.toHaveBeenCalled();
  expect(await createOutbox('a').list()).toEqual([entry]);
  expect(isMutationClaimed('a', entry.mutationId)).toBe(false);
  expect(latest).toMatchObject({ status: 'needs-attention', errorCode: 'unknown' });
  expect(JSON.stringify(latest)).not.toMatch(/private|health/);
});

it('a successful send whose acknowledgement fails is not a second attempt', async () => {
  const entry = await createOutbox('a').enqueue(input);
  send.mockImplementation(async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('file:///private/disk'));
    return { ok: true, status: 'applied' };
  });

  await observer.retry('a', entry.mutationId);
  // The server accepted it; only the local bookkeeping failed.
  expect(await createOutbox('a').list()).toEqual([entry]);
  expect(latest).toMatchObject({ status: 'needs-attention' });
});
it('malformed durable storage is generic needs-attention; no raw storage error leaks', async () => {
  await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, 'pregnancy complication /private/path');
  await observer.refresh();
  expect(latest).toMatchObject({ status: 'needs-attention', errorCode: 'unknown', retryMutationId: null });
  expect(JSON.stringify(latest)).not.toMatch(/pregnancy|private/);
});
it('failed acknowledgement never silently clears the durable mutation', async () => {
  const entry = await createOutbox('a').enqueue(input);
  send.mockImplementation(async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('file:///private/health.pdf'));
    return { ok: true, status: 'applied' };
  });
  await observer.retry('a', entry.mutationId);
  expect(await createOutbox('a').list()).toHaveLength(1);
  expect(latest).toMatchObject({ status: 'needs-attention', retryMutationId: null });
});
