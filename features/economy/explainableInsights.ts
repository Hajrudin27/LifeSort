import { addMonthsToMonthKey, BUDGET_TIME_ZONE } from '@/core/dates/budgetPeriod';
import { absMinorUnits, subtractMinorUnits, type MinorUnits } from '@/core/money/minorUnits';
import type { Expense } from '@/types/expense';
import type { BankFinancialInput } from './financialSources';
import { economyTotalsForMonth } from './monthlyTotals';

/**
 * APP-046 explainable insights: the approved facts about how settled spending
 * changed between the two latest COMPLETED Europe/Copenhagen budget months.
 *
 * It says what the records show, never why. No cause, advice, judgement,
 * forecast or percentage exists here, and none may be derived from these facts
 * by anything else: the screen, and later an AI (APP-085+), may only phrase them.
 *
 * Every figure is APP-039's `economyTotalsForMonth`, called once per month with
 * the caller's sources. Nothing re-sums an Expense.
 *
 * Pure: the caller passes the open month and the sources. No store, clock,
 * storage, network, logging or AI.
 */

/** One compared month, exactly as APP-039 computed it. */
export type ComparedMonth = {
  readonly monthKey: string;
  /** APP-039 settled spending: may be negative (refunds, negative manual entries); never clamped. */
  readonly settledSpending: MinorUnits;
  /** APP-039's count of booked expense entries. Context only, never a cause. */
  readonly expenseCount: number;
};

/** Where the figures come from. Typed; the screen owns the wording. */
export type SpendingChangeSource = {
  /** Economy records held in LifeSort, read through APP-039. */
  readonly kind: 'registered-economy-records';
  /** Production supplies no bank inputs (APP-041), so this is 'none' there. */
  readonly bankInputs: 'none' | 'supplied';
};

/** Which periods the comparison covers, and what counts in them. */
export type SpendingComparisonCoverage = {
  /** Two whole, completed budget months (APP-045). */
  readonly basis: 'completed-budget-months';
  readonly timeZone: typeof BUDGET_TIME_ZONE;
  /** The open month the comparison stops before; it is never compared. */
  readonly openMonthKey: string;
  /** What is registered for those months; missed recurring months are not reconstructed (APP-042). */
  readonly records: 'as-registered';
};

/**
 * Whether LifeSort can say when these records were last confirmed with the
 * server. It cannot: Expenses and income sync by best-effort direct writes with
 * no durable last-sync time, APP-036 sync status covers only the outbox, and
 * `createdAt` is neither an update time nor a sync time.
 */
export type SyncFreshness = {
  readonly status: 'not-available';
  readonly reason: 'no-authoritative-sync-time';
};

type SharedFacts = {
  readonly latest: ComparedMonth;
  readonly previous: ComparedMonth;
  readonly coverage: SpendingComparisonCoverage;
  readonly source: SpendingChangeSource;
  readonly syncFreshness: SyncFreshness;
};

export type SpendingChangeFact =
  | (SharedFacts & {
      readonly kind: 'settled-spending-change';
      /** |latest − previous|, in checked MinorUnits arithmetic. */
      readonly absoluteDelta: MinorUnits;
      readonly direction: 'higher' | 'lower' | 'unchanged';
    })
  | (SharedFacts & {
      /**
       * Neither month has a registered expense entry or any settled spending.
       * The records are silent; that is not knowledge that nothing was spent.
       */
      readonly kind: 'no-registered-spending';
    });

export type SpendingChangeInput = {
  /** The current, open Copenhagen budget month, from `budgetPeriodForInstant`. */
  readonly currentMonthKey: string;
  /** One account's Expenses snapshot. */
  readonly expenses: readonly Expense[];
  /** APP-039's bank boundary, passed through unchanged. Production supplies none. */
  readonly bank?: readonly BankFinancialInput[];
};

const SYNC_FRESHNESS: SyncFreshness = { status: 'not-available', reason: 'no-authoritative-sync-time' };

function comparedMonth(input: SpendingChangeInput, monthKey: string): ComparedMonth {
  // Income is not a source of spending, so none is passed: missing or present
  // income cannot change this fact.
  const totals = economyTotalsForMonth(input.expenses, {}, monthKey, input.bank ?? []);
  return { monthKey, settledSpending: totals.settledSpending, expenseCount: totals.expenseCount };
}

/**
 * Throws BudgetPeriodError for an invalid month key, APP-039's fixed codes for
 * invalid sources, and `money_unsafe_arithmetic` when the difference leaves the
 * safe integer range.
 */
export function settledSpendingChange(input: SpendingChangeInput): SpendingChangeFact {
  const latestMonthKey = addMonthsToMonthKey(input.currentMonthKey, -1);
  const previousMonthKey = addMonthsToMonthKey(input.currentMonthKey, -2);
  const shared: SharedFacts = {
    latest: comparedMonth(input, latestMonthKey),
    previous: comparedMonth(input, previousMonthKey),
    coverage: {
      basis: 'completed-budget-months',
      timeZone: BUDGET_TIME_ZONE,
      openMonthKey: input.currentMonthKey,
      records: 'as-registered',
    },
    source: { kind: 'registered-economy-records', bankInputs: (input.bank ?? []).length > 0 ? 'supplied' : 'none' },
    syncFreshness: SYNC_FRESHNESS,
  };

  const { latest, previous } = shared;
  if ([latest, previous].every((month) => month.expenseCount === 0 && month.settledSpending === 0)) {
    return { ...shared, kind: 'no-registered-spending' };
  }

  const difference = subtractMinorUnits(latest.settledSpending, previous.settledSpending);
  return {
    ...shared,
    kind: 'settled-spending-change',
    absoluteDelta: absMinorUnits(difference),
    direction: difference > 0 ? 'higher' : difference < 0 ? 'lower' : 'unchanged',
  };
}
