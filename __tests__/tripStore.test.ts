import AsyncStorage from '@react-native-async-storage/async-storage';
import { minorUnits } from '@/core/money/minorUnits';

/**
 * APP-058 — the trip store: what it accepts, what it sends, in what order, what it
 * keeps from before, and how a trip is deleted.
 *
 * The encrypted adapter is the real APP-029 one, so legacy hydration is proved through
 * the same bytes-on-disk path a device takes.
 */

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false, isDirectory: false, size: 0 })),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  deleteAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-file-system', () => ({
  File: class {
    bytes() { return Promise.reject(new Error('file missing')); }
    create() {}
    write() { return Promise.resolve(); }
  },
}));
const USER = '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11';
const mockLog: string[] = [];
let upsertResults: Record<string, { error: unknown }> = {};
let mockDeleteAnswer: { data: unknown; error: unknown } = { data: { status: 'deleted' }, error: null };
let mockPreviewAnswer: { data: unknown; error: unknown } = { data: { status: 'ok', expenses: 0, packing_items: 0, participants: 0, documents: 0 }, error: null };
let selectData: Record<string, unknown[]> = {};

const mockFrom = jest.fn((table: string) => ({
  upsert: (row: unknown) => {
    mockLog.push(`upsert:${table}`);
    return Promise.resolve(upsertResults[table] ?? { error: null });
  },
  // A row delete through the client: the store must never issue one for a trip (APP-058).
  delete: () => {
    mockLog.push(`delete:${table}`);
    const chain: Record<string, unknown> = {};
    chain.eq = () => chain;
    (chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => resolve({ error: null });
    return chain;
  },
  select: (columns: string) => {
    mockLog.push(`select:${table}:${columns}`);
    const answer = Promise.resolve({ data: selectData[table] ?? [], error: null });
    return { eq: () => answer, in: () => answer };
  },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: { id: '3f1b7c2e-9a4d-4e1f-8b6a-2c5d7e9f0a11' } } })) },
    from: (table: string) => mockFrom(table),
    rpc: jest.fn((name: string) => {
      mockLog.push(`rpc:${name}`);
      return Promise.resolve(name === 'delete_trip_if_dependencies_match' ? mockDeleteAnswer : mockPreviewAnswer);
    }),
  },
}));
jest.mock('@/utils/trip/tripReminder', () => ({
  scheduleTripPackingReminder: jest.fn(() => Promise.resolve()),
  cancelTripPackingReminder: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/utils/trip/currencyConversion', () => ({ fetchExchangeRate: jest.fn(() => Promise.resolve(null)) }));
const mockDeleteCachedFile = jest.fn((_uri: string) => Promise.resolve());
jest.mock('@/utils/shared/attachmentStorage', () => ({
  cleanupAttachments: (list?: { uri?: string }[]) => list?.forEach((a) => a.uri && mockDeleteCachedFile(a.uri)),
  deleteCachedAttachmentFile: (uri: string) => mockDeleteCachedFile(uri),
}));

import { documentMetadataEncryptedStorage } from '@/core/storage/documentCacheStorage';
import { useTripsStore } from '@/store/useTripsStore';
import { Trip } from '@/types/trip';
import { cancelTripPackingReminder } from '@/utils/trip/tripReminder';

const KEY = 'lifesort-trips';
const NONE = { expenses: 0, packingItems: 0, participants: 0, documents: 0 };
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const state = () => useTripsStore.getState();
const input = { name: 'Synthetic trip', destination: '  Rome ', startDate: '2027-05-01', endDate: '2027-05-08', budget: minorUnits(500_000) };

const legacyTrip = (overrides: Partial<Trip> = {}): Trip => ({
  id: '1693000000000-abc',
  name: 'Legacy trip',
  startDate: '2026-07-01',
  endDate: '2026-07-03',
  budget: null,
  documents: [{ id: 'doc-1', uri: 'file:///doc/attachments/doc-1.lsenc', name: 'boarding-pass.pdf', kind: 'document' }],
  createdAt: '2026-01-02T03:04:05.000Z',
  ...overrides,
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockLog.length = 0;
  upsertResults = {};
  mockDeleteAnswer = { data: { status: 'deleted' }, error: null };
  mockPreviewAnswer = { data: { status: 'ok', expenses: 0, packing_items: 0, participants: 0, documents: 0 }, error: null };
  selectData = {};
  await AsyncStorage.clear();
  await useTripsStore.persist.rehydrate();
  useTripsStore.setState({ trips: [], expenses: [], packingItems: [], participants: [], myUserId: null });
  await settle();
  jest.clearAllMocks();
  mockLog.length = 0;
});

describe('APP-058 creating and editing', () => {
  it('requires a destination and ordered calendar dates; a refused trip stores and sends nothing', async () => {
    for (const bad of [
      { destination: '' }, { destination: '   ' },
      { startDate: '2027-05-09' }, { startDate: '2027-02-29' }, { endDate: '2027-05-01T00:00:00.000Z' }, { endDate: '2027-5-8' },
    ]) {
      expect(state().addTrip({ ...input, ...bad }, [])).toBeNull();
    }
    await settle();
    expect(state().trips).toEqual([]);
    expect(mockLog).toEqual([]);
  });

  it('accepts a same-day trip, trims the destination, and creates a crypto UUID', () => {
    const id = state().addTrip({ ...input, startDate: '2027-05-01', endDate: '2027-05-01' }, [])!;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(state().trips[0]).toMatchObject({ id, destination: 'Rome', documents: [] });
  });

  it('sends the destination, and the trip row BEFORE its packing list', async () => {
    const id = state().addTrip(input, [{ label: 'Passport', category: 'essentials' }])!;
    await settle();
    expect(mockLog).toEqual(['upsert:trips', 'upsert:trip_packing_items']);
    expect(mockFrom).toHaveBeenCalledWith('trips');
    void id;
  });

  it('sends the packing list only if the server accepted the trip', async () => {
    upsertResults = { trips: { error: { code: '42501', message: 'row-level security' } } };
    state().addTrip(input, [{ label: 'Passport', category: 'essentials' }]);
    await settle();
    expect(mockLog).toEqual(['upsert:trips']);
  });

  it('edits a legacy trip without a destination, and lets it gain one', () => {
    useTripsStore.setState({ trips: [legacyTrip()] });
    expect(state().updateTrip('1693000000000-abc', { name: 'Renamed' })).toBe(true);
    expect(state().trips[0].destination).toBeUndefined();
    expect(state().updateTrip('1693000000000-abc', { destination: ' Lisbon ' })).toBe(true);
    expect(state().trips[0].destination).toBe('Lisbon');
  });

  it('never lets a trip that has a destination lose it, or take impossible dates', () => {
    useTripsStore.setState({ trips: [legacyTrip({ destination: 'Lisbon' })] });
    const before = state().trips[0];
    expect(state().updateTrip('1693000000000-abc', { destination: '  ' })).toBe(false);
    expect(state().updateTrip('1693000000000-abc', { endDate: '2026-06-30' })).toBe(false);
    expect(state().updateTrip('1693000000000-abc', { startDate: '2026-02-30' })).toBe(false);
    expect(state().updateTrip('missing', { name: 'x' })).toBe(false);
    expect(state().trips[0]).toBe(before);
  });
});

describe('APP-058 fetch', () => {
  it('maps destination, and leaves it absent for trips that never had one', async () => {
    selectData = {
      trips: [
        { id: 'a', name: 'With', destination: 'Rome', start_date: '2027-05-01', end_date: '2027-05-02', budget: null, created_at: '2026-01-01T00:00:00Z' },
        { id: 'b', name: 'Without', destination: null, start_date: '2027-05-01', end_date: '2027-05-02', budget: '10', created_at: '2026-01-01T00:00:00Z' },
      ],
      trip_participants: [],
    };
    await state().fetchFromSupabase();
    expect(state().trips.find((t) => t.id === 'a')!.destination).toBe('Rome');
    expect(state().trips.find((t) => t.id === 'b')!.destination).toBeUndefined();
    expect(mockLog.filter((l) => l.startsWith('select:trips:'))[0]).toContain('destination');
  });

  it('keeps the existing append-only merge: a known trip keeps its local values', async () => {
    useTripsStore.setState({ trips: [legacyTrip({ destination: 'Local' })] });
    selectData = { trips: [{ id: '1693000000000-abc', name: 'Changed elsewhere', destination: 'Remote', start_date: '2026-07-01', end_date: '2026-07-03', budget: null, created_at: 'x' }] };
    await state().fetchFromSupabase();
    expect(state().trips[0]).toMatchObject({ name: 'Legacy trip', destination: 'Local' });
  });
});

describe('APP-058 review #1 — canonical ownership', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'a', user_id: USER, name: 'Mine', destination: 'Rome', start_date: '2027-05-01', end_date: '2027-05-02', budget: null, created_at: 'x', ...overrides,
  });

  it('records the owner the server named, for own trips and for shared ones', async () => {
    selectData = {
      trips: [row(), row({ id: 'b', user_id: 'someone-else', name: 'Shared' })],
      trip_participants: [{ trip_id: 'b', owner_id: 'someone-else', user_id: USER, invited_email: 'x@example.test', status: 'accepted', invited_at: 'x' }],
    };
    await state().fetchFromSupabase();
    expect(state().trips.find((t) => t.id === 'a')!.ownerId).toBe(USER);
    expect(state().trips.find((t) => t.id === 'b')!.ownerId).toBe('someone-else');
    expect(mockLog.filter((l) => l.startsWith('select:trips:'))[0]).toContain('user_id');
  });

  it('gives a legacy trip its owner on the next fetch and changes nothing else about it', async () => {
    useTripsStore.setState({ trips: [legacyTrip({ destination: 'Local', name: 'Local name' })] });
    selectData = { trips: [row({ id: '1693000000000-abc', name: 'Remote name', destination: 'Remote' })] };
    await state().fetchFromSupabase();
    expect(state().trips[0]).toEqual(legacyTrip({ destination: 'Local', name: 'Local name', ownerId: USER }));
  });

  it('leaves the owner unknown when the server does not say (a failed or empty answer)', async () => {
    useTripsStore.setState({ trips: [legacyTrip()] });
    selectData = { trips: [] };
    await state().fetchFromSupabase();
    expect(state().trips[0].ownerId).toBeUndefined();
  });

  it('a row the server accepted under my id proves I own the trip; a refused one proves nothing', async () => {
    useTripsStore.setState({ trips: [legacyTrip({ id: 'mine' }), legacyTrip({ id: 'theirs' })] });
    state().updateTrip('mine', { name: 'x' });
    await settle();
    expect(state().trips.find((t) => t.id === 'mine')!.ownerId).toBe(USER);

    upsertResults = { trips: { error: { code: '23505', message: 'duplicate key value violates unique constraint "trips_id_globally_unique"' } } };
    state().updateTrip('theirs', { name: 'y' }); // a participant\'s edit: the owner\'s row cannot be upserted as mine
    await settle();
    expect(state().trips.find((t) => t.id === 'theirs')!.ownerId).toBeUndefined();
  });

  it('a new trip knows its owner when the session is known, and does not guess when it is not', async () => {
    useTripsStore.setState({ myUserId: null });
    const unknown = state().addTrip(input, [])!;
    expect(state().trips.find((t) => t.id === unknown)!.ownerId).toBeUndefined();
    await settle(); // ...and learns it once the server has accepted the row
    expect(state().trips.find((t) => t.id === unknown)!.ownerId).toBe(USER);

    useTripsStore.setState({ myUserId: 'known-user' });
    const known = state().addTrip(input, [])!;
    expect(state().trips.find((t) => t.id === known)!.ownerId).toBe('known-user');
  });

  it('an unknown owner is not stored as "me" when the server refuses the new trip', async () => {
    upsertResults = { trips: { error: { code: '42501', message: 'row-level security' } } };
    useTripsStore.setState({ myUserId: null });
    const id = state().addTrip(input, [])!;
    await settle();
    expect(state().trips.find((t) => t.id === id)!.ownerId).toBeUndefined();
  });

  it('hydrates an old encrypted payload with no owner, and stores the owner inside the APP-059 v1 envelope', async () => {
    await documentMetadataEncryptedStorage.setItem(KEY, JSON.stringify({ state: { trips: [legacyTrip()], expenses: [], packingItems: [], participants: [], myUserId: null }, version: 0 }));
    await useTripsStore.persist.rehydrate();
    expect(state().trips[0].ownerId).toBeUndefined();
    useTripsStore.setState({ trips: [legacyTrip({ ownerId: USER })] });
    await settle();
    expect(JSON.parse((await documentMetadataEncryptedStorage.getItem(KEY))!).version).toBe(1);
    expect(await AsyncStorage.getItem(KEY)).not.toContain(USER);
  });
});

describe('APP-058 data through APP-059 versioned local persistence', () => {
  it('hydrates a pre-APP-058 encrypted v0 payload with legacy ids, documents and no destination', async () => {
    const before058 = JSON.stringify({
      state: { trips: [legacyTrip()], expenses: [], packingItems: [], participants: [], myUserId: null },
      version: 0,
    });
    await documentMetadataEncryptedStorage.setItem(KEY, before058);
    expect(await AsyncStorage.getItem(KEY)).not.toContain('Legacy trip');

    await useTripsStore.persist.rehydrate();

    expect(state().trips).toEqual([legacyTrip()]);
    expect(state().trips[0].destination).toBeUndefined();
    // Nothing was uploaded, migrated or removed by hydrating.
    expect(mockLog).toEqual([]);
    expect(mockDeleteCachedFile).not.toHaveBeenCalled();
  });

  it('writes the destination inside the encrypted APP-059 v1 envelope', async () => {
    state().addTrip(input, []);
    await settle();
    expect(await AsyncStorage.getItem(KEY)).not.toContain('Rome');
    const decrypted = JSON.parse((await documentMetadataEncryptedStorage.getItem(KEY))!);
    expect(decrypted.version).toBe(1);
    expect(decrypted.state.trips[0].destination).toBe('Rome');
    // A trip holds no document path, filename or URL for linked documents.
    expect(JSON.stringify(decrypted.state.trips[0])).not.toMatch(/storage_path|storagePath|signed|https?:/);
  });
});

describe('APP-058 deleting a trip', () => {
  const populate = () => {
    useTripsStore.setState({
      trips: [legacyTrip({ destination: 'Lisbon' }), legacyTrip({ id: 'other', documents: [] })],
      expenses: [
        { id: 'e1', tripId: '1693000000000-abc', name: 'x', amount: 1, category: 'food', attachments: [{ id: 'ea', uri: 'file:///doc/attachments/ea.lsenc', name: 'r.jpg', kind: 'image' }], createdAt: 'x' },
        { id: 'e2', tripId: 'other', name: 'y', amount: 1, category: 'food', attachments: [], createdAt: 'x' },
      ],
      packingItems: [{ id: 'p1', tripId: '1693000000000-abc', label: 'a', checked: false, isDefault: false, category: 'other' }],
      participants: [{ tripId: '1693000000000-abc', ownerId: USER, userId: 'u2', invitedEmail: 'x@example.test', status: 'accepted', invitedAt: 'x' }],
    });
  };

  it('server failure keeps every local trace: state, files and the reminder', async () => {
    populate();
    for (const failure of [
      { data: null, error: { message: 'offline' } },
      { data: { status: 'not-found' }, error: null }, // and the re-check says it is still there
      { data: { status: 'not-owner' }, error: null },
      { data: { status: 'changed', expenses: 9, packing_items: 0, participants: 0, documents: 0 }, error: null },
    ]) {
      mockDeleteAnswer = failure;
      const result = await state().deleteTrip('1693000000000-abc', NONE);
      expect(result.ok).toBe(false);
    }
    expect(state().trips.map((t) => t.id)).toEqual(['1693000000000-abc', 'other']);
    expect(state().expenses).toHaveLength(2);
    expect(state().packingItems).toHaveLength(1);
    expect(state().participants).toHaveLength(1);
    expect(mockDeleteCachedFile).not.toHaveBeenCalled();
    expect(cancelTripPackingReminder).not.toHaveBeenCalled();
  });

  it('a thrown network error is a failure, not a crash, and changes nothing', async () => {
    populate();
    const { supabase } = jest.requireMock('@/lib/supabase');
    supabase.rpc.mockImplementationOnce(() => { throw new Error('offline'); });
    mockPreviewAnswer = { data: null, error: { message: 'offline' } };
    await expect(state().deleteTrip('1693000000000-abc', NONE)).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(state().trips).toHaveLength(2);
  });

  it('a confirmed delete clears that trip\'s state, legacy files, expense files and reminder — and only that trip\'s', async () => {
    populate();
    const result = await state().deleteTrip('1693000000000-abc', NONE);
    expect(result).toEqual({ ok: true });
    expect(state().trips.map((t) => t.id)).toEqual(['other']);
    expect(state().expenses.map((e) => e.id)).toEqual(['e2']);
    expect(state().packingItems).toEqual([]);
    expect(state().participants).toEqual([]);
    expect(mockDeleteCachedFile).toHaveBeenCalledWith('file:///doc/attachments/doc-1.lsenc');
    expect(mockDeleteCachedFile).toHaveBeenCalledWith('file:///doc/attachments/ea.lsenc');
    expect(cancelTripPackingReminder).toHaveBeenCalledWith('1693000000000-abc');
  });

  it('makes one server call to delete, and no row deletes of its own — the database owns child cleanup', async () => {
    populate();
    await state().deleteTrip('1693000000000-abc', NONE);
    expect(mockLog.filter((l) => l.startsWith('delete:'))).toEqual([]);
    expect(mockLog.filter((l) => l === 'rpc:delete_trip_if_dependencies_match')).toHaveLength(1);
  });

  it('hands the server the counts the user confirmed, and keeps everything when they have changed', async () => {
    populate();
    const { supabase } = jest.requireMock('@/lib/supabase');
    mockDeleteAnswer = { data: { status: 'changed', expenses: 4, packing_items: 2, participants: 1, documents: 3 }, error: null };
    const result = await state().deleteTrip('1693000000000-abc', { expenses: 3, packingItems: 2, participants: 1, documents: 3 });
    expect(supabase.rpc).toHaveBeenCalledWith('delete_trip_if_dependencies_match', {
      p_trip_id: '1693000000000-abc', p_expenses: 3, p_packing_items: 2, p_participants: 1, p_documents: 3,
    });
    expect(result).toEqual({ ok: false, reason: 'changed', counts: { expenses: 4, packingItems: 2, participants: 1, documents: 3 } });
    expect(state().trips).toHaveLength(2);
    expect(mockDeleteCachedFile).not.toHaveBeenCalled();
    expect(mockLog).not.toContain('rpc:trip_deletion_preview'); // no re-check: it answered, and the answer was "changed"
  });

  it('removes only this device\'s copy for a trip the server does not have', () => {
    populate();
    state().removeTripFromDevice('1693000000000-abc');
    expect(mockLog).toEqual([]);
    expect(state().trips.map((t) => t.id)).toEqual(['other']);
  });
});
