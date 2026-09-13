import { Expense } from "@/types/expense";
import { economyTotalsForMonth } from "@/features/economy/monthlyTotals";

export function totalForMonth(expenses: Expense[], monthKey: string): number {
  return economyTotalsForMonth(expenses, {}, monthKey).settledSpending;
}

export function categoryTotalForMonth(
  expenses: Expense[],
  monthKey: string,
  category: string,
): number {
  return totalForMonth(expenses.filter((e) => e.category === category), monthKey);
}
