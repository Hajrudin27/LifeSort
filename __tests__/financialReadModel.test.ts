import { minorUnits, type MinorUnits } from '@/core/money/minorUnits';
import { financialTotalsForMonth, type FinancialEntry, type FinancialTransaction } from '@/features/economy/financialReadModel';
import { bankFinancialEntries, manualExpenseEntries, manualIncomeEntries, type BankFinancialInput } from '@/features/economy/financialSources';
import { economyTotalsForMonth } from '@/features/economy/monthlyTotals';
import type { Expense } from '@/types/expense';

/** APP-040: every amount in this file is DKK MinorUnits (øre); 50_000 is 500 kr. */
const m = minorUnits;
const MONTH = '2026-09';
const DATE = '2026-09-10';
const expense: Expense = {
  id: 'manual-1', seriesId: 'series-1', isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null,
  name: 'Synthetic shop', amount: m(50_000), category: 'other',
  nextPaymentDate: DATE, attachments: [], createdAt: `${DATE}T12:00:00Z`,
};
const bank: BankFinancialInput = {
  id: 'bank-1', kind: 'debit', amountMinor: m(-50_000), currency: 'DKK', date: DATE, status: 'booked',
};
const read = (entries: readonly FinancialEntry[], month = MONTH) => financialTotalsForMonth(entries, month);
const bankEntry = (overrides: Partial<BankFinancialInput> = {}) => bankFinancialEntries([{ ...bank, ...overrides }])[0];
const manualEntry = (overrides: Partial<FinancialTransaction> = {}): FinancialTransaction => ({
  ...manualExpenseEntries([expense])[0], ...overrides,
});
const ZERO_TOTALS = { settledIncome: 0, settledSpending: 0, balance: 0, hasIncome: false, expenseCount: 0 };

describe('APP-039 manual adapters and monthly totals', () => {
  it('reads ordinary manual spending and manual monthly income together', () => {
    expect(economyTotalsForMonth([expense], { [MONTH]: m(200_000) }, MONTH)).toEqual({
      settledIncome: 200_000, settledSpending: 50_000, balance: 150_000, hasIncome: true, expenseCount: 1,
    });
  });
  it('reads expense-only and income-only manual mode with no bank dependency', () => {
    expect(economyTotalsForMonth([expense], {}, MONTH)).toMatchObject({ settledSpending: 50_000, settledIncome: 0, hasIncome: false });
    expect(economyTotalsForMonth([], { [MONTH]: m(200_000) }, MONTH)).toMatchObject({ settledSpending: 0, settledIncome: 200_000 });
    expect(economyTotalsForMonth([expense], {}, MONTH, [])).toEqual(economyTotalsForMonth([expense], {}, MONTH));
  });
  it('represents existing monthly income as an aggregate without a transaction ID or correlation', () => {
    expect(manualIncomeEntries({ [MONTH]: m(200_000) })).toEqual([{
      source: { kind: 'manual', representation: 'monthly-aggregate', monthKey: MONTH },
      semantic: 'income', amount: 200_000, currency: 'DKK',
    }]);
  });
  it('retains an unlinked monthly aggregate alongside a bank credit, even with the same amount', () => {
    expect(economyTotalsForMonth([], { [MONTH]: m(50_000) }, MONTH, [{ ...bank, kind: 'credit', amountMinor: m(50_000) }]).settledIncome).toBe(100_000);
  });
  it('preserves entered zero income versus missing income', () => {
    expect(economyTotalsForMonth([], { [MONTH]: m(0) }, MONTH).hasIncome).toBe(true);
    expect(economyTotalsForMonth([], {}, MONTH).hasIncome).toBe(false);
  });
  it('does not reinterpret existing negative manual expenses or income', () => {
    expect(economyTotalsForMonth([{ ...expense, amount: m(-2_500) }], { [MONTH]: m(-10_000) }, MONTH))
      .toMatchObject({ settledSpending: -2_500, settledIncome: -10_000, balance: -7_500 });
  });
  it('keeps recurrence instance identity separate from the series identity', () => {
    const entries = [expense, { ...expense, id: 'manual-2' }];
    expect(economyTotalsForMonth(entries, {}, MONTH).settledSpending).toBe(100_000);
  });
  it('returns deterministic zeros for an empty month', () => {
    expect(read([])).toEqual(ZERO_TOTALS);
  });
  it('uses existing date prefixes, includes the first/last day and excludes adjacent months', () => {
    const dates = ['2026-08-31', '2026-09-01', '2026-09-30', '2026-10-01'];
    const entries = dates.map((date) => bankEntry({ id: date, date, amountMinor: m(-10_000) }));
    expect(read(entries).settledSpending).toBe(20_000);
    expect(read([bankEntry({ date: '2026-09-30T23:30:00-04:00' })]).settledSpending).toBe(50_000);
    expect(economyTotalsForMonth([], { '2026-08': m(100_000) }, MONTH).settledIncome).toBe(0);
  });
});

describe('APP-040 MinorUnits in the unified read model', () => {
  it('sums øre exactly where major-unit floats would drift', () => {
    const tenOre = Array.from({ length: 3 }, (_, i) => ({ ...expense, id: `ore-${i}`, amount: m(10) }));
    expect(0.1 + 0.1 + 0.1).not.toBe(0.3);
    expect(economyTotalsForMonth(tenOre, { [MONTH]: m(30) }, MONTH)).toMatchObject({
      settledSpending: 30, settledIncome: 30, balance: 0,
    });
    const totals = economyTotalsForMonth([{ ...expense, amount: m(1) }], { [MONTH]: m(50) }, MONTH);
    expect(totals).toMatchObject({ settledSpending: 1, settledIncome: 50, balance: 49 });
    for (const value of Object.values(totals)) if (typeof value === 'number') expect(Number.isSafeInteger(value)).toBe(true);
  });
  it.each([12.5, 0.1, Number.MAX_SAFE_INTEGER + 1])('rejects non-MinorUnits amount %p at both boundaries', (amount) => {
    expect(() => read([manualEntry({ amount: amount as MinorUnits })])).toThrow('financial_amount_invalid');
    expect(() => bankEntry({ amountMinor: -amount as MinorUnits })).toThrow('financial_bank_amount_invalid');
  });
  it('rejects a total that would leave the safe integer range instead of approximating', () => {
    const huge = [expense, { ...expense, id: 'manual-2' }].map((e) => ({ ...e, amount: m(Number.MAX_SAFE_INTEGER) }));
    expect(() => economyTotalsForMonth(huge, {}, MONTH)).toThrow('money_unsafe_arithmetic');
  });
  it('carries MinorUnits unchanged from manual stores and the synthetic bank boundary', () => {
    expect(manualExpenseEntries([expense])[0].amount).toBe(50_000);
    expect(bankEntry({ amountMinor: m(-1) }).amount).toBe(1);
    expect(bankEntry({ kind: 'credit', amountMinor: m(1) }).amount).toBe(1);
  });
});

describe('APP-039 bank accounting semantics', () => {
  it('adapts a signed debit to spending', () => {
    expect(read([bankEntry()])).toMatchObject({ settledSpending: 50_000, settledIncome: 0 });
  });
  it('adapts a signed credit to income', () => {
    expect(read([bankEntry({ kind: 'credit', amountMinor: m(120_000) })])).toMatchObject({ settledSpending: 0, settledIncome: 120_000 });
  });
  it('accepts independent bank inputs through the same production facade', () => {
    expect(economyTotalsForMonth([expense], { [MONTH]: m(200_000) }, MONTH, [bank]))
      .toMatchObject({ settledSpending: 100_000, settledIncome: 200_000, balance: 100_000 });
  });
  it('keeps a transfer and a transfer pair neutral', () => {
    const out = bankEntry({ kind: 'transfer', amountMinor: m(-50_000) });
    const incoming = bankEntry({ id: 'bank-2', kind: 'transfer', amountMinor: m(50_000) });
    expect(read([out])).toEqual(read([]));
    expect(read([out, incoming])).toEqual(read([]));
  });
  it.each([[50_000, 0], [20_000, 30_000], [70_000, -20_000]])('refund %i reduces spending to %i without inflating income', (refund, spending) => {
    const entries = [bankEntry(), bankEntry({ id: 'refund', kind: 'refund', amountMinor: m(refund) })];
    expect(read(entries)).toMatchObject({ settledSpending: spending, settledIncome: 0, hasIncome: false });
  });
  it('does not require a refund to identify an original transaction', () => {
    expect(read([bankEntry({ kind: 'refund', amountMinor: m(20_000) })])).toMatchObject({ settledSpending: -20_000, settledIncome: 0 });
  });
  it.each<BankFinancialInput['kind']>(['debit', 'credit', 'refund', 'transfer'])('excludes a pending %s', (kind) => {
    const amountMinor = m(kind === 'debit' ? -50_000 : 50_000);
    expect(read([bankEntry({ kind, amountMinor, status: 'pending' })])).toEqual(read([]));
  });
  it('replaces pending with booked by stable identity regardless of order', () => {
    const pending = bankEntry({ status: 'pending', amountMinor: m(-45_000) });
    const booked = bankEntry();
    for (const entries of [[pending, booked], [booked, pending]]) {
      expect(read(entries)).toMatchObject({ settledSpending: 50_000, expenseCount: 1 });
    }
  });
  it('reconciles a pending-to-booked month change before month filtering', () => {
    const pending = bankEntry({ status: 'pending', date: '2026-08-31' });
    const booked = bankEntry({ date: '2026-09-01' });
    expect(read([pending, booked], '2026-08').settledSpending).toBe(0);
    expect(read([pending, booked]).settledSpending).toBe(50_000);
  });
  it('ignores obsolete pending amount changes when a booked snapshot exists in any position', () => {
    const firstPending = bankEntry({ status: 'pending', amountMinor: m(-40_000) });
    const secondPending = bankEntry({ status: 'pending', amountMinor: m(-45_000) });
    const booked = bankEntry();
    for (const entries of [[firstPending, secondPending, booked], [booked, firstPending, secondPending], [secondPending, booked, firstPending]]) {
      expect(read(entries)).toMatchObject({ settledSpending: 50_000, expenseCount: 1 });
    }
  });
});

describe('APP-039 explicit identity and correlation', () => {
  it('deduplicates exact repeated source identities, including a monthly aggregate', () => {
    const entries = [manualEntry(), bankEntry(), ...manualIncomeEntries({ [MONTH]: m(200_000) })];
    expect(read([...entries, ...entries])).toEqual(read(entries));
  });
  it('does not collide equal ID strings across manual/bank namespaces', () => {
    expect(read([manualEntry(), bankEntry({ id: expense.id })]).settledSpending).toBe(100_000);
  });
  it('does not collide a monthly key with a manual transaction ID', () => {
    const transaction = manualExpenseEntries([{ ...expense, id: MONTH }])[0];
    expect(read([transaction, ...manualIncomeEntries({ [MONTH]: m(50_000) })])).toMatchObject({ settledSpending: 50_000, settledIncome: 50_000 });
  });
  it('collapses explicit manual/bank correlation using bank facts, not input order', () => {
    const manual = manualEntry({ correlationId: 'explicit-link', amount: m(45_000) });
    const booked = bankEntry({ correlationId: 'explicit-link' });
    for (const entries of [[manual, booked], [booked, manual]]) {
      expect(read(entries)).toMatchObject({ settledSpending: 50_000, expenseCount: 1 });
    }
  });
  it('applies correlation to transaction-level manual income too', () => {
    const manual = manualEntry({ semantic: 'income', correlationId: 'credit-link' });
    const credit = bankEntry({ kind: 'credit', amountMinor: m(50_000), correlationId: 'credit-link' });
    expect(read([manual, credit]).settledIncome).toBe(50_000);
  });
  it('lets linked pending bank facts suppress the manual copy until booking', () => {
    const manual = manualEntry({ correlationId: 'link' });
    const pending = bankEntry({ correlationId: 'link', status: 'pending' });
    const booked = bankEntry({ correlationId: 'link' });
    expect(read([manual, pending])).toEqual(read([]));
    expect(read([manual, pending, booked]).settledSpending).toBe(50_000);
  });
  it('retains explicit correlation through an identity-linked booking that omits the link', () => {
    const manual = manualEntry({ correlationId: 'link' });
    const pending = bankEntry({ correlationId: 'link', status: 'pending' });
    const booked = bankEntry();
    expect(read([manual, pending, booked]).settledSpending).toBe(50_000);
    expect(read([booked, pending, manual]).settledSpending).toBe(50_000);
  });
  it('retains link evidence in repeated equal-status snapshots and rejects contradictory links', () => {
    const manual = manualEntry({ correlationId: 'link' });
    expect(read([manual, bankEntry(), bankEntry({ correlationId: 'link' })]).settledSpending).toBe(50_000);
    expect(() => read([bankEntry({ correlationId: 'a', status: 'pending' }), bankEntry({ correlationId: 'b' })]))
      .toThrow('financial_identity_conflict');
  });
  it('uses explicitly linked bank transfer/refund classifications instead of manual income', () => {
    const manual = manualEntry({ semantic: 'income', correlationId: 'link' });
    expect(read([manual, bankEntry({ kind: 'transfer', correlationId: 'link' })])).toEqual(read([]));
    expect(read([manual, bankEntry({ kind: 'refund', amountMinor: m(50_000), correlationId: 'link' })]))
      .toMatchObject({ settledSpending: -50_000, settledIncome: 0 });
  });
  it('removes correlated copies before filtering different manual/bank months', () => {
    const manual = manualEntry({ correlationId: 'link', date: '2026-08-31' });
    const booked = bankEntry({ correlationId: 'link' });
    expect(read([manual, booked], '2026-08').settledSpending).toBe(0);
    expect(read([manual, booked]).settledSpending).toBe(50_000);
  });
  it('does not dedupe identical amount/date or similar descriptions without an explicit link', () => {
    const similar = { ...expense, id: 'manual-2', name: 'Synthetic shop receipt' };
    expect(economyTotalsForMonth([expense, similar], {}, MONTH, [bank]).settledSpending).toBe(150_000);
    expect(manualExpenseEntries([expense])[0]).not.toHaveProperty('name');
  });
  it('retains different correlations and a link missing its counterpart', () => {
    expect(read([manualEntry({ correlationId: 'a' }), bankEntry({ correlationId: 'b' })]).settledSpending).toBe(100_000);
    expect(read([manualEntry({ correlationId: 'a' })]).settledSpending).toBe(50_000);
  });
  it('does not collapse different same-source IDs by correlation alone', () => {
    expect(read([bankEntry({ correlationId: 'link' }), bankEntry({ id: 'bank-2', correlationId: 'link' })]).settledSpending).toBe(100_000);
  });
  it('rejects ambiguous many-to-one correlation rather than guessing', () => {
    const entries = [manualEntry({ correlationId: 'link' }), bankEntry({ correlationId: 'link' }), bankEntry({ id: 'bank-2', correlationId: 'link' })];
    expect(() => read(entries)).toThrow('financial_correlation_ambiguous');
  });
  it('rejects conflicting equal-status identity copies rather than guessing recency', () => {
    expect(() => read([bankEntry(), bankEntry({ amountMinor: m(-60_000) })])).toThrow('financial_identity_conflict');
  });
  it('does not retain entries between calls after source deletion or account replacement', () => {
    expect(read([manualEntry()]).settledSpending).toBe(50_000);
    expect(read([])).toEqual(ZERO_TOTALS);
  });
});

describe('APP-039 boundary validation and purity', () => {
  it.each(['EUR', 'USD', ''])('rejects unsupported currency %s even if pending or outside the month', (currency) => {
    expect(() => economyTotalsForMonth([expense], {}, MONTH, [{ ...bank, currency, status: 'pending', date: '2026-08-01' }]))
      .toThrow('financial_currency_unsupported');
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite amounts', (amount) => {
    expect(() => read([manualEntry({ amount: amount as MinorUnits })])).toThrow('financial_amount_invalid');
    expect(() => bankEntry({ amountMinor: amount as MinorUnits })).toThrow('financial_bank_amount_invalid');
  });
  it('rejects sign contradictions at the bank boundary', () => {
    expect(() => bankEntry({ amountMinor: m(50_000) })).toThrow('financial_bank_amount_invalid');
    expect(() => bankEntry({ kind: 'refund', amountMinor: m(-50_000) })).toThrow('financial_bank_amount_invalid');
    expect(() => read([manualEntry({ semantic: 'refund', amount: m(-50_000) })])).toThrow('financial_amount_invalid');
  });
  it('rejects empty explicit correlation instead of merging unrelated entries', () => {
    expect(() => read([manualEntry({ correlationId: ' ' })])).toThrow('financial_correlation_invalid');
  });
  it('does not mutate input arrays, objects, or the existing persisted shapes', () => {
    const expenses = Object.freeze([Object.freeze({ ...expense })]);
    const income = Object.freeze({ [MONTH]: m(200_000) });
    const banks = Object.freeze([Object.freeze({ ...bank })]);
    const before = JSON.stringify({ expenses, income, banks });
    const first = economyTotalsForMonth(expenses, income, MONTH, banks);
    expect(economyTotalsForMonth(expenses, income, MONTH, banks)).toEqual(first);
    expect(JSON.stringify({ expenses, income, banks })).toBe(before);
    expect(expenses[0]).not.toHaveProperty('correlationId');
  });
});
