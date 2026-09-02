import { Expense } from "@/types/expense";

export function totalForMonth(expenses: Expense[], monthKey: string): number {
  return expenses
    .filter((e) => e.nextPaymentDate.slice(0, 7) === monthKey)
    .reduce((sum, e) => sum + e.amount, 0);
}

export function categoryTotalForMonth(
  expenses: Expense[],
  monthKey: string,
  category: string,
): number {
  return expenses
    .filter(
      (e) =>
        e.nextPaymentDate.slice(0, 7) === monthKey && e.category === category,
    )
    .reduce((sum, e) => sum + e.amount, 0);
}
