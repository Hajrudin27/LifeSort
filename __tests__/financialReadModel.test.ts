import { financialTotalsForMonth, type FinancialEntry, type FinancialTransaction } from '@/features/economy/financialReadModel';
import { bankFinancialEntries, manualExpenseEntries, manualIncomeEntries, type BankFinancialInput } from '@/features/economy/financialSources';
import { economyTotalsForMonth } from '@/features/economy/monthlyTotals';
import type { Expense } from '@/types/expense';

const MONTH = '2026-09';
const DATE = '2026-09-10';
const expense: Expense = {
  id: 'manual-1', seriesId: 'series-1', isRecurring: false,
  name: 'Synthetic shop', amount: 500, category: 'other',
  nextPaymentDate: DATE, attachments: [], createdAt: `${DATE}T12:00:00Z`,
};
const bank: BankFinancialInput = {
  id: 'bank-1', kind: 'debit', amount: -500, currency: 'DKK', date: DATE, status: 'booked',
};
const read = (entries: readonly FinancialEntry[], month = MONTH) => financialTotalsForMonth(entries, month);
const bankEntry = (overrides: Partial<BankFinancialInput> = {}) => bankFinancialEntries([{ ...bank, ...overrides }])[0];
const manualEntry = (overrides: Partial<FinancialTransaction> = {}): FinancialTransaction => ({
  ...manualExpenseEntries([expense])[0], ...overrides,
});

describe('APP-039 manual adapters and monthly totals', () => {
  it('reads ordinary manual spending and manual monthly income together', () => {
    expect(economyTotalsForMonth([expense], { [MONTH]: 2000 }, MONTH)).toEqual({
      settledIncome: 2000, settledSpending: 500, balance: 1500, hasIncome: true, expenseCount: 1,
    });
  });
  it('reads expense-only and income-only manual mode with no bank dependency', () => {
    expect(economyTotalsForMonth([expense], {}, MONTH)).toMatchObject({ settledSpending: 500, settledIncome: 0, hasIncome: false });
    expect(economyTotalsForMonth([], { [MONTH]: 2000 }, MONTH)).toMatchObject({ settledSpending: 0, settledIncome: 2000 });
    expect(economyTotalsForMonth([expense], {}, MONTH, [])).toEqual(economyTotalsForMonth([expense], {}, MONTH));
  });
  it('represents existing monthly income as an aggregate without a transaction ID or correlation', () => {
    expect(manualIncomeEntries({ [MONTH]: 2000 })).toEqual([{
      source: { kind: 'manual', representation: 'monthly-aggregate', monthKey: MONTH },
      semantic: 'income', amount: 2000, currency: 'DKK',
    }]);
  });
  it('retains an unlinked monthly aggregate alongside a bank credit, even with the same amount', () => {
    expect(economyTotalsForMonth([], { [MONTH]: 500 }, MONTH, [{ ...bank, kind: 'credit', amount: 500 }]).settledIncome).toBe(1000);
  });
  it('preserves entered zero income versus missing income', () => {
    expect(economyTotalsForMonth([], { [MONTH]: 0 }, MONTH).hasIncome).toBe(true);
    expect(economyTotalsForMonth([], {}, MONTH).hasIncome).toBe(false);
  });
  it('does not reinterpret existing negative manual expenses or income', () => {
    expect(economyTotalsForMonth([{ ...expense, amount: -25 }], { [MONTH]: -100 }, MONTH))
      .toMatchObject({ settledSpending: -25, settledIncome: -100, balance: -75 });
  });
  it('keeps recurrence instance identity separate from the series identity', () => {
    const entries = [expense, { ...expense, id: 'manual-2' }];
    expect(economyTotalsForMonth(entries, {}, MONTH).settledSpending).toBe(1000);
  });
  it('returns deterministic zeros for an empty month', () => {
    expect(read([])).toEqual({ settledIncome: 0, settledSpending: 0, balance: 0, hasIncome: false, expenseCount: 0 });
  });
  it('uses existing date prefixes, includes the first/last day and excludes adjacent months', () => {
    const dates = ['2026-08-31', '2026-09-01', '2026-09-30', '2026-10-01'];
    const entries = dates.map((date) => bankEntry({ id: date, date, amount: -100 }));
    expect(read(entries).settledSpending).toBe(200);
    expect(read([bankEntry({ date: '2026-09-30T23:30:00-04:00' })]).settledSpending).toBe(500);
    expect(economyTotalsForMonth([], { '2026-08': 1000 }, MONTH).settledIncome).toBe(0);
  });
});

describe('APP-039 bank accounting semantics', () => {
  it('adapts a signed debit to spending', () => {
    expect(read([bankEntry()])).toMatchObject({ settledSpending: 500, settledIncome: 0 });
  });
  it('adapts a signed credit to income', () => {
    expect(read([bankEntry({ kind: 'credit', amount: 1200 })])).toMatchObject({ settledSpending: 0, settledIncome: 1200 });
  });
  it('accepts independent bank inputs through the same production facade', () => {
    expect(economyTotalsForMonth([expense], { [MONTH]: 2000 }, MONTH, [bank]))
      .toMatchObject({ settledSpending: 1000, settledIncome: 2000, balance: 1000 });
  });
  it('keeps a transfer and a transfer pair neutral', () => {
    const out = bankEntry({ kind: 'transfer', amount: -500 });
    const incoming = bankEntry({ id: 'bank-2', kind: 'transfer', amount: 500 });
    expect(read([out])).toEqual(read([]));
    expect(read([out, incoming])).toEqual(read([]));
  });
  it.each([[500, 0], [200, 300], [700, -200]])('refund %i reduces spending to %i without inflating income', (refund, spending) => {
    const entries = [bankEntry(), bankEntry({ id: 'refund', kind: 'refund', amount: refund })];
    expect(read(entries)).toMatchObject({ settledSpending: spending, settledIncome: 0, hasIncome: false });
  });
  it('does not require a refund to identify an original transaction', () => {
    expect(read([bankEntry({ kind: 'refund', amount: 200 })])).toMatchObject({ settledSpending: -200, settledIncome: 0 });
  });
  it.each<BankFinancialInput['kind']>(['debit', 'credit', 'refund', 'transfer'])('excludes a pending %s', (kind) => {
    const amount = kind === 'debit' ? -500 : 500;
    expect(read([bankEntry({ kind, amount, status: 'pending' })])).toEqual(read([]));
  });
  it('replaces pending with booked by stable identity regardless of order', () => {
    const pending = bankEntry({ status: 'pending', amount: -450 });
    const booked = bankEntry();
    for (const entries of [[pending, booked], [booked, pending]]) {
      expect(read(entries)).toMatchObject({ settledSpending: 500, expenseCount: 1 });
    }
  });
  it('reconciles a pending-to-booked month change before month filtering', () => {
    const pending = bankEntry({ status: 'pending', date: '2026-08-31' });
    const booked = bankEntry({ date: '2026-09-01' });
    expect(read([pending, booked], '2026-08').settledSpending).toBe(0);
    expect(read([pending, booked]).settledSpending).toBe(500);
  });
  it('ignores obsolete pending amount changes when a booked snapshot exists in any position', () => {
    const firstPending = bankEntry({ status: 'pending', amount: -400 });
    const secondPending = bankEntry({ status: 'pending', amount: -450 });
    const booked = bankEntry();
    for (const entries of [[firstPending, secondPending, booked], [booked, firstPending, secondPending], [secondPending, booked, firstPending]]) {
      expect(read(entries)).toMatchObject({ settledSpending: 500, expenseCount: 1 });
    }
  });
});

describe('APP-039 explicit identity and correlation', () => {
  it('deduplicates exact repeated source identities, including a monthly aggregate', () => {
    const entries = [manualEntry(), bankEntry(), ...manualIncomeEntries({ [MONTH]: 2000 })];
    expect(read([...entries, ...entries])).toEqual(read(entries));
  });
  it('does not collide equal ID strings across manual/bank namespaces', () => {
    expect(read([manualEntry(), bankEntry({ id: expense.id })]).settledSpending).toBe(1000);
  });
  it('does not collide a monthly key with a manual transaction ID', () => {
    const transaction = manualExpenseEntries([{ ...expense, id: MONTH }])[0];
    expect(read([transaction, ...manualIncomeEntries({ [MONTH]: 500 })])).toMatchObject({ settledSpending: 500, settledIncome: 500 });
  });
  it('collapses explicit manual/bank correlation using bank facts, not input order', () => {
    const manual = manualEntry({ correlationId: 'explicit-link', amount: 450 });
    const booked = bankEntry({ correlationId: 'explicit-link' });
    for (const entries of [[manual, booked], [booked, manual]]) {
      expect(read(entries)).toMatchObject({ settledSpending: 500, expenseCount: 1 });
    }
  });
  it('applies correlation to transaction-level manual income too', () => {
    const manual = manualEntry({ semantic: 'income', correlationId: 'credit-link' });
    const credit = bankEntry({ kind: 'credit', amount: 500, correlationId: 'credit-link' });
    expect(read([manual, credit]).settledIncome).toBe(500);
  });
  it('lets linked pending bank facts suppress the manual copy until booking', () => {
    const manual = manualEntry({ correlationId: 'link' });
    const pending = bankEntry({ correlationId: 'link', status: 'pending' });
    const booked = bankEntry({ correlationId: 'link' });
    expect(read([manual, pending])).toEqual(read([]));
    expect(read([manual, pending, booked]).settledSpending).toBe(500);
  });
  it('retains explicit correlation through an identity-linked booking that omits the link', () => {
    const manual = manualEntry({ correlationId: 'link' });
    const pending = bankEntry({ correlationId: 'link', status: 'pending' });
    const booked = bankEntry();
    expect(read([manual, pending, booked]).settledSpending).toBe(500);
    expect(read([booked, pending, manual]).settledSpending).toBe(500);
  });
  it('retains link evidence in repeated equal-status snapshots and rejects contradictory links', () => {
    const manual = manualEntry({ correlationId: 'link' });
    expect(read([manual, bankEntry(), bankEntry({ correlationId: 'link' })]).settledSpending).toBe(500);
    expect(() => read([bankEntry({ correlationId: 'a', status: 'pending' }), bankEntry({ correlationId: 'b' })]))
      .toThrow('financial_identity_conflict');
  });
  it('uses explicitly linked bank transfer/refund classifications instead of manual income', () => {
    const manual = manualEntry({ semantic: 'income', correlationId: 'link' });
    expect(read([manual, bankEntry({ kind: 'transfer', correlationId: 'link' })])).toEqual(read([]));
    expect(read([manual, bankEntry({ kind: 'refund', amount: 500, correlationId: 'link' })]))
      .toMatchObject({ settledSpending: -500, settledIncome: 0 });
  });
  it('removes correlated copies before filtering different manual/bank months', () => {
    const manual = manualEntry({ correlationId: 'link', date: '2026-08-31' });
    const booked = bankEntry({ correlationId: 'link' });
    expect(read([manual, booked], '2026-08').settledSpending).toBe(0);
    expect(read([manual, booked]).settledSpending).toBe(500);
  });
  it('does not dedupe identical amount/date or similar descriptions without an explicit link', () => {
    const similar = { ...expense, id: 'manual-2', name: 'Synthetic shop receipt' };
    expect(economyTotalsForMonth([expense, similar], {}, MONTH, [bank]).settledSpending).toBe(1500);
    expect(manualExpenseEntries([expense])[0]).not.toHaveProperty('name');
  });
  it('retains different correlations and a link missing its counterpart', () => {
    expect(read([manualEntry({ correlationId: 'a' }), bankEntry({ correlationId: 'b' })]).settledSpending).toBe(1000);
    expect(read([manualEntry({ correlationId: 'a' })]).settledSpending).toBe(500);
  });
  it('does not collapse different same-source IDs by correlation alone', () => {
    expect(read([bankEntry({ correlationId: 'link' }), bankEntry({ id: 'bank-2', correlationId: 'link' })]).settledSpending).toBe(1000);
  });
  it('rejects ambiguous many-to-one correlation rather than guessing', () => {
    const entries = [manualEntry({ correlationId: 'link' }), bankEntry({ correlationId: 'link' }), bankEntry({ id: 'bank-2', correlationId: 'link' })];
    expect(() => read(entries)).toThrow('financial_correlation_ambiguous');
  });
  it('rejects conflicting equal-status identity copies rather than guessing recency', () => {
    expect(() => read([bankEntry(), bankEntry({ amount: -600 })])).toThrow('financial_identity_conflict');
  });
  it('does not retain entries between calls after source deletion or account replacement', () => {
    expect(read([manualEntry()]).settledSpending).toBe(500);
    expect(read([])).toEqual({ settledIncome: 0, settledSpending: 0, balance: 0, hasIncome: false, expenseCount: 0 });
  });
});

describe('APP-039 boundary validation and purity', () => {
  it.each(['EUR', 'USD', ''])('rejects unsupported currency %s even if pending or outside the month', (currency) => {
    expect(() => economyTotalsForMonth([expense], {}, MONTH, [{ ...bank, currency, status: 'pending', date: '2026-08-01' }]))
      .toThrow('financial_currency_unsupported');
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite amounts', (amount) => {
    expect(() => read([manualEntry({ amount })])).toThrow('financial_amount_invalid');
    expect(() => bankEntry({ amount })).toThrow('financial_bank_amount_invalid');
  });
  it('rejects sign contradictions at the bank boundary', () => {
    expect(() => bankEntry({ amount: 500 })).toThrow('financial_bank_amount_invalid');
    expect(() => bankEntry({ kind: 'refund', amount: -500 })).toThrow('financial_bank_amount_invalid');
    expect(() => read([manualEntry({ semantic: 'refund', amount: -500 })])).toThrow('financial_amount_invalid');
  });
  it('rejects empty explicit correlation instead of merging unrelated entries', () => {
    expect(() => read([manualEntry({ correlationId: ' ' })])).toThrow('financial_correlation_invalid');
  });
  it('does not mutate input arrays, objects, or the existing persisted shapes', () => {
    const expenses = Object.freeze([Object.freeze({ ...expense })]);
    const income = Object.freeze({ [MONTH]: 2000 });
    const banks = Object.freeze([Object.freeze({ ...bank })]);
    const before = JSON.stringify({ expenses, income, banks });
    const first = economyTotalsForMonth(expenses, income, MONTH, banks);
    expect(economyTotalsForMonth(expenses, income, MONTH, banks)).toEqual(first);
    expect(JSON.stringify({ expenses, income, banks })).toBe(before);
    expect(expenses[0]).not.toHaveProperty('correlationId');
  });
});
