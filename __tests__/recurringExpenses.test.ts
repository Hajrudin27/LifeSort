import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  anchorDayFromDateText,
  anchorDayFromIsoDate,
  DEFAULT_RECURRENCE_FREQUENCY,
  daysInMonth,
  isCoherentRecurrence,
  occurrenceDateForMonth,
  parseIsoDate,
  RECURRENCE_FREQUENCIES,
  repairLegacyOccurrenceDate,
  type RecurrenceFrequency,
} from '@/core/economy/recurrence';
import { minorUnits, type MinorUnits } from '@/core/money/minorUnits';
import { migrateLocalStore } from '@/core/storage/migrations/harness';
import { expensesMoneyMigration } from '@/core/storage/migrations/economyMoney';
import { economyTotalsForMonth } from '@/features/economy/monthlyTotals';

/**
 * APP-042: manual recurring costs — explicit frequency, calendar-correct dates,
 * and the boundary for future bank-derived candidates. See
 * docs/app-042-recurring-bills.md.
 */

type Row = Record<string, unknown>;
const mockWrites: { table: string; payload: unknown }[] = [];
const mockRemote: Record<string, Row[]> = {};

jest.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const rows = () => Promise.resolve({ data: mockRemote[table] ?? [], error: null });
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain, eq: () => chain, in: () => chain, delete: () => chain,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => rows().then(resolve, reject),
      upsert: (payload: unknown) => { mockWrites.push({ table, payload }); return Promise.resolve({ error: null }); },
      insert: (payload: unknown) => { mockWrites.push({ table, payload }); return Promise.resolve({ error: null }); },
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

const m = minorUnits;
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const store = () => useExpensesStore.getState();
const expenses = () => useExpensesStore.getState().expenses;
const expenseInput = (overrides: Partial<{
  name: string; amount: MinorUnits; category: string; nextPaymentDate: string;
  isRecurring: boolean; recurrenceFrequency: RecurrenceFrequency | null;
}> = {}) => ({
  name: 'Synthetic subscription',
  amount: m(9_900),
  category: 'subscription',
  nextPaymentDate: '2026-01-15',
  isRecurring: true,
  recurrenceFrequency: 'monthly' as RecurrenceFrequency | null,
  ...overrides,
});

beforeEach(async () => {
  await useExpensesStore.persist.rehydrate();
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  useIncomeStore.setState({ incomeByMonth: {} });
  await flush();
  mockWrites.length = 0;
  for (const key of Object.keys(mockRemote)) delete mockRemote[key];
});

describe('APP-042 the recurrence schedule is calendar arithmetic, not day counting', () => {
  it('generates monthly, quarterly and yearly occurrences only in due months', () => {
    const months = ['2026-02', '2026-03', '2026-04', '2026-06', '2026-07', '2027-01', '2027-02'];
    const due = (frequency: RecurrenceFrequency) =>
      months.filter((month) => occurrenceDateForMonth('2026-01-15', frequency, 15, month) !== null);
    expect(due('monthly')).toEqual(months);
    expect(due('quarterly')).toEqual(['2026-04', '2026-07', '2027-01']);
    expect(due('yearly')).toEqual(['2027-01']);
    expect(occurrenceDateForMonth('2026-01-15', 'quarterly', 15, '2026-04')).toBe('2026-04-15');
    expect(occurrenceDateForMonth('2026-01-15', 'yearly', 15, '2027-01')).toBe('2027-01-15');
  });

  it('never generates the same month or the past', () => {
    for (const frequency of RECURRENCE_FREQUENCIES) {
      expect(occurrenceDateForMonth('2026-01-15', frequency, 15, '2026-01')).toBeNull();
      expect(occurrenceDateForMonth('2026-01-15', frequency, 15, '2025-12')).toBeNull();
    }
  });

  it('clamps a short month without ever moving the anchor', () => {
    // A schedule on the 30th survives February: the clamp is one occurrence only.
    expect(occurrenceDateForMonth('2026-01-30', 'monthly', 30, '2026-02')).toBe('2026-02-28');
    expect(occurrenceDateForMonth('2026-02-28', 'monthly', 30, '2026-03')).toBe('2026-03-30');
    expect(occurrenceDateForMonth('2026-03-30', 'monthly', 30, '2026-04')).toBe('2026-04-30');
    // And so does a schedule on the 31st, which is not the same schedule.
    expect(occurrenceDateForMonth('2026-01-31', 'monthly', 31, '2026-02')).toBe('2026-02-28');
    expect(occurrenceDateForMonth('2026-02-28', 'monthly', 31, '2026-03')).toBe('2026-03-31');
    expect(occurrenceDateForMonth('2026-03-31', 'monthly', 31, '2026-04')).toBe('2026-04-30');
    expect(occurrenceDateForMonth('2026-04-30', 'monthly', 31, '2026-05')).toBe('2026-05-31');
    // An occurrence that happens to fall on a month's last day is not an
    // "end of month" schedule: the 30th stays the 30th.
    expect(occurrenceDateForMonth('2026-04-30', 'monthly', 30, '2026-05')).toBe('2026-05-30');
    // Quarterly and yearly follow the same rule, leap years included.
    expect(occurrenceDateForMonth('2026-01-31', 'quarterly', 31, '2026-04')).toBe('2026-04-30');
    expect(occurrenceDateForMonth('2026-04-30', 'quarterly', 31, '2026-07')).toBe('2026-07-31');
    expect(occurrenceDateForMonth('2024-02-29', 'yearly', 29, '2025-02')).toBe('2025-02-28');
    expect(occurrenceDateForMonth('2025-02-28', 'yearly', 29, '2026-02')).toBe('2026-02-28');
    expect(occurrenceDateForMonth('2027-02-28', 'yearly', 29, '2028-02')).toBe('2028-02-29');
    // A day that exists in the target month is kept exactly.
    expect(occurrenceDateForMonth('2026-01-29', 'monthly', 29, '2026-03')).toBe('2026-03-29');
  });

  it('refuses to schedule without a usable anchor day', () => {
    for (const anchor of [0, 32, -1, 15.5, NaN, null, undefined, '15']) {
      expect(occurrenceDateForMonth('2026-01-15', 'monthly', anchor as number, '2026-02')).toBeNull();
    }
  });

  it('separates the strict current-write parser from the permissive legacy one', () => {
    // Current writes: the date must exist. Legacy repair: the day token survives.
    expect(anchorDayFromIsoDate('2026-01-31')).toBe(31);
    expect(anchorDayFromIsoDate('2028-02-29')).toBe(29); // a real leap day
    for (const impossible of ['2026-02-31', '2026-02-30', '2026-04-31', '2027-02-29']) {
      expect(anchorDayFromIsoDate(impossible)).toBeNull();
      expect(anchorDayFromDateText(impossible)).not.toBeNull();
    }
  });

  it('reads the intended day token from a date, including a legacy impossible one', () => {
    expect(anchorDayFromDateText('2026-01-31')).toBe(31);
    expect(anchorDayFromDateText('2026-02-31')).toBe(31); // written by the old rollForwardMonth
    expect(repairLegacyOccurrenceDate('2026-02-31')).toEqual({ date: '2026-02-28', anchorDay: 31 });
    expect(repairLegacyOccurrenceDate('2028-02-30')).toEqual({ date: '2028-02-29', anchorDay: 30 });
    expect(repairLegacyOccurrenceDate('2026-04-31')).toEqual({ date: '2026-04-30', anchorDay: 31 });
    expect(repairLegacyOccurrenceDate('2026-09-15')).toEqual({ date: '2026-09-15', anchorDay: 15 });
    // Outside the known legacy pattern nothing is repaired.
    for (const bad of ['2026-13-01', '2026-02-32', '2026-02-00', '2026-2-3', 'yesterday', '', null]) {
      expect(repairLegacyOccurrenceDate(bad)).toBeNull();
      expect(anchorDayFromDateText(bad)).toBeNull();
    }
  });

  it('only ever produces real calendar dates, across every day and cadence in two years', () => {
    for (let month = 1; month <= 12; month += 1) {
      for (let day = 1; day <= daysInMonth(2026, month); day += 1) {
        const base = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        for (const frequency of RECURRENCE_FREQUENCIES) {
          for (let ahead = 1; ahead <= 24; ahead += 1) {
            const index = (month - 1) + ahead;
            const target = `${2026 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
            const result = occurrenceDateForMonth(base, frequency, day, target);
            if (result === null) continue;
            expect(parseIsoDate(result)).not.toBeNull();
            expect(result.slice(0, 7)).toBe(target);
          }
        }
      }
    }
  });

  it('rejects impossible or malformed input instead of guessing', () => {
    for (const bad of ['2027-02-30', '2026-04-31', '2026-13-01', 'yesterday', '2026-01']) {
      expect(occurrenceDateForMonth(bad, 'monthly', 15, '2026-05')).toBeNull();
      expect(parseIsoDate(bad)).toBeNull();
    }
    expect(occurrenceDateForMonth('2026-01-15', 'monthly', 15, '2026-13')).toBeNull();
  });
});

describe('APP-042 the manual recurrence pair cannot become incoherent', () => {
  it('stores a one-time expense with no frequency and a recurring one with its cadence', () => {
    store().addExpense(expenseInput({ isRecurring: false, recurrenceFrequency: null }));
    store().addExpense(expenseInput({ recurrenceFrequency: 'quarterly' }));
    expect(expenses().map((e) => [e.isRecurring, e.recurrenceFrequency])).toEqual([[false, null], [true, 'quarterly']]);
  });

  it('refuses a recurring expense without a frequency, and an unsupported frequency', () => {
    for (const frequency of [null, undefined, 'weekly', 'MONTHLY', 'daily', 7]) {
      expect(() => store().addExpense(expenseInput({ recurrenceFrequency: frequency as RecurrenceFrequency })))
        .toThrow('recurrence_incoherent');
    }
    // A one-time expense may not carry one either.
    expect(() => store().addExpense(expenseInput({ isRecurring: false, recurrenceFrequency: 'monthly' })))
      .toThrow('recurrence_incoherent');
    expect(expenses()).toEqual([]);
  });

  it('uses monthly as the visible default the create screen starts from', () => {
    expect(DEFAULT_RECURRENCE_FREQUENCY).toBe('monthly');
    expect(isCoherentRecurrence(true, DEFAULT_RECURRENCE_FREQUENCY, 15)).toBe(true);
    expect(isCoherentRecurrence(true, DEFAULT_RECURRENCE_FREQUENCY, null)).toBe(false);
    expect(isCoherentRecurrence(false, null, 15)).toBe(false);
  });

  it('derives the anchor from the payment date the user picked, and keeps it internal', () => {
    const id = store().addExpense(expenseInput({ nextPaymentDate: '2026-01-31' }));
    expect(expenses()[0]).toMatchObject({ recurrenceFrequency: 'monthly', recurrenceAnchorDay: 31 });

    // Amount-, name-, category- and frequency-only edits preserve it.
    store().updateExpense(id, { amount: m(12_000) });
    store().updateExpense(id, { name: 'Renamed', category: 'bill' });
    store().updateExpense(id, { recurrenceFrequency: 'quarterly' });
    expect(expenses()[0]).toMatchObject({ recurrenceAnchorDay: 31, recurrenceFrequency: 'quarterly', amount: 12_000 });

    // A new payment date resets it.
    store().updateExpense(id, { nextPaymentDate: '2026-01-05' });
    expect(expenses()[0].recurrenceAnchorDay).toBe(5);

    // Recurring → one-time clears both; one-time → recurring derives it again.
    store().updateExpense(id, { isRecurring: false });
    expect(expenses()[0]).toMatchObject({ recurrenceFrequency: null, recurrenceAnchorDay: null });
    store().updateExpense(id, { isRecurring: true, recurrenceFrequency: 'monthly' });
    expect(expenses()[0]).toMatchObject({ recurrenceFrequency: 'monthly', recurrenceAnchorDay: 5 });

    // A one-time expense never gets one, and a recurring expense needs a usable date.
    store().addExpense(expenseInput({ isRecurring: false, recurrenceFrequency: null }));
    expect(expenses()[1].recurrenceAnchorDay).toBeNull();
    expect(() => store().addExpense(expenseInput({ nextPaymentDate: 'not-a-date' }))).toThrow('recurrence_incoherent');
  });

  it('keeps the anchor when an edit re-sends the same, clamped date', () => {
    // The edit screen always sends nextPaymentDate. A February occurrence of a 31st
    // schedule is stored as the 28th, so re-sending it must not re-anchor to the 28th.
    const clamped = {
      id: 'feb', seriesId: 'series-31', isRecurring: true, recurrenceFrequency: 'monthly' as const,
      recurrenceAnchorDay: 31, name: 'Synthetic rent', amount: m(825_000), category: 'bill',
      nextPaymentDate: '2026-02-28', attachments: [], createdAt: '2026-02-01T00:00:00.000Z',
    };
    useExpensesStore.setState({ expenses: [clamped], seriesStoppedAt: {} });

    store().updateExpense('feb', { name: 'Renamed', nextPaymentDate: '2026-02-28' });
    expect(expenses()[0]).toMatchObject({ name: 'Renamed', recurrenceAnchorDay: 31 });
    store().updateExpense('feb', { recurrenceFrequency: 'monthly', nextPaymentDate: '2026-02-28', amount: m(900_000) });
    store().updateExpense('feb', { category: 'home', isRecurring: true, nextPaymentDate: '2026-02-28' });
    expect(expenses()[0]).toMatchObject({ recurrenceAnchorDay: 31, amount: 900_000, category: 'home' });

    store().rollForwardMonth('2026-03');
    expect(expenses().map((e) => e.nextPaymentDate)).toEqual(['2026-02-28', '2026-03-31']);
    expect(expenses()[1].recurrenceAnchorDay).toBe(31);

    // A frequency change alone, still re-sending the date, preserves it as well.
    useExpensesStore.setState({ expenses: [clamped], seriesStoppedAt: {} });
    store().updateExpense('feb', { recurrenceFrequency: 'quarterly', nextPaymentDate: '2026-02-28' });
    expect(expenses()[0]).toMatchObject({ recurrenceFrequency: 'quarterly', recurrenceAnchorDay: 31 });
    store().rollForwardMonth('2026-05');
    expect(expenses().map((e) => e.nextPaymentDate)).toEqual(['2026-02-28', '2026-05-31']);

    // A real date change still re-anchors, strictly.
    useExpensesStore.setState({ expenses: [clamped], seriesStoppedAt: {} });
    store().updateExpense('feb', { nextPaymentDate: '2026-02-20' });
    expect(expenses()[0].recurrenceAnchorDay).toBe(20);
    expect(() => store().updateExpense('feb', { nextPaymentDate: '2026-02-31' })).toThrow('recurrence_incoherent');
    expect(expenses()[0]).toMatchObject({ nextPaymentDate: '2026-02-20', recurrenceAnchorDay: 20 });
  });

  it('rejects a current write on a date the calendar does not have, leaving state untouched', () => {
    // The legacy repair helpers exist for historical data only: a write happening
    // now must name a real date, so this never reaches set().
    const impossible = ['2026-02-31', '2026-02-30', '2026-04-31', '2027-02-29', '2026-13-01', '2026-02-00', '2026-02-32', '20260231'];
    for (const date of impossible) {
      expect(() => store().addExpense(expenseInput({ nextPaymentDate: date }))).toThrow('recurrence_incoherent');
    }
    expect(expenses()).toEqual([]);

    const id = store().addExpense(expenseInput({ nextPaymentDate: '2026-01-15' }));
    const before = JSON.stringify(expenses());
    for (const date of impossible) {
      expect(() => store().updateExpense(id, { nextPaymentDate: date })).toThrow('recurrence_incoherent');
      expect(() => store().updateExpense(id, { nextPaymentDate: date, amount: m(1) })).toThrow('recurrence_incoherent');
    }
    expect(JSON.stringify(expenses())).toBe(before);

    // A real leap day is accepted and anchors on the 29th.
    store().updateExpense(id, { nextPaymentDate: '2028-02-29' });
    expect(expenses()[0]).toMatchObject({ nextPaymentDate: '2028-02-29', recurrenceAnchorDay: 29 });
    expect(store().addExpense(expenseInput({ nextPaymentDate: '2028-02-29' }))).toBeTruthy();
    expect(expenses()[1].recurrenceAnchorDay).toBe(29);

    // A one-time expense is not date-validated by the recurrence rule, as before APP-042.
    store().addExpense(expenseInput({ isRecurring: false, recurrenceFrequency: null, nextPaymentDate: '2026-02-31' }));
    expect(expenses()[2]).toMatchObject({ nextPaymentDate: '2026-02-31', recurrenceAnchorDay: null });
  });
});

describe('APP-042 recurrence generation through the real store', () => {
  it('materializes one instance per due month, with fresh IDs, the same series, amount and cadence', () => {
    const id = store().addExpense(expenseInput({ recurrenceFrequency: 'quarterly', nextPaymentDate: '2026-01-31' }));
    store().addAttachment(id, { id: 'a1', uri: 'file:///synthetic.jpg', name: 'r.jpg', kind: 'image' });

    store().rollForwardMonth('2026-02'); // not due for a quarterly series
    store().rollForwardMonth('2026-03'); // not due
    expect(expenses()).toHaveLength(1);

    store().rollForwardMonth('2026-04');
    store().rollForwardMonth('2026-04'); // repeating the same month must not duplicate
    store().rollForwardMonth('2026-07');
    const generated = expenses().filter((e) => e.id !== id);
    // April clamps to the 30th; July returns to the anchored 31st.
    expect(generated.map((e) => e.nextPaymentDate)).toEqual(['2026-04-30', '2026-07-31']);
    expect(new Set(expenses().map((e) => e.id)).size).toBe(3);
    expect(generated.every((e) => e.seriesId === id)).toBe(true);
    expect(generated.every((e) => e.amount === 9_900)).toBe(true);
    expect(generated.every((e) => e.recurrenceFrequency === 'quarterly')).toBe(true);
    // The anchor travels with the series and is never rewritten by a clamp.
    expect(expenses().every((e) => e.recurrenceAnchorDay === 31)).toBe(true);
    // A receipt belongs to the month it was filed in, never to the next instance.
    expect(generated.every((e) => e.attachments.length === 0)).toBe(true);
    expect(expenses().find((e) => e.id === id)!.attachments).toHaveLength(1);
  });

  it('keeps a monthly schedule on its day through a short month', () => {
    // The blocker this correction fixes: February must not turn a 30th into a 31st.
    const thirtieth = store().addExpense(expenseInput({ nextPaymentDate: '2026-01-30' }));
    store().rollForwardMonth('2026-02');
    store().rollForwardMonth('2026-03');
    store().rollForwardMonth('2026-04');
    expect(expenses().filter((e) => e.seriesId === thirtieth).map((e) => e.nextPaymentDate))
      .toEqual(['2026-01-30', '2026-02-28', '2026-03-30', '2026-04-30']);

    useExpensesStore.setState({ expenses: [], seriesStoppedAt: {} });
    const lastDay = store().addExpense(expenseInput({ nextPaymentDate: '2026-01-31' }));
    for (const month of ['2026-02', '2026-03', '2026-04', '2026-05']) store().rollForwardMonth(month);
    expect(expenses().filter((e) => e.seriesId === lastDay).map((e) => e.nextPaymentDate))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);

    // A schedule genuinely on the 30th of a 30-day month stays on the 30th.
    useExpensesStore.setState({ expenses: [], seriesStoppedAt: {} });
    store().addExpense(expenseInput({ nextPaymentDate: '2026-04-30' }));
    store().rollForwardMonth('2026-05');
    expect(expenses().map((e) => e.nextPaymentDate)).toEqual(['2026-04-30', '2026-05-30']);
  });

  it('does not restart a stopped series and does not generate from a one-time expense', () => {
    const recurring = store().addExpense(expenseInput());
    const oneTime = store().addExpense(expenseInput({ isRecurring: false, recurrenceFrequency: null, nextPaymentDate: '2026-01-20' }));
    store().deleteRecurringFromMonth(recurring, '2026-02');
    store().rollForwardMonth('2026-02');
    store().rollForwardMonth('2026-03');
    expect(expenses().map((e) => e.id)).toEqual([recurring, oneTime]);
  });

  it('carries an edited frequency, amount and date into future months and drops stale future instances', () => {
    const id = store().addExpense(expenseInput());
    store().rollForwardMonth('2026-02');
    store().rollForwardMonth('2026-03');
    expect(expenses()).toHaveLength(3);

    // Editing the January instance clears the materialized future, as before APP-042.
    store().updateExpense(id, { amount: m(12_000), recurrenceFrequency: 'yearly' });
    expect(expenses()).toHaveLength(1);
    store().rollForwardMonth('2026-02');
    expect(expenses()).toHaveLength(1); // yearly: February is not due any more
    store().rollForwardMonth('2027-01');
    expect(expenses().map((e) => [e.nextPaymentDate, e.amount, e.recurrenceFrequency])).toEqual([
      ['2026-01-15', 12_000, 'yearly'],
      ['2027-01-15', 12_000, 'yearly'],
    ]);
  });

  it('stops future recurrence when recurrence is switched off, and keeps the past untouched', () => {
    const id = store().addExpense(expenseInput());
    store().rollForwardMonth('2026-02');
    const february = expenses().find((e) => e.id !== id)!;

    store().updateExpense(february.id, { isRecurring: false });
    expect(expenses().find((e) => e.id === february.id)).toMatchObject({ isRecurring: false, recurrenceFrequency: null });
    store().rollForwardMonth('2026-03');
    expect(expenses()).toHaveLength(2);
    // The January instance is historical and is not rewritten by the edit.
    expect(expenses().find((e) => e.id === id)).toMatchObject({ isRecurring: true, recurrenceFrequency: 'monthly', amount: 9_900 });
  });

  it('turns a one-time expense into a coherent recurring one', () => {
    const id = store().addExpense(expenseInput({ isRecurring: false, recurrenceFrequency: null }));
    expect(() => store().updateExpense(id, { isRecurring: true })).toThrow('recurrence_incoherent');
    expect(expenses()[0]).toMatchObject({ isRecurring: false, recurrenceFrequency: null });

    store().updateExpense(id, { isRecurring: true, recurrenceFrequency: 'monthly' });
    store().rollForwardMonth('2026-02');
    expect(expenses().map((e) => [e.nextPaymentDate, e.recurrenceFrequency])).toEqual([
      ['2026-01-15', 'monthly'], ['2026-02-15', 'monthly'],
    ]);
  });

  it('counts every materialized instance as an ordinary manual occurrence in APP-039 totals', () => {
    store().addExpense(expenseInput({ nextPaymentDate: '2026-01-15' }));
    store().rollForwardMonth('2026-02');
    store().addExpense(expenseInput({ isRecurring: false, recurrenceFrequency: null, amount: m(2_500), nextPaymentDate: '2026-02-20' }));
    const totals = economyTotalsForMonth(expenses(), {}, '2026-02');
    expect(totals).toMatchObject({ settledSpending: 12_400, expenseCount: 2 });
  });
});

describe('APP-042 the server boundary carries the frequency', () => {
  const rows = () => mockWrites.filter((write) => write.table === 'expenses').flatMap((write) => [write.payload].flat() as Row[]);

  it('writes the cadence and anchor for recurring rows, and null for one-time rows', async () => {
    store().addExpense(expenseInput({ recurrenceFrequency: 'yearly', nextPaymentDate: '2026-01-31' }));
    store().addExpense(expenseInput({ isRecurring: false, recurrenceFrequency: null }));
    store().rollForwardMonth('2027-01');
    await flush();
    expect(rows().map((row) => [row.is_recurring, row.recurrence_frequency, row.recurrence_anchor_day])).toEqual([
      [true, 'yearly', 31], [false, null, null], [true, 'yearly', 31],
    ]);
  });

  it('maps a fetched row back, and rejects the whole snapshot when the server state is incoherent', async () => {
    const row = (id: string, isRecurring: boolean, frequency: unknown, anchorDay: unknown = null) => ({
      id, series_id: id, is_recurring: isRecurring, recurrence_frequency: frequency, recurrence_anchor_day: anchorDay,
      name: 'Synthetic', amount: 99.0, category: 'bill', next_payment_date: '2026-03-01',
      created_at: '2026-03-01T00:00:00.000Z',
    });
    mockRemote.expenses = [row('r1', true, 'quarterly', 31), row('o1', false, null)];
    await useExpensesStore.getState().fetchFromSupabase();
    await flush();
    expect(expenses().map((e) => [e.id, e.recurrenceFrequency, e.recurrenceAnchorDay]))
      .toEqual([['r1', 'quarterly', 31], ['o1', null, null]]);

    const before = JSON.stringify(expenses());
    for (const bad of [
      row('bad', true, null, 15), row('bad', true, 'weekly', 15), row('bad', false, 'monthly', 15),
      row('bad', true, 'monthly', null), row('bad', true, 'monthly', 0), row('bad', true, 'monthly', 32),
      row('bad', true, 'monthly', 15.5), row('bad', false, null, 15),
    ]) {
      mockRemote.expenses = [bad];
      await useExpensesStore.getState().fetchFromSupabase();
      await flush();
      expect(JSON.stringify(expenses())).toBe(before);
    }
  });
});

describe('APP-042 local persistence upgrades from v1 to v2', () => {
  const v1 = (expense: Row) => JSON.stringify({
    state: { expenses: [expense], seriesStoppedAt: { s1: '2026-12' }, categoryBudgets: { bill: 150_000 } },
    version: 1,
  });
  const memory = (raw: string) => {
    let bytes: string | null = raw;
    return { getItem: async () => bytes, setItem: jest.fn(async (_key: string, value: string) => { bytes = value; }), bytes: () => bytes };
  };
  const recurringV1 = {
    id: 'e1', seriesId: 's1', isRecurring: true, name: 'Synthetic rent', amount: 825_000,
    category: 'bill', nextPaymentDate: '2026-09-01', attachments: [{ id: 'a1', uri: 'file:///x.lsenc', name: 'r.jpg', kind: 'image' }],
    createdAt: '2026-09-01T08:00:00.000Z',
  };

  it('gives a v1 recurring expense monthly with the date\'s day as anchor, and a one-time expense null', async () => {
    const storage = memory(v1(recurringV1));
    expect((await migrateLocalStore(expensesMoneyMigration, storage)).migrated).toBe(true);
    const after = JSON.parse(storage.bytes()!);
    expect(after.version).toBe(2);
    expect(after.state.expenses[0]).toEqual({ ...recurringV1, recurrenceFrequency: 'monthly', recurrenceAnchorDay: 1 });
    expect(after.state.seriesStoppedAt).toEqual({ s1: '2026-12' });
    expect(after.state.categoryBudgets).toEqual({ bill: 150_000 });

    const oneTime = memory(v1({ ...recurringV1, isRecurring: false }));
    await migrateLocalStore(expensesMoneyMigration, oneTime);
    expect(JSON.parse(oneTime.bytes()!).state.expenses[0])
      .toEqual({ ...recurringV1, isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null });
  });

  it('repairs the legacy impossible dates the old rollForwardMonth could write', async () => {
    // Pre-APP-042 the next month's date was built by concatenation, with no calendar
    // check, so these strings exist on devices. The intended day survives as the anchor.
    for (const [stored, repaired, anchor] of [
      ['2026-02-31', '2026-02-28', 31], ['2026-02-30', '2026-02-28', 30],
      ['2028-02-30', '2028-02-29', 30], ['2026-04-31', '2026-04-30', 31],
    ] as [string, string, number][]) {
      const storage = memory(v1({ ...recurringV1, nextPaymentDate: stored }));
      await migrateLocalStore(expensesMoneyMigration, storage);
      expect(JSON.parse(storage.bytes()!).state.expenses[0]).toEqual({
        ...recurringV1, nextPaymentDate: repaired, recurrenceFrequency: 'monthly', recurrenceAnchorDay: anchor,
      });
    }

    // A repaired series then recurs on its intended day again.
    const storage = memory(v1({ ...recurringV1, nextPaymentDate: '2026-02-31' }));
    await migrateLocalStore(expensesMoneyMigration, storage);
    const migrated = JSON.parse(storage.bytes()!).state.expenses[0];
    expect(occurrenceDateForMonth(migrated.nextPaymentDate, 'monthly', migrated.recurrenceAnchorDay, '2026-03'))
      .toBe('2026-03-31');

    // A one-time expense with an impossible date is left exactly as it is: it never recurs.
    const oneTime = memory(v1({ ...recurringV1, isRecurring: false, nextPaymentDate: '2026-02-31' }));
    await migrateLocalStore(expensesMoneyMigration, oneTime);
    expect(JSON.parse(oneTime.bytes()!).state.expenses[0].nextPaymentDate).toBe('2026-02-31');

    // Anything outside the known pattern still fails closed.
    for (const bad of ['2026-13-01', '2026-02-32', '2026-02-00', 'yesterday', 20260231]) {
      const broken = memory(v1({ ...recurringV1, nextPaymentDate: bad }));
      await expect(migrateLocalStore(expensesMoneyMigration, broken)).rejects.toMatchObject({ code: 'transform-failed' });
      expect(broken.setItem).not.toHaveBeenCalled();
    }
  });

  it('never rescales money while adding the frequency', async () => {
    const amounts = [0, 1, -2_575, 825_000, 2 ** 33 * 100];
    const storage = memory(JSON.stringify({
      state: {
        expenses: amounts.map((amount, index) => ({ ...recurringV1, id: `e${index}`, amount })),
        seriesStoppedAt: {}, categoryBudgets: { bill: 1 },
      },
      version: 1,
    }));
    await migrateLocalStore(expensesMoneyMigration, storage);
    expect(JSON.parse(storage.bytes()!).state.expenses.map((e: Row) => e.amount)).toEqual(amounts);
    expect(JSON.parse(storage.bytes()!).state.categoryBudgets).toEqual({ bill: 1 });
  });

  it('requires canonical v2 bytes to carry both recurrence fields explicitly', async () => {
    const v2 = (expense: Row) => JSON.stringify({
      state: { expenses: [expense], seriesStoppedAt: {}, categoryBudgets: {} }, version: 2,
    });
    const oneTime = { ...recurringV1, isRecurring: false };
    const valid = [
      { ...oneTime, recurrenceFrequency: null, recurrenceAnchorDay: null },
      { ...recurringV1, recurrenceFrequency: 'quarterly', recurrenceAnchorDay: 31 },
      { ...recurringV1, nextPaymentDate: '2028-02-29', recurrenceFrequency: 'yearly', recurrenceAnchorDay: 29 },
    ];
    for (const expense of valid) {
      const storage = memory(v2(expense));
      expect((await migrateLocalStore(expensesMoneyMigration, storage)).migrated).toBe(false);
      expect(storage.setItem).not.toHaveBeenCalled();
    }

    const invalid: Row[] = [
      oneTime, // both properties absent: v2 bytes must say what they are
      { ...oneTime, recurrenceFrequency: null }, // only one property present
      { ...oneTime, recurrenceAnchorDay: null },
      { ...recurringV1, recurrenceFrequency: 'monthly' }, // recurring, anchor absent
      { ...recurringV1, recurrenceAnchorDay: 1 }, // recurring, cadence absent
      // A v2 recurring date is current data: the calendar must have it.
      { ...recurringV1, nextPaymentDate: '2026-02-31', recurrenceFrequency: 'monthly', recurrenceAnchorDay: 31 },
      { ...recurringV1, nextPaymentDate: '2027-02-29', recurrenceFrequency: 'monthly', recurrenceAnchorDay: 29 },
      { ...recurringV1, nextPaymentDate: '2026-13-01', recurrenceFrequency: 'monthly', recurrenceAnchorDay: 1 },
      { ...recurringV1, nextPaymentDate: 'yesterday', recurrenceFrequency: 'monthly', recurrenceAnchorDay: 1 },
    ];
    for (const expense of invalid) {
      const raw = v2(expense);
      const storage = memory(raw);
      await expect(migrateLocalStore(expensesMoneyMigration, storage)).rejects.toMatchObject({ code: 'validation-failed' });
      expect(storage.bytes()).toBe(raw);
      expect(storage.setItem).not.toHaveBeenCalled();
    }

    // A one-time expense keeps whatever date the schema accepted before APP-042.
    const untouchedDate = memory(v2({ ...oneTime, nextPaymentDate: '2026-02-31', recurrenceFrequency: null, recurrenceAnchorDay: null }));
    expect((await migrateLocalStore(expensesMoneyMigration, untouchedDate)).migrated).toBe(false);
  });

  it('runs v0 → v1 → v2 in one pass, converting money exactly once', async () => {
    const storage = memory(JSON.stringify({
      state: {
        expenses: [
          { ...recurringV1, amount: 82.5, nextPaymentDate: '2026-02-31' }, // legacy kroner and a legacy date
          { ...recurringV1, id: 'e2', isRecurring: false, amount: 0.1 + 0.2 },
        ],
        seriesStoppedAt: {}, categoryBudgets: { bill: 1500.5 },
      },
      version: 0,
    }));
    expect((await migrateLocalStore(expensesMoneyMigration, storage)).migrated).toBe(true);
    const after = JSON.parse(storage.bytes()!);
    expect(after.version).toBe(2);
    expect(after.state.expenses.map((e: Row) => [e.amount, e.nextPaymentDate, e.recurrenceFrequency, e.recurrenceAnchorDay]))
      .toEqual([[8_250, '2026-02-28', 'monthly', 31], [30, recurringV1.nextPaymentDate, null, null]]);
    expect(after.state.categoryBudgets).toEqual({ bill: 150_050 });
    // Re-running converts nothing again: the money is already canonical øre.
    storage.setItem.mockClear();
    expect((await migrateLocalStore(expensesMoneyMigration, storage)).migrated).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(JSON.parse(storage.bytes()!).state.expenses.map((e: Row) => e.amount)).toEqual([8_250, 30]);
  });

  it('leaves a current v2 payload untouched and writes nothing', async () => {
    const storage = memory(JSON.stringify({
      state: {
        expenses: [{ ...recurringV1, recurrenceFrequency: 'yearly', recurrenceAnchorDay: 1 }],
        seriesStoppedAt: {}, categoryBudgets: {},
      },
      version: 2,
    }));
    const before = storage.bytes();
    expect((await migrateLocalStore(expensesMoneyMigration, storage)).migrated).toBe(false);
    expect(storage.bytes()).toBe(before);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed recurrence shape, keeping the original bytes', async () => {
    for (const [expense, version] of [
      [{ ...recurringV1, isRecurring: 'yes' }, 1],
      [{ ...recurringV1, isRecurring: undefined }, 1],
      [{ ...recurringV1, recurrenceFrequency: 'monthly' }, 1], // v1 never carried the fields
      [{ ...recurringV1, recurrenceAnchorDay: 15 }, 1],
      [{ ...recurringV1, recurrenceFrequency: 'weekly', recurrenceAnchorDay: 15 }, 2],
      [{ ...recurringV1, recurrenceFrequency: null, recurrenceAnchorDay: 15 }, 2], // no cadence
      [{ ...recurringV1, recurrenceFrequency: 'monthly', recurrenceAnchorDay: null }, 2], // no anchor
      [{ ...recurringV1, recurrenceFrequency: 'monthly', recurrenceAnchorDay: 0 }, 2],
      [{ ...recurringV1, recurrenceFrequency: 'monthly', recurrenceAnchorDay: 32 }, 2],
      [{ ...recurringV1, recurrenceFrequency: 'monthly', recurrenceAnchorDay: '15' }, 2],
      [{ ...recurringV1, isRecurring: false, recurrenceFrequency: 'monthly', recurrenceAnchorDay: 15 }, 2],
      [{ ...recurringV1, isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: 15 }, 2],
    ] as [Row, number][]) {
      const raw = JSON.stringify({ state: { expenses: [expense], seriesStoppedAt: {}, categoryBudgets: {} }, version });
      const storage = memory(raw);
      await expect(migrateLocalStore(expensesMoneyMigration, storage)).rejects.toMatchObject({ name: 'LocalMigrationError' });
      expect(storage.bytes()).toBe(raw);
      expect(storage.setItem).not.toHaveBeenCalled();
    }
  });

  it('upgrades a real v1 fixture written by the APP-040 build', async () => {
    const raw = require('fs').readFileSync(
      require('path').join(__dirname, 'fixtures/local-migrations/expenses/22bbf3a-inner-v1.json'), 'utf8',
    );
    const storage = memory(raw);
    await migrateLocalStore(expensesMoneyMigration, storage);
    const after = JSON.parse(storage.bytes()!);
    expect(after.version).toBe(2);
    expect(after.state.expenses.map((e: Row) => [e.isRecurring, e.recurrenceFrequency, e.recurrenceAnchorDay, e.amount]))
      .toEqual([[true, 'monthly', 30, 825_000], [true, 'monthly', 15, 12_500], [false, null, null, 1_234], [false, null, null, 0]]);
    // Every other field, including attachments and the stop marker, is preserved.
    expect(after.state.seriesStoppedAt).toEqual(JSON.parse(raw).state.seriesStoppedAt);
    expect(after.state.expenses.map((e: Row) => e.attachments)).toEqual(
      JSON.parse(raw).state.expenses.map((e: Row) => e.attachments),
    );
  });
});

describe('APP-042 hydration keeps the store on the current schema', () => {
  it('hydrates persisted v2 rows and keeps recurring on the stored cadence', async () => {
    // The encrypted adapter's v0/v1 upgrades are covered in economyMoneyMigration.test.ts;
    // here the store reads the current shape and recurs from it.
    const stored = {
      id: 'legacy-1', seriesId: 'legacy-1', isRecurring: true, recurrenceFrequency: 'monthly' as const,
      recurrenceAnchorDay: 31, name: 'Synthetic rent', amount: m(825_000), category: 'bill',
      nextPaymentDate: '2026-01-31', attachments: [], createdAt: '2026-01-01T00:00:00.000Z',
    };
    useExpensesStore.setState({ expenses: [stored], seriesStoppedAt: {}, categoryBudgets: {} });
    await flush();
    const persisted = JSON.parse(await require('@/core/storage/documentCacheStorage')
      .decryptDocumentMetadataPayload('lifesort-expenses', (await AsyncStorage.getItem('lifesort-expenses'))!));
    expect(persisted.version).toBe(2);
    expect(persisted.state.expenses[0]).toMatchObject({ isRecurring: true, recurrenceFrequency: 'monthly', recurrenceAnchorDay: 31 });

    await useExpensesStore.persist.rehydrate();
    expect(expenses()).toEqual([stored]);
    // A hydrated series clamps February and returns to its anchor in March.
    store().rollForwardMonth('2026-02');
    store().rollForwardMonth('2026-03');
    expect(expenses().map((e) => e.nextPaymentDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(expenses().every((e) => e.recurrenceAnchorDay === 31)).toBe(true);
  });
});
