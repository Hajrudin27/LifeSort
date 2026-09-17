import type { MinorUnits } from '@/core/money/minorUnits';
import type { Expense } from '@/types/expense';
import { financialTotalsForMonth } from './financialReadModel';
import { bankFinancialEntries, manualExpenseEntries, manualIncomeEntries, type BankFinancialInput } from './financialSources';

/** Production currently has no bank source; callers use the empty default. */
export function economyTotalsForMonth(
  expenses: readonly Expense[],
  incomeByMonth: Readonly<Record<string, MinorUnits>>,
  monthKey: string,
  bank: readonly BankFinancialInput[] = [],
) {
  return financialTotalsForMonth([
    ...manualExpenseEntries(expenses),
    ...manualIncomeEntries(incomeByMonth),
    ...bankFinancialEntries(bank),
  ], monthKey);
}
