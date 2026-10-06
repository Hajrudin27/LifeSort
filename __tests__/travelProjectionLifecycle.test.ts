import AsyncStorage from '@react-native-async-storage/async-storage';

import { minorUnits } from '@/core/money/minorUnits';

/**
 * APP-059 review #1, findings 2, 3 and 6 — the life of the cached trip projection.
 *
 *  2. Log out and account switching remove it, and an answer that was in flight
 *     cannot bring it back, in memory or on disk.
 *  3. Nothing read back from disk is current, and a late, superseded or orphaned
 *     answer never overwrites what is current.
 *  6. A restored backup never inherits it.
 *
 * The store, its persistence (through the real migration gate) and the real logout
 * cleanup run against a stand-in server that can hold an answer back, so the order
 * in which answers arrive is controlled rather than timed.
 */

let mockFileContent = '';
jest.mock('@/lib/supabase', () => ({ supabase: require('@/__tests__/helpers/fakeTravelServer').fakeSupabase }));
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn(() => Promise.resolve()) }));
jest.mock('@/core/documents/documentSync', () => ({ clearDocumentSignedUrlCache: jest.fn() }));
jest.mock('@/core/storage/cycleHealthEncryptedStorage', () => ({
  cycleHealthEncryptedStorage: require('@react-native-async-storage/async-storage'),
  clearCycleHealthEncryptionKey: jest.fn(() => Promise.resolve()),
  withCycleHealthEncryptedStorageCleanup: jest.fn((cleanup: () => Promise<unknown>) => cleanup()),
}));
// Encryption is not the subject here (APP-028/029 suites); the plain adapter keeps the
// persisted Zustand payload directly readable.
jest.mock('@/core/storage/documentCacheStorage', () => ({
  documentMetadataEncryptedStorage: require('@react-native-async-storage/async-storage'),
  deleteCachedAttachmentFile: jest.fn(() => Promise.resolve()),
  clearDocumentCacheEncryptionKey: jest.fn(() => Promise.resolve()),
  clearPersistentAttachmentCache: jest.fn(() => Promise.resolve()),
  clearTemporaryAttachmentCache: jest.fn(() => Promise.resolve()),
  withDocumentCacheCleanup: jest.fn((cleanup: () => Promise<unknown>) => cleanup()),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///synthetic/',
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false })),
  deleteAsync: jest.fn(() => Promise.resolve()),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  readAsStringAsync: jest.fn(() => Promise.resolve(mockFileContent)),
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: false, assets: [{ uri: 'file:///synthetic/backup.json' }] })),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(() => Promise.resolve(false)), shareAsync: jest.fn() }));
jest.mock('@/utils/trip/tripReminder', () => ({ scheduleTripPackingReminder: jest.fn(), cancelTripPackingReminder: jest.fn() }));

import { deleteEconomyExpense, recoveryAccessToken, resetServer, server, settle } from '@/__tests__/helpers/fakeTravelServer';
import { clearLocalUserData } from '@/core/auth/clearLocalUserData';
import { LOCAL_STORE_RESETS } from '@/features/localStores';
import { projectionVisibleTo, settledTripSpend, tripSpendFreshness } from '@/features/travel/financialReadContract';
import { useAuthStore } from '@/store/useAuthStore';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useTripsStore } from '@/store/useTripsStore';
import type { Trip, TripFinancialProjection } from '@/types/trip';
import { importBackup } from '@/utils/shared/dataBackup';

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const BOB = 'aaaaaaaa-0000-4000-8000-000000000002';
const TRIP = 'trip-shared';
const KEY = 'lifesort-trips';

const localTrip = (overrides: Partial<Trip> = {}): Trip => ({
  id: TRIP, ownerId: OWNER, name: 'Shared', destination: 'Rome', startDate: '2027-05-01', endDate: '2027-05-08',
  budget: minorUnits(500_000), documents: [], createdAt: '2026-01-01T00:00:00.000Z', ...overrides,
});
const serverTrip = (id = TRIP) => ({
  id, user_id: OWNER, name: 'Shared', destination: 'Rome', start_date: '2027-05-01', end_date: '2027-05-08',
  budget: 5000, created_at: '2026-01-01T00:00:00.000Z',
});
function seedLinked(owner: string, id: string, amount: string, tripId = TRIP) {
  server.expenses.push({
    id, user_id: owner, series_id: id, is_recurring: false, recurrence_frequency: null, recurrence_anchor_day: null,
    name: `Synthetic ${id}`, amount, category: 'food', next_payment_date: '2027-05-02', created_at: '2026-10-01T00:00:00.000Z',
  });
  server.links.push({
    trip_id: tripId, expense_owner_id: owner, expense_id: id, travel_category: 'food',
    legacy_trip_expense_id: null, currency: null, original_amount: null, exchange_rate: null,
  });
}
const projectionRow = (expenseId: string): TripFinancialProjection => ({
  tripId: TRIP, expenseOwnerId: OWNER, expenseId, name: 'Synthetic', amount: minorUnits(10_000),
  category: 'food', transactionDate: '2027-05-02', semantic: 'expense', status: 'booked',
});
const localEconomyExpense = (id: string, amount = minorUnits(10_000)) => ({
  id, seriesId: id, isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null,
  name: `Synthetic ${id}`, amount, category: 'food' as const, nextPaymentDate: '2027-05-02',
  attachments: [], createdAt: '2026-10-01T00:00:00.000Z',
});

const state = () => useTripsStore.getState();
const refresh = (tripId = TRIP) => state().refreshTripFinancialProjection(tripId);
const projectionIds = (tripId = TRIP) =>
  state().financialProjections.filter((row) => row.tripId === tripId).map((row) => row.expenseId).sort();
const freshness = (tripId = TRIP) =>
  tripSpendFreshness([tripId], state().financialProjectionFreshAt, state().financialProjectionStatus);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function persisted(): Promise<{ state: Record<string, any> } | null> {
  await settle();
  const raw = await AsyncStorage.getItem(KEY);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(async () => {
  resetServer();
  server.user = OWNER;
  server.trips = [serverTrip()];
  server.participants = [{
    trip_id: TRIP, owner_id: OWNER, user_id: BOB, invited_email: 'bob@example.test', status: 'accepted',
    invited_at: '2026-01-02T00:00:00.000Z',
  }];
  await AsyncStorage.clear();
  await useTripsStore.persist.rehydrate();
  state().clearLocal();
  useTripsStore.setState({ trips: [localTrip()], myUserId: OWNER });
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  useAuthStore.setState({ session: { user: { id: OWNER } } as any });
  await settle();
});

describe('finding 2 — log out and account switching remove the projection cache', () => {
  it('A–C: the real Travel reset clears every projection field, in memory and on disk', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    expect(await refresh()).toBe(true);
    expect((await persisted())!.state.financialProjections).toHaveLength(1);

    LOCAL_STORE_RESETS.find((entry) => entry.key === KEY)!.reset();

    expect(state()).toMatchObject({
      trips: [], expenses: [], packingItems: [], participants: [], myUserId: null,
      financialProjections: [], financialProjectionFreshAt: {}, financialProjectionStatus: {},
    });
    expect((await persisted())!.state).toMatchObject({
      trips: [], financialProjections: [], financialProjectionFreshAt: {}, financialProjectionStatus: {},
    });
  });

  it('D–H: an answer in flight at log out cannot repopulate memory, or write to disk afterwards', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    server.holdProjections = true;
    const inFlight = refresh();
    await settle();
    expect(server.heldProjections).toHaveLength(1);

    await clearLocalUserData(LOCAL_STORE_RESETS);
    server.user = null;
    server.heldProjections[0].deliver();

    expect(await inFlight).toBe(false);
    expect(state().financialProjections).toEqual([]);
    expect(state().financialProjectionFreshAt).toEqual({});
    expect(state().financialProjectionStatus).toEqual({});
    // The sweep removed the key and nothing wrote the old account's answer back.
    expect(await persisted()).toBeNull();
  });

  it('I: account switch — an answer requested for the previous account never lands in the next one', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    seedLinked(OWNER, 'e2', '50.00');
    server.holdProjections = true;
    const ownersRequest = refresh(); // answered on arrival: e1 + e2
    await settle();

    // Log in as Bob: the cleanup runs before the new session, as signIn does.
    await clearLocalUserData(LOCAL_STORE_RESETS);
    server.user = BOB;
    deleteEconomyExpense(OWNER, 'e2');
    server.holdProjections = false;
    await state().fetchFromSupabase(); // Bob is a participant and loads the same trip id
    expect(state().myUserId).toBe(BOB);
    expect(projectionIds()).toEqual(['e1']);

    server.heldProjections[0].deliver(); // the owner's late answer, still listing e2
    expect(await ownersRequest).toBe(false);
    expect(projectionIds()).toEqual(['e1']);
    expect((await persisted())!.state.financialProjections.map((row: TripFinancialProjection) => row.expenseId)).toEqual(['e1']);
  });

  it('a session that changes WITHOUT a cleanup still cannot receive the previous account\'s answer', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    server.holdProjections = true;
    const inFlight = refresh();
    await settle();
    server.user = BOB; // e.g. another account's password-recovery link
    server.heldProjections[0].deliver();
    expect(await inFlight).toBe(false);
    expect(state().financialProjections).toEqual([]);
    expect(state().financialProjectionStatus).toEqual({});
  });

  it('a trip fetch in flight at log out writes no trips and starts no projection request', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    useTripsStore.setState({ trips: [] });
    let open!: () => void;
    server.readGate = new Promise((resolve) => { open = resolve; });
    const fetching = state().fetchFromSupabase();
    await settle();

    await clearLocalUserData(LOCAL_STORE_RESETS);
    server.user = BOB;
    open();
    await fetching;

    expect(state().trips).toEqual([]);
    expect(state().myUserId).toBeNull();
    expect(server.rpcCalls.filter((call) => call.name === 'trip_financial_projection')).toEqual([]);
    expect(await persisted()).toBeNull();
  });
});

describe('finding 3 — a cached projection is never presented as current', () => {
  it('freshness is never written to disk, and a restart brings the snapshot back only as stale', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    expect(await refresh()).toBe(true);
    expect(freshness()).toBe('fresh');
    expect((await persisted())!.state.financialProjectionStatus).toEqual({ [TRIP]: 'stale' });

    await useTripsStore.persist.rehydrate(); // a restart reads the disk again
    expect(projectionIds()).toEqual(['e1']); // still there to show...
    expect(state().financialProjectionStatus).toEqual({ [TRIP]: 'stale' }); // ...but not current
    expect(freshness()).toBe('stale');
  });

  it('a payload that claims to be fresh (older build or tampering) is still demoted on hydration', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({
      version: 1,
      state: {
        trips: [localTrip()], expenses: [], packingItems: [], participants: [], myUserId: OWNER,
        financialProjections: [projectionRow('e1')],
        financialProjectionFreshAt: { [TRIP]: '2026-10-01T00:00:00.000Z' },
        financialProjectionStatus: { [TRIP]: 'fresh' },
      },
    }));
    await useTripsStore.persist.rehydrate();
    expect(projectionIds()).toEqual(['e1']);
    expect(state().financialProjectionStatus).toEqual({ [TRIP]: 'stale' });
    expect(freshness()).toBe('stale');
  });

  it('A: an older answer cannot overwrite a newer, empty one', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    server.holdProjections = true;
    const older = refresh();
    await settle();
    deleteEconomyExpense(OWNER, 'e1');
    const newer = refresh();
    await settle();
    expect(server.heldProjections).toHaveLength(2);

    server.heldProjections[1].deliver();
    expect(await newer).toBe(true);
    expect(projectionIds()).toEqual([]);
    server.heldProjections[0].deliver(); // still lists e1
    expect(await older).toBe(false);
    expect(projectionIds()).toEqual([]);
    expect(freshness()).toBe('fresh');
  });

  it('A2: an older failure cannot mark a newer answer stale', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    server.holdProjections = true;
    const older = refresh();
    await settle(); // the older request has reached the server
    const newer = refresh();
    await settle();
    expect(server.heldProjections).toHaveLength(2);
    server.heldProjections[1].deliver();
    expect(await newer).toBe(true);
    server.heldProjections[0].fail();
    expect(await older).toBe(false);
    expect(state().financialProjectionStatus[TRIP]).toBe('fresh');
  });

  it('a request superseded before it was even sent is never sent at all', async () => {
    server.holdProjections = true;
    const older = refresh();
    const newer = refresh(); // issued in the same tick
    await settle();
    expect(server.heldProjections).toHaveLength(1);
    server.heldProjections[0].deliver();
    expect(await newer).toBe(true);
    expect(await older).toBe(false);
  });

  it('B: an answer in flight when the trip is deleted cannot resurrect its projection', async () => {
    const DOOMED = 'trip-to-delete'; // a deleted id stays "gone" for the process
    server.trips.push(serverTrip(DOOMED));
    useTripsStore.setState({ trips: [localTrip(), localTrip({ id: DOOMED })] });
    seedLinked(OWNER, 'doomed-expense', '10.00', DOOMED);
    server.holdProjections = true;
    const inFlight = refresh(DOOMED);
    await settle();

    expect(await state().deleteTrip(DOOMED, { expenses: 1, packingItems: 0, participants: 0, documents: 0 })).toEqual({ ok: true });
    server.heldProjections[0].deliver();

    expect(await inFlight).toBe(false);
    expect(projectionIds(DOOMED)).toEqual([]);
    expect(state().financialProjectionFreshAt).not.toHaveProperty(DOOMED);
    expect(state().financialProjectionStatus).not.toHaveProperty(DOOMED);
    expect(state().trips.map((trip) => trip.id)).toEqual([TRIP]);
  });

  it('D: after a participant is removed, the next refresh removes the projection they may no longer see', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    server.user = BOB;
    useTripsStore.setState({ myUserId: BOB });
    expect(await refresh()).toBe(true);
    expect(projectionIds()).toEqual(['e1']);

    server.participants = []; // the owner removes Bob
    expect(await refresh()).toBe(true);
    expect(projectionIds()).toEqual([]);
  });

  it('D2: if that refresh cannot reach the server, the old rows remain only as stale', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    server.user = BOB;
    useTripsStore.setState({ myUserId: BOB });
    expect(await refresh()).toBe(true);
    server.participants = [];
    server.failProjection = true;
    expect(await refresh()).toBe(false);
    expect(projectionIds()).toEqual(['e1']);
    expect(freshness()).toBe('stale');
  });

  it('E: deleting an Economy expense, then refreshing, updates the settled total', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    seedLinked(OWNER, 'e2', '25.50');
    expect(await refresh()).toBe(true);
    expect(settledTripSpend(state().financialProjections)).toBe(12_550);

    deleteEconomyExpense(OWNER, 'e2'); // its link cascades
    expect(await refresh()).toBe(true);
    expect(settledTripSpend(state().financialProjections)).toBe(10_000);
    expect(freshness()).toBe('fresh');
  });

  it('F: an offline refresh keeps the saved rows, but only as stale', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    expect(await refresh()).toBe(true);
    server.failProjection = true;
    expect(await refresh()).toBe(false);
    expect(projectionIds()).toEqual(['e1']);
    expect(freshness()).toBe('stale');
  });

  it('a trip with no snapshot at all is unavailable — never a total of zero', async () => {
    server.failProjection = true;
    expect(await refresh()).toBe(false);
    expect(freshness()).toBe('unavailable');
  });

  it('without a session nothing is requested and the saved snapshot stays unconfirmed', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    expect(await refresh()).toBe(true);
    server.user = null;
    server.rpcCalls.length = 0;
    expect(await refresh()).toBe(false);
    expect(server.rpcCalls).toEqual([]);
    expect(freshness()).toBe('stale');
  });
});

describe('review #2 HIGH #3 — canonical Economy mutations invalidate Travel', () => {
  it('invalidates every loaded trip when an edit races an older answer before any projection was cached', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    useExpensesStore.setState({ expenses: [localEconomyExpense('e1')] });
    server.holdProjections = true;
    const older = refresh();
    await settle();

    useExpensesStore.getState().updateExpense('e1', { amount: minorUnits(25_000) });
    await settle();
    expect(server.heldProjections).toHaveLength(2);
    server.heldProjections[0].deliver();
    expect(await older).toBe(false);
    expect(freshness()).toBe('unavailable');

    server.heldProjections[1].deliver();
    await settle();
    expect(freshness()).toBe('fresh');
    expect(state().financialProjections.find((row) => row.expenseId === 'e1')?.amount).toBe(25_000);
  });

  it('invalidates every loaded trip when a delete races an older answer before any projection was cached', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    useExpensesStore.setState({ expenses: [localEconomyExpense('e1')] });
    server.holdProjections = true;
    const older = refresh();
    await settle();

    useExpensesStore.getState().removeExpense('e1');
    await settle();
    expect(server.heldProjections).toHaveLength(2);
    server.heldProjections[0].deliver();
    expect(await older).toBe(false);
    expect(freshness()).toBe('unavailable');

    server.heldProjections[1].deliver();
    await settle();
    expect(projectionIds()).toEqual([]);
    expect(freshness()).toBe('fresh');
  });

  it('an actual Economy edit is stale immediately and becomes fresh only after the post-commit projection answer', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    useExpensesStore.setState({ expenses: [localEconomyExpense('e1')] });
    expect(await refresh()).toBe(true);
    expect(freshness()).toBe('fresh');

    server.holdProjections = true;
    useExpensesStore.getState().updateExpense('e1', { amount: minorUnits(25_000) });
    expect(freshness()).toBe('stale');
    await settle();
    expect(server.heldProjections).toHaveLength(1);
    expect(freshness()).toBe('stale');

    server.heldProjections[0].deliver();
    await settle();
    expect(freshness()).toBe('fresh');
    expect(state().financialProjections.find((row) => row.expenseId === 'e1')?.amount).toBe(25_000);
  });

  it('a held pre-delete answer cannot restore a removed expense; only the post-delete answer becomes fresh', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    useExpensesStore.setState({ expenses: [localEconomyExpense('e1')] });
    expect(await refresh()).toBe(true);

    server.holdProjections = true;
    const older = refresh(); // captured while e1 still exists
    await settle();
    expect(server.heldProjections).toHaveLength(1);

    useExpensesStore.getState().removeExpense('e1');
    expect(freshness()).toBe('stale');
    await settle(); // deletion commits, then its authoritative refresh is held
    expect(server.heldProjections).toHaveLength(2);

    server.heldProjections[0].deliver();
    expect(await older).toBe(false);
    expect(freshness()).toBe('stale');
    server.heldProjections[1].deliver();
    await settle();
    expect(projectionIds()).toEqual([]);
    expect(freshness()).toBe('fresh');
  });

  it('failed update and delete mutations remain stale and never start an authoritative refresh', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    useExpensesStore.setState({ expenses: [localEconomyExpense('e1')] });
    expect(await refresh()).toBe(true);
    server.holdProjections = true;
    server.failingWrites.add('expenses');

    useExpensesStore.getState().updateExpense('e1', { amount: minorUnits(30_000) });
    expect(freshness()).toBe('stale');
    await settle();
    expect(server.heldProjections).toEqual([]);

    server.failingWrites.clear();
    expect(await (async () => {
      server.holdProjections = false;
      return refresh();
    })()).toBe(true);
    server.holdProjections = true;
    server.failingTables.add('expenses');
    useExpensesStore.getState().removeExpense('e1');
    expect(freshness()).toBe('stale');
    await settle();
    expect(server.heldProjections).toEqual([]);
    expect(server.expenses.some((row) => row.id === 'e1')).toBe(true);
  });

  it('repeated edits supersede the earlier post-commit refresh and publish only the latest amount', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    useExpensesStore.setState({ expenses: [localEconomyExpense('e1')] });
    expect(await refresh()).toBe(true);
    server.holdProjections = true;

    useExpensesStore.getState().updateExpense('e1', { amount: minorUnits(20_000) });
    useExpensesStore.getState().updateExpense('e1', { amount: minorUnits(30_000) });
    expect(freshness()).toBe('stale');
    await settle();
    expect(server.heldProjections).toHaveLength(1);
    server.heldProjections[0].deliver();
    await settle();
    expect(freshness()).toBe('fresh');
    expect(state().financialProjections.find((row) => row.expenseId === 'e1')?.amount).toBe(30_000);
  });

  it('an account/authorization change cannot mark the old account projection fresh', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    useExpensesStore.setState({ expenses: [localEconomyExpense('e1')] });
    expect(await refresh()).toBe(true);
    server.user = BOB;
    useExpensesStore.getState().updateExpense('e1', { amount: minorUnits(40_000) });
    expect(freshness()).toBe('stale');
    await settle();
    expect(freshness()).toBe('stale');
  });

  it('an update queued for A cannot upsert the same expense id into B after an in-place session switch', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    server.expenses.push({ ...server.expenses[0], user_id: BOB, amount: '777.00' });
    useExpensesStore.setState({ expenses: [localEconomyExpense('e1')] });
    const gate = deferred();
    server.writeGates.set('expenses', gate.promise);

    useExpensesStore.getState().updateExpense('e1', { amount: minorUnits(20_000) });
    await settle();
    useExpensesStore.getState().updateExpense('e1', { amount: minorUnits(30_000) });
    server.user = BOB;
    useAuthStore.setState({ session: { user: { id: BOB } } as any });
    server.writeGates.delete('expenses');
    gate.resolve();
    await settle();

    expect(server.tableMutationCalls.filter((call) => call.table === 'expenses')).toEqual([
      { table: 'expenses', operation: 'upsert', user: OWNER },
    ]);
    expect(server.expenses.find((row) => row.user_id === OWNER && row.id === 'e1')?.amount).toBe('200.00');
    expect(server.expenses.find((row) => row.user_id === BOB && row.id === 'e1')?.amount).toBe('777.00');
  });

  it('a delete queued for A cannot delete B\'s same-id expense after an in-place session switch', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    server.expenses.push({ ...server.expenses[0], user_id: BOB, amount: '777.00' });
    useExpensesStore.setState({ expenses: [localEconomyExpense('e1')] });
    const gate = deferred();
    server.writeGates.set('expenses', gate.promise);

    useExpensesStore.getState().updateExpense('e1', { amount: minorUnits(20_000) });
    await settle();
    useExpensesStore.getState().removeExpense('e1');
    server.user = BOB;
    useAuthStore.setState({ session: { user: { id: BOB } } as any });
    server.writeGates.delete('expenses');
    gate.resolve();
    await settle();

    expect(server.tableMutationCalls.filter((call) => call.table === 'expenses')).toEqual([
      { table: 'expenses', operation: 'upsert', user: OWNER },
    ]);
    expect(server.expenses.some((row) => row.user_id === OWNER && row.id === 'e1')).toBe(true);
    expect(server.expenses.find((row) => row.user_id === BOB && row.id === 'e1')?.amount).toBe('777.00');
  });

  it('a queued A mutation may continue after the session safely switches back to A before execution', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    server.expenses.push({ ...server.expenses[0], user_id: BOB, amount: '777.00' });
    useExpensesStore.setState({ expenses: [localEconomyExpense('e1')] });
    const gate = deferred();
    server.writeGates.set('expenses', gate.promise);

    useExpensesStore.getState().updateExpense('e1', { amount: minorUnits(20_000) });
    await settle();
    useExpensesStore.getState().updateExpense('e1', { amount: minorUnits(30_000) });
    server.user = BOB;
    useAuthStore.setState({ session: { user: { id: BOB } } as any });
    server.user = OWNER;
    useAuthStore.setState({ session: { user: { id: OWNER } } as any });
    server.writeGates.delete('expenses');
    gate.resolve();
    await settle();

    expect(server.tableMutationCalls.filter((call) => call.table === 'expenses')).toEqual([
      { table: 'expenses', operation: 'upsert', user: OWNER },
      { table: 'expenses', operation: 'upsert', user: OWNER },
    ]);
    expect(server.expenses.find((row) => row.user_id === OWNER && row.id === 'e1')?.amount).toBe('300.00');
    expect(server.expenses.find((row) => row.user_id === BOB && row.id === 'e1')?.amount).toBe('777.00');
  });

  it('a mutation initiated after logout performs no server mutation or authoritative refresh', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    useExpensesStore.setState({ expenses: [localEconomyExpense('e1')] });
    expect(await refresh()).toBe(true);
    server.user = null;
    useAuthStore.setState({ session: null });
    server.rpcCalls.length = 0;
    server.tableMutationCalls.length = 0;

    useExpensesStore.getState().updateExpense('e1', { amount: minorUnits(40_000) });
    await settle();

    expect(server.tableMutationCalls).toEqual([]);
    expect(server.rpcCalls).toEqual([]);
    expect(server.expenses.find((row) => row.user_id === OWNER && row.id === 'e1')?.amount).toBe('100.00');
    expect(freshness()).toBe('fresh');
  });
});

describe('finding 6 — restoring a backup invalidates the projection cache', () => {
  const backupFile = (trips: Record<string, unknown>) =>
    JSON.stringify({ version: 7, exportedAt: '2026-10-05T00:00:00.000Z', data: { trips } });
  const restoredTravel = {
    trips: [localTrip({ name: 'Restored' })], expenses: [], packingItems: [], participants: [],
  };

  it('A–E: the old projections and their freshness are gone after one write, and nothing claims to be fresh', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    expect(await refresh()).toBe(true);
    expect(freshness()).toBe('fresh');

    const published: ReturnType<typeof state>[] = [];
    const unsubscribe = useTripsStore.subscribe((next) => published.push(next));
    mockFileContent = backupFile(restoredTravel);
    expect(await importBackup()).toMatchObject({ success: true, restoredKeys: ['trips'] });
    unsubscribe();

    // One write: no moment ever held the restored trips beside the old projections.
    expect(published).toHaveLength(1);
    expect(state().trips.map((trip) => trip.name)).toEqual(['Restored']);
    expect(state().financialProjections).toEqual([]);
    expect(state().financialProjectionFreshAt).toEqual({});
    expect(state().financialProjectionStatus).toEqual({});
    expect(freshness()).toBe('unavailable');
    expect((await persisted())!.state).toMatchObject({
      financialProjections: [], financialProjectionFreshAt: {}, financialProjectionStatus: {},
    });
  });

  it('F+G: a backup cannot smuggle in a projection cache or an account, and an earlier answer cannot land after it', async () => {
    seedLinked(OWNER, 'e1', '100.00');
    server.holdProjections = true;
    const inFlight = refresh();
    await settle();

    mockFileContent = backupFile({
      ...restoredTravel,
      myUserId: BOB,
      financialProjections: [projectionRow('smuggled')],
      financialProjectionFreshAt: { [TRIP]: '2026-10-05T00:00:00.000Z' },
      financialProjectionStatus: { [TRIP]: 'fresh' },
    });
    expect(await importBackup()).toMatchObject({ success: true });
    server.heldProjections[0].deliver();

    expect(await inFlight).toBe(false);
    expect(state().myUserId).toBe(OWNER);
    expect(state().financialProjections).toEqual([]);
    expect(state().financialProjectionFreshAt).toEqual({});
    expect(state().financialProjectionStatus).toEqual({});
  });
});

describe('password-recovery setSession — another account signed in without a local cleanup', () => {
  afterEach(() => useAuthStore.setState({ session: null, isRecoveringPassword: false }));
  const switchTo = (userId: string) =>
    useAuthStore.getState().beginPasswordRecovery({ accessToken: recoveryAccessToken(userId), refreshToken: 'synthetic' });

  it('1–6: A\'s late answer never lands, A\'s cache is never B\'s, and B\'s own projection then populates normally', async () => {
    useAuthStore.getState().init();
    await settle();
    expect(useAuthStore.getState().session?.user.id).toBe(OWNER);

    // 1. Account A (the owner) has a projection in memory and on disk...
    seedLinked(OWNER, 'e1', '100.00');
    seedLinked(OWNER, 'e2', '50.00');
    expect(await refresh()).toBe(true);
    expect((await persisted())!.state.financialProjections).toHaveLength(2);
    // ...and one more request of A's is still in flight.
    server.holdProjections = true;
    const ownersRequest = refresh();
    await settle();

    // 2. A password-recovery link for account B (Bob) switches the session in place.
    expect(await switchTo(BOB)).toEqual({ error: null });
    expect(useAuthStore.getState()).toMatchObject({ session: { user: { id: BOB } }, isRecoveringPassword: true });
    deleteEconomyExpense(OWNER, 'e2'); // the server moves on after A's answer was computed

    // 3+4. A's in-flight answer resolves and cannot land.
    server.heldProjections[0].deliver();
    expect(await ownersRequest).toBe(false);

    // 5. The cache is still A's, and it is not B's: B is shown none of it, and B's
    // answers cannot be mixed into A's dataset either.
    expect(state().myUserId).toBe(OWNER);
    expect(projectionVisibleTo(state().myUserId, BOB)).toBe(false);
    server.holdProjections = false;
    expect(await refresh()).toBe(false);
    expect(projectionIds()).toEqual(['e1', 'e2']); // A's own rows, untouched and hidden from B

    // 6. B's trip fetch (the root layout runs it for the new session) takes the dataset
    // over: A's cache is dropped and B's own projection populates normally.
    await state().fetchFromSupabase();
    expect(state().myUserId).toBe(BOB);
    expect(projectionVisibleTo(state().myUserId, BOB)).toBe(true);
    expect(projectionIds()).toEqual(['e1']);
    expect(freshness()).toBe('fresh');
    expect((await persisted())!.state.financialProjections.map((row: TripFinancialProjection) => row.expenseId)).toEqual(['e1']);
  });

  it('B\'s fetch drops A\'s whole cache — including trips B cannot see and answers B cannot get', async () => {
    const PRIVATE = 'trip-owner-private';
    server.trips.push(serverTrip(PRIVATE));
    useTripsStore.setState({ trips: [localTrip(), localTrip({ id: PRIVATE })] });
    seedLinked(OWNER, 'private-expense', '75.00', PRIVATE);
    useAuthStore.getState().init();
    await settle();
    expect(await refresh(PRIVATE)).toBe(true);
    expect(projectionIds(PRIVATE)).toEqual(['private-expense']);

    await switchTo(BOB);
    server.failProjection = true; // B's refreshes cannot reach the server at all
    await state().fetchFromSupabase();

    expect(state().myUserId).toBe(BOB);
    expect(projectionIds(PRIVATE)).toEqual([]); // not even as a stale snapshot
    expect(state().financialProjectionFreshAt).not.toHaveProperty(PRIVATE);
    expect(tripSpendFreshness([PRIVATE], state().financialProjectionFreshAt, state().financialProjectionStatus)).toBe('unavailable');
    expect((await persisted())!.state.financialProjections).toEqual([]);
  });
});
