import { minorUnits } from '@/core/money/minorUnits';
import { bankFinancialEntries, manualExpenseEntries } from '@/features/economy/financialSources';
import { financialTotalsForMonth } from '@/features/economy/financialReadModel';
import { economyTotalsForMonth } from '@/features/economy/monthlyTotals';
import * as recurringCandidates from '@/features/economy/recurringCandidates';
import {
  confirmRecurringCandidate,
  dismissRecurringCandidate,
  isTrackedRecurringCost,
  suggestRecurringCandidate,
  type RecurringPaymentCandidate,
} from '@/features/economy/recurringCandidates';
import type { Expense } from '@/types/expense';

/**
 * APP-042: the boundary for a FUTURE bank-derived recurring candidate. OB-403
 * detection is not implemented; what is tested here is that a suggestion stays a
 * suggestion, that confirming and dismissing are explicit, and that a candidate
 * never becomes a second financial fact beside the bank transaction.
 */
const m = minorUnits;
const MONTH = '2026-03';
const candidateInput = {
  id: 'candidate-1',
  source: 'bank' as const,
  suggestedFrequency: 'monthly' as const,
  suggestedNextDate: '2026-03-15',
  suggestedAmount: m(9_900),
  occurrenceIds: ['bank-tx-1', 'bank-tx-2', 'bank-tx-3'],
};
const suggested = () => suggestRecurringCandidate(candidateInput);

describe('APP-042 a bank candidate is a suggestion until the user says otherwise', () => {
  it('is created as suggested and is not a tracked recurring cost', () => {
    const candidate = suggested();
    expect(candidate.decision).toBe('suggested');
    expect(isTrackedRecurringCost(candidate)).toBe(false);
  });

  it('becomes tracked only through an explicit confirmation, and dismissal is explicit too', () => {
    const confirmed = confirmRecurringCandidate(suggested());
    expect(confirmed.decision).toBe('confirmed');
    expect(isTrackedRecurringCost(confirmed)).toBe(true);

    const dismissed = dismissRecurringCandidate(suggested());
    expect(dismissed.decision).toBe('dismissed');
    expect(isTrackedRecurringCost(dismissed)).toBe(false);

    // The user can still change their mind, in either direction, explicitly.
    expect(isTrackedRecurringCost(confirmRecurringCandidate(dismissed))).toBe(true);
    expect(isTrackedRecurringCost(dismissRecurringCandidate(confirmed))).toBe(false);
    // Transitions never mutate the candidate they came from.
    expect(suggested().decision).toBe('suggested');
  });

  it('carries nothing but metadata across a decision: only `decision` ever differs', () => {
    const candidate = suggested();
    for (const decided of [confirmRecurringCandidate(candidate), dismissRecurringCandidate(candidate)]) {
      expect({ ...decided, decision: 'suggested' }).toEqual({ ...candidate });
      // The suggestion stays exactly what the provider-neutral input supplied.
      expect(decided.suggestedNextDate).toBe(candidateInput.suggestedNextDate);
      expect(decided.suggestedFrequency).toBe(candidateInput.suggestedFrequency);
      expect(decided.suggestedAmount).toBe(candidateInput.suggestedAmount);
      expect(decided.occurrenceIds).toEqual(candidateInput.occurrenceIds);
    }
  });

  it('offers no way to extrapolate later dates, on purpose', () => {
    // A candidate found in February can only suggest 28 February for a schedule that
    // is really on the 31st, so its suggested date is not a day-of-month anchor.
    // Extrapolating from it would recreate the short-month drift APP-042 fixed for
    // manual recurrence, so the contract has no projection API and no anchor field.
    // Richer schedule semantics belong to OB-403.
    const february = confirmRecurringCandidate(suggestRecurringCandidate({
      ...candidateInput, suggestedFrequency: 'monthly', suggestedNextDate: '2026-02-28',
    }));
    expect(Object.keys(february)).not.toContain('recurrenceAnchorDay');
    expect(Object.values(february).join(' ')).not.toContain('2026-03');
    const exported = Object.keys(recurringCandidates);
    expect(exported).not.toContain('projectedOccurrences');
    expect(exported.filter((name) => /project|schedule|occurrenceDate|nextDate/i.test(name))).toEqual([]);
    expect(exported.sort()).toEqual([
      'RecurringCandidateError', 'confirmRecurringCandidate', 'dismissRecurringCandidate',
      'isTrackedRecurringCost', 'suggestRecurringCandidate',
    ]);
  });

  it('requires a real cadence signal: at least two distinct occurrences', () => {
    for (const occurrenceIds of [[], ['bank-tx-1'], ['bank-tx-1', 'bank-tx-1'], ['bank-tx-1', ''], 'bank-tx-1']) {
      expect(() => suggestRecurringCandidate({ ...candidateInput, occurrenceIds: occurrenceIds as string[] }))
        .toThrow('recurring_candidate_invalid');
    }
  });

  it('rejects an unsupported cadence, an impossible date, an unusable amount and a foreign source', () => {
    const bad: Partial<typeof candidateInput>[] = [
      { suggestedFrequency: 'weekly' as never },
      { suggestedFrequency: null as never },
      { suggestedNextDate: '2027-02-30' },
      { suggestedNextDate: '15/03/2026' },
      { suggestedAmount: 12.5 as never },
      { suggestedAmount: Number.MAX_SAFE_INTEGER as never },
      { source: 'manual' as never },
      { id: '' },
    ];
    for (const overrides of bad) {
      expect(() => suggestRecurringCandidate({ ...candidateInput, ...overrides })).toThrow('recurring_candidate_invalid');
    }
    // A variable-amount subscription is legitimate: the amount may be omitted.
    expect(suggestRecurringCandidate({ ...candidateInput, suggestedAmount: null }).suggestedAmount).toBeNull();
  });

  it('carries no provider payload: unknown fields cannot ride into LifeSort state', () => {
    const candidate = suggestRecurringCandidate({
      ...candidateInput,
      // What a provider adapter might be holding. None of it belongs here.
      providerAccessToken: 'synthetic-token',
      consentId: 'synthetic-consent',
      iban: 'DK0000000000000000',
      merchantDescription: 'SYNTHETIC MERCHANT 1234',
      rawPayload: { anything: true },
    } as never);
    expect(Object.keys(candidate).sort()).toEqual([
      'decision', 'id', 'occurrenceIds', 'source', 'suggestedAmount', 'suggestedFrequency', 'suggestedNextDate',
    ]);
    expect(JSON.stringify(candidate)).not.toMatch(/token|consent|iban|MERCHANT|rawPayload/i);
    expect(Object.isFrozen(candidate)).toBe(true);
  });
});

describe('APP-042 a candidate never becomes a second financial fact', () => {
  const bankTransaction = {
    id: 'bank-tx-3', kind: 'debit' as const, amountMinor: m(-9_900), currency: 'DKK',
    date: '2026-03-15', status: 'booked' as const,
  };
  const manualExpense: Expense = {
    id: 'manual-1', seriesId: 'manual-1', isRecurring: false, recurrenceFrequency: null, recurrenceAnchorDay: null, name: 'Synthetic',
    amount: m(2_500), category: 'other', nextPaymentDate: '2026-03-02', attachments: [], createdAt: '2026-03-02T00:00:00.000Z',
  };

  /** The read model only accepts manual entries and bank entries — candidates have no adapter. */
  const totals = (candidate: RecurringPaymentCandidate) => {
    expect(candidate).toBeDefined();
    return financialTotalsForMonth(
      [...manualExpenseEntries([manualExpense]), ...bankFinancialEntries([bankTransaction])],
      MONTH,
    );
  };

  it('confirming a candidate changes no total: the bank transaction stays the only fact', () => {
    const before = totals(suggested());
    const serialized = JSON.stringify(before);
    const confirmed = confirmRecurringCandidate(suggested());
    expect(totals(confirmed)).toEqual(before);
    expect(JSON.stringify(totals(confirmed))).toBe(serialized);
    expect(before).toMatchObject({ settledSpending: 12_400, expenseCount: 2 });
  });

  it('has no path into the read model: its fields are not a financial transaction', () => {
    const confirmed = confirmRecurringCandidate(suggested());
    // A candidate is not a FinancialTransaction: it has no semantic, status or currency,
    // and the entry adapters take bank inputs or Expenses, never candidates.
    expect(confirmed).not.toHaveProperty('semantic');
    expect(confirmed).not.toHaveProperty('status');
    expect(confirmed).not.toHaveProperty('amount');
    expect(() => bankFinancialEntries([confirmed as never])).toThrow();
  });

  it('creates no manual Expense, so a confirmed bank cost cannot be counted twice', () => {
    const confirmed = confirmRecurringCandidate(suggested());
    expect(isTrackedRecurringCost(confirmed)).toBe(true);
    const manualOnly = economyTotalsForMonth([manualExpense], {}, MONTH);
    expect(manualOnly).toMatchObject({ settledSpending: 2_500, expenseCount: 1 });
    // The candidate's own amount never joins the manual side of the read model.
    expect(manualOnly.settledSpending).not.toBe(2_500 + 9_900);
  });
});
