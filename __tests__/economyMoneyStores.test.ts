import AsyncStorage from '@react-native-async-storage/async-storage';

import { divideMinorUnits, minorUnits, negateMinorUnits, type MinorUnits } from '@/core/money/minorUnits';
import { parseSupportedMoneyInput } from '@/core/money/supportedMoney';
import { decryptDocumentMetadataPayload } from '@/core/storage/documentCacheStorage';

/**
 * APP-040 actual store flows: canonical MinorUnits in state and persistence,
 * exact decimal text at the server boundary, and remote hydration that
 * validates the complete snapshot before touching local state.
 */

type Row = Record<string, unknown>;
const mockWrites: { table: string; op: 'upsert' | 'insert'; payload: unknown }[] = [];
const mockRemote: Record<string, Row[] | Row | null> = {};

jest.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const rows = () => Promise.resolve({ data: mockRemote[table] ?? [], error: null });
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain, eq: () => chain, in: () => chain,
      delete: () => chain,
      single: () => Promise.resolve({ data: mockRemote[table] ?? null, error: mockRemote[table] ? null : { code: 'PGRST116' } }),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => rows().then(resolve, reject),
      upsert: (payload: unknown) => { mockWrites.push({ table, op: 'upsert', payload }); return Promise.resolve({ error: null }); },
      insert: (payload: unknown) => { mockWrites.push({ table, op: 'insert', payload }); return Promise.resolve({ error: null }); },
    });
    return chain;
  };
  return { supabase: { from, auth: { getUser: () => Promise.resolve({ data: { user: { id: 'synthetic-user' } } }) } } };
});
jest.mock('@/utils/shared/attachmentSync', () => ({
  uploadAttachment: jest.fn(() => Promise.resolve(null)),
  deleteAttachmentRemote: jest.fn(() => Promise.resolve()),
  fetchAttachmentsFor: jest.fn(() => Promise.resolve([])),
}));

import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';

const m = minorUnits;
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
/** What the forms do: text → supported MinorUnits. */
const parsed = (text: string): MinorUnits => {
  const result = parseSupportedMoneyInput(text);
  if (!result.ok) throw new Error('test input');
  return result.value;
};
/** What PostgREST sends back for a numeric: the stored decimal as a JSON number literal. */
const ingress = (decimal: unknown) => JSON.parse(`{"v":${decimal}}`).v;
const writesTo = (table: string) => mockWrites.filter((write) => write.table === table).map((write) => write.payload);
async function persisted(key: string): Promise<Record<string, any>> {
  await flush();
  const raw = (await AsyncStorage.getItem(key))!;
  return JSON.parse(key === 'lifesort-expenses' ? await decryptDocumentMetadataPayload(key, raw) : raw);
}

beforeEach(async () => {
  await Promise.all([useExpensesStore.persist.rehydrate(), useIncomeStore.persist.rehydrate(), useSavingsGoalsStore.persist.rehydrate()]);
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  useIncomeStore.setState({ incomeByMonth: {} });
  useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: m(0) });
  await flush();
  mockWrites.length = 0;
  for (const key of Object.keys(mockRemote)) delete mockRemote[key];
});

describe('APP-040 expense write paths', () => {
  const input = (amount: MinorUnits) => ({ name: 'Synthetic lunch', amount, category: 'food', nextPaymentDate: '2026-09-10', isRecurring: true, recurrenceFrequency: 'monthly' as const });

  it('create → edit → non-money rewrite → recurring copy → delete keeps canonical øre everywhere', async () => {
    const store = useExpensesStore.getState();
    const id = store.addExpense(input(parsed('89,50')));
    expect(useExpensesStore.getState().expenses[0].amount).toBe(8_950);
    await flush();
    expect(writesTo('expenses')).toEqual([expect.objectContaining({ id, amount: '89.50' })]);
    expect((await persisted('lifesort-expenses'))).toMatchObject({ version: 2, state: { expenses: [{ id, amount: 8_950, recurrenceFrequency: 'monthly' }] } });

    store.updateExpense(id, { amount: parsed('0.99') });
    expect(useExpensesStore.getState().expenses[0].amount).toBe(99);
    store.updateExpense(id, { name: 'Renamed' });
    store.updateExpense(id, { amount: undefined });
    store.addAttachment(id, { id: 'synthetic-attachment', uri: 'file:///synthetic.jpg', name: 'r.jpg', kind: 'image' });
    expect(useExpensesStore.getState().expenses[0]).toMatchObject({ name: 'Renamed', amount: 99 });

    store.rollForwardMonth('2026-10');
    store.rollForwardMonth('2026-11');
    expect(useExpensesStore.getState().expenses.map((e) => e.amount)).toEqual([99, 99, 99]);
    await flush();
    expect(writesTo('expenses').flat()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, amount: '0.99' }),
      expect.objectContaining({ next_payment_date: '2026-10-10', amount: '0.99' }),
    ]));
    expect((await persisted('lifesort-expenses')).state.expenses.map((e: Row) => e.amount)).toEqual([99, 99, 99]);

    store.removeExpense(id);
    expect(useExpensesStore.getState().expenses.some((e) => e.id === id)).toBe(false);
    expect((await persisted('lifesort-expenses')).state.expenses.map((e: Row) => e.amount)).toEqual([99, 99]);
  });

  it('category budgets are stored and sent as canonical money', async () => {
    const store = useExpensesStore.getState();
    store.setCategoryBudget('food', parsed('1500'));
    expect(useExpensesStore.getState().categoryBudgets).toEqual({ food: 150_000 });
    await flush();
    expect(writesTo('expense_category_budgets')).toEqual([{ user_id: 'synthetic-user', category: 'food', monthly_limit: '1500.00' }]);
    expect((await persisted('lifesort-expenses')).state.categoryBudgets).toEqual({ food: 150_000 });
    store.removeCategoryBudget('food');
    expect(useExpensesStore.getState().categoryBudgets).toEqual({});
  });

  it('rejects a non-canonical amount before any state change or server write', async () => {
    expect(() => useExpensesStore.getState().addExpense(input(12.5 as MinorUnits))).toThrow('money_unsupported_amount');
    expect(() => useExpensesStore.getState().setCategoryBudget('food', Number.NaN as MinorUnits)).toThrow('money_unsupported_amount');
    await flush();
    expect(useExpensesStore.getState()).toMatchObject({ expenses: [], categoryBudgets: {} });
    expect(mockWrites).toEqual([]);
  });
});

describe('APP-040 income and savings write paths', () => {
  it('income: explicit zero and øre values are stored and sent exactly', async () => {
    useIncomeStore.getState().setIncomeForMonth('2026-09', parsed('32150,05'));
    useIncomeStore.getState().setIncomeForMonth('2026-10', parsed('0'));
    expect(useIncomeStore.getState().incomeByMonth).toEqual({ '2026-09': 3_215_005, '2026-10': 0 });
    await flush();
    expect(writesTo('income')).toEqual([
      { user_id: 'synthetic-user', month_key: '2026-09', amount: '32150.05' },
      { user_id: 'synthetic-user', month_key: '2026-10', amount: '0.00' },
    ]);
    expect(await persisted('lifesort-income-v2')).toEqual({ state: { incomeByMonth: { '2026-09': 3_215_005, '2026-10': 0 } }, version: 1 });
  });

  it('savings goal, contribution, withdrawal, transfer, equal distribution and extra savings stay integral', async () => {
    const store = useSavingsGoalsStore.getState();
    const a = store.addGoal({ name: 'A', targetAmount: parsed('1000'), icon: 'travel' });
    const b = store.addGoal({ name: 'B', targetAmount: parsed('10,01'), icon: 'other' });
    store.updateGoal(b, { targetAmount: parsed('10.02') });
    expect(() => store.updateGoal(b, { targetAmount: undefined })).toThrow('money_unsupported_amount');
    expect(useSavingsGoalsStore.getState().goals[1].targetAmount).toBe(1_002);
    store.addContribution(a, parsed('0,10'));
    store.addContribution(a, parsed('0,20'));
    expect(useSavingsGoalsStore.getState().goals[0].savedAmount).toBe(30); // not 0.30000000000000004
    // APP-043: a withdrawal larger than the balance is refused, never clamped.
    expect(() => store.addContribution(a, negateMinorUnits(parsed('5')))).toThrow('savings_insufficient_balance');
    expect(useSavingsGoalsStore.getState().goals[0].savedAmount).toBe(30);
    store.addContribution(a, negateMinorUnits(parsed('0,30')));
    expect(useSavingsGoalsStore.getState().goals[0].savedAmount).toBe(0);
    store.addContribution(a, parsed('100'));
    store.transferBetweenGoals(a, b, parsed('33,33'));
    expect(useSavingsGoalsStore.getState().goals.map((g) => g.savedAmount)).toEqual([6_667, 3_333]);

    const { share, remainder } = divideMinorUnits(m(1_000), 3);
    store.distributeContributions([{ id: a, amount: share }, { id: b, amount: share }]);
    expect([share, remainder]).toEqual([333, 1]);
    store.addExtraSavings(parsed('0,05'));
    store.archiveGoal(a);
    store.unarchiveGoal(a);

    const state = useSavingsGoalsStore.getState();
    expect(state.goals.map((g) => [g.targetAmount, g.savedAmount, g.archived])).toEqual([[100_000, 7_000, false], [1_002, 3_666, undefined]]);
    expect(state.history.map((h) => h.amount)).toEqual([10, 20, -30, 10_000, -3_333, 3_333, 333, 333]);
    expect(state.extraSavings).toBe(5);
    await flush();
    expect(writesTo('savings_history').flat().map((row: any) => row.amount)).toEqual(['0.10', '0.20', '-0.30', '100.00', '-33.33', '33.33', '3.33', '3.33']);
    expect(writesTo('savings_extra')).toEqual([{ user_id: 'synthetic-user', amount: '0.05' }]);
    expect(writesTo('savings_goals').flat().every((row: any) => typeof row.target_amount === 'string' && typeof row.saved_amount === 'string')).toBe(true);
    const disk = await persisted('lifesort-savings-goals');
    expect(disk.version).toBe(1);
    expect(disk.state.history.map((h: Row) => h.amount)).toEqual(state.history.map((h) => h.amount));
    expect(disk.state.extraSavings).toBe(5);
  });
});

describe('APP-040 remote hydration validates before mutating', () => {
  const localExpense = { id: 'local', seriesId: 'local', isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null, name: 'Local', amount: m(1_250), category: 'other', nextPaymentDate: '2026-09-01', attachments: [], createdAt: '2026-09-01T00:00:00.000Z' };
  const row = (id: string, amount: unknown) => ({ id, series_id: id, is_recurring: false, name: `Remote ${id}`, amount, category: 'other', next_payment_date: '2026-09-02', created_at: '2026-09-02T00:00:00.000Z' });

  it('merges valid server numerics (JSON numbers) as exact MinorUnits', async () => {
    useExpensesStore.setState({ expenses: [localExpense], categoryBudgets: { food: m(100) } });
    mockRemote.expenses = [row('local', ingress('999.99')), row('r1', ingress('12.50')), row('r2', ingress('0.01'))];
    mockRemote.expense_category_budgets = [{ category: 'food', monthly_limit: ingress('5.00') }, { category: 'bill', monthly_limit: ingress('7000.00') }];
    await useExpensesStore.getState().fetchFromSupabase();
    expect(useExpensesStore.getState().expenses.map((e) => [e.id, e.amount])).toEqual([['local', 1_250], ['r1', 1_250], ['r2', 1]]);
    expect(useExpensesStore.getState().categoryBudgets).toEqual({ food: 100, bill: 700_000 });
  });

  it.each([ingress('12.345'), ingress('90071992547409.91'), null, 'abc'])('expenses: invalid server amount %p leaves good local data untouched', async (bad) => {
    useExpensesStore.setState({ expenses: [localExpense], categoryBudgets: { food: m(100) } });
    const before = JSON.stringify(useExpensesStore.getState());
    mockRemote.expenses = [row('r1', ingress('12.50')), row('r2', bad)];
    mockRemote.expense_category_budgets = [{ category: 'bill', monthly_limit: ingress('70.00') }];
    await useExpensesStore.getState().fetchFromSupabase();
    expect(JSON.stringify(useExpensesStore.getState())).toBe(before);
  });

  it('income: one invalid month rejects the whole fetch; valid data merges only missing months', async () => {
    useIncomeStore.setState({ incomeByMonth: { '2026-09': m(100) } });
    mockRemote.income = [{ month_key: '2026-08', amount: ingress('10.00') }, { month_key: '2026-10', amount: ingress('1.005') }];
    await useIncomeStore.getState().fetchFromSupabase();
    expect(useIncomeStore.getState().incomeByMonth).toEqual({ '2026-09': 100 });

    mockRemote.income = [{ month_key: '2026-08', amount: ingress('10.00') }, { month_key: '2026-09', amount: ingress('99.00') }];
    await useIncomeStore.getState().fetchFromSupabase();
    expect(useIncomeStore.getState().incomeByMonth).toEqual({ '2026-09': 100, '2026-08': 1_000 });
  });

  it('savings: an invalid extra amount rejects goals and history too', async () => {
    useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: m(0) });
    mockRemote.savings_goals = [{ id: 'g', name: 'G', icon: 'other', target_amount: ingress('100.00'), saved_amount: ingress('1.50'), deadline: null, archived: false, created_at: '2026-09-01' }];
    mockRemote.savings_history = [{ id: 'h', goal_id: 'g', amount: ingress('-0.50'), date: '2026-09-01' }];
    mockRemote.savings_extra = { amount: ingress('2.001') };
    await useSavingsGoalsStore.getState().fetchFromSupabase();
    expect(useSavingsGoalsStore.getState()).toMatchObject({ goals: [], history: [], extraSavings: 0 });

    mockRemote.savings_extra = { amount: ingress('2.00') };
    await useSavingsGoalsStore.getState().fetchFromSupabase();
    expect(useSavingsGoalsStore.getState()).toMatchObject({
      goals: [{ id: 'g', targetAmount: 10_000, savedAmount: 150 }], history: [{ id: 'h', amount: -50 }], extraSavings: 200,
    });
  });

  it('round-trips a device write to another device through the server representation exactly', async () => {
    // Including the largest supported amounts: 2^33 DKK and its neighbours below.
    const amounts = ['0', '0,01', '0,50', '12,50', '-25,75', '123456789,99', '8589934592', '8589934591,99', '-8589934592'];
    for (const text of amounts) useExpensesStore.getState().addExpense({ name: 'Synthetic', amount: parsed(text), category: 'other', nextPaymentDate: '2026-09-05', isRecurring: false, recurrenceFrequency: null });
    const original = useExpensesStore.getState().expenses.map((e) => [e.id, e.amount]);
    await flush();
    const sent = writesTo('expenses').flat() as Row[];
    // Other device: PostgreSQL stores the decimal text; PostgREST emits it as a JSON number.
    mockRemote.expenses = sent.map((r) => row(r.id as string, ingress(r.amount)));
    useExpensesStore.setState({ expenses: [] });
    await useExpensesStore.getState().fetchFromSupabase();
    expect(useExpensesStore.getState().expenses.map((e) => [e.id, e.amount])).toEqual(original);
  });
});

describe('APP-040 unsupported persisted money is rejected before any store mutation', () => {
  /** Valid generic MinorUnits that the server transport cannot round-trip. */
  const EDGE = m(2 ** 33 * 100);
  const JUST_ABOVE = m(2 ** 33 * 100 + 1);
  /** An exact cent double that a material sub-cent server value aliases (20000000000000.001 → .00). */
  const ALIASED = m(2_000_000_000_000_000);
  const MAX = m(Number.MAX_SAFE_INTEGER);
  const snapshot = async (key: string) => {
    await flush();
    return { state: JSON.stringify(key === 'lifesort-expenses' ? useExpensesStore.getState() : key === 'lifesort-income-v2' ? useIncomeStore.getState() : useSavingsGoalsStore.getState()), disk: await AsyncStorage.getItem(key) };
  };

  it('Expenses: add, amount edit and category budget leave state, disk and server untouched', async () => {
    const store = useExpensesStore.getState();
    const id = store.addExpense({ name: 'Existing', amount: EDGE, category: 'other', nextPaymentDate: '2026-09-01', isRecurring: false, recurrenceFrequency: null });
    store.setCategoryBudget('other', m(10_000));
    const before = await snapshot('lifesort-expenses');
    mockWrites.length = 0;

    for (const unsupported of [JUST_ABOVE, ALIASED, MAX]) {
      expect(() => store.addExpense({ name: 'New', amount: unsupported, category: 'other', nextPaymentDate: '2026-09-02', isRecurring: false, recurrenceFrequency: null })).toThrow('money_unsupported_amount');
      expect(() => store.updateExpense(id, { amount: unsupported, name: 'Renamed' })).toThrow('money_unsupported_amount');
      expect(() => store.setCategoryBudget('other', unsupported)).toThrow('money_unsupported_amount');
    }
    expect(await snapshot('lifesort-expenses')).toEqual(before);
    expect(mockWrites).toEqual([]);
  });

  it('Income: an unsupported month amount leaves state, disk and server untouched', async () => {
    useIncomeStore.getState().setIncomeForMonth('2026-09', m(100));
    const before = await snapshot('lifesort-income-v2');
    mockWrites.length = 0;
    for (const unsupported of [JUST_ABOVE, ALIASED, MAX]) {
      expect(() => useIncomeStore.getState().setIncomeForMonth('2026-10', unsupported)).toThrow('money_unsupported_amount');
      expect(() => useIncomeStore.getState().setIncomeForMonth('2026-09', unsupported)).toThrow('money_unsupported_amount');
    }
    expect(await snapshot('lifesort-income-v2')).toEqual(before);
    expect(mockWrites).toEqual([]);
  });

  it('Savings: unsupported inputs AND unsupported resulting balances leave state, disk and server untouched', async () => {
    const store = useSavingsGoalsStore.getState();
    const full = store.addGoal({ name: 'At the edge', targetAmount: EDGE, icon: 'other' });
    const small = store.addGoal({ name: 'Small', targetAmount: m(10_000), icon: 'other' });
    store.distributeContributions([{ id: full, amount: EDGE }, { id: small, amount: m(100) }]);
    store.addExtraSavings(EDGE);
    const before = await snapshot('lifesort-savings-goals');
    mockWrites.length = 0;

    // Unsupported inputs.
    expect(() => store.addGoal({ name: 'Too big', targetAmount: JUST_ABOVE, icon: 'other' })).toThrow('money_unsupported_amount');
    expect(() => store.addGoal({ name: 'Aliased', targetAmount: ALIASED, icon: 'other' })).toThrow('money_unsupported_amount');
    expect(() => store.updateGoal(small, { targetAmount: MAX, name: 'Renamed' })).toThrow('money_unsupported_amount');
    expect(() => store.addContribution(small, MAX)).toThrow('money_unsupported_amount');
    // Supported inputs whose persisted result would not be supported (EDGE + 1).
    expect(() => store.addContribution(full, m(1))).toThrow('money_unsupported_amount');
    expect(() => store.transferBetweenGoals(small, full, m(1))).toThrow('money_unsupported_amount');
    expect(() => store.distributeContributions([{ id: small, amount: m(1) }, { id: full, amount: m(1) }])).toThrow('money_unsupported_amount');
    expect(() => store.addExtraSavings(m(1))).toThrow('money_unsupported_amount');

    expect(await snapshot('lifesort-savings-goals')).toEqual(before);
    expect(useSavingsGoalsStore.getState().goals.map((g) => g.savedAmount)).toEqual([EDGE, 100]);
    expect(mockWrites).toEqual([]);
  });
});
