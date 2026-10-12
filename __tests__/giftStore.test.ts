import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * APP-069 — the real Gifts store, through the real migration-gated AsyncStorage adapter.
 *
 * Measured by reading the raw bytes AsyncStorage holds. Gifts are local-only, so the same file also
 * proves that nothing reaches the network or the outbox, and that no Gift action touches Economy.
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
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn(() => Promise.resolve()) }));
jest.mock('@/core/auth/emailVerification', () => ({ clearResendThrottle: jest.fn(() => Promise.resolve()) }));
jest.mock('@/core/auth/reauth', () => ({ clearVerification: jest.fn() }));
jest.mock('@/utils/shared/attachmentSync', () => ({ clearSignedUrlCache: jest.fn() }));
jest.mock('@/utils/shared/attachmentStorage', () => ({ clearAttachmentCache: jest.fn(() => Promise.resolve()) }));
jest.mock('@/utils/shared/attachmentViewerSource', () => ({ clearAttachmentViewerSources: jest.fn() }));
jest.mock('@/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ session: null }) } }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'user-a' } } })), getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })) },
    from: jest.fn(() => { throw new Error('no table access expected'); }),
    rpc: jest.fn(),
  },
}));

import { clearLocalUserData } from '@/core/auth/clearLocalUserData';
import { minorUnits } from '@/core/money/minorUnits';
import { LOCAL_STORE_RESETS } from '@/features/localStores';
import { supabase as mockSupabase } from '@/lib/supabase';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useGiftsStore } from '@/store/useGiftsStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import type { GiftInput } from '@/features/gifts/domain/gift';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = 'lifesort-gifts';
const PERSON = 'Sentinel Person Ørsted';
const IDEA = 'Sentinel gift idea';
const input: GiftInput = { personLabel: PERSON, idea: IDEA, occasionLabel: 'Sentinel birthday', occasionDate: '2026-12-24', budget: '300', purchased: false };
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const raw = async (key: string) => AsyncStorage.getItem(key);
const gifts = () => useGiftsStore.getState().gifts;
const store = () => useGiftsStore.getState();
const giftReset = () => LOCAL_STORE_RESETS.filter((entry) => entry.key === KEY);
const stored = (rows: unknown[], version = 0) => JSON.stringify({ state: { gifts: rows }, version });
const row = (patch: Record<string, unknown> = {}) => ({
  id: 'g-1', personLabel: PERSON, idea: IDEA, createdAt: '2026-10-12T09:30:00.000Z', ...patch,
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await clearLocalUserData([]);
  await AsyncStorage.clear();
  await useGiftsStore.persist.rehydrate();
  useGiftsStore.setState({ gifts: [] });
  await settle();
  jest.clearAllMocks();
});

describe('create, edit and delete', () => {
  it('creates a gift with a UUID id, a creation instant and the validated fields', () => {
    const result = store().addGift(input);
    expect(result.ok).toBe(true);
    const [created] = gifts();
    expect(created.id).toMatch(UUID_V4);
    expect(result.ok && result.id).toBe(created.id);
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(created).toMatchObject({ personLabel: PERSON, idea: IDEA, occasionLabel: 'Sentinel birthday', occasionDate: '2026-12-24', budget: 30_000 });
    expect(created).not.toHaveProperty('purchasedOn');
    expect(created).not.toHaveProperty('paid');
  });

  it('mints a different id for every gift, and allows the same person and the same occasion twice', () => {
    store().addGift(input);
    store().addGift(input);
    expect(gifts()).toHaveLength(2);
    expect(new Set(gifts().map((g) => g.id)).size).toBe(2);
    expect(gifts().map((g) => g.personLabel)).toEqual([PERSON, PERSON]);
  });

  it('refuses invalid input without touching state, and reports field codes only', () => {
    const result = store().addGift({ ...input, personLabel: ' ', budget: '-5', occasionDate: '2026-02-30' });
    expect(result).toEqual({ ok: false, errors: { personLabel: 'required', occasionDate: 'invalid', budget: 'negative' } });
    expect(gifts()).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('Sentinel');
  });

  it('edits keep id and createdAt, change the fields, and refuse an invalid edit', () => {
    store().addGift(input);
    const original = gifts()[0];
    expect(store().updateGift(original.id, { ...input, idea: 'A better idea', budget: '' }).ok).toBe(true);
    expect(gifts()[0]).toMatchObject({ id: original.id, createdAt: original.createdAt, idea: 'A better idea' });
    expect(gifts()[0]).not.toHaveProperty('budget');
    const refused = store().updateGift(original.id, { ...input, idea: 'a\u0000b' });
    expect(refused).toEqual({ ok: false, errors: { idea: 'invalidCharacters' } });
    expect(gifts()[0].idea).toBe('A better idea');
    expect(store().updateGift('missing', input)).toEqual({ ok: false, errors: {} });
  });

  it('marks a gift purchased through an edit: the date and the paid amount arrive together, the budget stays', () => {
    store().addGift(input);
    const id = gifts()[0].id;
    expect(store().updateGift(id, { ...input, purchased: true, purchasedOn: '2026-10-01', paid: '279,50' }).ok).toBe(true);
    expect(gifts()[0]).toMatchObject({ purchasedOn: '2026-10-01', paid: 27_950, budget: 30_000 });
  });

  it('refuses a future purchase date, and a paid amount without a purchase', () => {
    store().addGift(input);
    const id = gifts()[0].id;
    expect(store().updateGift(id, { ...input, purchased: true, purchasedOn: '2999-01-01' })).toEqual({ ok: false, errors: { purchasedOn: 'future' } });
    expect(store().updateGift(id, { ...input, purchased: false, paid: '10' })).toEqual({ ok: false, errors: { paid: 'purchaseRequired' } });
    expect(gifts()[0]).not.toHaveProperty('purchasedOn');
  });

  it('un-purchasing removes the purchase date and the paid amount, and nothing else', () => {
    store().addGift({ ...input, purchased: true, purchasedOn: '2026-10-01', paid: '100' });
    const id = gifts()[0].id;
    expect(gifts()[0]).toMatchObject({ purchasedOn: '2026-10-01', paid: 10_000 });
    store().updateGift(id, { ...input, purchased: false });
    expect(gifts()[0]).not.toHaveProperty('purchasedOn');
    expect(gifts()[0]).not.toHaveProperty('paid');
    expect(gifts()[0]).toMatchObject({ budget: 30_000, idea: IDEA, id });
  });

  it('corrects the purchase date and the amounts afterwards', () => {
    store().addGift({ ...input, purchased: true, purchasedOn: '2026-10-01', paid: '100' });
    const id = gifts()[0].id;
    store().updateGift(id, { ...input, purchased: true, purchasedOn: '2026-09-15', paid: '0', budget: '250,25' });
    expect(gifts()[0]).toMatchObject({ purchasedOn: '2026-09-15', paid: 0, budget: 25_025 });
  });

  it('deletes a gift, and a deleted gift does not come back after a restart', async () => {
    store().addGift(input);
    store().addGift({ ...input, idea: 'Keep me' });
    const doomed = gifts()[0].id;
    store().removeGift(doomed);
    expect(gifts().map((g) => g.idea)).toEqual(['Keep me']);
    await settle();
    useGiftsStore.setState({ gifts: [] });
    await useGiftsStore.persist.rehydrate();
    expect(gifts().map((g) => g.idea)).toEqual(['Keep me']);
    expect(gifts().some((g) => g.id === doomed)).toBe(false);
  });
});

describe('persistence', () => {
  it('writes Zustand 0 in plain AsyncStorage under lifesort-gifts: only the gifts, no function, no runtime state', async () => {
    store().addGift(input);
    await settle();
    const bytes = JSON.parse((await raw(KEY))!);
    expect(bytes.version).toBe(0);
    expect(Object.keys(bytes.state)).toEqual(['gifts']);
    expect(bytes.state.gifts[0]).toMatchObject({ personLabel: PERSON, idea: IDEA, budget: 30_000 });
    expect(Object.keys(bytes.state.gifts[0])).toEqual(['id', 'personLabel', 'idea', 'occasionLabel', 'occasionDate', 'budget', 'createdAt']);
  });

  it('survives a restart: a fresh hydrate reads the same gifts back, including a purchase', async () => {
    store().addGift(input);
    store().addGift({ ...input, idea: 'Bought', purchased: true, purchasedOn: '2026-10-01', paid: '49,95' });
    await settle();
    const before = gifts();
    useGiftsStore.setState({ gifts: [] });
    await useGiftsStore.persist.rehydrate();
    expect(gifts()).toEqual(before);
  });

  it('does not render a corrupt row, a repeated id or an unknown key, and does not crash', async () => {
    await AsyncStorage.setItem(KEY, stored([
      row({ id: 'ok' }),
      row({ id: 'neg', budget: -1 }),
      row({ id: 'ok', idea: 'duplicate id' }),
      row({ id: 'extra', unknownKey: 1 }),
      row({ id: 'paid-only', paid: 5 }),
      row({ id: 'future-ok', purchasedOn: '2999-01-01' }),
      'junk',
      null,
    ]));
    await useGiftsStore.persist.rehydrate();
    expect(gifts().map((g) => g.id)).toEqual(['ok', 'future-ok']);
  });

  it('treats a state with no list, or a list that is not an array, as empty', async () => {
    for (const state of [{}, { gifts: 'not a list' }, { gifts: { 0: row() } }, { other: 1 }]) {
      await AsyncStorage.setItem(KEY, JSON.stringify({ state, version: 0 }));
      useGiftsStore.setState({ gifts: [] });
      await useGiftsStore.persist.rehydrate();
      expect(gifts()).toEqual([]);
    }
  });

  it('fails closed on unreadable bytes: nothing is shown, and a later write cannot overwrite them', async () => {
    const corrupt = '{ this is not json';
    await AsyncStorage.setItem(KEY, corrupt);
    await useGiftsStore.persist.rehydrate();
    expect(gifts()).toEqual([]);
    store().addGift(input);
    await settle();
    expect(await raw(KEY)).toBe(corrupt);
  });

  it('fails closed on a payload from a newer app version rather than guessing, and keeps it', async () => {
    const newer = stored([row()], 1);
    await AsyncStorage.setItem(KEY, newer);
    await useGiftsStore.persist.rehydrate();
    expect(gifts()).toEqual([]);
    store().addGift(input);
    await settle();
    expect(await raw(KEY)).toBe(newer);
  });

  it('drops a corrupt row from disk on the next write (accepted: no released client could write one)', async () => {
    await AsyncStorage.setItem(KEY, stored([row({ id: 'ok' }), row({ id: 'bad', budget: -1 })]));
    await useGiftsStore.persist.rehydrate();
    store().addGift(input);
    await settle();
    expect(JSON.parse((await raw(KEY))!).state.gifts.map((g: { id: string }) => g.id)).toHaveLength(2);
    expect(await raw(KEY)).not.toContain('"bad"');
  });
});

describe('Gifts are local-only', () => {
  it('makes no Supabase call and writes nothing to the outbox, whatever the user does — even signed in', async () => {
    store().addGift(input);
    const id = gifts()[0].id;
    store().updateGift(id, { ...input, purchased: true, purchasedOn: '2026-10-01', paid: '10' });
    store().updateGift(id, { ...input, purchased: false });
    store().removeGift(id);
    store().restoreBackup({ gifts: [row()] });
    store().exportBackup();
    store().clearLocal();
    await settle();
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
    expect(mockSupabase.auth.getUser).not.toHaveBeenCalled();
    expect(await raw('lifesort-outbox')).toBeNull();
    expect(await raw('sync-status')).toBeNull();
  });

  it('has no fetch, mirror, sync, revision or tombstone anywhere on the store or in a row', () => {
    store().addGift({ ...input, purchased: true, purchasedOn: '2026-10-01', paid: '10' });
    expect(Object.keys(store()).filter((key) => /fetch|sync|supabase|mirror|outbox|revision|tombstone/i.test(key))).toEqual([]);
    expect(Object.keys(gifts()[0]).filter((key) => /revision|tombstone|deleted|updatedAt|sync|mutation/i.test(key))).toEqual([]);
  });
});

describe('Gifts never touch Economy', () => {
  const m = (value: number) => minorUnits(value);
  const economy = () => JSON.stringify({
    expenses: useExpensesStore.getState().expenses,
    seriesStoppedAt: useExpensesStore.getState().seriesStoppedAt,
    categoryBudgets: useExpensesStore.getState().categoryBudgets,
    income: useIncomeStore.getState().incomeByMonth,
    goals: useSavingsGoalsStore.getState().goals,
    history: useSavingsGoalsStore.getState().history,
    extra: useSavingsGoalsStore.getState().extraSavings,
  });
  const economyKeys = ['lifesort-expenses', 'lifesort-income-v2', 'lifesort-savings-goals'];
  const economyBytes = async () => JSON.stringify(await Promise.all(economyKeys.map(raw)));

  it('create, purchase, edit, un-purchase and delete leave expenses, income, savings and their stored bytes exactly as they were', async () => {
    useExpensesStore.setState({
      expenses: [{ id: 'e1', amount: m(12_345), category: 'food', date: '2026-10-01', description: 'Lunch', isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null, createdAt: '2026-10-01T10:00:00.000Z' } as never],
    });
    useIncomeStore.setState({ incomeByMonth: { '2026-10': m(3_000_000) } });
    useSavingsGoalsStore.setState({ goals: [{ id: 's1', name: 'Trip', targetAmount: m(500_000), savedAmount: m(100_000), icon: 'car', createdAt: '2026-09-01T00:00:00.000Z' } as never] });
    await settle();
    const before = economy();
    const bytesBefore = await economyBytes();
    // The comparison means something only if the Economy stores really have bytes to compare.
    expect(JSON.parse(bytesBefore).every((entry: string | null) => entry !== null)).toBe(true);

    // Every write path the store has: create (planned and already purchased), edit, purchase,
    // correct, un-purchase, delete, restore from a backup, and clear.
    store().addGift({ ...input, budget: '999' });
    store().addGift({ ...input, idea: 'Bought at once', purchased: true, purchasedOn: '2026-10-01', paid: '666,66' });
    const id = gifts()[0].id;
    store().updateGift(id, { ...input, purchased: true, purchasedOn: '2026-10-01', paid: '888,88' });
    store().updateGift(id, { ...input, idea: 'Edited', purchased: true, purchasedOn: '2026-10-02', paid: '777' });
    store().updateGift(id, { ...input, purchased: false });
    store().updateGift(id, { ...input, purchased: true, purchasedOn: '2026-10-03', paid: '0' });
    store().removeGift(id);
    store().restoreBackup({ gifts: [row({ id: 'restored', purchasedOn: '2026-10-01', paid: 55_500, budget: 66_600 })] });
    store().exportBackup();
    store().clearLocal();
    await settle();

    expect(economy()).toBe(before);
    expect(await economyBytes()).toBe(bytesBefore);
    expect(useExpensesStore.getState().expenses).toHaveLength(1);
    // No Gift amount ever shows up on the ledger, under any rendering of it.
    for (const amount of ['99900', '88888', '77700', '66666', '55500', '66600']) expect(economy()).not.toContain(`"amount":${amount}`);
  });
});

describe('backup payload', () => {
  it('exports only the gifts: an explicit whitelist, never the whole state', () => {
    store().addGift(input);
    const exported = store().exportBackup();
    expect(Object.keys(exported)).toEqual(['gifts']);
    expect(exported.gifts).toEqual(gifts());
  });

  it('restores validated rows over the current ones, and refuses anything that is not canonical', () => {
    store().addGift(input);
    store().restoreBackup({ gifts: [row({ id: 'restored' })] });
    expect(gifts().map((g) => g.id)).toEqual(['restored']);
    // Unreachable after the parser; and then refused rather than half-applied.
    store().restoreBackup({ gifts: [row({ id: 'a' }), row({ id: 'b', budget: -1 })] });
    store().restoreBackup({ gifts: 'junk' });
    store().restoreBackup({});
    expect(gifts().map((g) => g.id)).toEqual(['restored']);
  });
});

describe('logout and account switch', () => {
  it('registers a reset for lifesort-gifts in the canonical registry', () => {
    expect(giftReset()).toHaveLength(1);
  });

  it('A -> logout -> B: nothing of A is in memory or on disk, and B starts empty', async () => {
    store().addGift(input);
    store().addGift({ ...input, idea: 'Bought', purchased: true, purchasedOn: '2026-10-01', paid: '55' });
    await settle();
    expect(await raw(KEY)).toContain(PERSON);

    await clearLocalUserData(giftReset());

    expect(gifts()).toEqual([]);
    expect(await raw(KEY)).toBeNull();

    // B signs in on the same phone.
    await useGiftsStore.persist.rehydrate();
    expect(gifts()).toEqual([]);
    store().addGift({ ...input, personLabel: 'B Person', idea: 'B idea' });
    await settle();
    expect(JSON.stringify(gifts())).not.toContain(PERSON);
    expect(await raw(KEY)).not.toContain(PERSON);
    expect(await raw(KEY)).not.toContain(IDEA);
  });

  it('removes the key even when no reset was registered: the lifesort- sweep catches it', async () => {
    store().addGift(input);
    await settle();
    expect(await raw(KEY)).not.toBeNull();
    await clearLocalUserData([]);
    expect(await raw(KEY)).toBeNull();
  });

  it('a write still queued when the user logs out cannot bring the gifts back', async () => {
    store().addGift(input);
    // No settle: the persist write is still in flight when the cleanup starts.
    await clearLocalUserData(giftReset());
    await settle();
    expect(gifts()).toEqual([]);
    expect(await raw(KEY)).toBeNull();
  });
});
