import { addMinorUnits, negateMinorUnits, type MinorUnits } from '@/core/money/minorUnits';
import { supportedMoney } from '@/core/money/supportedMoney';
import type { SavingsGoal } from '@/types/savingsGoal';
import { parseCalendarDate } from '@/utils/shared/localDate';

/**
 * APP-043: the rules every NEW savings-goal mutation obeys.
 *
 * A goal's `savedAmount` is its canonical current value. It changes only through
 * movements: signed amounts on named goals, where each movement is applied to the
 * balance AND recorded as one SavingsContribution with exactly the same amount.
 * History and balance therefore cannot say different things about one operation.
 *
 *  - contribution: one movement, deposit (+) or withdrawal (−), never zero;
 *  - transfer:     −amount on the source, +amount on the destination (sum is zero);
 *  - allocation:   one positive movement per distinct goal.
 *
 * Savings movements are allocation facts between the user's own savings buckets.
 * They are never Expense, income or bank facts, and nothing here touches APP-039.
 *
 * Everything is pure and throws BEFORE the caller changes anything. Failures carry
 * a fixed code only — never an amount, a name, a goal ID or a date.
 */

export type SavingsRuleCode =
  | 'savings_target_invalid'
  | 'savings_deadline_invalid'
  | 'savings_goal_not_found'
  | 'savings_amount_invalid'
  | 'savings_insufficient_balance'
  | 'savings_transfer_same_goal'
  | 'savings_duplicate_goal'
  | 'savings_allocation_empty';

export class SavingsRuleError extends Error {
  constructor(readonly code: SavingsRuleCode) {
    super(code);
    this.name = 'SavingsRuleError';
  }
}

function fail(code: SavingsRuleCode): never {
  throw new SavingsRuleError(code);
}

/** A target is supported persisted money and strictly positive. */
export function savingsTarget(value: unknown): MinorUnits {
  const target = supportedMoney(value);
  if (target <= 0) fail('savings_target_invalid');
  return target;
}

/**
 * A deadline is optional; when present it is a real calendar date, 'YYYY-MM-DD'.
 * Nothing is normalized. A date in the past is legitimate: it is not rejected.
 */
export function isValidSavingsDeadline(value: unknown): value is string {
  return parseCalendarDate(value) !== null;
}

export function savingsDeadline(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isValidSavingsDeadline(value)) fail('savings_deadline_invalid');
  return value;
}

/** One signed change to one goal's balance, recorded verbatim as history. */
export type SavingsMovement = { readonly goalId: string; readonly amount: MinorUnits };

/** A deposit (+) or a withdrawal (−) on one goal. Zero moves nothing and is refused. */
export function contributionMovements(goalId: string, amount: MinorUnits): SavingsMovement[] {
  const checked = supportedMoney(amount);
  if (checked === 0) fail('savings_amount_invalid');
  return [{ goalId, amount: checked }];
}

/** Exactly −amount on the source and +amount on the destination. */
export function transferMovements(fromId: string, toId: string, amount: MinorUnits): SavingsMovement[] {
  const checked = supportedMoney(amount);
  if (checked <= 0) fail('savings_amount_invalid');
  if (fromId === toId) fail('savings_transfer_same_goal');
  return [
    { goalId: fromId, amount: negateMinorUnits(checked) },
    { goalId: toId, amount: checked },
  ];
}

/** One strictly positive movement per goal; duplicates are refused when applied. */
export function allocationMovements(
  allocations: readonly { readonly id: string; readonly amount: MinorUnits }[],
): SavingsMovement[] {
  if (allocations.length === 0) fail('savings_allocation_empty');
  return allocations.map((allocation) => {
    const checked = supportedMoney(allocation.amount);
    if (checked <= 0) fail('savings_amount_invalid');
    return { goalId: allocation.id, amount: checked };
  });
}

/**
 * The next goals after applying every movement, or a throw with nothing changed.
 * Each goal must exist and appear at most once; each resulting balance must be
 * non-negative and supported money. There is no upper bound: overfunding is valid.
 * Untouched goals are returned as the same objects.
 */
export function applySavingsMovements(
  goals: readonly SavingsGoal[],
  movements: readonly SavingsMovement[],
): SavingsGoal[] {
  const next = new Map<string, MinorUnits>();
  for (const movement of movements) {
    if (next.has(movement.goalId)) fail('savings_duplicate_goal');
    const goal = goals.find((candidate) => candidate.id === movement.goalId);
    if (!goal) fail('savings_goal_not_found');
    const balance = addMinorUnits(goal.savedAmount, supportedMoney(movement.amount));
    if (balance < 0) fail('savings_insufficient_balance');
    next.set(movement.goalId, supportedMoney(balance));
  }
  return goals.map((goal) => {
    const savedAmount = next.get(goal.id);
    return savedAmount === undefined ? goal : { ...goal, savedAmount };
  });
}

/** Form validation: whether the store would accept these movements. Never throws. */
export function savingsMovementsAllowed(
  goals: readonly SavingsGoal[],
  build: () => readonly SavingsMovement[],
): boolean {
  try {
    applySavingsMovements(goals, build());
    return true;
  } catch {
    return false;
  }
}
