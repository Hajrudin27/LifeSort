/**
 * APP-058 — the trip's remote operations: the server-counted deletion preview (fail
 * closed, never zero), the server-confirmed delete, and the owner-only document links
 * (idempotent, ids only).
 */

const USER = '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11';
const DOC = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockGetUser = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => mockGetUser() },
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => mockFrom(table),
  },
}));

import {
  deleteTripRemote,
  fetchTripDeletionPreview,
  fetchTripDocumentLinks,
  linkTripDocument,
  unlinkTripDocument,
} from '@/utils/trip/tripRemote';

let consoleSpies: jest.SpyInstance[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockImplementation(() => Promise.resolve({ data: { user: { id: USER } } }));
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m));
});
afterEach(() => {
  for (const spy of consoleSpies) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); }
});

describe('APP-058 deletion preview', () => {
  const ok = { status: 'ok', expenses: 3, packing_items: 5, participants: 2, documents: 1 };

  it('asks the server for the trip by id and reads its counts', async () => {
    mockRpc.mockResolvedValue({ data: ok, error: null });
    await expect(fetchTripDeletionPreview('trip-1')).resolves.toEqual({
      ok: true, preview: { status: 'ok', expenses: 3, packingItems: 5, participants: 2, documents: 1 },
    });
    expect(mockRpc).toHaveBeenCalledWith('trip_deletion_preview', { p_trip_id: 'trip-1' });
  });

  it('a genuine zero is zero, and the other two answers are passed on as they are', async () => {
    mockRpc.mockResolvedValue({ data: { ...ok, expenses: 0, packing_items: 0, participants: 0, documents: 0 }, error: null });
    await expect(fetchTripDeletionPreview('t')).resolves.toMatchObject({ ok: true, preview: { expenses: 0, documents: 0 } });
    mockRpc.mockResolvedValue({ data: { status: 'not-owner' }, error: null });
    await expect(fetchTripDeletionPreview('t')).resolves.toEqual({ ok: true, preview: { status: 'not-owner' } });
    mockRpc.mockResolvedValue({ data: { status: 'not-found' }, error: null });
    await expect(fetchTripDeletionPreview('t')).resolves.toEqual({ ok: true, preview: { status: 'not-found' } });
  });

  it.each([
    ['an error', { data: null, error: { message: 'offline' } }],
    ['no data', { data: null, error: null }],
    ['an array', { data: [], error: null }],
    ['an unknown status', { data: { status: 'maybe' }, error: null }],
    ['a missing count', { data: { status: 'ok', expenses: 1, packing_items: 1, participants: 1 }, error: null }],
    ['a negative count', { data: { ...ok, expenses: -1 }, error: null }],
    ['a fractional count', { data: { ...ok, packing_items: 1.5 }, error: null }],
    ['a stringly count', { data: { ...ok, participants: '2' }, error: null }],
    ['NaN', { data: { ...ok, documents: NaN }, error: null }],
  ])('is a failure for %s — never guessed as zero', async (_label: string, answer: unknown) => {
    mockRpc.mockResolvedValue(answer);
    await expect(fetchTripDeletionPreview('t')).resolves.toEqual({ ok: false });
  });

  it('is a failure when the call throws', async () => {
    mockRpc.mockImplementation(() => { throw new Error('offline'); });
    await expect(fetchTripDeletionPreview('t')).resolves.toEqual({ ok: false });
  });
});

describe('APP-058 delete', () => {
  const confirmed = { expenses: 3, packingItems: 5, participants: 2, documents: 1 };

  it('asks the server to delete the trip ONLY IF its dependencies are the counts the user confirmed', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'deleted' }, error: null });
    await expect(deleteTripRemote('t', confirmed)).resolves.toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('delete_trip_if_dependencies_match', {
      p_trip_id: 't', p_expenses: 3, p_packing_items: 5, p_participants: 2, p_documents: 1,
    });
    // The client issues no row delete of its own.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('changed: nothing was deleted, and the fresh counts come back to be shown again', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'changed', expenses: 4, packing_items: 5, participants: 2, documents: 1 }, error: null });
    await expect(deleteTripRemote('t', confirmed)).resolves.toEqual({
      ok: false, reason: 'changed', counts: { expenses: 4, packingItems: 5, participants: 2, documents: 1 },
    });
  });

  it.each([
    ['a participant', { data: { status: 'not-owner' }, error: null }, { ok: false, reason: 'not-owner' }],
    ['an unknown trip (it may already be gone)', { data: { status: 'not-found' }, error: null }, { ok: false, reason: 'not-confirmed' }],
    ['an error', { data: null, error: { message: 'timeout' } }, { ok: false, reason: 'failed' }],
    ['a missing session reported by the server', { data: null, error: { message: 'not_authenticated' } }, { ok: false, reason: 'not-authenticated' }],
    ['no data', { data: null, error: null }, { ok: false, reason: 'failed' }],
    ['an unknown status', { data: { status: 'probably' }, error: null }, { ok: false, reason: 'failed' }],
    ['a changed answer with a bad count', { data: { status: 'changed', expenses: -1, packing_items: 0, participants: 0, documents: 0 }, error: null }, { ok: false, reason: 'failed' }],
    ['a changed answer with a missing count', { data: { status: 'changed', expenses: 1 }, error: null }, { ok: false, reason: 'failed' }],
  ])('%s is never a deletion', async (_label: string, answer: unknown, expected: unknown) => {
    mockRpc.mockResolvedValue(answer);
    await expect(deleteTripRemote('t', confirmed)).resolves.toEqual(expected);
  });

  it('needs a session, and turns a throw into a failure', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(deleteTripRemote('t', confirmed)).resolves.toEqual({ ok: false, reason: 'not-authenticated' });
    expect(mockRpc).not.toHaveBeenCalled();
    mockGetUser.mockResolvedValue({ data: { user: { id: USER } } });
    mockRpc.mockImplementation(() => { throw new Error('offline'); });
    await expect(deleteTripRemote('t', confirmed)).resolves.toEqual({ ok: false, reason: 'failed' });
  });
});

describe('APP-058 document links', () => {
  it('reads only this owner\'s links for the trip, as ids, and keeps a failed read apart from none', async () => {
    const eqCalls: unknown[][] = [];
    const answer = (result: unknown) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = (...args: unknown[]) => { eqCalls.push(args); return c; };
      c.order = () => Promise.resolve(result);
      return c;
    };
    mockFrom.mockReturnValue(answer({ data: [{ document_id: DOC, created_at: 'x' }, { document_id: 'not-a-uuid' }], error: null }));
    await expect(fetchTripDocumentLinks('t')).resolves.toEqual([DOC]);
    expect(mockFrom).toHaveBeenCalledWith('trip_document_references');
    expect(eqCalls).toEqual([['user_id', USER], ['trip_id', 't']]);

    mockFrom.mockReturnValue(answer({ data: [], error: null }));
    await expect(fetchTripDocumentLinks('t')).resolves.toEqual([]);
    mockFrom.mockReturnValue(answer({ data: null, error: { message: 'x' } }));
    await expect(fetchTripDocumentLinks('t')).resolves.toBeNull();
    mockFrom.mockImplementation(() => { throw new Error('offline'); });
    await expect(fetchTripDocumentLinks('t')).resolves.toBeNull();
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(fetchTripDocumentLinks('t')).resolves.toBeNull();
  });

  it('links with ids only, and treats "already linked" as success so a retry is safe', async () => {
    const insert = jest.fn();
    mockFrom.mockReturnValue({ insert });
    insert.mockResolvedValue({ error: null });
    await expect(linkTripDocument('t', DOC)).resolves.toBe('linked');
    expect(insert).toHaveBeenCalledWith({ user_id: USER, trip_id: 't', document_id: DOC });
    // Nothing that names or locates the document is ever sent.
    expect(JSON.stringify(insert.mock.calls)).not.toMatch(/name|path|url|signed/i);

    insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    await expect(linkTripDocument('t', DOC)).resolves.toBe('already-linked');
    for (const failure of [{ code: '23503', message: 'fk' }, { code: '42501', message: 'rls' }, { message: 'offline' }]) {
      insert.mockResolvedValue({ error: failure });
      await expect(linkTripDocument('t', DOC)).resolves.toBe('failed');
    }
    insert.mockImplementation(() => { throw new Error('offline'); });
    await expect(linkTripDocument('t', DOC)).resolves.toBe('failed');
  });

  it('refuses something that is not a document id, and needs a session', async () => {
    const insert = jest.fn();
    mockFrom.mockReturnValue({ insert });
    await expect(linkTripDocument('t', `${USER}/${DOC}`)).resolves.toBe('failed');
    await expect(linkTripDocument('t', 'receipt.pdf')).resolves.toBe('failed');
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(linkTripDocument('t', DOC)).resolves.toBe('failed');
    expect(insert).not.toHaveBeenCalled();
  });

  it('unlinks the link row only', async () => {
    const eqCalls: unknown[][] = [];
    const c: Record<string, unknown> = {};
    c.delete = () => c;
    c.eq = (...args: unknown[]) => { eqCalls.push(args); return eqCalls.length === 3 ? Promise.resolve({ error: null }) : c; };
    mockFrom.mockReturnValue(c);
    await expect(unlinkTripDocument('t', DOC)).resolves.toBe(true);
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('trip_document_references');
    expect(eqCalls).toEqual([['user_id', USER], ['trip_id', 't'], ['document_id', DOC]]);
  });
});
