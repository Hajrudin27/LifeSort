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
let upsertPayloads: Record<string, unknown[]> = {};
let mockUserId: string | null = USER;
let mockDeleteAnswer: { data: unknown; error: unknown } = { data: { status: 'deleted' }, error: null };
let mockPreviewAnswer: { data: unknown; error: unknown } = { data: { status: 'ok', expenses: 0, packing_items: 0, participants: 0, documents: 0 }, error: null };
let mockTemplateApplyAnswer: { data: unknown; error: unknown } = { data: 'applied', error: null };
let mockTemplateApplications: Record<string, unknown[]> = {};
let selectData: Record<string, unknown[]> = {};

const mockFrom = jest.fn((table: string) => ({
  upsert: (row: unknown) => {
    mockLog.push(`upsert:${table}`);
    (upsertPayloads[table] ??= []).push(row);
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
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: { id: mockUserId } } })) },
    from: (table: string) => mockFrom(table),
    rpc: jest.fn((name: string, args?: Record<string, unknown>) => {
      mockLog.push(`rpc:${name}`);
      if (name === 'delete_trip_if_dependencies_match') return Promise.resolve(mockDeleteAnswer);
      if (name === 'apply_trip_packing_template') return Promise.resolve(mockTemplateApplyAnswer);
      if (name === 'list_trip_packing_template_applications') {
        return Promise.resolve({ data: mockTemplateApplications[String(args?.p_trip_id)] ?? [], error: null });
      }
      return Promise.resolve(mockPreviewAnswer);
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
import { getPackingTemplate, resolvePackingTemplate } from '@/features/travel/packingTemplates';
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
  upsertPayloads = {};
  mockUserId = USER;
  mockDeleteAnswer = { data: { status: 'deleted' }, error: null };
  mockPreviewAnswer = { data: { status: 'ok', expenses: 0, packing_items: 0, participants: 0, documents: 0 }, error: null };
  mockTemplateApplyAnswer = { data: 'applied', error: null };
  mockTemplateApplications = {};
  selectData = {};
  await AsyncStorage.clear();
  await useTripsStore.persist.rehydrate();
  useTripsStore.setState({ trips: [], expenses: [], packingItems: [], appliedPackingTemplates: [], participants: [], myUserId: null });
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

  it('hydrates an old encrypted payload with no owner, and stores the owner inside the current encrypted envelope', async () => {
    await documentMetadataEncryptedStorage.setItem(KEY, JSON.stringify({ state: { trips: [legacyTrip()], expenses: [], packingItems: [], participants: [], myUserId: null }, version: 0 }));
    await useTripsStore.persist.rehydrate();
    expect(state().trips[0].ownerId).toBeUndefined();
    useTripsStore.setState({ trips: [legacyTrip({ ownerId: USER })] });
    await settle();
    expect(JSON.parse((await documentMetadataEncryptedStorage.getItem(KEY))!).version).toBe(2);
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

  it('writes the destination inside the encrypted APP-060 v2 envelope', async () => {
    state().addTrip(input, []);
    await settle();
    expect(await AsyncStorage.getItem(KEY)).not.toContain('Rome');
    const decrypted = JSON.parse((await documentMetadataEncryptedStorage.getItem(KEY))!);
    expect(decrypted.version).toBe(2);
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

describe('APP-060 template copies use ordinary account-bound packing rows', () => {
  const translated = () => resolvePackingTemplate(
    getPackingTemplate('travel-essentials', 2)!,
    (key) => key.split('.').at(-1) ?? key,
  );
  const holdNextTemplateApplication = () => {
    const { supabase } = jest.requireMock('@/lib/supabase');
    let resolve!: (value: { data: unknown; error: unknown }) => void;
    supabase.rpc.mockImplementationOnce((name: string) => {
      expect(name).toBe('apply_trip_packing_template');
      return new Promise((done) => { resolve = done; });
    });
    return (value: { data: unknown; error: unknown }) => resolve(value);
  };
  const canonicalPackingRows = () => translated().items.map((item, index) => ({
    id: `server-copy-${index}`,
    user_id: USER,
    trip_id: 'trip-a',
    label: item.label,
    checked: false,
    category: item.category,
  }));

  beforeEach(() => {
    useTripsStore.setState({
      myUserId: USER,
      trips: [legacyTrip({ id: 'trip-a', ownerId: USER, destination: 'Rome', documents: [] })],
      packingItems: [],
      appliedPackingTemplates: [],
    });
  });

  it('hydrates an encrypted APP-059 v1 dataset, preserves packing, then applies APP-060 normally', async () => {
    const pre060 = {
      state: {
        trips: [legacyTrip({ id: 'trip-a', ownerId: USER, destination: 'Rome', documents: [] })],
        expenses: [],
        packingItems: [{
          id: 'manual-passport', tripId: 'trip-a', label: 'passport', checked: true,
          isDefault: false, category: 'essentials',
        }],
        participants: [], myUserId: USER,
        financialProjections: [], financialProjectionFreshAt: {}, financialProjectionStatus: {},
        pendingExpenseDrafts: {},
      },
      version: 1,
    };
    useTripsStore.setState({ trips: [], expenses: [], packingItems: [], appliedPackingTemplates: [], participants: [] });
    await settle();
    await documentMetadataEncryptedStorage.setItem(KEY, JSON.stringify(pre060));

    await useTripsStore.persist.rehydrate();

    expect(state().trips).toEqual(pre060.state.trips);
    expect(state().packingItems).toEqual(pre060.state.packingItems);
    expect(state().myUserId).toBe(USER);
    expect(state().appliedPackingTemplates).toEqual([]);
    await expect(state().applyPackingTemplate('trip-a', translated())).resolves.toEqual({ ok: true, added: 5 });
    expect(state().packingItems.find((item) => item.id === 'manual-passport')).toEqual(pre060.state.packingItems[0]);
    expect(state().appliedPackingTemplates).toEqual([expect.objectContaining({
      tripId: 'trip-a', templateId: 'travel-essentials', templateVersion: 2,
    })]);
  });

  it('applies additively, records the exact identity, and cannot apply that version again', async () => {
    const { supabase } = jest.requireMock('@/lib/supabase');
    const sourceBefore = JSON.stringify(getPackingTemplate('travel-essentials', 2));
    await expect(state().applyPackingTemplate('trip-a', translated())).resolves.toEqual({ ok: true, added: 6 });
    await settle();

    expect(state().packingItems).toHaveLength(6);
    expect(state().packingItems.every((item) => item.authorId === USER && item.isDefault === false)).toBe(true);
    expect(state().appliedPackingTemplates).toEqual([expect.objectContaining({
      tripId: 'trip-a', templateId: 'travel-essentials', templateVersion: 2, appliedBy: USER,
    })]);
    expect(supabase.rpc).toHaveBeenCalledWith('apply_trip_packing_template', expect.objectContaining({
      p_trip_id: 'trip-a', p_expected_account_id: USER,
      p_template_id: 'travel-essentials', p_template_version: 2,
      p_items: expect.arrayContaining([expect.objectContaining({ label: 'passport' })]),
    }));
    expect(upsertPayloads.trip_packing_items).toBeUndefined();

    const firstId = state().packingItems[0].id;
    expect(state().updatePackingItem(firstId, 'My passport', 'other')).toBe(true);
    await settle();
    expect(state().packingItems.find((item) => item.id === firstId)).toMatchObject({ label: 'My passport', category: 'other' });
    expect(JSON.stringify(getPackingTemplate('travel-essentials', 2))).toBe(sourceBefore);

    await expect(state().applyPackingTemplate('trip-a', translated())).resolves.toEqual({ ok: true, added: 0 });
    expect(state().packingItems).toHaveLength(6);
    expect(state().packingItems.find((item) => item.id === firstId)?.label).toBe('My passport');
    expect(mockLog.filter((entry) => entry === 'rpc:apply_trip_packing_template')).toHaveLength(1);
  });

  it('lets an accepted-participant-shaped dataset create rows under that participant, not the owner', async () => {
    const { supabase } = jest.requireMock('@/lib/supabase');
    useTripsStore.setState({
      trips: [legacyTrip({ id: 'shared', ownerId: 'owner-account', destination: 'Paris', documents: [] })],
    });
    await expect(state().applyPackingTemplate('shared', translated())).resolves.toEqual({ ok: true, added: 6 });
    await settle();
    expect(supabase.rpc).toHaveBeenCalledWith('apply_trip_packing_template', expect.objectContaining({
      p_trip_id: 'shared', p_expected_account_id: USER,
    }));
    expect(state().packingItems.every((row) => row.authorId === USER && row.tripId === 'shared')).toBe(true);
  });

  it('fails closed before copying when the current session is not the loaded account', async () => {
    mockUserId = 'different-account';
    await expect(state().applyPackingTemplate('trip-a', translated())).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(state().packingItems).toEqual([]);
    expect(state().appliedPackingTemplates).toEqual([]);
    expect(upsertPayloads.trip_packing_items).toBeUndefined();
  });

  it('a stale Account A success cannot mutate Account B rows or the same Trip/template marker', async () => {
    const release = holdNextTemplateApplication();
    const applying = state().applyPackingTemplate('trip-a', translated());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state().packingItems).toEqual([]);
    expect(state().appliedPackingTemplates).toEqual([]);

    const accountB = 'different-account';
    const bItem = {
      id: 'b-packing', tripId: 'trip-a', authorId: accountB, label: 'B item',
      checked: true, isDefault: false, category: 'other' as const,
    };
    const bMarker = {
      tripId: 'trip-a', templateId: 'travel-essentials', templateVersion: 2,
      appliedBy: accountB, appliedAt: '2026-10-06T12:00:00.000Z',
    };
    mockUserId = accountB;
    state().clearLocal();
    useTripsStore.setState({
      myUserId: accountB,
      trips: [legacyTrip({ id: 'trip-a', ownerId: accountB, destination: 'Rome', documents: [] })],
      packingItems: [bItem],
      appliedPackingTemplates: [bMarker],
    });

    release({ data: 'applied', error: null });
    await expect(applying).resolves.toEqual({ ok: false, reason: 'stale' });

    expect(state().packingItems).toEqual([bItem]);
    expect(state().appliedPackingTemplates).toEqual([bMarker]);
  });

  it('logout plus a stale failure leaves the cleared dataset untouched', async () => {
    const release = holdNextTemplateApplication();
    const applying = state().applyPackingTemplate('trip-a', translated());
    await new Promise((resolve) => setTimeout(resolve, 0));
    mockUserId = null;
    state().clearLocal();
    release({ data: null, error: { message: 'offline' } });

    await expect(applying).resolves.toEqual({ ok: false, reason: 'stale' });
    expect(state().trips).toEqual([]);
    expect(state().packingItems).toEqual([]);
    expect(state().appliedPackingTemplates).toEqual([]);
  });

  it('a dataset-epoch replacement cannot be changed by a stale failure', async () => {
    const release = holdNextTemplateApplication();
    const applying = state().applyPackingTemplate('trip-a', translated());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const replacementItem = {
      id: 'replacement-item', tripId: 'trip-a', authorId: USER, label: 'Restored item',
      checked: false, isDefault: false, category: 'other' as const,
    };
    const replacementMarker = {
      tripId: 'trip-a', templateId: 'travel-essentials', templateVersion: 2,
      appliedBy: USER, appliedAt: '2026-10-06T13:00:00.000Z',
    };
    state().restoreBackup({
      trips: [legacyTrip({ id: 'trip-a', ownerId: USER, destination: 'Rome', documents: [] })],
      expenses: [], packingItems: [replacementItem], appliedPackingTemplates: [replacementMarker], participants: [],
    });
    release({ data: null, error: { message: 'offline' } });

    await expect(applying).resolves.toEqual({ ok: false, reason: 'stale' });
    expect(state().packingItems).toEqual([replacementItem]);
    expect(state().appliedPackingTemplates).toEqual([replacementMarker]);
  });

  it('Trip removal while an application is held cannot resurrect rows or a marker', async () => {
    useTripsStore.setState({
      trips: [legacyTrip({ id: 'trip-remove', ownerId: USER, destination: 'Rome', documents: [] })],
      packingItems: [], appliedPackingTemplates: [],
    });
    const release = holdNextTemplateApplication();
    const applying = state().applyPackingTemplate('trip-remove', translated());
    await new Promise((resolve) => setTimeout(resolve, 0));
    state().removeTripFromDevice('trip-remove');
    release({ data: 'applied', error: null });

    await expect(applying).resolves.toEqual({ ok: false, reason: 'stale' });
    expect(state().trips).toEqual([]);
    expect(state().packingItems).toEqual([]);
    expect(state().appliedPackingTemplates).toEqual([]);
  });

  it('persists no provisional state and retries cleanly after termination before server commit', async () => {
    const manual = {
      id: 'manual-item', tripId: 'trip-a', authorId: USER, label: 'My own item',
      checked: true, isDefault: false, category: 'other' as const,
    };
    useTripsStore.setState({ packingItems: [manual] });
    await settle();
    const release = holdNextTemplateApplication();
    const applying = state().applyPackingTemplate('trip-a', translated());
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();

    expect(state().packingItems).toEqual([manual]);
    expect(state().appliedPackingTemplates).toEqual([]);
    const durableDuringRequest = (await documentMetadataEncryptedStorage.getItem(KEY))!;
    const parsedDuringRequest = JSON.parse(durableDuringRequest);
    expect(parsedDuringRequest.state.packingItems).toEqual([manual]);
    expect(parsedDuringRequest.state.appliedPackingTemplates).toEqual([]);

    // A real process would discard the callback. Incrementing the epoch before
    // hydrating the captured bytes models that lifecycle boundary in this process.
    state().clearLocal();
    await settle();
    await documentMetadataEncryptedStorage.setItem(KEY, durableDuringRequest);
    await useTripsStore.persist.rehydrate();
    release({ data: null, error: { message: 'terminated-before-commit' } });
    await expect(applying).resolves.toEqual({ ok: false, reason: 'stale' });
    expect(state().packingItems).toEqual([manual]);
    expect(state().appliedPackingTemplates).toEqual([]);

    await expect(state().applyPackingTemplate('trip-a', translated())).resolves.toEqual({ ok: true, added: 6 });
    expect(state().packingItems).toHaveLength(7);
    expect(state().packingItems.filter((item) => item.id === manual.id)).toEqual([manual]);
    expect(state().appliedPackingTemplates).toHaveLength(1);
  });

  it('recovers a committed lost response from the server without provisional or duplicate rows', async () => {
    const manual = {
      id: 'manual-item', tripId: 'trip-a', authorId: USER, label: 'My own item',
      checked: true, isDefault: false, category: 'other' as const,
    };
    useTripsStore.setState({ packingItems: [manual] });
    await settle();
    mockTemplateApplyAnswer = { data: null, error: { message: 'response-lost-after-commit' } };
    await expect(state().applyPackingTemplate('trip-a', translated())).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(state().packingItems).toEqual([manual]);
    expect(state().appliedPackingTemplates).toEqual([]);

    const beforeRestart = (await documentMetadataEncryptedStorage.getItem(KEY))!;
    state().clearLocal();
    await settle();
    await documentMetadataEncryptedStorage.setItem(KEY, beforeRestart);
    await useTripsStore.persist.rehydrate();

    selectData = {
      trips: [{
        id: 'trip-a', user_id: USER, name: 'Trip', destination: 'Rome',
        start_date: '2027-05-01', end_date: '2027-05-08', budget: null, created_at: 'x',
      }],
      trip_packing_items: canonicalPackingRows(), trip_expenses: [], trip_participants: [],
    };
    mockTemplateApplications = { 'trip-a': [{
      template_id: 'travel-essentials', template_version: 2,
      applied_by: USER, applied_at: '2026-10-06T14:00:00.000Z',
    }] };

    await state().fetchFromSupabase();
    await state().fetchFromSupabase();
    expect(state().packingItems).toHaveLength(7);
    expect(new Set(state().packingItems.map((item) => item.id)).size).toBe(7);
    expect(state().packingItems.find((item) => item.id === manual.id)).toEqual(manual);
    expect(state().appliedPackingTemplates).toHaveLength(1);
  });

  it('an already-applied retry reconciles another client\'s canonical rows and never keeps losing ids', async () => {
    mockTemplateApplyAnswer = { data: null, error: { message: 'unknown-result' } };
    await expect(state().applyPackingTemplate('trip-a', translated())).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(state().packingItems).toEqual([]);

    selectData = { trip_packing_items: canonicalPackingRows() };
    mockTemplateApplications = { 'trip-a': [{
      template_id: 'travel-essentials', template_version: 2,
      applied_by: USER, applied_at: '2026-10-06T15:00:00.000Z',
    }] };
    mockTemplateApplyAnswer = { data: 'already-applied', error: null };
    await expect(state().applyPackingTemplate('trip-a', translated())).resolves.toEqual({ ok: true, added: 0 });
    await expect(state().applyPackingTemplate('trip-a', translated())).resolves.toEqual({ ok: true, added: 0 });

    expect(state().packingItems.map((item) => item.id)).toEqual(canonicalPackingRows().map((row) => row.id));
    expect(state().appliedPackingTemplates).toHaveLength(1);
    expect(mockLog.filter((entry) => entry === 'rpc:apply_trip_packing_template')).toHaveLength(2);
  });

  it('new-Trip template rows and marker become durable only after server confirmation', async () => {
    const release = holdNextTemplateApplication();
    const template = translated();
    const id = state().addTrip(
      input,
      template.items.map(({ label, category }) => ({ label, category })),
      null,
      { id: template.id, version: template.version },
    )!;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();

    expect(state().packingItems.filter((item) => item.tripId === id)).toEqual([]);
    expect(state().appliedPackingTemplates.filter((application) => application.tripId === id)).toEqual([]);
    const beforeConfirmation = JSON.parse((await documentMetadataEncryptedStorage.getItem(KEY))!);
    expect(beforeConfirmation.state.packingItems.filter((item: { tripId: string }) => item.tripId === id)).toEqual([]);
    release({ data: 'applied', error: null });
    await settle();

    expect(state().packingItems.filter((item) => item.tripId === id)).toHaveLength(6);
    expect(state().appliedPackingTemplates).toEqual([expect.objectContaining({
      tripId: id, templateId: 'travel-essentials', templateVersion: 2,
    })]);
  });

  it('a current authorized server failure leaves ordinary rows untouched and stores no template state', async () => {
    const manual = {
      id: 'manual-item', tripId: 'trip-a', authorId: USER, label: 'My own item',
      checked: true, isDefault: false, category: 'other' as const,
    };
    useTripsStore.setState({ packingItems: [manual] });
    mockTemplateApplyAnswer = { data: null, error: { message: 'offline-or-denied' } };
    await expect(state().applyPackingTemplate('trip-a', translated())).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(state().packingItems).toEqual([manual]);
    expect(state().appliedPackingTemplates).toEqual([]);
  });

  it('drops the entire previous Travel dataset before an in-place account fetch lands', async () => {
    await state().applyPackingTemplate('trip-a', translated());
    await settle();
    expect(state().packingItems).toHaveLength(6);

    mockUserId = 'different-account';
    selectData = { trips: [], trip_packing_items: [], trip_expenses: [], trip_participants: [] };
    await state().fetchFromSupabase();

    expect(state().myUserId).toBe('different-account');
    expect(state().trips).toEqual([]);
    expect(state().packingItems).toEqual([]);
    expect(state().expenses).toEqual([]);
    expect(state().participants).toEqual([]);
    expect(state().appliedPackingTemplates).toEqual([]);
  });

  it('restores server-confirmed applied identities after an account login', async () => {
    selectData = {
      trips: [{
        id: 'trip-a', user_id: USER, name: 'Trip', destination: 'Rome',
        start_date: '2027-05-01', end_date: '2027-05-08', budget: null, created_at: 'x',
      }],
      trip_packing_items: [], trip_expenses: [], trip_participants: [],
    };
    mockTemplateApplications = { 'trip-a': [{
      template_id: 'travel-essentials', template_version: 2,
      applied_by: USER, applied_at: '2026-10-06T00:00:00.000Z',
    }] };
    useTripsStore.setState({ trips: [], packingItems: [], appliedPackingTemplates: [], myUserId: null });

    await state().fetchFromSupabase();

    expect(state().appliedPackingTemplates).toEqual([{
      tripId: 'trip-a', templateId: 'travel-essentials', templateVersion: 2,
      appliedBy: USER, appliedAt: '2026-10-06T00:00:00.000Z',
    }]);
  });

  it('a successful authoritative fetch removes a phantom marker without deleting ordinary packing rows', async () => {
    const manual = {
      id: 'manual-item', tripId: 'trip-a', authorId: USER, label: 'My own item',
      checked: true, isDefault: false, category: 'other' as const,
    };
    useTripsStore.setState({
      packingItems: [manual],
      appliedPackingTemplates: [{
        tripId: 'trip-a', templateId: 'travel-essentials', templateVersion: 2,
        appliedBy: USER, appliedAt: '2026-10-06T00:00:00.000Z',
      }],
    });
    selectData = { trips: [], trip_packing_items: [], trip_expenses: [], trip_participants: [] };
    mockTemplateApplications = { 'trip-a': [] };

    await state().fetchFromSupabase();

    expect(state().packingItems).toEqual([manual]);
    expect(state().appliedPackingTemplates).toEqual([]);
  });

  it('a marker fetch that finishes after Trip removal cannot resurrect application state', async () => {
    const { supabase } = jest.requireMock('@/lib/supabase');
    useTripsStore.setState({
      trips: [legacyTrip({ id: 'trip-fetch-remove', ownerId: USER, destination: 'Rome', documents: [] })],
      packingItems: [], appliedPackingTemplates: [],
    });
    let release!: (value: { data: unknown[]; error: null }) => void;
    supabase.rpc.mockImplementationOnce((name: string) => {
      expect(name).toBe('list_trip_packing_template_applications');
      return new Promise((resolve) => { release = resolve; });
    });
    const fetching = state().fetchFromSupabase();
    await new Promise((resolve) => setTimeout(resolve, 0));
    state().removeTripFromDevice('trip-fetch-remove');
    release({ data: [{
      template_id: 'travel-essentials', template_version: 2,
      applied_by: USER, applied_at: '2026-10-06T00:00:00.000Z',
    }], error: null });

    await fetching;
    expect(state().trips).toEqual([]);
    expect(state().appliedPackingTemplates).toEqual([]);
  });

  it('a marker fetch started before server confirmation cannot erase the newly confirmed marker', async () => {
    const { supabase } = jest.requireMock('@/lib/supabase');
    let releaseFetch!: (value: { data: unknown[]; error: null }) => void;
    supabase.rpc.mockImplementationOnce((name: string) => {
      expect(name).toBe('list_trip_packing_template_applications');
      return new Promise((resolve) => { releaseFetch = resolve; });
    });
    const fetching = state().fetchFromSupabase();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(state().applyPackingTemplate('trip-a', translated())).resolves.toEqual({ ok: true, added: 6 });
    expect(state().appliedPackingTemplates).toHaveLength(1);
    releaseFetch({ data: [], error: null });
    await fetching;

    expect(state().packingItems).toHaveLength(6);
    expect(state().appliedPackingTemplates).toEqual([expect.objectContaining({
      tripId: 'trip-a', templateId: 'travel-essentials', templateVersion: 2,
    })]);
  });

  it('persists rows and identities through restart and backup, and clears both on logout or trip removal', async () => {
    await state().applyPackingTemplate('trip-a', translated());
    await settle();
    const encrypted = await AsyncStorage.getItem(KEY);
    const persistedSnapshot = (await documentMetadataEncryptedStorage.getItem(KEY))!;
    const decrypted = JSON.parse(persistedSnapshot);
    expect(encrypted).not.toContain('passport');
    expect(decrypted.state.packingItems).toHaveLength(6);
    expect(decrypted.state.appliedPackingTemplates).toHaveLength(1);
    expect(decrypted.state).not.toHaveProperty('packingTemplates');
    expect(decrypted.version).toBe(2);

    // Simulate a new process: discard memory, restore the exact encrypted bytes, hydrate.
    useTripsStore.setState({ packingItems: [], appliedPackingTemplates: [] });
    await settle();
    await documentMetadataEncryptedStorage.setItem(KEY, persistedSnapshot);
    await useTripsStore.persist.rehydrate();
    expect(state().packingItems).toHaveLength(6);
    expect(state().appliedPackingTemplates).toHaveLength(1);

    state().removeTripFromDevice('trip-a');
    expect(state().packingItems).toEqual([]);
    expect(state().appliedPackingTemplates).toEqual([]);

    state().restoreBackup({
      trips: [legacyTrip({ id: 'restored-trip', ownerId: USER, destination: 'Oslo', documents: [] })],
      expenses: [],
      packingItems: decrypted.state.packingItems.map((item: Record<string, unknown>) => ({ ...item, tripId: 'restored-trip' })),
      appliedPackingTemplates: decrypted.state.appliedPackingTemplates.map((application: Record<string, unknown>) => ({
        ...application, tripId: 'restored-trip',
      })),
      participants: [],
    });
    expect(state().packingItems).toHaveLength(6);
    expect(state().appliedPackingTemplates).toEqual([expect.objectContaining({
      tripId: 'restored-trip', templateId: 'travel-essentials', templateVersion: 2,
    })]);

    state().clearLocal();
    await settle();
    await useTripsStore.persist.rehydrate();
    expect(state().packingItems).toEqual([]);
    expect(state().appliedPackingTemplates).toEqual([]);
  });
});
