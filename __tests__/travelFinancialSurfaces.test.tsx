import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';

import { formatDkk, moneyLocaleFor } from '@/core/money/format';
import { minorUnits } from '@/core/money/minorUnits';

/**
 * APP-059 review #1 — what the user actually sees.
 *
 *  3. Every Travel financial surface (the yearly total, the trip summary and the
 *     trip's expense list) labels a saved projection as not current, and shows no
 *     number at all where no snapshot exists.
 *  5. The resolution action is offered only to a legacy row's proven author.
 *  6. Restored trips never show the projection of the dataset they replaced.
 */

let mockFileContent = '';
let mockParams: Record<string, string> = {};
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ setOptions: jest.fn() }),
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/components/DatePickerField', () => {
  const { createElement } = require('react');
  const { TextInput: MockTextInput } = require('react-native');
  return function MockDatePickerField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
    return createElement(MockTextInput, { accessibilityLabel: 'transaction-date', value, onChangeText: onChange });
  };
});
jest.mock('@/components/RingProgress', () => function MockRingProgress() { return null; });
// Neither the documents section, the delete flow nor the attachment grid is under test here.
jest.mock('@/components/TripDocumentsSection', () => function MockTripDocumentsSection() { return null; });
jest.mock('@/components/TripDeleteFlow', () => function MockTripDeleteFlow() { return null; });
jest.mock('@/components/TripAttachmentGrid', () => function MockTripAttachmentGrid() { return null; });
jest.mock('@/lib/supabase', () => ({ supabase: require('@/__tests__/helpers/fakeTravelServer').fakeSupabase }));
jest.mock('@/core/storage/documentCacheStorage', () => ({
  documentMetadataEncryptedStorage: require('@react-native-async-storage/async-storage'),
  deleteCachedAttachmentFile: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/utils/trip/tripReminder', () => ({ scheduleTripPackingReminder: jest.fn(), cancelTripPackingReminder: jest.fn() }));
jest.mock('@/utils/shared/attachmentStorage', () => ({ cleanupAttachments: jest.fn(), deleteCachedAttachmentFile: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///synthetic/',
  readAsStringAsync: jest.fn(() => Promise.resolve(mockFileContent)),
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: false, assets: [{ uri: 'file:///synthetic/backup.json' }] })),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(() => Promise.resolve(false)), shareAsync: jest.fn() }));

import { router } from 'expo-router';

import { recoveryAccessToken, resetServer, server, settle } from '@/__tests__/helpers/fakeTravelServer';
import TripExpensesScreen from '@/app/travel/[id]/expenses/index';
import EditTripExpenseScreen from '@/app/travel/[id]/expenses/edit/[expenseId]';
import TripDetailScreen from '@/app/travel/[id]/index';
import TravelScreen from '@/app/travel/index';
import i18n from '@/localization/i18n';
import { useAuthStore } from '@/store/useAuthStore';
import { useTripsStore } from '@/store/useTripsStore';
import type { Trip, TripExpense, TripFinancialProjection } from '@/types/trip';
import { importBackup } from '@/utils/shared/dataBackup';

const OWNER = 'cccccccc-0000-4000-8000-000000000001';
const BOB = 'cccccccc-0000-4000-8000-000000000002';
const CAROL = 'cccccccc-0000-4000-8000-000000000003';
const TRIP = 'trip-surfaces';
const YEAR = new Date().getFullYear();
const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
const dkk = (amount: number) => formatDkk(minorUnits(amount), moneyLocaleFor('en'));
const STALE = () => t('travel.financialProjectionStale');
const UNAVAILABLE = () => t('travel.spendUnavailable');

const trip: Trip = {
  id: TRIP, ownerId: OWNER, name: 'Synthetic trip', destination: 'Rome', startDate: `${YEAR}-11-01`, endDate: `${YEAR}-11-05`,
  budget: minorUnits(500_000), documents: [], createdAt: `${YEAR}-01-01T00:00:00.000Z`,
};
const projection: TripFinancialProjection = {
  tripId: TRIP, expenseOwnerId: OWNER, expenseId: 'economy-1', name: 'Hotel', amount: minorUnits(123_400),
  category: 'accommodation', transactionDate: `${YEAR}-11-02`, semantic: 'expense', status: 'booked',
};
const legacy = (id: string, authorId: string | undefined): TripExpense => ({
  id, tripId: TRIP, ...(authorId ? { authorId } : {}), name: `Legacy ${id}`, amount: 25, amountMinor: minorUnits(2_500),
  category: 'transport', attachments: [], resolutionStatus: 'requires-transaction-date',
});

const SURFACES: [string, () => React.ReactElement, Record<string, string>][] = [
  ['the yearly total', () => <TravelScreen />, {}],
  ['the trip summary', () => <TripDetailScreen />, { id: TRIP }],
  ['the trip expense list', () => <TripExpensesScreen />, { id: TRIP }],
];

let tree: TestRenderer.ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await settle(2); }); };
async function render(element: React.ReactElement, params: Record<string, string>) {
  mockParams = params;
  await act(async () => { tree?.unmount(); tree = TestRenderer.create(element); });
  await flush();
}
const texts = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const anyTextContains = (fragment: string) => texts().some((text) => text.includes(fragment));
function pressableAncestor(label: string) {
  let node: TestRenderer.ReactTestInstance | null = tree.root.findAllByType(Text).find((candidate) =>
    [candidate.props.children].flat().join('') === label) ?? null;
  while (node) {
    if (node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function') return node;
    node = node.parent;
  }
  return null;
}

/** A snapshot saved to disk by an earlier session, which claimed to be fresh then. */
async function savedSnapshotFromEarlierSession() {
  await AsyncStorage.setItem('lifesort-trips', JSON.stringify({
    version: 2,
    state: {
      trips: [trip], expenses: [], packingItems: [], appliedPackingTemplates: [], participants: [], myUserId: OWNER,
      financialProjections: [projection],
      financialProjectionFreshAt: { [TRIP]: `${YEAR}-10-01T00:00:00.000Z` },
      financialProjectionStatus: { [TRIP]: 'fresh' },
    },
  }));
  await useTripsStore.persist.rehydrate();
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetServer();
  server.user = OWNER;
  server.trips = [{
    id: TRIP, user_id: OWNER, name: 'Synthetic trip', destination: 'Rome', start_date: trip.startDate,
    end_date: trip.endDate, budget: 5000, created_at: trip.createdAt,
  }];
  await i18n.changeLanguage('en');
  await AsyncStorage.clear();
  await useTripsStore.persist.rehydrate();
  useTripsStore.getState().clearLocal();
  useTripsStore.setState({ trips: [trip], myUserId: OWNER });
  useAuthStore.setState({ session: { user: { id: OWNER } } as never });
  await settle();
});
afterEach(() => { act(() => { tree?.unmount(); }); });

describe('finding 3 — no Travel financial surface presents a saved projection as current', () => {
  it.each(SURFACES)('%s: a snapshot read back from disk is shown only with the stale label', async (_name, element, params) => {
    await savedSnapshotFromEarlierSession();
    server.holdProjections = true; // revalidation is still under way
    await render(element(), params);
    expect(anyTextContains(dkk(123_400))).toBe(true);
    expect(texts()).toContain(STALE());
  });

  it.each(SURFACES)('%s: a snapshot the server confirmed in this session carries no stale label', async (_name, element, params) => {
    server.expenses = [{
      id: 'economy-1', user_id: OWNER, name: 'Hotel', amount: '1234.00', category: 'accommodation',
      next_payment_date: `${YEAR}-11-02`, series_id: 'economy-1', is_recurring: false,
      recurrence_frequency: null, recurrence_anchor_day: null, created_at: `${YEAR}-10-01T00:00:00.000Z`,
    }];
    server.links = [{
      trip_id: TRIP, expense_owner_id: OWNER, expense_id: 'economy-1', travel_category: 'accommodation',
      legacy_trip_expense_id: null, currency: null, original_amount: null, exchange_rate: null,
    }];
    await render(element(), params);
    expect(anyTextContains(dkk(123_400))).toBe(true);
    expect(texts()).not.toContain(STALE());
  });

  it.each(SURFACES)('%s: an offline refresh keeps the saved total visible only as stale', async (_name, element, params) => {
    await savedSnapshotFromEarlierSession();
    server.failProjection = true;
    await render(element(), params);
    expect(anyTextContains(dkk(123_400))).toBe(true);
    expect(texts()).toContain(STALE());
  });

  it.each(SURFACES)('%s: with no snapshot at all the spend is unavailable, never zero', async (_name, element, params) => {
    server.holdProjections = true;
    await render(element(), params);
    expect(texts()).toContain(UNAVAILABLE());
    expect(anyTextContains(dkk(0))).toBe(false);
  });
});

describe('finding 5 — the resolution action is offered only to the proven author', () => {
  beforeEach(() => {
    server.participants = [BOB, CAROL].map((user) => ({
      trip_id: TRIP, owner_id: OWNER, user_id: user, invited_email: `${user}@example.test`, status: 'accepted',
      invited_at: `${YEAR}-01-02T00:00:00.000Z`,
    }));
    server.user = CAROL;
    useAuthStore.setState({ session: { user: { id: CAROL } } as never });
    useTripsStore.setState({
      myUserId: CAROL,
      expenses: [legacy('by-bob', BOB), legacy('by-carol', CAROL), legacy('unattributed', undefined)],
    });
  });

  it('C: another participant\'s row (and an unattributed one on someone else\'s trip) has no resolve action', async () => {
    await render(<TripExpensesScreen />, { id: TRIP });
    expect(pressableAncestor('Legacy by-bob')).toBeNull();
    expect(pressableAncestor('Legacy unattributed')).toBeNull();
    expect(texts().filter((text) => text === t('travel.legacyExpenseAuthorOnly'))).toHaveLength(2);

    const own = pressableAncestor('Legacy by-carol');
    expect(own).not.toBeNull();
    await act(async () => { own!.props.onPress(); });
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/travel/[id]/expenses/edit/[expenseId]', params: { id: TRIP, expenseId: 'by-carol' },
    });
  });

  it('C+D: opened directly (e.g. by a link), someone else\'s row offers no resolve button and sends nothing', async () => {
    await render(<EditTripExpenseScreen />, { id: TRIP, expenseId: 'by-bob' });
    expect(texts()).toContain(t('travel.legacyExpenseAuthorOnly'));
    expect(texts()).not.toContain(t('travel.resolveExpense'));
    expect(server.rpcCalls.filter((call) => call.name === 'link_trip_economy_expense')).toEqual([]);

    await render(<EditTripExpenseScreen />, { id: TRIP, expenseId: 'by-carol' });
    expect(texts()).toContain(t('travel.resolveExpense'));
  });
});

describe('finding 6 — restored trips never show the projection they replaced', () => {
  it('F: after a restore the trip summary shows no spend until the server answers for the restored data', async () => {
    await savedSnapshotFromEarlierSession();
    mockFileContent = JSON.stringify({
      version: 7, exportedAt: `${YEAR}-10-05T00:00:00.000Z`,
      data: { trips: { trips: [trip], expenses: [], packingItems: [], participants: [] } },
    });
    expect(await importBackup()).toMatchObject({ success: true, restoredKeys: ['trips'] });

    server.holdProjections = true;
    await render(<TripDetailScreen />, { id: TRIP });
    expect(texts()).toContain(UNAVAILABLE());
    expect(anyTextContains(dkk(123_400))).toBe(false);
  });
});

describe('password-recovery setSession — another account signed in without a local cleanup', () => {
  const ownersProjection = () => {
    server.expenses = [{
      id: 'economy-1', user_id: OWNER, name: 'Hotel', amount: '1234.00', category: 'accommodation',
      next_payment_date: `${YEAR}-11-02`, series_id: 'economy-1', is_recurring: false,
      recurrence_frequency: null, recurrence_anchor_day: null, created_at: `${YEAR}-10-01T00:00:00.000Z`,
    }];
    server.links = [{
      trip_id: TRIP, expense_owner_id: OWNER, expense_id: 'economy-1', travel_category: 'accommodation',
      legacy_trip_expense_id: null, currency: null, original_amount: null, exchange_rate: null,
    }];
  };

  it.each(SURFACES)('%s: the previous account\'s projection is never presented to the new account', async (_name, element, params) => {
    useAuthStore.getState().init();
    await settle();
    ownersProjection();
    expect(await useTripsStore.getState().refreshTripFinancialProjection(TRIP)).toBe(true); // A: confirmed, fresh

    // A recovery link for Bob — a participant who can see the same trip — switches the
    // session in place. No local cleanup runs on this path.
    server.participants = [{
      trip_id: TRIP, owner_id: OWNER, user_id: BOB, invited_email: 'bob@example.test', status: 'accepted',
      invited_at: `${YEAR}-01-02T00:00:00.000Z`,
    }];
    expect(await useAuthStore.getState().beginPasswordRecovery({
      accessToken: recoveryAccessToken(BOB), refreshToken: 'synthetic',
    })).toEqual({ error: null });
    expect(useAuthStore.getState().session?.user.id).toBe(BOB);

    server.holdProjections = true; // Bob's own revalidation has not answered yet
    await render(element(), params);
    expect(anyTextContains(dkk(123_400))).toBe(false);
    expect(texts()).toContain(UNAVAILABLE());
  });

  it('…and the new account\'s own projection is shown normally once its data loads', async () => {
    useAuthStore.getState().init();
    await settle();
    ownersProjection();
    expect(await useTripsStore.getState().refreshTripFinancialProjection(TRIP)).toBe(true);
    server.participants = [{
      trip_id: TRIP, owner_id: OWNER, user_id: BOB, invited_email: 'bob@example.test', status: 'accepted',
      invited_at: `${YEAR}-01-02T00:00:00.000Z`,
    }];
    await useAuthStore.getState().beginPasswordRecovery({ accessToken: recoveryAccessToken(BOB), refreshToken: 'synthetic' });

    await useTripsStore.getState().fetchFromSupabase(); // what the root layout runs for the new session
    await render(<TripDetailScreen />, { id: TRIP });
    expect(anyTextContains(dkk(123_400))).toBe(true); // Bob's own confirmed answer for the shared trip
    expect(texts()).not.toContain(STALE());
  });
});

describe('a saved resolution whose attachments are still moving to Economy', () => {
  const ATTACHMENT = { id: 'att-1', uri: 'file:///doc/attachments/att-1.lsenc', name: 'synthetic.jpg', kind: 'image' as const };
  async function pressButton(label: string) {
    const button = tree.root.findAllByProps({ accessibilityRole: 'button' })
      .find((node) => typeof node.props.onPress === 'function'
        && node.findAllByType(Text).some((text) => text.props.children === label))!;
    await act(async () => { await button.props.onPress(); });
    await flush();
  }

  it('C: the screen says it was saved — never "save failed" — and a later refresh completes the handoff', async () => {
    server.tripExpenses = [{
      id: 'own-legacy', user_id: OWNER, trip_id: TRIP, name: 'Legacy own-legacy', amount: 25, category: 'transport',
      currency: null, original_amount: null, exchange_rate: null,
    }];
    useTripsStore.setState({ expenses: [{ ...legacy('own-legacy', OWNER), attachments: [ATTACHMENT] }] });
    server.throwingTables.add('expenses'); // Economy cannot confirm its own copy yet

    await render(<EditTripExpenseScreen />, { id: TRIP, expenseId: 'own-legacy' });
    const date = tree.root.findAllByType(TextInput).find((node) => node.props.accessibilityLabel === 'transaction-date')!;
    await act(async () => { date.props.onChangeText(`${YEAR}-11-02`); });
    await pressButton(t('travel.resolveExpense'));

    expect(server.links.map((link) => link.legacy_trip_expense_id)).toEqual(['own-legacy']); // saved on the server
    expect(texts()).not.toContain(t('travel.expenseSaveFailed'));
    expect(texts()).toContain(t('travel.legacyAttachmentsPendingDetail'));
    expect(texts()).not.toContain(t('travel.resolveExpense')); // nothing left to submit
    expect(texts()).not.toContain(t('expenses.delete')); // the row still owns its files
    expect(router.back).not.toHaveBeenCalled();
    expect(useTripsStore.getState().expenses.map((expense) => expense.attachments)).toEqual([[ATTACHMENT]]);

    // The list shows it as saved, not as an unresolved historical expense.
    await render(<TripExpensesScreen />, { id: TRIP });
    expect(texts()).toContain(t('travel.legacyAttachmentsPending'));
    expect(texts()).not.toContain(t('travel.needsTransactionDate'));
    expect(texts()).not.toContain(t('travel.unresolvedExpenseCount', { count: 1 }));

    // Economy can be read again: the next refresh completes the handoff.
    server.throwingTables.clear();
    await act(async () => { await useTripsStore.getState().refreshTripFinancialProjection(TRIP); });
    await flush();
    expect(useTripsStore.getState().expenses).toEqual([]);
    expect(texts()).not.toContain(t('travel.legacyAttachmentsPending'));
  });
});
