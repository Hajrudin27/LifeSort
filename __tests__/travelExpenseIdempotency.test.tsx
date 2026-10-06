import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { minorUnits } from '@/core/money/minorUnits';

/**
 * APP-059 review #1, finding 1 — retrying a new Travel expense must converge on ONE
 * canonical Economy expense and ONE trip link.
 *
 * The client runs for real — screen, store and bridge — against a stand-in server
 * that implements the migration's idempotency rule and can lose an answer AFTER it
 * committed. The same rule on real PostgreSQL, including two requests with the same
 * id at the same time, is proved in tests/db/app059.test.cjs.
 */

jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/components/DatePickerField', () => {
  const { createElement } = require('react');
  const { TextInput: MockTextInput } = require('react-native');
  return function MockDatePickerField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
    return createElement(MockTextInput, { accessibilityLabel: 'transaction-date', value, onChangeText: onChange });
  };
});
jest.mock('@/lib/supabase', () => ({ supabase: require('@/__tests__/helpers/fakeTravelServer').fakeSupabase }));
jest.mock('@/core/storage/documentCacheStorage', () => ({
  documentMetadataEncryptedStorage: require('@react-native-async-storage/async-storage'),
  deleteCachedAttachmentFile: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/utils/trip/tripReminder', () => ({ scheduleTripPackingReminder: jest.fn(), cancelTripPackingReminder: jest.fn() }));
jest.mock('@/utils/shared/attachmentStorage', () => ({ cleanupAttachments: jest.fn(), deleteCachedAttachmentFile: jest.fn() }));

import { router } from 'expo-router';

import { resetServer, server, settle } from '@/__tests__/helpers/fakeTravelServer';
import NewTripExpenseScreen from '@/app/travel/[id]/expenses/new';
import i18n from '@/localization/i18n';
import { useAuthStore } from '@/store/useAuthStore';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useTripsStore } from '@/store/useTripsStore';
import type { TripExpenseCategory } from '@/types/trip';

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const TRIP = 'trip-rome';
const KEY = 'lifesort-trips';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const input = {
  tripId: TRIP, name: 'Taxi', amount: minorUnits(12_550), category: 'transport' as TripExpenseCategory, transactionDate: '2027-05-03',
};
const add = (overrides: Partial<typeof input> & { expenseId: string }) =>
  useTripsStore.getState().addTripExpense({ ...input, ...overrides });
const linkCalls = () => server.rpcCalls.filter((call) => call.name === 'link_trip_economy_expense');
const t = (key: string) => i18n.t(key);

beforeEach(async () => {
  resetServer();
  server.user = ME;
  server.trips = [{
    id: TRIP, user_id: ME, name: 'Rome', destination: 'Rome', start_date: '2027-05-01', end_date: '2027-05-08',
    budget: null, created_at: '2026-01-01T00:00:00.000Z',
  }];
  mockParams = { id: TRIP };
  await i18n.changeLanguage('en');
  await Promise.all([useTripsStore.persist.rehydrate(), useExpensesStore.persist.rehydrate()]);
  useAuthStore.setState({ session: { user: { id: ME } } as any });
  useTripsStore.setState({
    trips: [{
      id: TRIP, ownerId: ME, name: 'Rome', destination: 'Rome', startDate: '2027-05-01', endDate: '2027-05-08',
      budget: null, documents: [], createdAt: '2026-01-01T00:00:00.000Z',
    }],
    expenses: [], packingItems: [], participants: [], myUserId: ME,
    financialProjections: [], financialProjectionFreshAt: {}, financialProjectionStatus: {},
    pendingExpenseDrafts: {},
  });
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  await settle();
  jest.clearAllMocks();
});

afterEach(() => useAuthStore.setState({ session: null }));

describe('APP-059 review #1 — one logical expense is one Economy expense', () => {
  it('A–F: the server commits, the answer is lost, and every retry of the same draft converges', async () => {
    server.lostLinkAnswers = 3;
    const outcomes: (string | null)[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) outcomes.push(await add({ expenseId: 'draft-1' }));

    // The first three attempts committed or replayed, but the client never heard back.
    expect(outcomes).toEqual([null, null, null, 'draft-1']);
    // C: the same id on every attempt — never a fresh one per call.
    expect(linkCalls().map((call) => call.args.p_expense_id)).toEqual(['draft-1', 'draft-1', 'draft-1', 'draft-1']);
    // D + E: exactly one canonical Economy expense and one link.
    expect(server.expenses.map((row) => row.id)).toEqual(['draft-1']);
    expect(server.links.map((row) => [row.trip_id, row.expense_id])).toEqual([[TRIP, 'draft-1']]);

    // F: retrying even after the success still converges.
    expect(await add({ expenseId: 'draft-1' })).toBe('draft-1');
    expect(server.expenses).toHaveLength(1);
    expect(server.links).toHaveLength(1);
    expect(useTripsStore.getState().financialProjections.map((row) => row.expenseId)).toEqual(['draft-1']);
    // Nothing of it was written into Travel's legacy array.
    expect(useTripsStore.getState().expenses).toEqual([]);
  });

  it('a dropped connection (the call throws after the commit) converges the same way', async () => {
    server.thrownLinkAnswers = 2;
    expect(await add({ expenseId: 'draft-1' })).toBeNull();
    expect(await add({ expenseId: 'draft-1' })).toBeNull();
    expect(await add({ expenseId: 'draft-1' })).toBe('draft-1');
    expect(server.expenses).toHaveLength(1);
    expect(server.links).toHaveLength(1);
  });

  it('a retry whose details changed after a lost answer is refused — never a second expense', async () => {
    server.lostLinkAnswers = 1;
    expect(await add({ expenseId: 'draft-1' })).toBeNull();
    expect(await add({ expenseId: 'draft-1', amount: minorUnits(9_900) })).toBeNull();
    expect(server.expenses.map((row) => [row.id, row.amount])).toEqual([['draft-1', '125.50']]);
    expect(server.links).toHaveLength(1);
  });

  it('H: two different drafts with identical details are two separate expenses', async () => {
    expect(await add({ expenseId: 'draft-1' })).toBe('draft-1');
    expect(await add({ expenseId: 'draft-2' })).toBe('draft-2');
    expect(server.expenses.map((row) => row.id).sort()).toEqual(['draft-1', 'draft-2']);
    expect(server.links.map((row) => row.expense_id).sort()).toEqual(['draft-1', 'draft-2']);
  });

  it('nothing is sent without a draft identity', async () => {
    expect(await add({ expenseId: '' })).toBeNull();
    expect(await add({ expenseId: '   ' })).toBeNull();
    expect(linkCalls()).toEqual([]);
  });

  it('keeps A\'s durable draft and sends nothing as B when the account changes during persistence', async () => {
    const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae8';
    server.participants = [{
      trip_id: TRIP, owner_id: ME, user_id: OTHER, invited_email: 'other@example.test',
      status: 'accepted', invited_at: '2026-10-06T00:00:00.000Z',
    }];
    const setItem = AsyncStorage.setItem as jest.Mock;
    const realSetItem = setItem.getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    setItem.mockImplementation(async (key: string, value: string) => {
      if (key === KEY) await held;
      return realSetItem(key, value);
    });

    const saving = add({ expenseId: 'account-bound-draft' });
    await settle(3);
    server.user = OTHER;
    useAuthStore.setState({ session: { user: { id: OTHER } } as any });
    useTripsStore.setState({ myUserId: OTHER });
    release();
    expect(await saving).toBeNull();
    setItem.mockImplementation(realSetItem);

    expect(linkCalls()).toEqual([]);
    expect(server.expenses).toEqual([]);
    expect(server.links).toEqual([]);
    expect(useTripsStore.getState().pendingExpenseDrafts['account-bound-draft']).toMatchObject({
      accountId: ME, status: 'pending',
    });

    server.user = ME;
    useAuthStore.setState({ session: { user: { id: ME } } as any });
    useTripsStore.setState({ myUserId: ME });
    expect(await add({ expenseId: 'account-bound-draft' })).toBe('account-bound-draft');
    expect(linkCalls().map((call) => call.args.p_expected_account_id)).toEqual([ME]);
    expect(server.expenses.map((row) => [row.user_id, row.id])).toEqual([[ME, 'account-bound-draft']]);
    expect(server.links.map((row) => [row.expense_owner_id, row.expense_id])).toEqual([[ME, 'account-bound-draft']]);
  });
});

describe('APP-059 review #1 — the new-expense screen keeps one id per draft', () => {
  let tree: TestRenderer.ReactTestRenderer;
  const flush = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await settle(2); }); };
  const render = async () => {
    await act(async () => { tree?.unmount(); tree = TestRenderer.create(<NewTripExpenseScreen />); });
    await flush();
  };
  const texts = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
  const type = async (match: (props: Record<string, unknown>) => boolean, text: string) => {
    const field = tree.root.findAllByType(TextInput).find((node) => match(node.props))!;
    await act(async () => { field.props.onChangeText(text); });
  };
  const fill = async () => {
    await type((props) => props.placeholder === t('expenses.namePlaceholder'), 'Taxi');
    await type((props) => props.placeholder === t('expenses.amountPlaceholder'), '125.50');
    await type((props) => props.accessibilityLabel === 'transaction-date', '2027-05-03');
  };
  const save = async () => {
    const button = tree.root.findAllByProps({ accessibilityRole: 'button' })
      .find((node) => typeof node.props.onPress === 'function'
        && node.findAllByType(Text).some((label) => label.props.children === t('expenses.save')))!;
    await act(async () => { await button.props.onPress(); });
    await flush();
  };
  afterEach(() => { act(() => { tree?.unmount(); }); });

  async function restartTripsFromPersistedBytes() {
    await settle();
    const persisted = await AsyncStorage.getItem(KEY);
    expect(persisted).not.toBeNull();
    // Replace volatile memory, then restore the exact bytes that existed at process
    // termination and hydrate through the real persisted-store adapter.
    useTripsStore.setState({ pendingExpenseDrafts: {} });
    await settle();
    await AsyncStorage.setItem(KEY, persisted!);
    await useTripsStore.persist.rehydrate();
  }

  it('retries after lost answers with the SAME id, and only a new draft gets a new id', async () => {
    server.lostLinkAnswers = 2;
    await render();
    await fill();

    await save();
    expect(texts()).toContain(t('travel.expenseSaveFailed'));
    await save();
    expect(router.back).not.toHaveBeenCalled();
    await save();
    expect(router.back).toHaveBeenCalledTimes(1);

    const draft = linkCalls().map((call) => call.args.p_expense_id);
    expect(draft).toHaveLength(3);
    expect(new Set(draft).size).toBe(1);
    expect(draft[0]).toMatch(UUID_V4);
    expect(server.expenses.map((row) => row.id)).toEqual([draft[0]]);
    expect(server.links.map((row) => row.expense_id)).toEqual([draft[0]]);

    // A genuinely new expense — a new draft — with the very same details.
    await render();
    await fill();
    await save();
    const next = linkCalls()[3].args.p_expense_id;
    expect(next).toMatch(UUID_V4);
    expect(next).not.toBe(draft[0]);
    expect(server.expenses.map((row) => row.id).sort()).toEqual([draft[0], next].sort());
    expect(server.links).toHaveLength(2);
  });

  it('persists before the first RPC, survives process termination, and retries the committed link with the exact same id', async () => {
    const setItem = AsyncStorage.setItem as jest.Mock;
    const realSetItem = setItem.getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let hold = true;
    setItem.mockImplementation(async (key: string, value: string) => {
      if (hold && key === KEY) await held;
      return realSetItem(key, value);
    });
    server.lostLinkAnswers = 1;
    await render();
    await fill();

    let saving!: Promise<void>;
    await act(async () => {
      const button = tree.root.findAllByProps({ accessibilityRole: 'button' })
        .find((node) => typeof node.props.onPress === 'function'
          && node.findAllByType(Text).some((label) => label.props.children === t('expenses.save')))!;
      saving = button.props.onPress();
      await settle(3);
    });
    expect(linkCalls()).toEqual([]); // the durable draft write is still held
    hold = false;
    release();
    await act(async () => { await saving; });
    await flush();
    setItem.mockImplementation(realSetItem);

    expect(linkCalls()).toHaveLength(1);
    const stableId = linkCalls()[0].args.p_expense_id as string;
    expect(useTripsStore.getState().pendingExpenseDrafts[stableId]).toMatchObject({
      expenseId: stableId, accountId: ME, tripId: TRIP, name: 'Taxi', amount: 12_550,
      category: 'flight', transactionDate: '2027-05-03', status: 'ambiguous',
    });
    expect(server.expenses).toHaveLength(1);
    expect(server.links).toHaveLength(1);

    act(() => tree.unmount());
    await restartTripsFromPersistedBytes();
    expect(useTripsStore.getState().pendingExpenseDrafts[stableId]?.status).toBe('ambiguous');
    expect(await add({ expenseId: stableId, amount: minorUnits(9_900) })).toBeNull();
    expect(linkCalls()).toHaveLength(1); // persisted identity rejects changed details before the RPC
    await render(); // fields and identity come from persistence, not the old component
    await save();

    expect(linkCalls().map((call) => call.args.p_expense_id)).toEqual([stableId, stableId]);
    expect(server.expenses.map((row) => row.id)).toEqual([stableId]);
    expect(server.links.map((row) => row.expense_id)).toEqual([stableId]);
    expect(useTripsStore.getState().pendingExpenseDrafts).toEqual({});

    let replayOne: string | null = null;
    let replayTwo: string | null = null;
    await act(async () => { replayOne = await add({ expenseId: stableId, category: 'flight' }); });
    await act(async () => { replayTwo = await add({ expenseId: stableId, category: 'flight' }); });
    expect(replayOne).toBe(stableId);
    expect(replayTwo).toBe(stableId);
    expect(server.expenses.map((row) => row.id)).toEqual([stableId]);
    expect(server.links.map((row) => row.expense_id)).toEqual([stableId]);

    await render();
    await fill();
    await save();
    const newId = linkCalls()[4].args.p_expense_id as string;
    expect(newId).not.toBe(stableId);
    expect(server.expenses.map((row) => row.id).sort()).toEqual([stableId, newId].sort());
  });

  it('never recovers or submits another account\'s persistent draft', async () => {
    server.lostLinkAnswers = 1;
    await render();
    await fill();
    await save();
    const ownerDraft = linkCalls()[0].args.p_expense_id as string;
    expect(useTripsStore.getState().pendingExpenseDrafts[ownerDraft]?.accountId).toBe(ME);

    const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae8';
    server.user = OTHER;
    await act(async () => {
      useAuthStore.setState({ session: { user: { id: OTHER } } as any });
      useTripsStore.setState({ myUserId: OTHER });
    });
    expect(await add({ expenseId: ownerDraft })).toBeNull();
    expect(linkCalls()).toHaveLength(1);
  });
});
