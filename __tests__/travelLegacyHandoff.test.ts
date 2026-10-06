import AsyncStorage from '@react-native-async-storage/async-storage';

import { minorUnits } from '@/core/money/minorUnits';

/**
 * APP-059 review #1, findings 4 and 5.
 *
 *  4. A resolved legacy Travel expense keeps its attachments until the canonical
 *     Economy expense durably owns them: through a failed or incomplete Economy
 *     refresh, a process that dies between the steps, a restart and any number of
 *     retries. The encrypted adapter is the real APP-029 one, so "durable" is proved
 *     through the same bytes-on-disk path a device takes.
 *  5. Who may resolve a legacy row follows the server's `trip_expenses.user_id`, and
 *     the client fails closed where authorship cannot be established.
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
jest.mock('@/lib/supabase', () => ({ supabase: require('@/__tests__/helpers/fakeTravelServer').fakeSupabase }));
jest.mock('@/utils/trip/tripReminder', () => ({ scheduleTripPackingReminder: jest.fn(), cancelTripPackingReminder: jest.fn() }));
const mockDeletedFiles: string[] = [];
jest.mock('@/utils/shared/attachmentStorage', () => ({
  cleanupAttachments: (list?: { uri?: string }[]) => list?.forEach((attachment) => attachment.uri && mockDeletedFiles.push(attachment.uri)),
  deleteCachedAttachmentFile: (uri: string) => { mockDeletedFiles.push(uri); return Promise.resolve(); },
}));

import { resetServer, server, settle } from '@/__tests__/helpers/fakeTravelServer';
import { documentMetadataEncryptedStorage } from '@/core/storage/documentCacheStorage';
import { handOffLegacyAttachments } from '@/features/economy/travelFinancialBridge';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useTripsStore } from '@/store/useTripsStore';
import type { Attachment } from '@/types/attachment';
import type { Trip, TripExpense } from '@/types/trip';

const OWNER = 'bbbbbbbb-0000-4000-8000-000000000001';
const BOB = 'bbbbbbbb-0000-4000-8000-000000000002';
const CAROL = 'bbbbbbbb-0000-4000-8000-000000000003';
const TRIP = 'trip-legacy';
const LEGACY = 'legacy-1693000000000';
const A1: Attachment = { id: 'att-1', uri: 'file:///doc/attachments/att-1.lsenc', name: 'synthetic-receipt.jpg', kind: 'image' };
const A2: Attachment = { id: 'att-2', uri: 'file:///doc/attachments/att-2.lsenc', name: 'synthetic-ticket.pdf', kind: 'document' };
const A3: Attachment = { id: 'att-3', uri: 'file:///doc/attachments/att-3.lsenc', name: 'synthetic-late.jpg', kind: 'image' };

const localTrip = (overrides: Partial<Trip> = {}): Trip => ({
  id: TRIP, ownerId: OWNER, name: 'Legacy trip', startDate: '2026-07-01', endDate: '2026-07-08',
  budget: null, documents: [], createdAt: '2026-01-01T00:00:00.000Z', ...overrides,
});
const legacyExpense = (overrides: Partial<TripExpense> = {}): TripExpense => ({
  id: LEGACY, tripId: TRIP, authorId: OWNER, name: 'Train', amount: 25, amountMinor: minorUnits(2_500),
  category: 'transport', attachments: [A1, A2], createdAt: '2020-01-02T00:00:00.000Z',
  resolutionStatus: 'requires-transaction-date', ...overrides,
});
const legacyRow = (id: string, author: string) => ({
  id, user_id: author, trip_id: TRIP, name: 'Synthetic legacy', amount: 25, category: 'transport',
  currency: null, original_amount: null, exchange_rate: null,
});
const resolution = { id: LEGACY, name: 'Train', amount: minorUnits(2_500), category: 'transport' as const, transactionDate: '2026-07-02' };

const trips = () => useTripsStore.getState();
const resolve = (input: Partial<typeof resolution> = {}) => trips().resolveLegacyTripExpense({ ...resolution, ...input });
const refresh = () => trips().refreshTripFinancialProjection(TRIP);
const legacyIds = () => trips().expenses.map((expense) => expense.id);
const legacyAttachmentIds = () => trips().expenses.find((expense) => expense.id === LEGACY)?.attachments.map((a) => a.id);
const economyAttachmentIds = () =>
  useExpensesStore.getState().expenses.find((expense) => expense.id === LEGACY)?.attachments.map((a) => a.id);
const linkCalls = () => server.rpcCalls.filter((call) => call.name === 'link_trip_economy_expense');
async function decrypted(key: string): Promise<{ state: Record<string, any> }> {
  await settle();
  return JSON.parse((await documentMetadataEncryptedStorage.getItem(key))!);
}
const persistedEconomyAttachmentIds = async () => (await decrypted('lifesort-expenses')).state.expenses
  .find((expense: { id: string }) => expense.id === LEGACY)?.attachments.map((a: Attachment) => a.id);
/** A process restart: memory is replaced by whatever actually reached the disk. */
async function restart() {
  await settle();
  await Promise.all([useTripsStore.persist.rehydrate(), useExpensesStore.persist.rehydrate()]);
}
// AsyncStorage.setItem is already a jest.fn (the package mock), so jest.spyOn would hand
// back that same function: keep its own implementation and swap implementations instead.
const setItemMock = AsyncStorage.setItem as jest.Mock;
const realSetItem = setItemMock.getMockImplementation()!;
/** Replaces how AsyncStorage writes for this test only; afterEach puts the real one back. */
function interceptWrites(write: (key: string, value: string) => Promise<unknown>) {
  setItemMock.mockImplementation(write);
  return { restore: () => setItemMock.mockImplementation(realSetItem) };
}
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 400 && !check(); i += 1) await new Promise((r) => setTimeout(r, 0));
  if (!check()) throw new Error(`timed out waiting for ${label}`);
}

afterEach(() => {
  setItemMock.mockImplementation(realSetItem);
});

beforeEach(async () => {
  resetServer();
  server.user = OWNER;
  server.trips = [{
    id: TRIP, user_id: OWNER, name: 'Legacy trip', destination: null, start_date: '2026-07-01', end_date: '2026-07-08',
    budget: null, created_at: '2026-01-01T00:00:00.000Z',
  }];
  server.tripExpenses = [legacyRow(LEGACY, OWNER)];
  mockDeletedFiles.length = 0;
  await AsyncStorage.clear();
  await Promise.all([useTripsStore.persist.rehydrate(), useExpensesStore.persist.rehydrate()]);
  trips().clearLocal();
  useTripsStore.setState({ trips: [localTrip()], expenses: [legacyExpense()], myUserId: OWNER });
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  await settle();
});

describe('finding 4 — the legacy row keeps its attachments until Economy durably owns them', () => {
  it('success: one authoritative association, durable and encrypted, before the legacy row goes', async () => {
    expect(await resolve()).toBe('resolved');

    expect(legacyIds()).toEqual([]);
    expect(economyAttachmentIds()).toEqual(['att-1', 'att-2']);
    expect(await persistedEconomyAttachmentIds()).toEqual(['att-1', 'att-2']);
    expect(await AsyncStorage.getItem('lifesort-expenses')).not.toContain('synthetic-receipt'); // ciphertext only
    expect((await decrypted('lifesort-trips')).state.expenses).toEqual([]);
    expect(mockDeletedFiles).toEqual([]); // the files changed owner; none was deleted
    expect(server.links.map((link) => link.legacy_trip_expense_id)).toEqual([LEGACY]);
    expect(server.tripExpenses).toEqual([]);
  });

  it('A: the server resolved it but the Economy refresh throws — the attachments stay on the legacy row', async () => {
    server.throwingTables.add('expenses');
    expect(await resolve()).toBe('attachments-pending'); // saved — not a failed save

    expect(server.expenses.map((row) => row.id)).toEqual([LEGACY]); // the server DID commit
    expect(legacyAttachmentIds()).toEqual(['att-1', 'att-2']);
    expect((await decrypted('lifesort-trips')).state.expenses[0].attachments.map((a: Attachment) => a.id)).toEqual(['att-1', 'att-2']);
    expect(economyAttachmentIds()).toBeUndefined();
    expect(mockDeletedFiles).toEqual([]);

    server.throwingTables.clear(); // Economy can be read again: the next refresh completes it
    expect(await refresh()).toBe(true);
    expect(legacyIds()).toEqual([]);
    expect(await persistedEconomyAttachmentIds()).toEqual(['att-1', 'att-2']);
  });

  it('B: the refresh answers without the new expense — the attachments stay on the legacy row', async () => {
    server.hiddenRowIds.add(LEGACY); // e.g. a replica that has not caught up
    expect(await resolve()).toBe('attachments-pending');
    expect(legacyAttachmentIds()).toEqual(['att-1', 'att-2']);
    expect(economyAttachmentIds()).toBeUndefined();

    server.hiddenRowIds.clear();
    expect(await refresh()).toBe(true);
    expect(legacyIds()).toEqual([]);
    expect(economyAttachmentIds()).toEqual(['att-1', 'att-2']);
  });

  it('C+D: the process dies right after the server commit; after a restart the attachments are reachable and start-up completes the handoff', async () => {
    server.lostLinkAnswers = 1; // committed, answer lost...
    server.failProjection = true; // ...and nothing else gets through before the process dies
    expect(await resolve()).toBe('failed'); // nothing is known to have been saved

    await restart();
    expect(legacyAttachmentIds()).toEqual(['att-1', 'att-2']); // still reachable after the restart
    expect(economyAttachmentIds()).toBeUndefined();

    server.failProjection = false;
    await trips().fetchFromSupabase(); // the ordinary start-up path
    expect(legacyIds()).toEqual([]);
    expect(economyAttachmentIds()).toEqual(['att-1', 'att-2']);
    expect(await persistedEconomyAttachmentIds()).toEqual(['att-1', 'att-2']);
    expect((await decrypted('lifesort-trips')).state.expenses).toEqual([]);
  });

  it('E: the process dies after Economy is durable but before the legacy removal reached disk; restart and retries converge on one association', async () => {
    const travelWritesLost = interceptWrites((key, value) => (key === 'lifesort-trips' ? Promise.resolve() : realSetItem(key, value)));
    expect(await resolve()).toBe('resolved');
    await settle(); // every Travel write queued so far is lost with the process
    travelWritesLost.restore();

    await restart();
    expect(legacyAttachmentIds()).toEqual(['att-1', 'att-2']); // the legacy row came back from disk...
    expect(economyAttachmentIds()).toEqual(['att-1', 'att-2']); // ...and Economy already owns the files

    expect(await refresh()).toBe(true);
    expect(await refresh()).toBe(true);
    expect(legacyIds()).toEqual([]);
    expect(economyAttachmentIds()).toEqual(['att-1', 'att-2']); // exactly once each
    expect(await persistedEconomyAttachmentIds()).toEqual(['att-1', 'att-2']);
    expect(mockDeletedFiles).toEqual([]);
  });

  it('in that window, deleting the legacy row or its trip never deletes a file Economy now owns', async () => {
    // Its own trip: a removed trip id stays "gone" for the rest of the process (APP-058).
    const WINDOW_TRIP = 'trip-window';
    server.trips = [{ ...server.trips[0], id: WINDOW_TRIP }];
    server.tripExpenses = [{ ...legacyRow(LEGACY, OWNER), trip_id: WINDOW_TRIP }];
    useTripsStore.setState({ trips: [localTrip({ id: WINDOW_TRIP })], expenses: [legacyExpense({ tripId: WINDOW_TRIP })] });
    await settle();
    const travelWritesLost = interceptWrites((key, value) => (key === 'lifesort-trips' ? Promise.resolve() : realSetItem(key, value)));
    expect(await resolve()).toBe('resolved');
    await settle(); // every Travel write queued so far is lost with the process
    travelWritesLost.restore();
    await restart();

    trips().removeExpenseAttachment(LEGACY, 'att-1');
    trips().removeTripExpense(LEGACY);
    trips().removeTripFromDevice(WINDOW_TRIP);
    expect(mockDeletedFiles).toEqual([]);
    expect(economyAttachmentIds()).toEqual(['att-1', 'att-2']);
  });

  it('repeated retries never duplicate an attachment association', async () => {
    server.lostLinkAnswers = 1; // the answer is lost; the refresh after it proves the save and settles the handoff
    expect(await resolve()).toBe('resolved'); // the server's record shows this very submission
    expect(legacyIds()).toEqual([]);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await handOffLegacyAttachments(LEGACY, [A1, A2])).toBe('durable');
      expect(await refresh()).toBe(true);
    }
    expect(economyAttachmentIds()).toEqual(['att-1', 'att-2']);
    expect(await persistedEconomyAttachmentIds()).toEqual(['att-1', 'att-2']);
    expect(server.expenses).toHaveLength(1);
    expect(server.links).toHaveLength(1);
  });

  it('orders an older no-attachment write before the durable handoff write, so restart cannot lose metadata', async () => {
    // Economy already knows the canonical row, without the legacy files yet.
    useExpensesStore.setState({
      expenses: [{
        id: LEGACY, seriesId: LEGACY, isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null,
        name: 'Train', amount: minorUnits(2_500), category: 'transport', nextPaymentDate: '2026-07-02',
        attachments: [], createdAt: '2026-10-05T10:00:00.000Z',
      }],
    });
    await settle();

    let releaseOlder!: () => void;
    const olderHeld = new Promise<void>((release) => { releaseOlder = release; });
    let olderStarted = false;
    let holdNextEconomyWrite = true;
    interceptWrites(async (key, value) => {
      if (key === 'lifesort-expenses' && holdNextEconomyWrite) {
        holdNextEconomyWrite = false;
        olderStarted = true;
        await olderHeld;
      }
      return realSetItem(key, value);
    });

    // This stale snapshot contains no attachments and is physically held open.
    useExpensesStore.setState((state) => ({
      expenses: state.expenses.map((expense) => ({ ...expense, name: 'Train refreshed' })),
    }));
    await until(() => olderStarted, 'the older Economy write to start');

    let handoffSettled = false;
    const handoff = handOffLegacyAttachments(LEGACY, [A1, A2]).then((result) => {
      handoffSettled = true;
      return result;
    });
    await settle(5);
    // The confirming write/read-back cannot pass the older write. The old
    // implementation returned durable here and was then overwritten on release.
    expect(handoffSettled).toBe(false);

    releaseOlder();
    expect(await handoff).toBe('durable');
    await useExpensesStore.persist.rehydrate();
    expect(economyAttachmentIds()).toEqual(['att-1', 'att-2']);
    expect(await persistedEconomyAttachmentIds()).toEqual(['att-1', 'att-2']);
  });

  it('an attachment added to the legacy row during the handoff keeps the row until it is handed over too', async () => {
    let releaseEconomyWrites!: () => void;
    const economyWritesHeld = new Promise<void>((release) => { releaseEconomyWrites = release; });
    interceptWrites(async (key, value) => {
      if (key === 'lifesort-expenses') await economyWritesHeld;
      return realSetItem(key, value);
    });

    const resolving = resolve();
    await until(() => economyAttachmentIds()?.length === 2, 'the handoff to reach its durable write');
    trips().addExpenseAttachment(LEGACY, A3);
    releaseEconomyWrites();

    expect(await resolving).toBe('resolved'); // the second pass (the refresh) handed A3 over as well
    expect(legacyIds()).toEqual([]);
    expect(economyAttachmentIds()).toEqual(['att-1', 'att-2', 'att-3']);
  });

  it('Economy\'s late attachment answer for the new expense cannot drop the handed-over attachments', async () => {
    // Uploaded to the new Economy expense from another device; Economy's answer about it
    // arrives only after the handoff has completed and the legacy row is gone.
    server.attachments = [{ id: 'att-remote', user_id: OWNER, owner_type: 'expense', owner_id: LEGACY, storage_path: `${OWNER}/expense/${LEGACY}/att-remote.jpg`, name: 'synthetic-remote.jpg', kind: 'image' }];
    let releaseAttachmentAnswer!: () => void;
    server.tableGates.set('attachments', new Promise<void>((release) => { releaseAttachmentAnswer = release; }));

    expect(await resolve()).toBe('resolved');
    expect(legacyIds()).toEqual([]);
    expect(economyAttachmentIds()).toEqual(['att-1', 'att-2']);

    releaseAttachmentAnswer();
    await settle();
    expect(economyAttachmentIds()).toEqual(['att-remote', 'att-1', 'att-2']);
  });
});

describe('finding 5 — the server-known author decides who may resolve', () => {
  const asParticipant = (userId: string) => {
    server.user = userId;
    server.participants = [BOB, CAROL].map((user) => ({
      trip_id: TRIP, owner_id: OWNER, user_id: user, invited_email: `${user}@example.test`, status: 'accepted',
      invited_at: '2026-01-02T00:00:00.000Z',
    }));
    trips().clearLocal();
  };

  it('A–D: a participant\'s row fetched by another account carries its author, and no resolution is attempted', async () => {
    server.tripExpenses = [legacyRow('legacy-owner', OWNER), legacyRow('legacy-bob', BOB)];
    asParticipant(CAROL);
    await trips().fetchFromSupabase();

    const byId = Object.fromEntries(trips().expenses.map((expense) => [expense.id, expense.authorId]));
    expect(byId).toEqual({ 'legacy-owner': OWNER, 'legacy-bob': BOB });
    expect(await resolve({ id: 'legacy-bob' })).toBe('failed');
    expect(await resolve({ id: 'legacy-owner' })).toBe('failed');
    expect(linkCalls()).toEqual([]);
  });

  it('E: an owner-authored row stays resolvable by the owner', async () => {
    useTripsStore.setState({ expenses: [] });
    await trips().fetchFromSupabase();
    expect(trips().expenses.find((expense) => expense.id === LEGACY)?.authorId).toBe(OWNER);
    useTripsStore.setState({ expenses: trips().expenses.map((expense) => ({ ...expense, attachments: [A1] })) });
    expect(await resolve()).toBe('resolved');
    expect(linkCalls()).toHaveLength(1);
  });

  it('the participant\'s own row stays resolvable by that participant', async () => {
    server.tripExpenses = [legacyRow('legacy-bob', BOB)];
    asParticipant(BOB);
    await trips().fetchFromSupabase();
    expect(await resolve({ id: 'legacy-bob' })).toBe('resolved');
    expect(linkCalls().map((call) => call.args.p_legacy_trip_expense_id)).toEqual(['legacy-bob']);
  });

  it('a row stored before authors were kept learns its author from the next fetch', async () => {
    server.tripExpenses = [legacyRow('legacy-owner', OWNER)];
    asParticipant(BOB);
    useTripsStore.setState({
      trips: [localTrip()],
      expenses: [legacyExpense({ id: 'legacy-owner', authorId: undefined, attachments: [] })],
    });
    await trips().fetchFromSupabase();
    expect(trips().expenses.find((expense) => expense.id === 'legacy-owner')?.authorId).toBe(OWNER);
    expect(await resolve({ id: 'legacy-owner' })).toBe('failed');
    expect(linkCalls()).toEqual([]);
  });

  it('the server\'s author replaces a contradicting local one; a row the server does not return keeps its own', async () => {
    server.tripExpenses = [legacyRow('legacy-owner', OWNER)];
    asParticipant(BOB);
    useTripsStore.setState({
      trips: [localTrip()],
      expenses: [
        legacyExpense({ id: 'legacy-owner', authorId: BOB, attachments: [] }), // e.g. from an edited backup
        legacyExpense({ id: 'device-only', authorId: BOB, attachments: [] }),
      ],
    });
    await trips().fetchFromSupabase();
    const byId = Object.fromEntries(trips().expenses.map((expense) => [expense.id, expense.authorId]));
    expect(byId).toEqual({ 'legacy-owner': OWNER, 'device-only': BOB });
  });

  it('F: an unknown author fails closed wherever authorship cannot be established', async () => {
    const unattributed = legacyExpense({ authorId: undefined, attachments: [] });

    // Someone else's trip: an unattributed row there could be anybody's.
    asParticipant(BOB);
    useTripsStore.setState({ trips: [localTrip()], expenses: [unattributed] });
    expect(await resolve()).toBe('failed');

    // A trip whose owner is not known.
    server.user = OWNER;
    useTripsStore.setState({ trips: [localTrip({ ownerId: undefined })], expenses: [unattributed] });
    expect(await resolve()).toBe('failed');

    // Nobody signed in.
    server.user = null;
    useTripsStore.setState({ trips: [localTrip()], expenses: [unattributed] });
    expect(await resolve()).toBe('failed');
    expect(linkCalls()).toEqual([]);

    // Control: the owner's own unattributed (device-only) history on the owner's own trip.
    server.user = OWNER;
    server.tripExpenses = [];
    expect(await resolve()).toBe('resolved');
    expect(linkCalls()).toHaveLength(1);
  });
});

describe('the result of a resolution — a saved resolution is never reported as a failed save', () => {
  it('A–D: the server resolves it while the handoff cannot finish yet → attachments-pending, attachments still reachable', async () => {
    server.throwingTables.add('expenses'); // Economy cannot be read, so its durable copy cannot be confirmed
    expect(await resolve()).toBe('attachments-pending');

    // A: the canonical financial resolution succeeded, and it counts.
    expect(server.expenses.map((row) => row.id)).toEqual([LEGACY]);
    expect(server.links.map((row) => [row.expense_id, row.legacy_trip_expense_id])).toEqual([[LEGACY, LEGACY]]);
    expect(trips().financialProjections.map((row) => row.expenseId)).toEqual([LEGACY]);
    expect(trips().financialProjectionStatus[TRIP]).toBe('fresh');
    // B: the attachment handoff is pending — Economy does not own the attachments yet.
    expect(economyAttachmentIds()).toBeUndefined();
    // D: the legacy row still owns them, in memory and on disk.
    expect(legacyAttachmentIds()).toEqual(['att-1', 'att-2']);
    expect((await decrypted('lifesort-trips')).state.expenses[0].attachments.map((a: Attachment) => a.id)).toEqual(['att-1', 'att-2']);
    expect(mockDeletedFiles).toEqual([]);
  });

  it('E: a later refresh completes the handoff', async () => {
    server.throwingTables.add('expenses');
    expect(await resolve()).toBe('attachments-pending');

    server.throwingTables.clear();
    expect(await refresh()).toBe(true);
    expect(legacyIds()).toEqual([]);
    expect(economyAttachmentIds()).toEqual(['att-1', 'att-2']);
    expect(await persistedEconomyAttachmentIds()).toEqual(['att-1', 'att-2']);
  });

  it('F: retrying while pending, and once more until it completes, never duplicates the Economy expense or an attachment', async () => {
    server.throwingTables.add('expenses');
    expect(await resolve()).toBe('attachments-pending');
    expect(await resolve()).toBe('attachments-pending'); // the same submission again: idempotent

    server.throwingTables.clear();
    expect(await resolve()).toBe('resolved'); // a retry completes it
    expect(linkCalls()).toHaveLength(3);
    expect(server.expenses).toHaveLength(1);
    expect(server.links).toHaveLength(1);
    expect(legacyIds()).toEqual([]);
    expect(economyAttachmentIds()).toEqual(['att-1', 'att-2']);
    expect(await persistedEconomyAttachmentIds()).toEqual(['att-1', 'att-2']);
  });

  it('a lost answer is still reported as saved when the server\'s own record shows this submission', async () => {
    server.lostLinkAnswers = 1;
    server.throwingTables.add('expenses');
    expect(await resolve()).toBe('attachments-pending');
    expect(legacyAttachmentIds()).toEqual(['att-1', 'att-2']);
  });

  it('…but a retry whose details differ from what the server holds is not reported as saved', async () => {
    server.lostLinkAnswers = 1;
    server.failProjection = true;
    expect(await resolve()).toBe('failed'); // the answer and the server's record were both out of reach

    server.failProjection = false;
    server.throwingTables.add('expenses');
    expect(await resolve({ amount: minorUnits(9_900) })).toBe('failed'); // the server holds 25.00, not 99.00
    expect(server.expenses.map((row) => row.amount)).toEqual(['25.00']);
    expect(legacyAttachmentIds()).toEqual(['att-1', 'att-2']);
  });
});
