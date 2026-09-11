import {
  type ConfirmedModuleChoice, parseModuleChoiceSnapshots, reconcileModuleChoiceSnapshots,
} from '@/core/sync/moduleChoiceReconciliation';
import { createModuleChoiceSnapshots } from '@/core/sync/moduleChoiceSnapshots';

const mockSession = jest.fn();
const mockFrom = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockHeader = jest.fn();
const mockRetry = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getSession: (...args: unknown[]) => mockSession(...args) },
  from: (...args: unknown[]) => mockFrom(...args),
} }));
const entity = (revision = '4', enabled = false, entityId = 'goals'): ConfirmedModuleChoice => ({
  entityId, enabled, revision, updatedAt: `2026-09-11T07:00:00.00000${revision === '4' ? '4' : '5'}+00:00`, deletedAt: null,
});
const row = (value = entity()) => ({ module_id: value.entityId, enabled: value.enabled,
  revision: value.revision, updated_at: value.updatedAt, deleted_at: value.deletedAt });
const merge = (local: readonly ConfirmedModuleChoice[], remote: readonly ConfirmedModuleChoice[]) =>
  reconcileModuleChoiceSnapshots(local, remote, []);
const session = (accountId = 'account-a') => ({ data: { session: {
  user: { id: accountId }, access_token: 'test-token',
} }, error: null });

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue(session());
  mockFrom.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ setHeader: mockHeader });
  mockHeader.mockReturnValue({ retry: mockRetry });
  mockRetry.mockResolvedValue({ data: [row()], error: null });
});

it('accepts a fetched entity into empty confirmed state', () => {
  expect(merge([], parseModuleChoiceSnapshots([row()]))).toEqual([entity()]);
});
it('regression: fetch updates existing rows, not append-only, including payload and metadata', async () => {
  const handle = createModuleChoiceSnapshots('account-a');
  expect(await handle.fetch([])).toEqual({ ok: true });
  expect(handle.getSnapshot().entities).toEqual([entity('4', false)]);
  mockRetry.mockResolvedValue({ data: [row(entity('5', true))], error: null });
  expect(await handle.fetch([])).toEqual({ ok: true });
  expect(handle.getSnapshot()).toEqual({ accountId: 'account-a', entities: [entity('5', true)] });
});
it('older remote revision cannot regress a newer local version even with a later timestamp', () => {
  expect(merge([entity('5', true)], [{ ...entity(), updatedAt: '2099-01-01T00:00:00Z' }]))
    .toEqual([entity('5', true)]);
});
it('equal revision and equal content are stable', () => {
  expect(merge([entity()], [entity()])).toEqual([entity()]);
});
it.each([
  { ...entity(), enabled: true }, { ...entity(), updatedAt: '2099-01-01T00:00:00Z' },
])('equal revision with contradictory value or timestamp fails closed: %j', (remote) => {
  expect(() => merge([entity()], [remote])).toThrow('invariant');
});
it('multiple entities and repeated IDs reconcile deterministically regardless of fetch order', () => {
  const rows = [entity('5', true), entity('4'), entity('4', true, 'habits'), entity('5', true)];
  expect(merge([], rows)).toEqual([entity('5', true), entity('4', true, 'habits')]);
  expect(merge([], [...rows].reverse())).toEqual(merge([], rows));
});
it('repeating a fetched snapshot is idempotent', async () => {
  const handle = createModuleChoiceSnapshots('account-a');
  await handle.fetch([]);
  const before = handle.getSnapshot();
  await handle.fetch([]);
  expect(handle.getSnapshot()).toEqual(before);
});
it('inconsistent equal-version duplicates fail regardless of their order around a newer row', () => {
  const rows = [entity('5', true), entity('4'), entity('4', true)];
  expect(() => merge([], rows)).toThrow('invariant');
  expect(() => merge([], [...rows].reverse())).toThrow('invariant');
});
it('missing remote rows never delete confirmed entities', async () => {
  const handle = createModuleChoiceSnapshots('account-a');
  await handle.fetch([]);
  mockRetry.mockResolvedValue({ data: [], error: null });
  await handle.fetch([]);
  expect(handle.getSnapshot().entities).toEqual([entity()]);
});
it('known pending local work is refused without sending or resolving it', async () => {
  expect(() => reconcileModuleChoiceSnapshots([entity()], [entity('5', true)], ['goals'])).toThrow('pending');
  const handle = createModuleChoiceSnapshots('account-a');
  await handle.fetch([]);
  mockFrom.mockClear();
  expect(await handle.fetch(['goals'])).toEqual({ ok: false, reason: 'pending' });
  expect(handle.getSnapshot().entities).toEqual([entity()]);
  expect(mockFrom).not.toHaveBeenCalled();
});
it('compares the entire bigint range without JS number rounding', () => {
  const older = entity('9007199254740992');
  const newer = entity('9007199254740993', true);
  expect(merge([older], [newer])).toEqual([newer]);
  expect(merge([newer], [older])).toEqual([newer]);
  expect(merge([], [entity('9223372036854775807')])).toHaveLength(1);
});
it.each([undefined, null, 4, 9007199254740992, '0', '-1', '01', '1.5', '9223372036854775808'])
('rejects missing, malformed or lossy revision %j', (revision) => {
  expect(() => parseModuleChoiceSnapshots([{ ...row(), revision }])).toThrow('invalid');
});
it.each([null, {}, [null], [{ ...row(), enabled: 'true' }], [{ ...row(), updated_at: 'infinity' }],
  [{ ...row(), module_id: 'account' }]])('rejects malformed fetched snapshot %j', (rows) => {
  expect(() => parseModuleChoiceSnapshots(rows)).toThrow('invalid');
});
it('does not mutate inputs and retains sub-millisecond timestamp precision', () => {
  const input = entity();
  const output = merge([], [input]);
  expect(output[0].updatedAt).toBe(input.updatedAt);
  expect(output[0]).not.toBe(input);
  expect(Object.isFrozen(output)).toBe(true);
  expect(Object.isFrozen(output[0])).toBe(true);
});
it('fetches version metadata as text with pinned bearer, account filter and no retry', async () => {
  await createModuleChoiceSnapshots('account-a').fetch([]);
  expect(mockFrom).toHaveBeenCalledWith('user_modules');
  expect(mockSelect).toHaveBeenCalledWith('module_id, enabled, revision::text, updated_at, deleted_at');
  expect(mockEq).toHaveBeenCalledWith('user_id', 'account-a');
  expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer test-token');
  expect(mockRetry).toHaveBeenCalledWith(false);
});
it.each([null, session('account-b').data.session])('refuses an absent or wrong account %j', async (value) => {
  mockSession.mockResolvedValue({ data: { session: value } });
  expect(await createModuleChoiceSnapshots('account-a').fetch([])).toEqual({ ok: false, reason: 'authorization' });
  expect(mockFrom).not.toHaveBeenCalled();
});
it('never publishes data after the account switches while fetching', async () => {
  mockSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session('account-b'));
  const handle = createModuleChoiceSnapshots('account-a');
  expect(await handle.fetch([])).toEqual({ ok: false, reason: 'authorization' });
  expect(handle.getSnapshot().entities).toEqual([]);
});
it('concurrent out-of-order fetch completions merge against the latest confirmed state', async () => {
  let resolveOld!: (value: unknown) => void;
  mockRetry.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ data: [row(entity('5', true))] });
  const handle = createModuleChoiceSnapshots('account-a');
  const old = handle.fetch([]);
  await Promise.resolve();
  expect(await handle.fetch([])).toEqual({ ok: true });
  resolveOld({ data: [row()] });
  expect(await old).toEqual({ ok: true });
  expect(handle.getSnapshot().entities).toEqual([entity('5', true)]);
});
it('dispose clears the handle and prevents an in-flight response repopulating it', async () => {
  let resolve!: (value: unknown) => void;
  mockRetry.mockReturnValue(new Promise((done) => { resolve = done; }));
  const handle = createModuleChoiceSnapshots('account-a');
  const pending = handle.fetch([]);
  await Promise.resolve();
  handle.dispose();
  resolve({ data: [row()] });
  expect(await pending).toEqual({ ok: false, reason: 'authorization' });
  expect(handle.getSnapshot().entities).toEqual([]);
  expect(await handle.fetch([])).toEqual({ ok: false, reason: 'authorization' });
});
it('invariant mismatch fails atomically without publishing other rows from the response', async () => {
  const handle = createModuleChoiceSnapshots('account-a');
  await handle.fetch([]);
  mockRetry.mockResolvedValue({ data: [row(entity('5', true, 'habits')), row(entity('4', true))] });
  expect(await handle.fetch([])).toEqual({ ok: false, reason: 'invariant' });
  expect(handle.getSnapshot().entities).toEqual([entity()]);
});
it.each([{ error: { message: 'private' } }, { data: null }])('keeps state on failed/invalid fetch %j', async (response) => {
  const handle = createModuleChoiceSnapshots('account-a');
  await handle.fetch([]);
  mockRetry.mockResolvedValue(response);
  expect((await handle.fetch([])).ok).toBe(false);
  expect(handle.getSnapshot().entities).toEqual([entity()]);
});
it('transport exceptions return a safe unavailable result without a retry', async () => {
  mockRetry.mockRejectedValue(new Error('private headers'));
  expect(await createModuleChoiceSnapshots('account-a').fetch([])).toEqual({ ok: false, reason: 'unavailable' });
  expect(mockRetry).toHaveBeenCalledTimes(1);
});
it('handles keep account state separate and never persist a new local surface', async () => {
  const a = createModuleChoiceSnapshots('account-a');
  await a.fetch([]);
  expect(createModuleChoiceSnapshots('account-b').getSnapshot()).toEqual({ accountId: 'account-b', entities: [] });
  expect(createModuleChoiceSnapshots('account-a').getSnapshot().entities).toEqual([]);
});

const tombstone = (revision = '6', entityId = 'goals'): ConfirmedModuleChoice => ({
  ...entity(revision, true, entityId), deletedAt: '2026-09-11T07:00:00.000006+00:00',
});
describe('APP-034 tombstone reconciliation', () => {
  it('deleted rows are represented by tombstones, not absence', async () => {
    const handle = createModuleChoiceSnapshots('account-a');
    await handle.fetch([]);
    mockRetry.mockResolvedValue({ data: [row(tombstone())] });
    await handle.fetch([]);
    expect(handle.getSnapshot().entities).toEqual([tombstone()]);
    // Absence must preserve deletion history, just as it preserves active rows.
    mockRetry.mockResolvedValue({ data: [] });
    await handle.fetch([]);
    expect(handle.getSnapshot().entities).toEqual([tombstone()]);
  });
  it('stale client cannot resurrect: older active remote state preserves the confirmed delete revision', () => {
    expect(merge([tombstone()], [entity('5', true)])).toEqual([tombstone()]);
  });
  it('newer remote tombstone replaces an active confirmed entity', () => {
    expect(merge([entity('5', true)], [tombstone()])).toEqual([tombstone()]);
  });
  it('equal and repeated tombstones are idempotent with exact metadata retained', async () => {
    mockRetry.mockResolvedValue({ data: [row(tombstone())] });
    const handle = createModuleChoiceSnapshots('account-a');
    await handle.fetch([]);
    const before = handle.getSnapshot();
    await handle.fetch([]);
    expect(handle.getSnapshot()).toEqual(before);
    expect(merge([tombstone()], [tombstone(), tombstone()])).toEqual([tombstone()]);
  });
  it.each([
    { ...tombstone(), deletedAt: null },
    { ...tombstone(), deletedAt: '2026-09-11T07:00:00.000007+00:00' },
  ])('equal revision with contradictory deletion metadata fails closed: %j', (remote) => {
    expect(() => merge([tombstone()], [remote])).toThrow('invariant');
    expect(() => merge([remote], [tombstone()])).toThrow('invariant');
  });
  it('stale tombstones do not regress a newer confirmed version', () => {
    expect(merge([entity('7')], [tombstone()])).toEqual([entity('7')]);
  });
  it('multiple entities and fetch ordering retain tombstones without duplicate IDs', () => {
    const remote = [tombstone(), entity('5', true), entity('4', false, 'habits'), tombstone()];
    expect(merge([], remote)).toEqual([tombstone(), entity('4', false, 'habits')]);
    expect(merge([], [...remote].reverse())).toEqual(merge([], remote));
  });
  it('physical absence does not synthesize deletedAt on an active entity', () => {
    expect(merge([entity()], [])).toEqual([entity()]);
    expect(merge([entity()], [])[0].deletedAt).toBeNull();
  });
  it.each([undefined, '', 'infinity', 'bad-date', 0, {}])('rejects invalid/missing deleted_at %j', (deleted_at) => {
    expect(() => parseModuleChoiceSnapshots([{ ...row(), deleted_at }])).toThrow('invalid');
  });
  it('late active fetch cannot resurrect after a newer tombstone fetch completes', async () => {
    let resolveOld!: (value: unknown) => void;
    mockRetry.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ data: [row(tombstone())] });
    const handle = createModuleChoiceSnapshots('account-a');
    const old = handle.fetch([]);
    await Promise.resolve();
    await handle.fetch([]);
    resolveOld({ data: [row(entity('5', true))] });
    await old;
    expect(handle.getSnapshot().entities).toEqual([tombstone()]);
  });
  it('pending local edit vs tombstone is refused without selecting a winner', async () => {
    expect(() => reconcileModuleChoiceSnapshots([entity('5')], [tombstone()], ['goals'])).toThrow('pending');
    const handle = createModuleChoiceSnapshots('account-a');
    mockRetry.mockResolvedValue({ data: [row(tombstone())] });
    await handle.fetch([]);
    expect(await handle.fetch(['goals'])).toEqual({ ok: false, reason: 'pending' });
    expect(handle.getSnapshot().entities).toEqual([tombstone()]);
  });
  it('does not publish a tombstone to a switched account', async () => {
    mockRetry.mockResolvedValue({ data: [row(tombstone())] });
    mockSession.mockResolvedValueOnce(session()).mockResolvedValueOnce(session('account-b'));
    const handle = createModuleChoiceSnapshots('account-a');
    expect(await handle.fetch([])).toEqual({ ok: false, reason: 'authorization' });
    expect(handle.getSnapshot().entities).toEqual([]);
  });
});
