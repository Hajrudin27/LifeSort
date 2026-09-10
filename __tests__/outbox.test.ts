import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

import * as ids from '@/core/ids';
import { createOutbox, OUTBOX_STORAGE_KEY, withOutboxCleanup } from '@/core/sync/outbox';
import type { DataDomainId } from '@/core/storage/dataProfileRegistry';
import { userDataKeys } from '@/core/storage/localDataScopes';

const input = { dataDomain: 'tasks.todos' as const, entityType: 'todo', entityId: 'legacy-todo', operation: 'upsert' as const, payload: { completed: true } };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await withOutboxCleanup(async () => { await AsyncStorage.clear(); });
});

it('persists cryptographic identity, payload and required metadata before enqueue resolves', async () => {
  const mint = jest.spyOn(ids, 'newEntityId');
  const entry = await createOutbox('account-a').enqueue({ ...input, baseRevision: 4 });
  expect(mint).toHaveBeenCalledTimes(1);
  expect(randomUUID).toHaveBeenCalledTimes(1);
  expect(entry.mutationId).toBe((randomUUID as jest.Mock).mock.results[0].value);
  expect(entry.mutationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(entry).toEqual({ ...input, baseRevision: 4, mutationId: expect.any(String), createdAt: expect.any(String), status: 'pending', attempts: 0 });
  expect(Number.isFinite(Date.parse(entry.createdAt))).toBe(true);
  expect(JSON.parse((await AsyncStorage.getItem(OUTBOX_STORAGE_KEY))!)).toEqual({
    version: 1, state: { accountId: 'account-a', mutations: [entry] },
  });
});

it('propagates crypto failure without writing or falling back', async () => {
  (randomUUID as jest.Mock).mockImplementationOnce(() => { throw new Error('crypto unavailable'); });
  await expect(createOutbox('account-a').enqueue(input)).rejects.toThrow('crypto unavailable');
  expect(await AsyncStorage.getItem(OUTBOX_STORAGE_KEY)).toBeNull();
});

it('rehydrates metadata changes and clearing nextRetryAt', async () => {
  const outbox = createOutbox('account-a');
  const entry = await outbox.enqueue(input);
  const update = { attempts: 3, status: 'failed' as const, nextRetryAt: '2026-09-11T12:00:00.000Z' };
  await expect(outbox.updateMetadata(entry.mutationId, update)).resolves.toBe(true);
  expect(await createOutbox('account-a').list()).toEqual([{ ...entry, ...update }]);
  expect(JSON.parse((await AsyncStorage.getItem(OUTBOX_STORAGE_KEY))!).state.mutations[0]).toEqual({ ...entry, ...update });
  await outbox.updateMetadata(entry.mutationId, { status: 'pending', nextRetryAt: null });
  expect(await createOutbox('account-a').list()).toEqual([{ ...entry, attempts: 3 }]);
});

it('survives a fresh module with only the persisted bytes retained', async () => {
  const original = createOutbox('account-a');
  const entry = await original.enqueue(input);
  const bytes = await AsyncStorage.getItem(OUTBOX_STORAGE_KEY);
  jest.resetModules();
  const restartedStorage = require('@react-native-async-storage/async-storage');
  await restartedStorage.clear();
  await restartedStorage.setItem(OUTBOX_STORAGE_KEY, bytes);
  const restarted = require('@/core/sync/outbox').createOutbox('account-a');
  expect(await restarted.list()).toEqual([entry]);
  await restarted.acknowledge(entry.mutationId);
  const remainingBytes = await restartedStorage.getItem(OUTBOX_STORAGE_KEY);
  jest.resetModules();
  const secondStorage = require('@react-native-async-storage/async-storage');
  await secondStorage.clear();
  await secondStorage.setItem(OUTBOX_STORAGE_KEY, remainingBytes);
  expect(await require('@/core/sync/outbox').createOutbox('account-a').list()).toEqual([]);
});

it('keeps simultaneous mutations for the same entity distinct and ordered across handles', async () => {
  const first = createOutbox('account-a');
  const second = createOutbox('account-a');
  const entries = await Promise.all([
    first.enqueue(input),
    second.enqueue({ ...input, operation: 'delete', payload: undefined }),
    first.enqueue(input),
  ]);
  expect(new Set(entries.map((entry) => entry.mutationId)).size).toBe(3);
  expect(await createOutbox('account-a').list()).toEqual(entries);
  await Promise.all([
    first.acknowledge(entries[1].mutationId),
    second.updateMetadata(entries[0].mutationId, { attempts: 1 }),
  ]);
  expect(await createOutbox('account-a').list()).toEqual([{ ...entries[0], attempts: 1 }, entries[2]]);
  await expect(first.acknowledge('missing')).resolves.toBe(false);
  await expect(first.updateMetadata('missing', { attempts: 1 })).resolves.toBe(false);
});

it('persists distinct concrete entity types within the same household data domain', async () => {
  const outbox = createOutbox('account-a');
  const entries = await Promise.all(['household.task', 'household.shopping-item'].map((entityType) =>
    outbox.enqueue({ dataDomain: 'home.household', entityType, entityId: 'shared-id', operation: 'delete' }),
  ));
  // Same domain, entity ID and operation, with no payload from which to infer a kind.
  const stored = JSON.parse((await AsyncStorage.getItem(OUTBOX_STORAGE_KEY))!);
  expect(stored.state.mutations).toEqual(entries);
  expect(stored.state.mutations.map(({ dataDomain, entityType }: { dataDomain: string; entityType: string }) =>
    ({ dataDomain, entityType }),
  )).toEqual([
    { dataDomain: 'home.household', entityType: 'household.task' },
    { dataDomain: 'home.household', entityType: 'household.shopping-item' },
  ]);
  expect(await createOutbox('account-a').list()).toEqual(entries);
});

it('waits for a delayed write and snapshots caller-owned input', async () => {
  const entered = deferred();
  const release = deferred();
  const setItem = AsyncStorage.setItem;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    entered.resolve();
    await release.promise;
    return setItem(key, value);
  });
  const supplied = { ...input, payload: { completed: true } };
  let settled = false;
  const pending = createOutbox('account-a').enqueue(supplied).then((entry) => { settled = true; return entry; });
  supplied.payload.completed = false;
  await entered.promise;
  expect(settled).toBe(false);
  release.resolve();
  const entry = await pending;
  entry.payload!.completed = false;
  const listed = await createOutbox('account-a').list();
  expect(listed[0].payload).toEqual({ completed: true });
  listed.length = 0;
  expect(await createOutbox('account-a').list()).toHaveLength(1);
});

it('rejects failed writes without losing previous entries or poisoning later operations', async () => {
  const outbox = createOutbox('account-a');
  const entry = await outbox.enqueue(input);
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await expect(outbox.enqueue(input)).rejects.toThrow('disk full');
  expect(await createOutbox('account-a').list()).toEqual([entry]);
  await outbox.enqueue(input);
  expect(await createOutbox('account-a').list()).toHaveLength(2);
});

it('does not acknowledge or change metadata durably if its write fails', async () => {
  const outbox = createOutbox('account-a');
  const entry = await outbox.enqueue(input);
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await expect(outbox.acknowledge(entry.mutationId)).rejects.toThrow();
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await expect(outbox.updateMetadata(entry.mutationId, { attempts: 9 })).rejects.toThrow();
  expect(await createOutbox('account-a').list()).toEqual([entry]);
});

it.each(['cycle.user-health', 'economy.attachments', 'travel.attachments', 'account.auth-session', 'cycle.reference-content', 'unknown', 'economy.expenses', 'travel.trips', 'core.outbox'])(
  'rejects unsupported or sensitive domain %s before persistence', async (dataDomain) => {
    await expect(createOutbox('account-a').enqueue({ ...input, dataDomain: dataDomain as DataDomainId })).rejects.toThrow();
    expect(await AsyncStorage.getItem(OUTBOX_STORAGE_KEY)).toBeNull();
  },
);

it.each([
  ['dataDomain', undefined], ['dataDomain', null], ['dataDomain', 42],
  ['entityType', undefined], ['entityType', null], ['entityType', 42],
  ['entityType', ''], ['entityType', ' \t '],
] as const)('rejects invalid %s on enqueue and rehydration (%#)', async (field, value) => {
  const outbox = createOutbox('account-a');
  const entry = await outbox.enqueue(input);
  await expect(outbox.enqueue({ ...input, [field]: value } as never)).rejects.toThrow();
  expect(await outbox.list()).toEqual([entry]);
  const raw = JSON.stringify({ version: 1, state: {
    accountId: 'account-a', mutations: [{ ...entry, [field]: value }],
  } });
  await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, raw);
  await expect(createOutbox('account-a').list()).rejects.toThrow();
  expect(await AsyncStorage.getItem(OUTBOX_STORAGE_KEY)).toBe(raw);
});

it.each([
  { attempts: -1 }, { attempts: 1.5 }, { nextRetryAt: 'bad date' }, { status: 'unknown' },
])('rejects invalid processing metadata without overwriting storage: %j', async (patch) => {
  const outbox = createOutbox('account-a');
  const entry = await outbox.enqueue(input);
  // Deliberately bypass static typing to exercise the runtime persistence boundary.
  await expect(outbox.updateMetadata(entry.mutationId, patch as never)).rejects.toThrow();
  expect(await createOutbox('account-a').list()).toEqual([entry]);
});

it('rejects lossy or cyclic payloads and an upsert without a payload', async () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const outbox = createOutbox('account-a');
  for (const payload of [undefined, { missing: undefined }, { value: NaN }, new Date(), cycle]) {
    await expect(outbox.enqueue({ ...input, payload } as never)).rejects.toThrow();
  }
  expect(await AsyncStorage.getItem(OUTBOX_STORAGE_KEY)).toBeNull();
});

it.each(['invalid json', '{"version":2,"state":{}}', '{"version":1,"state":{"accountId":"account-a","mutations":[{}]}}'])(
  'fails closed on unreadable storage without overwriting it (%#)', async (raw) => {
    await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, raw);
    await expect(createOutbox('account-a').list()).rejects.toThrow();
    await expect(createOutbox('account-a').enqueue(input)).rejects.toThrow();
    expect(await AsyncStorage.getItem(OUTBOX_STORAGE_KEY)).toBe(raw);
  },
);

it('does not hide a read failure as an empty queue', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('unavailable'));
  await expect(createOutbox('account-a').list()).rejects.toThrow('Outbox storage could not be read.');
});

it('isolates accounts and revokes old handles across cleanup', async () => {
  const old = createOutbox('account-a');
  await old.enqueue(input);
  expect(await createOutbox('account-b').list()).toEqual([]);
  await expect(createOutbox('account-b').enqueue(input)).rejects.toThrow(/cleanup/);
  expect(userDataKeys([OUTBOX_STORAGE_KEY])).toEqual([OUTBOX_STORAGE_KEY]);
  await withOutboxCleanup(async () => undefined);
  await expect(old.list()).rejects.toThrow(/unavailable/);
  await expect(old.enqueue(input)).rejects.toThrow(/unavailable/);
  expect(await AsyncStorage.getItem(OUTBOX_STORAGE_KEY)).toBeNull();
  expect(await createOutbox('account-b').list()).toEqual([]);
  await createOutbox('account-b').enqueue(input);
  expect(await createOutbox('account-b').list()).toHaveLength(1);
});

it('drains a delayed write before cleanup and rejects stale queued operations', async () => {
  const entered = deferred();
  const release = deferred();
  const setItem = AsyncStorage.setItem;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    entered.resolve();
    await release.promise;
    return setItem(key, value);
  });
  const old = createOutbox('account-a');
  const write = old.enqueue(input);
  const rejectedWrite = expect(write).rejects.toThrow(/unavailable/);
  await entered.promise;
  const staleRead = expect(old.list()).rejects.toThrow(/unavailable/);
  const cleanup = withOutboxCleanup(async () => {
    expect(await AsyncStorage.getItem(OUTBOX_STORAGE_KEY)).toBeNull();
  });
  expect(() => createOutbox('account-b')).toThrow(/unavailable/);
  release.resolve();
  await Promise.all([rejectedWrite, staleRead, cleanup]);
  expect(await createOutbox('account-b').list()).toEqual([]);
});

it('runs the rest of cleanup and keeps owner isolation if removal fails', async () => {
  const old = createOutbox('account-a');
  await old.enqueue(input);
  jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('disk failure'));
  const cleanup = jest.fn(async () => undefined);
  await expect(withOutboxCleanup(cleanup)).rejects.toThrow(/could not be cleared/);
  expect(cleanup).toHaveBeenCalledTimes(1);
  await expect(old.list()).rejects.toThrow(/unavailable/);
  expect(await createOutbox('account-b').list()).toEqual([]);
  await expect(createOutbox('account-b').enqueue(input)).rejects.toThrow(/cleanup/);
});
