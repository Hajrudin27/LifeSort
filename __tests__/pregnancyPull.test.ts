const mockSession = jest.fn();
const mockRpc = jest.fn();
const mockHeader = jest.fn();
const mockRetry = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => mockSession(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { parsePregnancyPullPage, pullPregnancyChanges, PREGNANCY_PULL_PAGE_LIMIT } from '@/core/pregnancy/syncPull';

const account = 'a0000000-0000-4000-8000-000000000001';
const idOf = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const live = () => true;
const row = (changeSeq: number, patch: Record<string, unknown> = {}) => ({ changeSeq, entityType: 'log', entityId: idOf(changeSeq), revision: 1, deleted: false, ...patch });
const page = (changes: unknown[], nextChangeSeq: number) => ({ changes, nextChangeSeq });

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue({ data: { session: { user: { id: account }, access_token: 'pregnancy-token' } }, error: null });
  mockRpc.mockReturnValue({ setHeader: (...args: unknown[]) => { mockHeader(...args); return { retry: mockRetry }; } });
  mockRetry.mockResolvedValue({ data: page([], 0), error: null, status: 200 });
});

describe('APP-076 B2B1 Pregnancy pull transport', () => {
  it('starts at cursor 0 with limit 100, a pinned bearer token and retry(false); an empty page keeps the cursor', async () => {
    await expect(pullPregnancyChanges(account, 0, live)).resolves.toEqual({ ok: true, changes: [], nextChangeSeq: 0 });
    expect(mockRpc).toHaveBeenCalledWith('pull_pregnancy_sync_state', { p_after_change_seq: 0, p_limit: 100 });
    expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer pregnancy-token');
    expect(mockRetry).toHaveBeenCalledWith(false);
    expect(PREGNANCY_PULL_PAGE_LIMIT).toBe(100);
  });

  it('returns a validated page whose cursor is exactly the last processed row', async () => {
    mockRetry.mockResolvedValue({ data: page([row(5), row(6, { entityType: 'pregnancy', deleted: true, revision: 3 })], 6), error: null, status: 200 });
    await expect(pullPregnancyChanges(account, 4, live)).resolves.toEqual({
      ok: true, nextChangeSeq: 6,
      changes: [row(5), row(6, { entityType: 'pregnancy', deleted: true, revision: 3 })],
    });
  });

  it('accepts exactly 100 rows and rejects 101', () => {
    const hundred = Array.from({ length: 100 }, (_, index) => row(index + 1));
    expect(parsePregnancyPullPage(page(hundred, 100), account, 0)).toMatchObject({ ok: true, nextChangeSeq: 100 });
    const tooMany = Array.from({ length: 101 }, (_, index) => row(index + 1));
    expect(parsePregnancyPullPage(page(tooMany, 101), account, 0)).toBeNull();
  });

  it.each([
    ['not an object', null],
    ['a bare array', []],
    ['missing changes', { nextChangeSeq: 0 }],
    ['changes not an array', { changes: {}, nextChangeSeq: 0 }],
    ['an unexpected top-level key', { changes: [], nextChangeSeq: 0, extra: 1 }],
    ['a string cursor', { changes: [], nextChangeSeq: '0' }],
    ['a negative cursor', { changes: [], nextChangeSeq: -1 }],
    ['an unsafe cursor', { changes: [], nextChangeSeq: 2 ** 53 }],
    ['a fractional cursor', { changes: [], nextChangeSeq: 0.5 }],
    ['a cursor that jumps beyond the processed rows', page([row(1)], 9)],
    ['a cursor below the processed rows', page([row(1), row(2)], 1)],
    ['a non-empty-page cursor equal to the old cursor', page([row(1)], 0)],
    ['an empty page that moves the cursor', page([], 3)],
    ['a duplicate sequence', page([row(1), row(1, { entityId: idOf(9) })], 1)],
    ['a non-monotonic sequence', page([row(2), row(1)], 1)],
    ['a sequence not beyond the cursor', page([row(0)], 0)],
    ['an unsafe sequence', page([row(2 ** 53)], 2 ** 53)],
    ['a zero revision', page([row(1, { revision: 0 })], 1)],
    ['an unsafe revision', page([row(1, { revision: 2 ** 53 })], 1)],
    ['a string revision', page([row(1, { revision: '1' })], 1)],
    ['an unknown entity type', page([row(1, { entityType: 'consent' })], 1)],
    ['a non-boolean deleted', page([row(1, { deleted: 'false' })], 1)],
    ['a malformed entity id', page([row(1, { entityId: 'pregnancy-1' })], 1)],
    ['an extra row key', page([row(1, { notes: 'private' })], 1)],
    ['a settings row for another account', page([row(1, { entityType: 'settings', entityId: idOf(1) })], 1)],
    ['a deleted settings row', page([row(1, { entityType: 'settings', entityId: account, deleted: true })], 1)],
  ])('rejects %s without moving the cursor', async (_label, data) => {
    expect(parsePregnancyPullPage(data, account, 0)).toBeNull();
    mockRetry.mockResolvedValue({ data, error: null, status: 200 });
    await expect(pullPregnancyChanges(account, 0, live)).resolves.toEqual({ ok: false, reason: 'invalid-response', attempted: true });
  });

  it('accepts a settings row only for the bound account', () => {
    expect(parsePregnancyPullPage(page([row(1, { entityType: 'settings', entityId: account })], 1), account, 0)).toMatchObject({ ok: true });
  });

  it('classifies failures safely and never surfaces the raw error or payload', async () => {
    const cases: Array<[Record<string, unknown>, number, string]> = [
      [{ code: 'PT401', message: 'private server response' }, 401, 'authorization'],
      [{ code: 'PGRST301', message: 'jwt expired' }, 401, 'authorization'],
      [{ code: 'PT400', message: 'invalid_cursor' }, 400, 'validation'],
      [{ code: 'x', message: 'private server response' }, 429, 'rate-limited'],
      [{ code: 'PT503', message: 'private server response' }, 503, 'unavailable'],
      [{ message: 'private network detail' }, 0, 'unavailable'],
    ];
    for (const [error, status, reason] of cases) {
      mockRetry.mockResolvedValue({ data: { changes: [{ notes: 'sensitive health text' }] }, error: { ...error, details: 'sensitive server diagnostic' }, status });
      const result = await pullPregnancyChanges(account, 0, live);
      expect(result).toEqual({ ok: false, reason, attempted: true });
      expect(JSON.stringify(result)).not.toMatch(/sensitive|private/);
    }
    mockRetry.mockRejectedValue(new Error('private network detail'));
    const thrown = await pullPregnancyChanges(account, 0, live);
    expect(thrown).toEqual({ ok: false, reason: 'unavailable', attempted: true });
  });

  it('a session read that throws or errs happened before any dispatch', async () => {
    mockSession.mockRejectedValue(new Error('keychain'));
    await expect(pullPregnancyChanges(account, 0, live)).resolves.toEqual({ ok: false, reason: 'unavailable', attempted: false });
    mockSession.mockResolvedValue({ data: { session: null }, error: { message: 'private' } });
    await expect(pullPregnancyChanges(account, 0, live)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: false });
    mockSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(pullPregnancyChanges(account, 0, live)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: false });
    mockSession.mockResolvedValue({ data: { session: { user: { id: 'someone-else' }, access_token: 't' } }, error: null });
    await expect(pullPregnancyChanges(account, 0, live)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: false });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('never dispatches for a stale account/epoch and discards a response that arrives after one', async () => {
    await expect(pullPregnancyChanges(account, 0, () => false)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: false });
    expect(mockSession).not.toHaveBeenCalled();
    let active = true;
    mockSession.mockImplementation(async () => { active = false; return { data: { session: { user: { id: account }, access_token: 't' } }, error: null }; });
    await expect(pullPregnancyChanges(account, 0, () => active)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: false });
    expect(mockRpc).not.toHaveBeenCalled();
    active = true;
    mockSession.mockResolvedValue({ data: { session: { user: { id: account }, access_token: 't' } }, error: null });
    mockRetry.mockImplementation(async () => { active = false; return { data: page([row(1)], 1), error: null, status: 200 }; });
    await expect(pullPregnancyChanges(account, 0, () => active)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: true });
  });

  it('refuses an unsafe cursor argument before any work', async () => {
    for (const bad of [-1, 1.5, 2 ** 53, Number.NaN]) {
      await expect(pullPregnancyChanges(account, bad, live)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: false });
    }
    expect(mockSession).not.toHaveBeenCalled();
  });
});
