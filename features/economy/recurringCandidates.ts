import { isRecurrenceFrequency, parseIsoDate, type RecurrenceFrequency } from '@/core/economy/recurrence';
import { isSupportedMoney } from '@/core/money/supportedMoney';
import type { MinorUnits } from '@/core/money/minorUnits';

/**
 * APP-042: the LifeSort-side contract for a *future* bank-derived recurring
 * payment candidate.
 *
 * Detection is NOT implemented here. Finding cadence in real transactions is
 * OB-403's job, on the Open Banking side, and this file must never grow one.
 * What it does own is the shape LifeSort will accept a suggestion in, and the
 * three states a suggestion can be in, so that:
 *
 *  - a suggestion is never silently treated as a bill the user has accepted;
 *  - confirming and dismissing are explicit, user-driven transitions;
 *  - the boundary is provider-neutral: no provider name, token, consent,
 *    account number, merchant text or raw payload has a field here. References
 *    to the underlying transactions are opaque LifeSort-level IDs (the same
 *    `id` space as APP-039's `BankFinancialInput`), nothing else.
 *
 * DOUBLE COUNTING: a candidate is metadata about payments the bank already
 * reports. It is not a financial fact, it never becomes an APP-039
 * `FinancialTransaction`, and confirming one must not create a manual Expense —
 * the bank transaction stays the only fact. Confirmation only records that the
 * user recognises the recurring cost.
 *
 * Bank-derived candidate state is server-owned once Open Banking exists, so
 * APP-042 adds no local store, table or persistence for it.
 *
 * NO SCHEDULE PROJECTION: unlike a manual recurring Expense, a candidate carries no
 * `recurrenceAnchorDay`, and one cannot be inferred from `suggestedNextDate` — a
 * February suggestion of the 28th says nothing about whether the schedule is the
 * 28th, the 30th or the 31st. Extrapolating would recreate exactly the short-month
 * drift APP-042 fixed for manual recurrence, so this file offers no projection API.
 * Detection, linkage and any richer schedule metadata belong to OB-403.
 */

/** Where a candidate came from. Manual recurring costs are Expenses, not candidates. */
export type RecurringCandidateSource = 'bank';

/**
 * suggested — proposed, never counted as an accepted recurring cost.
 * confirmed — the user explicitly recognised it.
 * dismissed — the user explicitly rejected it; it is not shown as accepted.
 */
export type RecurringCandidateDecision = 'suggested' | 'confirmed' | 'dismissed';

export type RecurringPaymentCandidate = {
  /** Opaque LifeSort candidate identity, stable across refreshes. */
  readonly id: string;
  readonly source: RecurringCandidateSource;
  readonly suggestedFrequency: RecurrenceFrequency;
  /**
   * ISO yyyy-mm-dd; a real calendar date. ONE suggested occurrence, not a stored
   * schedule: a candidate found in February may suggest the 28th for a schedule
   * that is really on the 31st, so LifeSort must not read a day-of-month anchor
   * out of it. APP-042 therefore never extrapolates later dates from a candidate.
   */
  readonly suggestedNextDate: string;
  /** DKK MinorUnits (APP-040), or null when the amount varies between occurrences. */
  readonly suggestedAmount: MinorUnits | null;
  /**
   * The observed occurrences the suggestion rests on, as opaque LifeSort
   * transaction IDs. At least two: one payment is not a cadence. This is what
   * makes a suggestion explainable to the user.
   */
  readonly occurrenceIds: readonly string[];
  readonly decision: RecurringCandidateDecision;
};

export class RecurringCandidateError extends Error {
  constructor(readonly code: 'recurring_candidate_invalid') {
    super(code);
    this.name = 'RecurringCandidateError';
  }
}

export type RecurringCandidateInput = {
  readonly id: string;
  readonly source: RecurringCandidateSource;
  readonly suggestedFrequency: RecurrenceFrequency;
  readonly suggestedNextDate: string;
  readonly suggestedAmount?: MinorUnits | null;
  readonly occurrenceIds: readonly string[];
};

/**
 * The only way into the model. Fields are copied one by one, so anything a
 * provider adapter might carry along — descriptions, tokens, account numbers —
 * cannot ride into LifeSort state. A new candidate is always `suggested`.
 */
export function suggestRecurringCandidate(input: RecurringCandidateInput): RecurringPaymentCandidate {
  const invalid = () => { throw new RecurringCandidateError('recurring_candidate_invalid'); };
  if (typeof input?.id !== 'string' || input.id.trim().length === 0) invalid();
  if (input.source !== 'bank') invalid();
  if (!isRecurrenceFrequency(input.suggestedFrequency)) invalid();
  if (!parseIsoDate(input.suggestedNextDate)) invalid();
  const amount = input.suggestedAmount ?? null;
  if (amount !== null && !isSupportedMoney(amount)) invalid();
  const occurrenceIds = input.occurrenceIds;
  if (!Array.isArray(occurrenceIds) || occurrenceIds.length < 2) invalid();
  if (!occurrenceIds.every((id) => typeof id === 'string' && id.trim().length > 0)) invalid();
  if (new Set(occurrenceIds).size !== occurrenceIds.length) invalid();

  return Object.freeze({
    id: input.id,
    source: 'bank',
    suggestedFrequency: input.suggestedFrequency,
    suggestedNextDate: input.suggestedNextDate,
    suggestedAmount: amount,
    occurrenceIds: Object.freeze([...occurrenceIds]),
    decision: 'suggested',
  });
}

const withDecision = (
  candidate: RecurringPaymentCandidate,
  decision: RecurringCandidateDecision,
): RecurringPaymentCandidate => Object.freeze({ ...candidate, decision });

/** An explicit user action. No confidence score, threshold or timer may call this. */
export function confirmRecurringCandidate(candidate: RecurringPaymentCandidate): RecurringPaymentCandidate {
  return withDecision(candidate, 'confirmed');
}

/** An explicit user action; the candidate stops being offered as an accepted cost. */
export function dismissRecurringCandidate(candidate: RecurringPaymentCandidate): RecurringPaymentCandidate {
  return withDecision(candidate, 'dismissed');
}

/** Only an explicitly confirmed candidate counts as a recurring cost the user tracks. */
export function isTrackedRecurringCost(candidate: RecurringPaymentCandidate): boolean {
  return candidate.decision === 'confirmed';
}
