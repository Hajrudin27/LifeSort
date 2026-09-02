import { Expense } from '@/types/expense';
import { SavingsContribution } from '@/types/savingsGoal';
import { addMonths, getMonthKey } from '@/utils/shared/monthKey';

export interface MonthlyPoint {
  monthKey: string;
  label: string;
  value: number;
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
    const total = expenses.filter((e) => e.nextPaymentDate.slice(0, 7) === key).reduce((sum, e) => sum + e.amount, 0);
    points.push({ monthKey: key, label: shortMonthLabel(d, locale), value: total });
  }
  return points;
}

export function getIncomeTrend(incomeByMonth: Record<string, number>, monthsBack: number, locale: string): MonthlyPoint[] {
  const now = new Date();
  const points: MonthlyPoint[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = addMonths(now, -i);
    const key = getMonthKey(d);
    points.push({ monthKey: key, label: shortMonthLabel(d, locale), value: incomeByMonth[key] ?? 0 });
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
    const cumulative = sorted
      .filter((c) => c.date.slice(0, 10) <= endOfMonthKey)
      .reduce((sum, c) => sum + c.amount, 0);
    points.push({ monthKey: key, label: shortMonthLabel(d, locale), value: cumulative });
  }
  return points;
}