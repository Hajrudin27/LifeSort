import {
  budgetPeriodDaysFrom,
  budgetPeriodForRecordedDate,
  isoWeeksInMonth,
  type BudgetPeriod,
} from '@/core/dates/budgetPeriod';
import type { GroceryPurchase } from '@/types/food';

/**
 * APP-045: the one derivation of the Food budget facts that the Food overview,
 * the weekly plan, Home and the Economy tab's Food card show.
 *
 * The formula is unchanged: the monthly budget divided by the number of ISO
 * weeks that touch the month is the weekly budget. What changed is who decides
 * the month and week (the caller's Copenhagen period) and how a purchase is
 * placed (its Copenhagen date, via core/dates).
 *
 * Food money stays major-unit numbers, not APP-040 MinorUnits, and a purchase
 * never becomes Economy spending (APP-049). Pure: no store, clock or storage.
 */

type FoodBudgetBase = {
  readonly monthKey: string;
  readonly weekKey: string;
  /** Purchases whose Copenhagen date falls in `weekKey`. */
  readonly spentThisWeek: number;
};

export type FoodBudgetFacts =
  | (FoodBudgetBase & { readonly hasBudget: false })
  | (FoodBudgetBase & {
      readonly hasBudget: true;
      readonly monthlyBudget: number;
      readonly weeklyBudget: number;
      /** Negative when the week is over budget. */
      readonly remaining: number;
    });

/** The month's Food budget, or null when none is set. */
export function monthlyFoodBudget(monthlyBudgetByMonth: Readonly<Record<string, number>>, monthKey: string): number | null {
  return monthlyBudgetByMonth[monthKey] ?? null;
}

/** A purchase's period: a timestamp in Copenhagen, a date-only value as written, anything else none. */
export function foodPurchasePeriod(purchase: Pick<GroceryPurchase, 'date'>): BudgetPeriod | null {
  return budgetPeriodForRecordedDate(purchase.date);
}

export function foodBudgetFacts({
  period,
  monthlyBudgetByMonth,
  purchases,
}: {
  period: Pick<BudgetPeriod, 'monthKey' | 'weekKey'>;
  monthlyBudgetByMonth: Readonly<Record<string, number>>;
  purchases: readonly GroceryPurchase[];
}): FoodBudgetFacts {
  const spentThisWeek = purchases
    .filter((purchase) => foodPurchasePeriod(purchase)?.weekKey === period.weekKey)
    .reduce((sum, purchase) => sum + purchase.amount, 0);
  const base = { monthKey: period.monthKey, weekKey: period.weekKey, spentThisWeek };

  const monthlyBudget = monthlyFoodBudget(monthlyBudgetByMonth, period.monthKey);
  if (monthlyBudget === null) return { ...base, hasBudget: false };

  const weeklyBudget = monthlyBudget / isoWeeksInMonth(period.monthKey).length;
  return { ...base, hasBudget: true, monthlyBudget, weeklyBudget, remaining: weeklyBudget - spentThisWeek };
}

/** The week before the period's week: where last week's saved meal plan lives. */
export function previousFoodWeekKey(period: BudgetPeriod): string {
  return budgetPeriodDaysFrom(period, -7).weekKey;
}
