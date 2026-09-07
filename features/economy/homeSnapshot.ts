import type { HomeSnapshot } from '@/core/modules/moduleRegistry';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import { getMonthKey } from '@/utils/shared/monthKey';

/**
 * Økonomi-modulets kort til Home (APP-011).
 *
 * Modulet bestemmer selv, hvad der er værd at vise — og hvad der ikke er.
 * Home får ét tal og en hjælpetekst, aldrig en liste af udgifter.
 */
export async function economyHomeSnapshot(): Promise<HomeSnapshot | null> {
  const monthKey = getMonthKey(new Date());

  const netIncome = useIncomeStore.getState().incomeByMonth[monthKey] ?? 0;
  const monthExpensesTotal = useExpensesStore
    .getState()
    .expenses.filter((expense) => expense.nextPaymentDate.startsWith(monthKey))
    .reduce((sum, expense) => sum + expense.amount, 0);

  const goals = useSavingsGoalsStore.getState().goals;
  const totalSaved = goals.reduce((sum, goal) => sum + goal.savedAmount, 0);
  const totalTarget = goals.reduce((sum, goal) => sum + goal.targetAmount, 0);

  const moneyAvailable = netIncome - monthExpensesTotal;

  return {
    moduleId: 'economy',
    titleKey: 'home.moneySnapshotLabel',
    value: `${moneyAvailable.toFixed(0)} kr.`,
    // Sparemålene fylder ikke et helt kort, men er det mest brugbare at vide
    // ved siden af "hvor meget er der tilbage".
    helperKey: totalTarget > 0 ? 'home.moneySnapshotHelperSavings' : 'home.moneySnapshotHelper',
    helperParams: totalTarget > 0 ? { percent: Math.round((totalSaved / totalTarget) * 100) } : undefined,
    priority: moneyAvailable < 0 ? 'urgent' : 'normal',
    sensitivity: 'financial',
    route: '/economy',
  };
}
