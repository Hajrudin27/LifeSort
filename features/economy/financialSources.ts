import { absMinorUnits, isMinorUnits, type MinorUnits } from '@/core/money/minorUnits';
import type { Expense } from '@/types/expense';
import type { FinancialTransaction, ManualMonthlyIncome } from './financialReadModel';

/** No correlation is inferred from the current persisted Expense shape. */
export function manualExpenseEntries(expenses: readonly Expense[]): FinancialTransaction[] {
  return expenses.map((expense) => ({
    source: { kind: 'manual', representation: 'transaction', id: expense.id },
    semantic: 'expense',
    amount: expense.amount,
    currency: 'DKK',
    date: expense.nextPaymentDate,
    status: 'booked',
  }));
}

export function manualIncomeEntries(incomeByMonth: Readonly<Record<string, MinorUnits>>): ManualMonthlyIncome[] {
  return Object.entries(incomeByMonth).map(([monthKey, amount]) => ({
    source: { kind: 'manual', representation: 'monthly-aggregate', monthKey },
    semantic: 'income',
    amount,
    currency: 'DKK',
  }));
}

/**
 * Non-persisted LifeSort bank boundary, NOT a provider payload. No current bank
 * source exists. A future adapter must supply one account's active snapshots and
 * stable transaction IDs (including across pending -> booked), removing deleted
 * records upstream. `amountMinor` is signed DKK MinorUnits (APP-040): debit
 * negative, credit/refund positive; transfer either sign. Currency is checked
 * before any aggregation; the adapter converts provider money before this point.
 */
export type BankFinancialInput = {
  readonly id: string;
  readonly kind: 'debit' | 'credit' | 'transfer' | 'refund';
  readonly amountMinor: MinorUnits;
  readonly currency: string;
  readonly date: string;
  readonly status: 'pending' | 'booked';
  readonly correlationId?: string;
};

export function bankFinancialEntries(inputs: readonly BankFinancialInput[]): FinancialTransaction[] {
  return inputs.map((input) => {
    if (input.currency !== 'DKK') throw new Error('financial_currency_unsupported');
    if (!isMinorUnits(input.amountMinor) ||
        (input.kind === 'debit' && input.amountMinor > 0) ||
        ((input.kind === 'credit' || input.kind === 'refund') && input.amountMinor < 0)) {
      throw new Error('financial_bank_amount_invalid');
    }
    return {
      source: { kind: 'bank', representation: 'transaction', id: input.id },
      semantic: input.kind === 'debit' ? 'expense' : input.kind === 'credit' ? 'income' : input.kind,
      amount: absMinorUnits(input.amountMinor),
      currency: 'DKK',
      date: input.date,
      status: input.status,
      correlationId: input.correlationId,
    };
  });
}
