import { subtractMinorUnits, type MinorUnits } from '@/core/money/minorUnits';
import { parseSupportedMoneyInput, supportedMoney } from '@/core/money/supportedMoney';
import type { FinancialMonthlyTotals } from './financialReadModel';

/**
 * APP-044 "Har jeg råd?": what ONE hypothetical purchase would do to the
 * current plan. It describes a result; it never says whether to buy.
 *
 * The current plan is exactly the current month's APP-039 totals from
 * `economyTotalsForMonth`: registered income minus settled spending. Savings
 * goals, extra savings, category and Food budgets, future income, credit and
 * assets are not part of it, and nothing here adds them.
 *
 * Pure: the caller supplies the totals and the amount. Nothing here reads a
 * store, the clock, storage or the network, and nothing is persisted; the
 * purchase exists only in the caller's memory.
 */

/**
 * Descriptive states. `within-current-plan` does not mean "affordable" and
 * `over-current-plan` does not mean "unaffordable": they say where the
 * registered plan would land, and nothing more.
 */
export type PurchaseImpact =
  | {
      /** The plan would end at or above zero (`within`), or below it (`over`). */
      readonly status: 'within-current-plan' | 'over-current-plan';
      readonly purchaseAmount: MinorUnits;
      /** The APP-039 monthly balance, as the read model computed it. */
      readonly balanceBefore: MinorUnits;
      readonly balanceAfter: MinorUnits;
    }
  | {
      /**
       * No income is registered for the month. Missing income is not zero
       * income, so no remaining balance is calculated, let alone invented.
       */
      readonly status: 'plan-incomplete';
      readonly purchaseAmount: MinorUnits;
    };

/** Fixed, value-free code. Never add the amount to a message. */
export class PurchaseImpactError extends Error {
  constructor(readonly code: 'purchase_amount_invalid') {
    super(code);
    this.name = 'PurchaseImpactError';
  }
}

/**
 * Form text → the purchase amount, or null while the text is not one: the
 * APP-040 parser, supported money and strictly positive, the same rules
 * `evaluatePurchaseImpact` enforces.
 */
export function purchaseAmountFromInput(text: string): MinorUnits | null {
  const parsed = parseSupportedMoneyInput(text);
  return parsed.ok && parsed.value > 0 ? parsed.value : null;
}

/**
 * `plan` is the result of `economyTotalsForMonth` for the current month. Its
 * balance is used as computed; this function never re-sums a source.
 *
 * Throws `money_unsupported_amount` (APP-040) or `purchase_amount_invalid` for
 * an amount that is not supported money or not above zero, and
 * `money_unsafe_arithmetic` when the result leaves the safe integer range.
 */
export function evaluatePurchaseImpact(plan: FinancialMonthlyTotals, amount: MinorUnits): PurchaseImpact {
  const purchaseAmount = supportedMoney(amount);
  if (purchaseAmount <= 0) throw new PurchaseImpactError('purchase_amount_invalid');

  if (!plan.hasIncome) return { status: 'plan-incomplete', purchaseAmount };

  // Checked integer arithmetic: nothing is clamped, rounded or turned into kroner.
  const balanceAfter = subtractMinorUnits(plan.balance, purchaseAmount);
  return {
    status: balanceAfter >= 0 ? 'within-current-plan' : 'over-current-plan',
    purchaseAmount,
    balanceBefore: plan.balance,
    balanceAfter,
  };
}
