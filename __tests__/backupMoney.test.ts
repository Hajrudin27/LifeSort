import { minorUnits } from '@/core/money/minorUnits';
import { BACKUP_VERSION, parseBackupFile } from '@/utils/shared/backupValidation';

/** APP-040 backup format 2: Economy money is DKK MinorUnits; format 1 is converted once before restore. */

let mockFileContent = '';
let mockWritten = '';
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: false, assets: [{ uri: 'file:///synthetic/backup.json' }] })),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///synthetic/',
  readAsStringAsync: jest.fn(() => Promise.resolve(mockFileContent)),
  writeAsStringAsync: jest.fn((_uri: string, content: string) => { mockWritten = content; return Promise.resolve(); }),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(false)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import { useTodoStore } from '@/store/useTodoStore';
import { exportBackup, importBackup } from '@/utils/shared/dataBackup';

const m = minorUnits;
const todo = { id: 'todo-1', title: 'Synthetic task', importance: 'low', completed: false, createdAt: '2026-09-01T00:00:00.000Z' };
const food = { monthlyBudgetByMonth: { '2026-09': 2500.5 }, purchases: [{ id: 'p1', amount: 12.345, date: '2026-09-02' }] };
const trips = { trips: [], expenses: [{ id: 't1', tripId: 'trip', name: 'Synthetic train', amount: 99.95, category: 'transport' }], packingItems: [], participants: [] };

function v1Economy() {
  return {
    expenses: {
      expenses: [{ id: 'e1', seriesId: 'e1', isRecurring: false, name: 'Synthetic', amount: 12.5, category: 'other', nextPaymentDate: '2026-09-01', attachments: [], createdAt: '2026-09-01T00:00:00.000Z' }],
      seriesStoppedAt: { e1: '2026-12' },
      categoryBudgets: { other: 1500, food: 0.1 + 0.2 },
    },
    income: { incomeByMonth: { '2026-09': 32000.75, '2026-08': 0 } },
    savingsGoals: {
      goals: [{ id: 'g1', name: 'Synthetic goal', icon: 'other', targetAmount: 1000, savedAmount: 250.25, createdAt: '2026-09-01' }],
      history: [{ id: 'h1', goalId: 'g1', amount: 300, date: '2026-09-01' }, { id: 'h2', goalId: 'g1', amount: -49.75, date: '2026-09-02' }],
      extraSavings: 10.1,
    },
  };
}
const backup = (version: number, data: Record<string, unknown>) => JSON.stringify({ version, exportedAt: '2026-09-01T00:00:00.000Z', data });

describe('APP-040 backup parsing', () => {
  it('writes format 3', () => {
    expect(BACKUP_VERSION).toBe(3);
  });

  it('format 1: converts every Economy money field exactly once and leaves other modules unchanged', () => {
    const result = parseBackupFile(backup(1, { ...v1Economy(), todos: { todos: [todo] }, food, trips }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version).toBe(1);
    expect(result.data.expenses).toEqual({
      ...v1Economy().expenses,
      // APP-042: a pre-format-3 one-time expense normalizes to no cadence and no anchor.
      expenses: [{ ...v1Economy().expenses.expenses[0], amount: 1_250, recurrenceFrequency: null, recurrenceAnchorDay: null }],
      categoryBudgets: { other: 150_000, food: 30 },
    });
    expect(result.data.income).toEqual({ incomeByMonth: { '2026-09': 3_200_075, '2026-08': 0 } });
    expect(result.data.savingsGoals).toEqual({
      goals: [{ ...v1Economy().savingsGoals.goals[0], targetAmount: 100_000, savedAmount: 25_025 }],
      history: [{ ...v1Economy().savingsGoals.history[0], amount: 30_000 }, { ...v1Economy().savingsGoals.history[1], amount: -4_975 }],
      extraSavings: 1_010,
    });
    // Food and Travel keep their major-unit numbers, even a third decimal: not APP-040's data.
    expect(result.data.food).toEqual(food);
    expect(result.data.trips).toEqual(trips);
    expect(result.data.todos).toEqual({ todos: [todo] });
  });

  it('format 2: the largest supported amount (2^33 DKK) is accepted unchanged', () => {
    const edge = 2 ** 33 * 100;
    const data = { income: { incomeByMonth: { '2026-09': edge, '2026-10': -edge } } };
    expect(parseBackupFile(backup(2, data))).toEqual({ ok: true, version: 2, data });
  });

  it('format 2: canonical amounts are validated and never scaled again', () => {
    const v2 = {
      expenses: { expenses: [{ id: 'e1', amount: 1_250, isRecurring: false }], categoryBudgets: { other: 150_000 } },
      income: { incomeByMonth: { '2026-09': 3_200_075 } },
      savingsGoals: { goals: [{ id: 'g1', targetAmount: 100_000, savedAmount: 1 }], history: [{ id: 'h1', amount: -4_975 }], extraSavings: 0 },
    };
    const result = parseBackupFile(backup(2, v2));
    expect(result).toEqual({
      ok: true,
      version: 2,
      data: { ...v2, expenses: { ...v2.expenses, expenses: [{ ...v2.expenses.expenses[0], recurrenceFrequency: null, recurrenceAnchorDay: null }] } },
    });
  });

  it.each([
    ['format 1 third decimal', 1, { income: { incomeByMonth: { '2026-09': 12.345 } } }, 'invalid_money'],
    ['format 1 unsafe amount', 1, { savingsGoals: { extraSavings: 1e14 } }, 'invalid_money'],
    ['format 1 missing expense amount', 1, { expenses: { expenses: [{ id: 'e1', isRecurring: false }] } }, 'invalid_money'],
    ['format 1 string budget', 1, { expenses: { categoryBudgets: { food: '100' } } }, 'invalid_money'],
    ['format 2 fractional minor unit', 2, { expenses: { expenses: [{ id: 'e1', amount: 12.5, isRecurring: false }] } }, 'invalid_money'],
    ['format 2 unsafe integer', 2, { savingsGoals: { history: [{ id: 'h', amount: 2 ** 60 }] } }, 'invalid_money'],
    ['format 2 safe integer the transport cannot carry (MAX_SAFE_INTEGER)', 2, { income: { incomeByMonth: { '2026-09': Number.MAX_SAFE_INTEGER } } }, 'invalid_money'],
    ['format 2 safe integer just above 2^33 DKK', 2, { expenses: { categoryBudgets: { food: 2 ** 33 * 100 + 1 } } }, 'invalid_money'],
    ['format 2 exact cent that a sub-cent server value aliases', 2, { income: { incomeByMonth: { '2026-09': 2_000_000_000_000_000 } } }, 'invalid_money'],
    ['format 1 value converting to unsupported money', 1, { savingsGoals: { extraSavings: 8589934592.01 } }, 'invalid_money'],
    ['format 1 parseFloat-collapsed third decimal (20000000000000.001)', 1, { income: { incomeByMonth: { '2026-09': parseFloat('20000000000000.001') } } }, 'invalid_money'],
    ['format 1 high-magnitude third decimal', 1, { income: { incomeByMonth: { '2026-09': 5_000_000_000.001 } } }, 'invalid_money'],
    ['non-object expense entry', 2, { expenses: { expenses: [42] } }, 'invalid_format'],
    ['future format', 4, { income: { incomeByMonth: {} } }, 'unsupported_version'],
    // APP-042 recurrence: a pre-3 file without a usable isRecurring, and a format 3 file
    // whose pair contradicts itself, both fail before any store is touched.
    ['pre-3 expense without isRecurring', 2, { expenses: { expenses: [{ id: 'e1', amount: 1_250 }] } }, 'invalid_format'],
    ['pre-3 expense with a non-boolean isRecurring', 2, { expenses: { expenses: [{ id: 'e1', amount: 1_250, isRecurring: 'yes' }] } }, 'invalid_format'],
    ['pre-3 recurring expense with an unrepairable date', 2, { expenses: { expenses: [{ id: 'e1', amount: 1_250, isRecurring: true, nextPaymentDate: '2026-13-01' }] } }, 'invalid_format'],
    ['pre-3 recurring expense without a date', 2, { expenses: { expenses: [{ id: 'e1', amount: 1_250, isRecurring: true }] } }, 'invalid_format'],
  ])('%s → %s', (_name, version, data, error) => {
    expect(parseBackupFile(backup(version as number, data as Record<string, unknown>))).toEqual({ ok: false, error });
  });

  it('APP-042: an older backup keeps its intended recurrence day, repairing the legacy impossible dates', () => {
    const expense = (id: string, isRecurring: boolean, nextPaymentDate: string) =>
      ({ id, seriesId: id, isRecurring, name: 'Synthetic', amount: 1_250, category: 'bill', nextPaymentDate, attachments: [], createdAt: '2026-01-01T00:00:00.000Z' });
    const result = parseBackupFile(backup(2, {
      expenses: {
        expenses: [
          expense('r1', true, '2026-01-31'),
          expense('r2', true, '2026-02-31'), // written by the pre-APP-042 rollForwardMonth
          expense('o1', false, '2026-02-31'), // a one-time date is left exactly as it is
        ],
      },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data.expenses!.expenses as Record<string, unknown>[]).map((e) => [
      e.id, e.nextPaymentDate, e.recurrenceFrequency, e.recurrenceAnchorDay,
    ])).toEqual([
      ['r1', '2026-01-31', 'monthly', 31],
      ['r2', '2026-02-28', 'monthly', 31],
      ['o1', '2026-02-31', null, null],
    ]);
  });

  it('APP-042: a format 3 backup keeps the explicit cadence and anchor unchanged', () => {
    const data = {
      expenses: {
        expenses: [
          { id: 'r1', amount: 1_250, isRecurring: true, recurrenceFrequency: 'quarterly', recurrenceAnchorDay: 31, nextPaymentDate: '2026-01-31' },
          { id: 'o1', amount: 99, isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null, nextPaymentDate: '2026-01-05' },
        ],
      },
    };
    expect(parseBackupFile(backup(3, data))).toEqual({ ok: true, version: 3, data });
  });

  describe('APP-042 format 3 is the canonical schema: nothing is normalized or repaired', () => {
    /** Everything unrelated to recurrence is valid, so each case isolates its own rule. */
    const expense = (overrides: Record<string, unknown>) => ({
      expenses: { expenses: [{
        id: 'e1', seriesId: 'e1', name: 'Synthetic', amount: 1_250, category: 'bill',
        nextPaymentDate: '2026-01-15', attachments: [], createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
      }] },
    });
    const parse = (overrides: Record<string, unknown>) => parseBackupFile(backup(3, expense(overrides)));

    it.each([
      ['one-time with explicit null/null', { isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null }],
      ['recurring monthly', { isRecurring: true, recurrenceFrequency: 'monthly', recurrenceAnchorDay: 15 }],
      ['recurring quarterly', { isRecurring: true, recurrenceFrequency: 'quarterly', recurrenceAnchorDay: 31 }],
      ['recurring yearly', { isRecurring: true, recurrenceFrequency: 'yearly', recurrenceAnchorDay: 1 }],
      ['recurring on a real leap day', { isRecurring: true, nextPaymentDate: '2028-02-29', recurrenceFrequency: 'yearly', recurrenceAnchorDay: 29 }],
    ])('accepts %s unchanged', (_name, overrides) => {
      const result = parse(overrides);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.expenses).toEqual(expense(overrides).expenses);
    });

    it.each([
      ['one-time missing both fields', { isRecurring: false }],
      ['one-time missing recurrenceFrequency', { isRecurring: false, recurrenceAnchorDay: null }],
      ['one-time missing recurrenceAnchorDay', { isRecurring: false, recurrenceFrequency: null }],
      ['one-time carrying a frequency', { isRecurring: false, recurrenceFrequency: 'monthly', recurrenceAnchorDay: null }],
      ['one-time carrying an anchor', { isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: 15 }],
      ['recurring missing recurrenceFrequency', { isRecurring: true, recurrenceAnchorDay: 15 }],
      ['recurring missing recurrenceAnchorDay', { isRecurring: true, recurrenceFrequency: 'monthly' }],
      ['recurring missing both fields', { isRecurring: true }],
      ['unknown frequency', { isRecurring: true, recurrenceFrequency: 'weekly', recurrenceAnchorDay: 15 }],
      ['case-variant frequency', { isRecurring: true, recurrenceFrequency: 'Monthly', recurrenceAnchorDay: 15 }],
      ['anchor 0', { isRecurring: true, recurrenceFrequency: 'monthly', recurrenceAnchorDay: 0 }],
      ['anchor 32', { isRecurring: true, recurrenceFrequency: 'monthly', recurrenceAnchorDay: 32 }],
      ['fractional anchor', { isRecurring: true, recurrenceFrequency: 'monthly', recurrenceAnchorDay: 15.5 }],
      // A recurring expense is current data: no legacy repair happens in format 3.
      ['recurring on an impossible date', { isRecurring: true, nextPaymentDate: '2026-02-31', recurrenceFrequency: 'monthly', recurrenceAnchorDay: 31 }],
      ['recurring on a non-leap 29 February', { isRecurring: true, nextPaymentDate: '2027-02-29', recurrenceFrequency: 'monthly', recurrenceAnchorDay: 29 }],
      ['recurring with an impossible month', { isRecurring: true, nextPaymentDate: '2026-13-01', recurrenceFrequency: 'monthly', recurrenceAnchorDay: 1 }],
      ['recurring with malformed date text', { isRecurring: true, nextPaymentDate: 'yesterday', recurrenceFrequency: 'monthly', recurrenceAnchorDay: 1 }],
      ['recurring with no date at all', { isRecurring: true, nextPaymentDate: undefined, recurrenceFrequency: 'monthly', recurrenceAnchorDay: 1 }],
    ])('rejects %s', (_name, overrides) => {
      expect(parse(overrides)).toEqual({ ok: false, error: 'invalid_format' });
    });

    it('leaves a one-time expense date alone: APP-042 tightened recurring data only', () => {
      const result = parse({ isRecurring: false, nextPaymentDate: '2026-02-31', recurrenceFrequency: null, recurrenceAnchorDay: null });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect((result.data.expenses!.expenses as Record<string, unknown>[])[0].nextPaymentDate).toBe('2026-02-31');
    });
  });

  it('never reports the offending amount', () => {
    expect(JSON.stringify(parseBackupFile(backup(1, { income: { incomeByMonth: { '2026-09': 12.345 } } })))).not.toContain('12.345');
  });
});

describe('APP-040 backup restore and export through the real stores', () => {
  const localExpenses = [{ id: 'local', seriesId: 'local', isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null, name: 'Local', amount: m(999), category: 'other', nextPaymentDate: '2026-09-01', attachments: [], createdAt: '2026-09-01T00:00:00.000Z' }];

  beforeEach(async () => {
    await Promise.all([useExpensesStore.persist.rehydrate(), useIncomeStore.persist.rehydrate(), useSavingsGoalsStore.persist.rehydrate(), useTodoStore.persist.rehydrate()]);
    useExpensesStore.setState({ expenses: localExpenses, seriesStoppedAt: {}, categoryBudgets: { food: m(100) } });
    useIncomeStore.setState({ incomeByMonth: { '2026-09': m(500) } });
    useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: m(7) });
    useTodoStore.setState({ todos: [] });
  });

  it('rejects an unsupported format 1 amount before ANY store mutation, keeping current data', async () => {
    const data = v1Economy();
    data.savingsGoals.history[1].amount = 49.755; // last store in the file, after Expenses and Income
    mockFileContent = backup(1, { ...data, todos: { todos: [todo] } });
    const before = JSON.stringify([useExpensesStore.getState(), useIncomeStore.getState(), useSavingsGoalsStore.getState(), useTodoStore.getState()]);
    const setters = [useExpensesStore, useIncomeStore, useSavingsGoalsStore, useTodoStore].map((store) => jest.spyOn(store, 'setState'));

    expect(await importBackup()).toEqual({ success: false, restoredKeys: [], skippedKeys: [], error: 'invalid_money' });
    for (const setter of setters) expect(setter).not.toHaveBeenCalled();
    expect(JSON.stringify([useExpensesStore.getState(), useIncomeStore.getState(), useSavingsGoalsStore.getState(), useTodoStore.getState()])).toBe(before);
    for (const setter of setters) setter.mockRestore();
  });

  it('rejects a format 2 backup with a generic safe integer the app cannot carry, before ANY store mutation', async () => {
    const data = {
      expenses: { expenses: [{ id: 'e1', seriesId: 'e1', isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null, name: 'Synthetic', amount: 1_250, category: 'other', nextPaymentDate: '2026-09-01', attachments: [], createdAt: '2026-09-01T00:00:00.000Z' }] },
      income: { incomeByMonth: { '2026-09': 3_200_000 } },
      savingsGoals: { goals: [], history: [], extraSavings: Number.MAX_SAFE_INTEGER },
      todos: { todos: [todo] },
    };
    mockFileContent = backup(2, data);
    const stores = [useExpensesStore, useIncomeStore, useSavingsGoalsStore, useTodoStore];
    const before = JSON.stringify(stores.map((store) => store.getState()));
    const setters = stores.map((store) => jest.spyOn(store, 'setState'));

    expect(await importBackup()).toEqual({ success: false, restoredKeys: [], skippedKeys: [], error: 'invalid_money' });
    for (const setter of setters) expect(setter).not.toHaveBeenCalled();
    expect(JSON.stringify(stores.map((store) => store.getState()))).toBe(before);
    for (const setter of setters) setter.mockRestore();
  });

  it.each([
    ['a recurring expense with no anchor day', { isRecurring: true, recurrenceFrequency: 'monthly' }],
    ['a recurring expense on an impossible date', { isRecurring: true, nextPaymentDate: '2026-02-31', recurrenceFrequency: 'monthly', recurrenceAnchorDay: 31 }],
    ['a one-time expense missing both recurrence fields', { isRecurring: false }],
  ])('APP-042: a format 3 backup containing %s mutates no store at all', async (_name, overrides) => {
    // Validation must finish before the first setState, so a file that is valid up to
    // its expenses must still leave Income, Savings and Todos exactly as they were.
    mockFileContent = backup(3, {
      expenses: { expenses: [{
        id: 'e1', seriesId: 'e1', name: 'Synthetic', amount: 1_250, category: 'bill',
        nextPaymentDate: '2026-01-15', attachments: [], createdAt: '2026-01-01T00:00:00.000Z', ...overrides,
      }] },
      income: { incomeByMonth: { '2026-09': 3_200_000 } },
      savingsGoals: { goals: [], history: [], extraSavings: 4_200 },
      todos: { todos: [todo] },
    });
    const stores = [useExpensesStore, useIncomeStore, useSavingsGoalsStore, useTodoStore];
    const before = JSON.stringify(stores.map((store) => store.getState()));
    const setters = stores.map((store) => jest.spyOn(store, 'setState'));

    expect(await importBackup()).toEqual({ success: false, restoredKeys: [], skippedKeys: [], error: 'invalid_format' });
    for (const setter of setters) expect(setter).not.toHaveBeenCalled();
    expect(JSON.stringify(stores.map((store) => store.getState()))).toBe(before);
    expect(useExpensesStore.getState().expenses).toEqual(localExpenses);
    expect(useIncomeStore.getState().incomeByMonth).toEqual({ '2026-09': 500 });
    expect(useSavingsGoalsStore.getState().extraSavings).toBe(7);
    for (const setter of setters) setter.mockRestore();
  });

  it('restores a valid format 1 backup as MinorUnits', async () => {
    mockFileContent = backup(1, v1Economy());
    expect(await importBackup()).toMatchObject({ success: true, restoredKeys: ['expenses', 'income', 'savingsGoals'] });
    expect(useExpensesStore.getState().expenses.map((e) => e.amount)).toEqual([1_250]);
    expect(useExpensesStore.getState().categoryBudgets).toEqual({ other: 150_000, food: 30 });
    expect(useIncomeStore.getState().incomeByMonth).toEqual({ '2026-09': 3_200_075, '2026-08': 0 });
    expect(useSavingsGoalsStore.getState()).toMatchObject({ extraSavings: 1_010, history: [{ amount: 30_000 }, { amount: -4_975 }] });
  });

  it('exports format 3 from canonical state, and re-importing it does not double-scale', async () => {
    mockFileContent = backup(1, v1Economy());
    await importBackup();
    const canonical = JSON.stringify([useExpensesStore.getState().expenses, useIncomeStore.getState().incomeByMonth, useSavingsGoalsStore.getState().goals, useSavingsGoalsStore.getState().history, useSavingsGoalsStore.getState().extraSavings]);

    await exportBackup();
    const exported = JSON.parse(mockWritten);
    expect(exported.version).toBe(3);
    expect(exported.data.expenses.expenses[0].amount).toBe(1_250);
    expect(exported.data.income.incomeByMonth['2026-09']).toBe(3_200_075);
    expect(exported.data.savingsGoals.extraSavings).toBe(1_010);

    useExpensesStore.setState({ expenses: [], categoryBudgets: {} });
    useIncomeStore.setState({ incomeByMonth: {} });
    useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: m(0) });
    mockFileContent = mockWritten;
    expect(await importBackup()).toMatchObject({ success: true });
    expect(JSON.stringify([useExpensesStore.getState().expenses, useIncomeStore.getState().incomeByMonth, useSavingsGoalsStore.getState().goals, useSavingsGoalsStore.getState().history, useSavingsGoalsStore.getState().extraSavings])).toBe(canonical);
  });
});
