import { economyTotalsForMonth } from './monthlyTotals';
import { formatDkk, moneyLocaleFor } from '@/core/money/format';
import { absMinorUnits, sumMinorUnits } from '@/core/money/minorUnits';
import { isInMonth, type MonthlyFact } from '@/core/modules/monthlyReview';
import { whenStoresHydrated } from '@/core/storage/storeHydration';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import i18n from '@/localization/i18n';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';

/** Økonomiens kendsgerninger for måneden. Summer af brugerens egne poster. */
export async function economyMonthlyReview(monthKey: string): Promise<MonthlyFact[]> {
  await whenStoresHydrated([useExpensesStore, useIncomeStore, useSavingsGoalsStore]);

  const totals = economyTotalsForMonth(
    useExpensesStore.getState().expenses,
    useIncomeStore.getState().incomeByMonth,
    monthKey,
  );
  const income = totals.settledIncome;
  const savedThisMonth = sumMinorUnits(
    useSavingsGoalsStore
      .getState()
      .history.filter((entry) => isInMonth(entry.date, monthKey))
      .map((entry) => entry.amount),
  );
  const locale = moneyLocaleFor(i18n.language);

  const facts: MonthlyFact[] = [];

  // Intet at fortælle er ikke det samme som nul. Er der ingen poster, siger
  // modulet ingenting frem for at pynte siden med et nul.
  if (totals.expenseCount > 0) {
    facts.push({
      moduleId: 'economy',
      labelKey: 'review.economySpent',
      params: {
        amount: formatDkk(totals.settledSpending, locale),
        count: totals.expenseCount,
      },
      sensitivity: 'financial',
    });
  }

  if (income > 0) {
    facts.push({
      moduleId: 'economy',
      labelKey: 'review.economyIncome',
      params: { amount: formatDkk(income, locale) },
      sensitivity: 'financial',
    });
  }

  if (savedThisMonth !== 0) {
    facts.push({
      moduleId: 'economy',
      // Både ind- og udbetalinger tæller med; en udbetaling er ikke et nederlag,
      // den er en oplysning.
      labelKey: savedThisMonth > 0 ? 'review.economySaved' : 'review.economyWithdrawn',
      params: { amount: formatDkk(absMinorUnits(savedThisMonth), locale) },
      sensitivity: 'financial',
    });
  }

  return facts;
}
