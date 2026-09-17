import { sumMinorUnits, type MinorUnits } from '@/core/money/minorUnits';
import { economyTotalsForMonth } from '@/features/economy/monthlyTotals';
import { Expense } from '@/types/expense';
import { SavingsContribution } from '@/types/savingsGoal';
import { addMonths, getMonthKey } from '@/utils/shared/monthKey';

export interface MonthlyPoint {
  monthKey: string;
  label: string;
  value: MinorUnits; // DKK øre; charts only use its proportions
}

function shortMonthLabel(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
}

export function getExpenseTrend(expenses: Expense[], monthsBack: number, locale: string): MonthlyPoint[] {
  const now = new Date();
  const points: MonthlyPoint[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = addMonths(now, -i);
    const key = getMonthKey(d);
    const total = economyTotalsForMonth(expenses, {}, key).settledSpending;
    points.push({ monthKey: key, label: shortMonthLabel(d, locale), value: total });
  }
  return points;
}

export function getIncomeTrend(incomeByMonth: Record<string, MinorUnits>, monthsBack: number, locale: string): MonthlyPoint[] {
  const now = new Date();
  const points: MonthlyPoint[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = addMonths(now, -i);
    const key = getMonthKey(d);
    const total = economyTotalsForMonth([], incomeByMonth, key).settledIncome;
    points.push({ monthKey: key, label: shortMonthLabel(d, locale), value: total });
  }
  return points;
}

export function getSavingsTrend(history: SavingsContribution[], monthsBack: number, locale: string): MonthlyPoint[] {
  const now = new Date();
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const points: MonthlyPoint[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = addMonths(now, -i);
    const key = getMonthKey(d);
    const endOfMonthKey = `${key}-31`; // ISO-strenge sammenlignes korrekt alfabetisk
    const cumulative = sumMinorUnits(
      sorted.filter((c) => c.date.slice(0, 10) <= endOfMonthKey).map((c) => c.amount),
    );
    points.push({ monthKey: key, label: shortMonthLabel(d, locale), value: cumulative });
  }
  return points;
}