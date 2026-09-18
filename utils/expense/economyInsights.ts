import { addMonthsToMonthKey } from '@/core/dates/budgetPeriod';
import { sumMinorUnits, type MinorUnits } from '@/core/money/minorUnits';
import { economyTotalsForMonth } from '@/features/economy/monthlyTotals';
import { Expense } from '@/types/expense';
import { SavingsContribution } from '@/types/savingsGoal';
import { monthKeyToDate } from '@/utils/shared/monthKey';

export interface MonthlyPoint {
  monthKey: string;
  label: string;
  value: MinorUnits; // DKK øre; charts only use its proportions
}

function shortMonthLabel(monthKey: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short' }).format(monthKeyToDate(monthKey));
}

/**
 * The `monthsBack` month keys ending with `currentMonthKey`, oldest first.
 * APP-045: the caller passes the current Copenhagen budget month, so the last
 * point is the same month the Economy tab calls current.
 */
function trendMonths(currentMonthKey: string, monthsBack: number): string[] {
  return Array.from({ length: monthsBack }, (_, index) => addMonthsToMonthKey(currentMonthKey, index - monthsBack + 1));
}

export function getExpenseTrend(expenses: Expense[], monthsBack: number, locale: string, currentMonthKey: string): MonthlyPoint[] {
  return trendMonths(currentMonthKey, monthsBack).map((key) => ({
    monthKey: key,
    label: shortMonthLabel(key, locale),
    value: economyTotalsForMonth(expenses, {}, key).settledSpending,
  }));
}

export function getIncomeTrend(
  incomeByMonth: Record<string, MinorUnits>,
  monthsBack: number,
  locale: string,
  currentMonthKey: string,
): MonthlyPoint[] {
  return trendMonths(currentMonthKey, monthsBack).map((key) => ({
    monthKey: key,
    label: shortMonthLabel(key, locale),
    value: economyTotalsForMonth([], incomeByMonth, key).settledIncome,
  }));
}

export function getSavingsTrend(
  history: SavingsContribution[],
  monthsBack: number,
  locale: string,
  currentMonthKey: string,
): MonthlyPoint[] {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  return trendMonths(currentMonthKey, monthsBack).map((key) => {
    const endOfMonthKey = `${key}-31`; // ISO-strenge sammenlignes korrekt alfabetisk
    const cumulative = sumMinorUnits(
      sorted.filter((c) => c.date.slice(0, 10) <= endOfMonthKey).map((c) => c.amount),
    );
    return { monthKey: key, label: shortMonthLabel(key, locale), value: cumulative };
  });
}
