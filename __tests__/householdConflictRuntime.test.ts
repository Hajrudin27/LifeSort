import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ConnectivityState } from '@/core/sync/connectivity';
import { releaseAllMutationClaims } from '@/core/sync/mutationClaims';
import { createOutbox, withOutboxCleanup, type OutboxMutation } from '@/core/sync/outbox';
import { createSyncCoordinator } from '@/core/sync/syncCoordinator';
import type { HouseholdTask } from '@/types/household';
import { calendarDateForTask } from '@/utils/household/householdTaskSchedule';

/**
 * APP-061 C5: a refused (409) Home-task mutation reaches reconciliation through the
 * real coordinator → permanent-failure hook → authoritative read → outbox supersede
 * path. The in-memory server mirrors the reviewed SQL rules: receipts, revision CAS,
 * immutable tombstones and the same-day completion no-op.
 */

type Row = { task: HouseholdTask; revision: number; updatedAt: string; deletedAt: string | null };
type Call = { user: string; mutationId: string; payload: unknown; base: number | null; operation: string };
const mockServer = { rows: new Map<string, Row>(), receipts: new Map<string, string>(), calls: [] as Call[] };
let mockAccount: string | null = null;
let mockReadGate: Promise<void> | null = null;
let mockUnavailable = false;
let mockReads = 0;

function mockApply(authorization: string, args: Record<string, unknown>) {
  const user = authorization.replace('Bearer token-', '');
  if (mockUnavailable) return { data: null, error: { code: 'PT503', message: 'busy' }, status: 503 };
  const base = (args.p_base_revision ?? null) as number | null;
  const payload = args.p_payload as { action?: string; completedOn?: string; task?: HouseholdTask } | null;
  mockServer.calls.push({ user, mutationId: String(args.p_mutation_id), payload, base, operation: String(args.p_operation) });
  const receipt = `${user}:${args.p_mutation_id}`;
  const fingerprint = JSON.stringify([args.p_entity_id, args.p_operation, payload, base]);
  const fail = (code: string, status: number) => ({ data: null, error: { code, message: 'refused' }, status });
  if (mockServer.receipts.has(receipt)) {
    return mockServer.receipts.get(receipt) === fingerprint ? { data: 'replayed', error: null, status: 200 } : fail('PT409', 409);
  }
  const ok = () => { mockServer.receipts.set(receipt, fingerprint); return { data: 'applied', error: null, status: 200 }; };
  const key = `${user}:${args.p_entity_id}`;
  const row = mockServer.rows.get(key);
  const bump = (target: Row) => {
    target.revision += 1;
    target.updatedAt = new Date(Date.parse(target.updatedAt) + 1000).toISOString();
  };
  if (args.p_operation === 'delete') {
    if (!row) return fail('PT422', 422);
    if (row.deletedAt) return ok();
    if (base !== row.revision) return fail('PT409', 409);
    bump(row);
    row.deletedAt = row.updatedAt;
    return ok();
  }
  if (payload?.action === 'create') {
    if (row) return fail('PT409', 409);
    mockServer.rows.set(key, { task: { ...payload.task! }, revision: 1, updatedAt: '2026-10-07T10:00:00.000Z', deletedAt: null });
    return ok();
  }
  if (!row) return fail('PT422', 422);
  if (row.deletedAt) return fail('PT409', 409);
  if (payload?.action === 'complete') {
    if (row.task.lastDone === payload.completedOn) return ok();
    if (base !== row.revision) return fail('PT409', 409);
    row.task = { ...row.task, lastDone: payload.completedOn,
      assignedTo: row.task.rotates ? (row.task.assignedTo === 'me' ? 'partner' : 'me') : row.task.assignedTo };
    bump(row);
    return ok();
  }
  if (base !== row.revision) return fail('PT409', 409);
  const next = payload!.task!;
  if (next.createdAt !== row.task.createdAt || next.kind !== row.task.kind || next.timeZone !== row.task.timeZone) {
    return fail('PT400', 400);
  }
  row.task = { ...next };
  bump(row);
  return ok();
}

async function mockTaskRead(user: string) {
  mockReads += 1;
  if (mockReadGate) await mockReadGate;
  const data = [...mockServer.rows.entries()].filter(([key]) => key.startsWith(`${user}:`)).map(([, row]) => ({
    id: row.task.id, kind: row.task.kind, title: row.task.title, frequency: row.task.frequency,
    last_done: row.task.lastDone ?? null, assigned_to: row.task.assignedTo, rotates: row.task.rotates,
    created_at: row.task.createdAt, time_zone: row.task.timeZone, revision: String(row.revision),
    updated_at: row.updatedAt, deleted_at: row.deletedAt,
  }));
  return { data, error: null };
}

jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ session: mockAccount ? { user: { id: mockAccount } } : null }) },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockAccount ? { id: mockAccount } : null } }),
      getSession: () => Promise.resolve({
        data: { session: mockAccount ? { user: { id: mockAccount }, access_token: `token-${mockAccount}` } : null },
        error: null,
      }),
    },
    from: (table: string) => ({
      select: () => ({ eq: (_column: string, user: string) => table === 'household_tasks'
        ? mockTaskRead(user)
        : Promise.resolve({ data: [], error: null }) }),
      upsert: () => Promise.resolve({ error: null }),
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    }),
    rpc: (_name: string, args: Record<string, unknown>) => ({
      setHeader: (_header: string, value: string) => ({ retry: () => Promise.resolve(mockApply(value, args)) }),
    }),
  },
}));

import { reconcileHomeTasksAfterRefusal, useHouseholdStore } from '@/store/useHouseholdStore';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID = '11111111-1111-4111-8111-111111111111';
const seed: HouseholdTask = {
  id: ID, kind: 'cleaning', title: 'Kitchen', frequency: 'weekly', lastDone: '2026-10-01',
  assignedTo: 'me', rotates: true, createdAt: '2026-01-01T00:00:00.000Z', timeZone: 'Europe/Copenhagen',
};
const store = () => useHouseholdStore.getState();
const serverRow = (user = A, id = ID) => mockServer.rows.get(`${user}:${id}`)!;
const local = () => store().tasks.find((task) => task.id === ID);
const queued = async (user = A) => createOutbox(user).list();
const otherDevice = (changes: Partial<HouseholdTask>, deleted = false) => {
  const row = serverRow();
  row.task = { ...row.task, ...changes };
  row.revision += 1;
  row.updatedAt = new Date(Date.parse(row.updatedAt) + 1000).toISOString();
  if (deleted) row.deletedAt = row.updatedAt;
};

let network: ConnectivityState = 'online';
let coordinators: ReturnType<typeof createSyncCoordinator>[] = [];
/** Without an override the coordinator uses the production refusal registry. */
function start(onPermanentFailure?: (accountId: string, mutation: OutboxMutation) => void) {
  const coordinator = createSyncCoordinator({
    getActiveAccount: () => mockAccount,
    connectivity: { getState: () => network, subscribe: () => () => {} },
    foreground: { isForeground: () => true, subscribe: () => () => {} },
    schedule: (callback) => setTimeout(callback, 0),
    cancel: (handle) => clearTimeout(handle),
    ...(onPermanentFailure ? { onPermanentFailure } : {}),
  });
  coordinators.push(coordinator);
  coordinator.setAccount(mockAccount);
  return coordinator;
}
async function drain() {
  for (let round = 0; round < 40; round += 1) {
    for (const coordinator of coordinators) await coordinator.settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
/** Process restart: runtime-only state is gone, persisted bytes and the outbox remain. */
async function restart() {
  for (const coordinator of coordinators) coordinator.dispose();
  coordinators = [];
  releaseAllMutationClaims();
  useHouseholdStore.setState({ taskConflicts: {}, tasks: [], taskSync: {} });
  await useHouseholdStore.persist.rehydrate();
}

beforeEach(async () => {
  for (const coordinator of coordinators) coordinator.dispose();
  coordinators = [];
  releaseAllMutationClaims();
  network = 'online';
  mockReadGate = null;
  mockUnavailable = false;
  mockAccount = A;
  mockServer.rows.clear();
  mockServer.receipts.clear();
  mockServer.calls = [];
  await withOutboxCleanup(async () => { await AsyncStorage.clear(); });
  store().clearLocal();
  mockServer.rows.set(`${A}:${ID}`, { task: { ...seed }, revision: 3, updatedAt: '2026-10-07T09:00:00.000Z', deletedAt: null });
  await store().fetchFromSupabase();
  expect(store().taskSync[ID]).toMatchObject({ revision: '3', confirmed: seed });
});
afterAll(() => { for (const coordinator of coordinators) coordinator.dispose(); });

describe('APP-061 C5 runtime: refused Home-task mutations reach reconciliation', () => {
  it('A: stale edit vs remote edit of the same field is refused, kept, and recoverable as "keep mine"', async () => {
    otherDevice({ title: 'Theirs' });
    start();
    store().updateTask(ID, { title: 'Mine' });
    await drain();
    // The runtime (not a test-side fetch) recorded the conflict; nothing was overwritten.
    expect(mockServer.calls).toHaveLength(1);
    expect(serverRow().task.title).toBe('Theirs');
    expect(local()!.title).toBe('Mine');
    expect(store().taskConflicts[ID]).toMatchObject({ accountId: A, sync: { revision: '4' } });
    const refused = (await queued())[0];
    expect(refused).toMatchObject({ status: 'failed', baseRevision: 3 });

    expect(await store().resolveTaskConflict(ID, 'mine')).toBe(true);
    await drain();
    const replacement = mockServer.calls[1];
    expect(replacement.mutationId).not.toBe(refused.mutationId);
    expect(replacement.base).toBe(4);
    expect(serverRow()).toMatchObject({ revision: 5, task: { title: 'Mine' } });
    expect(await queued()).toEqual([]);
    expect(store().taskConflicts).toEqual({});

    // The entity queue continues: a later completion applies and rotates exactly once.
    store().markTaskDone(ID);
    await drain();
    expect(serverRow()).toMatchObject({ revision: 6, task: { assignedTo: 'partner', lastDone: calendarDateForTask(seed) } });
  });

  it('A: "keep the other version" retires the refused chain and shows the server state', async () => {
    otherDevice({ title: 'Theirs' });
    start();
    store().updateTask(ID, { title: 'Mine' });
    await drain();
    expect(await store().resolveTaskConflict(ID, 'server')).toBe(true);
    await drain();
    expect(local()!.title).toBe('Theirs');
    expect(await queued()).toEqual([]);
    expect(mockServer.calls).toHaveLength(1);
    store().updateTask(ID, { title: 'Next' });
    await drain();
    expect(mockServer.calls[1].base).toBe(4);
    expect(serverRow()).toMatchObject({ revision: 5, task: { title: 'Next' } });
  });

  it('B: a local edit merges with a remote completion through a NEW mutation on the latest revision', async () => {
    otherDevice({ lastDone: '2026-10-05', assignedTo: 'partner' });
    start();
    store().updateTask(ID, { title: 'Mine' });
    await drain();
    expect(mockServer.calls.map((call) => call.base)).toEqual([3, 4]);
    expect(mockServer.calls[1].mutationId).not.toBe(mockServer.calls[0].mutationId);
    expect(serverRow()).toMatchObject({ revision: 5,
      task: { title: 'Mine', lastDone: '2026-10-05', assignedTo: 'partner' } });
    expect(local()).toEqual(serverRow().task);
    expect(await queued()).toEqual([]);
    expect(store().taskConflicts).toEqual({});
  });

  it('C: a local completion merges with a remote edit and rotates exactly once', async () => {
    otherDevice({ title: 'Theirs' });
    start();
    store().markTaskDone(ID);
    await drain();
    expect(serverRow()).toMatchObject({ revision: 5,
      task: { title: 'Theirs', lastDone: calendarDateForTask(seed), assignedTo: 'partner' } });
    expect(local()).toEqual(serverRow().task);
    expect(await queued()).toEqual([]);
  });

  it('D: two completions for the same civil date rotate once and the queue continues', async () => {
    const today = calendarDateForTask(seed);
    otherDevice({ lastDone: today, assignedTo: 'partner' });
    start();
    store().markTaskDone(ID);
    await drain();
    expect(serverRow()).toMatchObject({ revision: 4, task: { assignedTo: 'partner', lastDone: today } });
    expect(local()).toMatchObject({ assignedTo: 'partner', lastDone: today });
    store().updateTask(ID, { title: 'After' });
    await drain();
    expect(serverRow()).toMatchObject({ revision: 5, task: { title: 'After', assignedTo: 'partner' } });
  });

  it('D: completions on different dates are never auto-combined into a second rotation', async () => {
    otherDevice({ lastDone: '2026-10-05', assignedTo: 'partner' });
    start();
    store().markTaskDone(ID);
    await drain();
    expect(serverRow()).toMatchObject({ revision: 4, task: { assignedTo: 'partner', lastDone: '2026-10-05' } });
    expect(store().taskConflicts[ID]).toBeDefined();
    expect(await store().resolveTaskConflict(ID, 'mine')).toBe(true);
    await drain();
    // An explicit edit sets the user's view; the server does not rotate it again.
    expect(serverRow()).toMatchObject({ revision: 5,
      task: { assignedTo: 'partner', lastDone: calendarDateForTask(seed) } });
  });

  it('E: a server tombstone retires the whole refused chain and nothing recreates the task', async () => {
    otherDevice({}, true);
    start();
    store().updateTask(ID, { title: 'Stale edit' });
    store().markTaskDone(ID);
    await drain();
    expect(local()).toBeUndefined();
    expect(await queued()).toEqual([]);
    expect(store().taskSync[ID].deletedAt).not.toBeNull();
    expect(store().taskConflicts).toEqual({});
    expect(mockServer.calls.some((call) => (call.payload as { action?: string } | null)?.action === 'create')).toBe(false);
    await store().fetchFromSupabase();
    await restart();
    await store().fetchFromSupabase();
    expect(local()).toBeUndefined();
    expect(serverRow().deletedAt).not.toBeNull();
  });

  it('F: a conflict survives restart and is recomputed and resolvable after the startup read', async () => {
    otherDevice({ title: 'Theirs' });
    start();
    store().updateTask(ID, { title: 'Mine' });
    await drain();
    await restart();
    expect(store().taskConflicts).toEqual({});
    expect(local()!.title).toBe('Mine');
    start();
    await store().fetchFromSupabase();
    expect(store().taskConflicts[ID]).toBeDefined();
    expect(await store().resolveTaskConflict(ID, 'server')).toBe(true);
    await drain();
    expect(local()!.title).toBe('Theirs');
    expect(await queued()).toEqual([]);
  });

  it('F: a restart after the replacement is durable sends it exactly once', async () => {
    otherDevice({ lastDone: '2026-10-05', assignedTo: 'partner' });
    start((accountId, mutation) => { network = 'offline'; reconcileHomeTasksAfterRefusal(accountId, mutation); });
    store().updateTask(ID, { title: 'Mine' });
    await drain();
    const [replacement] = await queued();
    expect(replacement).toMatchObject({ status: 'pending', baseRevision: 4 });
    expect(replacement.mutationId).not.toBe(mockServer.calls[0].mutationId);
    await restart();
    expect(local()!.title).toBe('Mine');
    network = 'online';
    start();
    await drain();
    expect(serverRow()).toMatchObject({ revision: 5, task: { title: 'Mine', assignedTo: 'partner' } });
    expect(mockServer.calls).toHaveLength(2);
    expect(await queued()).toEqual([]);
  });

  it('G: logout while reconciliation is in flight publishes nothing and sends nothing under another account', async () => {
    otherDevice({ title: 'Theirs' });
    let open!: () => void;
    mockReadGate = new Promise((resolve) => { open = resolve; });
    start();
    store().updateTask(ID, { title: 'Mine' });
    await drain();
    expect(mockServer.calls).toHaveLength(1);
    mockAccount = null;
    await withOutboxCleanup(async () => { store().clearLocal(); });
    open();
    await drain();
    expect(store().tasks).toEqual([]);
    expect(store().taskConflicts).toEqual({});
    mockAccount = B;
    for (const coordinator of coordinators) coordinator.setAccount(B);
    await drain();
    expect(await queued(B)).toEqual([]);
    expect(mockServer.calls.every((call) => call.user === A)).toBe(true);
    expect(await store().resolveTaskConflict(ID, 'mine')).toBe(false);
  });

  it('a transient failure is retried by policy and never triggers reconciliation', async () => {
    mockUnavailable = true;
    const reads = mockReads;
    start();
    store().updateTask(ID, { title: 'Mine' });
    await drain();
    expect(mockReads).toBe(reads);
    expect((await queued())[0]).toMatchObject({ status: 'failed', nextRetryAt: expect.any(String) });
    expect(store().taskConflicts).toEqual({});
  });

  it('duplicate-create window: a lost planned revision turns a queued create\'s follow-up into an edit', async () => {
    network = 'offline';
    start();
    store().addTask({ kind: 'cleaning', title: 'New', frequency: 'monthly' });
    await drain();
    const id = store().tasks.find((task) => task.title === 'New')!.id;
    store().restoreBackup({ tasks: store().tasks }); // drops the sync cache and runtime chains
    store().updateTask(id, { title: 'Edited' });
    await drain();
    expect((await queued()).map((m) => [(m.payload as { action: string }).action, m.baseRevision]))
      .toEqual([['create', undefined], ['edit', 1]]);
    network = 'online';
    for (const coordinator of coordinators) coordinator.setAccount(null);
    start();
    await drain();
    expect(serverRow(A, id)).toMatchObject({ revision: 2, task: { title: 'Edited' } });
  });

  it('duplicate-create window: a second create refused after the first applied is rebased automatically', async () => {
    start();
    store().addTask({ kind: 'cleaning', title: 'New', frequency: 'monthly' });
    await drain();
    const id = store().tasks.find((task) => task.title === 'New')!.id;
    expect(serverRow(A, id).revision).toBe(1);
    store().restoreBackup({ tasks: store().tasks });
    store().updateTask(id, { title: 'Edited' });
    await drain();
    expect(serverRow(A, id)).toMatchObject({ revision: 2, task: { title: 'Edited' } });
    expect(await queued()).toEqual([]);
    expect(store().taskConflicts).toEqual({});
  });
});

describe('outbox supersedeChain', () => {
  const edit = (title: string, baseRevision: number) => ({
    dataDomain: 'home.household' as const, entityType: 'home-task', entityId: ID, operation: 'upsert' as const,
    payload: { action: 'edit', task: { ...seed, title } }, baseRevision,
  });

  it('is compare-and-set on the exact chain and gives replacements fresh IDs', async () => {
    const outbox = createOutbox(A);
    const first = await outbox.enqueue(edit('One', 3));
    expect(await outbox.supersedeChain(['00000000-0000-4000-8000-000000000000'], [edit('X', 4)])).toBeNull();
    await outbox.enqueue(edit('Two', 4));
    expect(await outbox.supersedeChain([first.mutationId], [edit('X', 4)])).toBeNull();
    const all = (await outbox.list()).map((m) => m.mutationId);
    const [replacement] = (await outbox.supersedeChain(all, [edit('Merged', 4)]))!;
    expect(all).not.toContain(replacement.mutationId);
    expect(await outbox.list()).toEqual([replacement]);
  });

  it('a failed write leaves the old chain durable (never neither old nor new)', async () => {
    const outbox = createOutbox(A);
    const first = await outbox.enqueue(edit('One', 3));
    const spy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(outbox.supersedeChain([first.mutationId], [edit('Merged', 4)])).rejects.toThrow();
    spy.mockRestore();
    expect((await outbox.list()).map((m) => m.mutationId)).toEqual([first.mutationId]);
  });
});
