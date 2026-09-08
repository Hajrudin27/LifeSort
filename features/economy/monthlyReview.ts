import { isInMonth, type MonthlyFact } from '@/core/modules/monthlyReview';
import { whenStoresHydrated } from '@/core/storage/storeHydration';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';

/** Økonomiens kendsgerninger for måneden. Summer af brugerens egne poster. */
export async function economyMonthlyReview(monthKey: string): Promise<MonthlyFact[]> {
  await whenStoresHydrated([useExpensesStore, useIncomeStore, useSavingsGoalsStore]);

  const expenses = useExpensesStore.getState().expenses.filter((e) => isInMonth(e.nextPaymentDate, monthKey));
  const income = useIncomeStore.getState().incomeByMonth[monthKey] ?? 0;
  const savedThisMonth = useSavingsGoalsStore
    .getState()
    .history.filter((entry) => isInMonth(entry.date, monthKey))
    .reduce((sum, entry) => sum + entry.amount, 0);

  const facts: MonthlyFact[] = [];

  // Intet at fortælle er ikke det samme som nul. Er der ingen poster, siger
  // modulet ingenting frem for at pynte siden med et nul.
  if (expenses.length > 0) {
    facts.push({
      moduleId: 'economy',
      labelKey: 'review.economySpent',
      params: {
        amount: expenses.reduce((sum, e) => sum + e.amount, 0).toFixed(0),
        count: expenses.length,
      },
      sensitivity: 'financial',
    });
  }

  if (income > 0) {
    facts.push({
      moduleId: 'economy',
      labelKey: 'review.economyIncome',
      params: { amount: income.toFixed(0) },
      sensitivity: 'financial',
    });
  }

  if (savedThisMonth !== 0) {
    facts.push({
      moduleId: 'economy',
      // Både ind- og udbetalinger tæller med; en udbetaling er ikke et nederlag,
      // den er en oplysning.
      labelKey: savedThisMonth > 0 ? 'review.economySaved' : 'review.economyWithdrawn',
      params: { amount: Math.abs(savedThisMonth).toFixed(0) },
      sensitivity: 'financial',
    });
  }

  return facts;
}
