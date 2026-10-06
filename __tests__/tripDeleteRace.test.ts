/**
 * APP-058 review #1 — a delete must not lose a race with the trip's own writes.
 *
 * Trip-row writes used to be fire-and-forget and independent of the delete, so an
 * earlier upsert could commit AFTER a confirmed delete and put the trip back. Every
 * remote write of one trip now runs in order, and a delete waits for those before it.
 *
 * The server is modelled by hand and every call is a promise the test settles, so the
 * ORDER in which requests commit is what is being controlled — not timing.
 */

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false, isDirectory: false, size: 0 })),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  deleteAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-file-system', () => ({ File: class { bytes() { return Promise.reject(new Error('x')); } create() {} write() { return Promise.resolve(); } } }));
type Gate<T> = { resolve: (value: T) => void; reject: (error: unknown) => void; promise: Promise<T> };
function mockGate<T>(): Gate<T> {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { resolve, reject, promise };
}

const mockServerTrips = new Set<string>();
const mockLog: string[] = [];
const mockSent: string[] = [];
let mockTripUpserts: { id: string; gate: Gate<{ error: unknown }> }[] = [];
let mockTripDeletes: { id: string; gate: Gate<{ data: unknown; error: unknown }> }[] = [];
let mockPreviewFails = false;
let mockFetchRows: unknown[] = [];
let mockFetchTables: Record<string, unknown[]> = {};
const mockSelectRequests: string[] = [];
const mockHoldTables = new Set<string>();
let mockHold: Promise<void> = Promise.resolve();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'owner-1' } } })) },
    rpc: jest.fn((name: string, args: { p_trip_id: string }) => {
      mockLog.push(name === 'delete_trip_if_dependencies_match' ? 'delete:trips' : `rpc:${name}`);
      if (name === 'delete_trip_if_dependencies_match') {
        const g = mockGate<{ data: unknown; error: unknown }>();
        mockTripDeletes.push({ id: args.p_trip_id, gate: g });
        return g.promise;
      }
      if (mockPreviewFails) return Promise.resolve({ data: null, error: { message: 'offline' } });
      return Promise.resolve({
        data: mockServerTrips.has(args.p_trip_id)
          ? { status: 'ok', expenses: 0, packing_items: 0, participants: 0, documents: 0 }
          : { status: 'not-found' },
        error: null,
      });
    }),
    from: (table: string) => ({
      upsert: (row: { id: string; name: string }) => {
        if (table !== 'trips') { mockLog.push(`upsert:${table}`); return Promise.resolve({ error: null }); }
        mockSent.push(row.name);
        const g = mockGate<{ error: unknown }>();
        mockTripUpserts.push({ id: row.id, gate: g });
        mockLog.push('upsert:trips');
        return g.promise;
      },
      select: () => {
        mockSelectRequests.push(table);
        // A response can be held back, then delivered later: the stale-response cases.
        const hold = mockHoldTables.has(table) ? mockHold : Promise.resolve();
        const answer = hold.then(() => ({ data: mockFetchTables[table] ?? (table === 'trips' ? mockFetchRows : []), error: null }));
        return { eq: () => answer, in: () => answer };
      },
    }),
  },
}));
jest.mock('@/utils/trip/tripReminder', () => ({ scheduleTripPackingReminder: jest.fn(), cancelTripPackingReminder: jest.fn() }));
jest.mock('@/utils/trip/currencyConversion', () => ({ fetchExchangeRate: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/utils/shared/attachmentStorage', () => ({ cleanupAttachments: jest.fn(), deleteCachedAttachmentFile: jest.fn() }));
jest.mock('@/core/storage/documentCacheStorage', () => ({
  documentMetadataEncryptedStorage: require('@react-native-async-storage/async-storage'),
  deleteCachedAttachmentFile: jest.fn(() => Promise.resolve()),
}));

import { useTripsStore } from '@/store/useTripsStore';

const state = () => useTripsStore.getState();
const NONE = { expenses: 0, packingItems: 0, participants: 0, documents: 0 };
const input = { name: 'Race', destination: 'Rome', startDate: '2027-05-01', endDate: '2027-05-08', budget: null };
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 200 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  if (!check()) throw new Error(`timed out waiting for ${label}`);
}
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

/** The server commits the upsert, and only then does the client hear about it. */
const commitUpsert = (index: number) => { mockServerTrips.add(mockTripUpserts[index].id); mockTripUpserts[index].gate.resolve({ error: null }); };
/** The server deletes the trip. `answer` is what reaches the client. */
function commitDelete(index: number, answer: 'ok' | 'lost' | 'none' | 'changed') {
  const { id, gate: g } = mockTripDeletes[index];
  if (answer !== 'none' && answer !== 'changed') mockServerTrips.delete(id);
  if (answer === 'ok') g.resolve({ data: { status: 'deleted' }, error: null });
  else if (answer === 'changed') g.resolve({ data: { status: 'changed', expenses: 1, packing_items: 0, participants: 0, documents: 0 }, error: null });
  else if (answer === 'lost') g.resolve({ data: null, error: { message: 'Network request failed' } });
  else g.resolve({ data: { status: 'not-found' }, error: null });
}

beforeEach(async () => {
  mockServerTrips.clear(); mockLog.length = 0; mockSent.length = 0; mockTripUpserts = []; mockTripDeletes = []; mockPreviewFails = false; mockFetchRows = []; mockFetchTables = {}; mockSelectRequests.length = 0; mockHoldTables.clear(); mockHold = Promise.resolve();
  await useTripsStore.persist.rehydrate();
  useTripsStore.setState({ trips: [], expenses: [], packingItems: [], participants: [], myUserId: null });
  await flush();
  mockLog.length = 0;
});

describe('APP-058 review #1 — a delete waits for the trip\'s own writes', () => {
  it('create upsert in flight → delete: the delete is not sent until the create has landed, and the trip stays deleted', async () => {
    const id = state().addTrip(input, [{ label: 'Passport', category: 'essentials' }])!;
    await until(() => mockTripUpserts.length === 1, 'create upsert');

    const deleting = state().deleteTrip(id, NONE);
    await flush();
    expect(mockLog).toEqual(['upsert:trips']); // no delete yet: it is behind the create
    expect(mockTripDeletes).toHaveLength(0);

    commitUpsert(0);
    await until(() => mockTripDeletes.length === 1, 'delete');
    // The create finished — including the packing list that follows it — before the delete began.
    expect(mockLog).toEqual(['upsert:trips', 'upsert:trip_packing_items', 'delete:trips']);
    commitDelete(0, 'ok');

    await expect(deleting).resolves.toEqual({ ok: true });
    expect(mockServerTrips.has(id)).toBe(false);
    expect(state().trips).toEqual([]);
  });

  it('update upsert in flight → delete: same order, the trip stays deleted', async () => {
    const id = state().addTrip(input, [])!;
    await until(() => mockTripUpserts.length === 1, 'create'); commitUpsert(0); await flush();
    mockLog.length = 0;

    state().updateTrip(id, { name: 'Renamed' });
    await until(() => mockTripUpserts.length === 2, 'update upsert');
    const deleting = state().deleteTrip(id, NONE);
    await flush();
    expect(mockTripDeletes).toHaveLength(0);

    commitUpsert(1);
    await until(() => mockTripDeletes.length === 1, 'delete');
    commitDelete(0, 'ok');
    await expect(deleting).resolves.toEqual({ ok: true });
    expect(mockLog).toEqual(['upsert:trips', 'delete:trips']);
    expect(mockServerTrips.has(id)).toBe(false);
  });

  it('several writes then a delete run strictly in the order they were asked for', async () => {
    const id = state().addTrip(input, [])!;
    state().updateTrip(id, { name: 'One' });
    state().updateTrip(id, { name: 'Two' });
    const deleting = state().deleteTrip(id, NONE);
    for (let step = 0; step < 3; step += 1) {
      await until(() => mockTripUpserts.length === step + 1, `upsert ${step}`);
      expect(mockTripUpserts).toHaveLength(step + 1); // the next one has not started
      commitUpsert(step);
    }
    await until(() => mockTripDeletes.length === 1, 'delete');
    commitDelete(0, 'ok');
    await deleting;
    expect(mockLog.filter((l) => l !== 'upsert:trip_packing_items')).toEqual(['upsert:trips', 'upsert:trips', 'upsert:trips', 'delete:trips']);
    expect(mockServerTrips.size).toBe(0);
  });

  it('a write waiting its turn sends the latest state, not the copy it was asked about', async () => {
    const id = state().addTrip(input, [])!;
    await until(() => mockTripUpserts.length === 1, 'create');
    state().updateTrip(id, { name: 'One' });
    state().updateTrip(id, { name: 'Two' });
    for (let step = 0; step < 3; step += 1) {
      await until(() => mockTripUpserts.length === step + 1, `upsert ${step}`);
      commitUpsert(step);
    }
    await flush();
    expect(mockSent).toEqual(['Race', 'Two', 'Two']);
    expect(mockServerTrips.has(id)).toBe(true);
  });

  it('an upsert queued BEHIND a delete never recreates the trip once the delete succeeded', async () => {
    const id = state().addTrip(input, [])!;
    await until(() => mockTripUpserts.length === 1, 'create'); commitUpsert(0); await flush();

    const deleting = state().deleteTrip(id, NONE);
    await until(() => mockTripDeletes.length === 1, 'delete');
    // The user edits while the delete is in flight; that write waits behind it.
    state().updateTrip(id, { name: 'Too late' });
    await flush();
    commitDelete(0, 'ok');
    await deleting;
    await flush();

    expect(mockTripUpserts).toHaveLength(1); // the late edit was never sent
    expect(mockServerTrips.has(id)).toBe(false);
  });

  it('…but if the delete FAILED, that queued edit still goes out: nothing was deleted', async () => {
    const id = state().addTrip(input, [])!;
    await until(() => mockTripUpserts.length === 1, 'create'); commitUpsert(0); await flush();

    mockPreviewFails = true; // and the server cannot be asked either
    const deleting = state().deleteTrip(id, NONE);
    await until(() => mockTripDeletes.length === 1, 'delete');
    state().updateTrip(id, { name: 'Kept' });
    mockTripDeletes[0].gate.resolve({ data: null, error: { message: 'offline' } });
    await expect(deleting).resolves.toMatchObject({ ok: false });
    await until(() => mockTripUpserts.length === 2, 'the queued edit');
    expect(state().trips.map((t) => t.id)).toEqual([id]);
  });

  it('after a confirmed deletion a fetch that was already in flight cannot bring the trip back', async () => {
    const id = state().addTrip(input, [])!;
    await until(() => mockTripUpserts.length === 1, 'create'); commitUpsert(0); await flush();
    const deleting = state().deleteTrip(id, NONE);
    await until(() => mockTripDeletes.length === 1, 'delete'); commitDelete(0, 'ok'); await deleting;

    mockFetchRows = [{ id, user_id: 'owner-1', name: 'Race', destination: 'Rome', start_date: '2027-05-01', end_date: '2027-05-08', budget: null, created_at: 'x' }];
    await state().fetchFromSupabase();
    expect(state().trips).toEqual([]);
  });
});

describe('APP-058 review #1 — an ambiguous delete converges', () => {
  async function tripOnServer() {
    const id = state().addTrip(input, [])!;
    await until(() => mockTripUpserts.length === 1, 'create'); commitUpsert(0); await flush();
    mockLog.length = 0;
    return id;
  }

  it('the server committed the delete but the answer was lost: success, no reopen needed', async () => {
    const id = await tripOnServer();
    const deleting = state().deleteTrip(id, NONE);
    await until(() => mockTripDeletes.length === 1, 'delete');
    commitDelete(0, 'lost');

    await expect(deleting).resolves.toEqual({ ok: true });
    expect(mockLog).toEqual(['delete:trips', 'rpc:trip_deletion_preview']); // it asked, and the server said "not there"
    expect(state().trips).toEqual([]);
  });

  it('an unconfirmed delete that matched no row is checked, and a trip that is truly gone is cleaned up locally', async () => {
    const id = await tripOnServer();
    mockServerTrips.delete(id); // deleted by another device
    const deleting = state().deleteTrip(id, NONE);
    await until(() => mockTripDeletes.length === 1, 'delete');
    commitDelete(0, 'none');
    await expect(deleting).resolves.toEqual({ ok: true });
    expect(state().trips).toEqual([]);
  });

  it('a failed delete of a trip the server still has stays a failure, and nothing local is touched', async () => {
    const id = await tripOnServer();
    const deleting = state().deleteTrip(id, NONE);
    await until(() => mockTripDeletes.length === 1, 'delete');
    mockTripDeletes[0].gate.resolve({ data: null, error: { message: 'timeout' } });
    await expect(deleting).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(mockServerTrips.has(id)).toBe(true);
    expect(state().trips.map((t) => t.id)).toEqual([id]);
  });

  it('when the server cannot be asked either, it is still a failure — never guessed as success', async () => {
    const id = await tripOnServer();
    mockPreviewFails = true;
    const deleting = state().deleteTrip(id, NONE);
    await until(() => mockTripDeletes.length === 1, 'delete');
    commitDelete(0, 'lost'); // it actually committed, but nothing can confirm it now
    await expect(deleting).resolves.toMatchObject({ ok: false });
    expect(state().trips).toHaveLength(1);
  });

  it('a retry converges: the first attempt lost its answer and could not check, the second finds it gone', async () => {
    const id = await tripOnServer();
    mockPreviewFails = true;
    const first = state().deleteTrip(id, NONE);
    await until(() => mockTripDeletes.length === 1, 'first delete');
    commitDelete(0, 'lost');
    await expect(first).resolves.toMatchObject({ ok: false });
    expect(state().trips).toHaveLength(1);

    mockPreviewFails = false;
    const second = state().deleteTrip(id, NONE);
    await until(() => mockTripDeletes.length === 2, 'second delete');
    commitDelete(1, 'none'); // nothing left to delete
    await expect(second).resolves.toEqual({ ok: true });
    expect(state().trips).toEqual([]);
  });

  it('a session that is missing is not "gone"', async () => {
    const id = await tripOnServer();
    const { supabase } = jest.requireMock('@/lib/supabase');
    supabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } });
    await expect(state().deleteTrip(id, NONE)).resolves.toEqual({ ok: false, reason: 'not-authenticated' });
    expect(mockLog).not.toContain('rpc:trip_deletion_preview');
    expect(state().trips).toHaveLength(1);
  });
});

describe('APP-058 review #2 — a stale response cannot put a deleted trip\'s data back', () => {
  const rowsFor = (id: string) => ({
    trips: [{ id, user_id: 'owner-1', name: 'Race', destination: 'Rome', start_date: '2027-05-01', end_date: '2027-05-08', budget: null, created_at: 'x' }],
    trip_packing_items: [{ id: `${id}-p`, trip_id: id, label: 'Coat', checked: false, category: 'other' }],
    trip_expenses: [{ id: `${id}-e`, trip_id: id, name: 'Train', amount: 10, category: 'transport', currency: null, original_amount: null, exchange_rate: null }],
    trip_participants: [{ trip_id: id, owner_id: 'owner-1', user_id: 'owner-1', invited_email: 'x@example.test', status: 'accepted', invited_at: 'x' }],
  });

  async function deletedTrip() {
    const id = state().addTrip(input, [])!;
    await until(() => mockTripUpserts.length === 1, 'create'); commitUpsert(0); await flush();
    const deleting = state().deleteTrip(id, NONE);
    await until(() => mockTripDeletes.length === 1, 'delete'); commitDelete(0, 'ok'); await deleting;
    expect(state().trips).toEqual([]);
    return id;
  }

  it('a fetch already in flight returns the trip AND its packing item, expense and invitation after the delete: none reappears', async () => {
    const id = state().addTrip(input, [])!;
    await until(() => mockTripUpserts.length === 1, 'create'); commitUpsert(0); await flush();
    mockFetchTables = rowsFor(id);
    let release!: () => void;
    mockHold = new Promise<void>((resolve) => { release = resolve; });
    for (const table of ['trips', 'trip_packing_items', 'trip_expenses', 'trip_participants']) mockHoldTables.add(table);

    const fetching = state().fetchFromSupabase();
    await until(() => mockSelectRequests.length >= 4, 'the fetch to be in flight');

    const deleting = state().deleteTrip(id, NONE);
    await until(() => mockTripDeletes.length === 1, 'delete'); commitDelete(0, 'ok'); await deleting;
    expect(state().trips).toEqual([]);

    release(); // the stale answer arrives now, carrying the trip and all its children
    await fetching;
    await flush();
    expect(state().trips).toEqual([]);
    expect(state().packingItems).toEqual([]);
    expect(state().expenses).toEqual([]);
    expect(state().participants).toEqual([]);
  });

  it('fetchParticipants in flight when the trip is deleted cannot repopulate participants', async () => {
    const id = await deletedTrip();
    mockFetchTables = rowsFor(id);
    // Start the request first, delete the trip while it is out, then let it answer.
    const again = state().addTrip(input, [])!;
    await until(() => mockTripUpserts.length === 2, 'second create'); commitUpsert(1); await flush();
    mockFetchTables = rowsFor(again);
    let release!: () => void;
    mockHold = new Promise<void>((resolve) => { release = resolve; });
    mockHoldTables.add('trip_participants');
    const asking = state().fetchParticipants(again);
    await until(() => mockSelectRequests.includes('trip_participants'), 'the participants request');

    const deleting = state().deleteTrip(again, NONE);
    await until(() => mockTripDeletes.length === 2, 'second delete'); commitDelete(1, 'ok'); await deleting;
    release();
    await asking;
    await flush();
    expect(state().participants).toEqual([]);
  });

  it('a late answer for a trip that was not deleted is still applied, even while another trip is gone', async () => {
    const gone = await deletedTrip();
    const kept = state().addTrip(input, [])!;
    await until(() => mockTripUpserts.length === 2, 'create'); commitUpsert(1); await flush();
    mockFetchTables = {
      trips: [...rowsFor(gone).trips, ...rowsFor('someone-elses-trip').trips.map((row) => ({ ...row, id: 'someone-elses-trip' }))],
      trip_packing_items: [...rowsFor(gone).trip_packing_items, ...rowsFor('someone-elses-trip').trip_packing_items],
      trip_expenses: [...rowsFor(gone).trip_expenses, ...rowsFor('someone-elses-trip').trip_expenses],
      trip_participants: [...rowsFor(gone).trip_participants, ...rowsFor('someone-elses-trip').trip_participants],
    };
    await state().fetchFromSupabase();
    await flush();
    // (The mock answers the "own" and "shared" queries with the same rows, so compare distinct trips.)
    const distinct = (ids: string[]) => [...new Set(ids)].sort();
    expect(distinct(state().trips.map((t) => t.id))).toEqual([kept, 'someone-elses-trip'].sort());
    expect(distinct(state().packingItems.map((p) => p.tripId))).toEqual(['someone-elses-trip']);
    expect(distinct(state().expenses.map((e) => e.tripId))).toEqual(['someone-elses-trip']);
    expect(distinct(state().participants.map((p) => p.tripId))).toEqual(['someone-elses-trip']);
  });

  it('an ordinary fetch with nothing deleted behaves as before', async () => {
    mockFetchTables = rowsFor('ordinary');
    await state().fetchFromSupabase();
    const distinct = (ids: string[]) => [...new Set(ids)];
    expect(distinct(state().trips.map((t) => t.id))).toEqual(['ordinary']);
    expect(distinct(state().packingItems.map((p) => p.tripId))).toEqual(['ordinary']);
    expect(distinct(state().expenses.map((e) => e.tripId))).toEqual(['ordinary']);
    expect(distinct(state().participants.map((p) => p.tripId))).toEqual(['ordinary']);
  });
});

describe('APP-058 review #2 — deletion only of what the user confirmed', () => {
  it('"changed" deletes nothing, keeps every local trace, does not re-check, and lets later writes go out', async () => {
    const id = state().addTrip(input, [])!;
    await until(() => mockTripUpserts.length === 1, 'create'); commitUpsert(0); await flush();
    mockLog.length = 0;

    const deleting = state().deleteTrip(id, NONE);
    await until(() => mockTripDeletes.length === 1, 'delete');
    state().updateTrip(id, { name: 'Edited meanwhile' });
    commitDelete(0, 'changed');

    await expect(deleting).resolves.toEqual({ ok: false, reason: 'changed', counts: { expenses: 1, packingItems: 0, participants: 0, documents: 0 } });
    expect(mockServerTrips.has(id)).toBe(true);
    expect(state().trips.map((t) => t.id)).toEqual([id]);
    expect(mockLog).not.toContain('rpc:trip_deletion_preview');
    await until(() => mockTripUpserts.length === 2, 'the queued edit still goes out: nothing was deleted');
  });
});
