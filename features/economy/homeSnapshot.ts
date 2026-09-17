import { economyTotalsForMonth } from './monthlyTotals';
import { formatDkk, moneyLocaleFor } from '@/core/money/format';
import { sumMinorUnits } from '@/core/money/minorUnits';
import type { HomeSnapshot } from '@/core/modules/moduleRegistry';
import { whenStoresHydrated } from '@/core/storage/storeHydration';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import i18n from '@/localization/i18n';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import { getMonthKey } from '@/utils/shared/monthKey';

/**
 * Økonomi-modulets kort til Home (APP-011).
 *
 * Modulet bestemmer selv, hvad der er værd at vise — og hvad der ikke er.
 * Home får ét tal og en hjælpetekst, aldrig en liste af udgifter.
 */
export async function economyHomeSnapshot(): Promise<HomeSnapshot | null> {
  // Vent på disken. Ellers regnes kortet ud på en tom store, og brugeren får
  // "0 kr." serveret som et faktum. Se APP-014.
  await whenStoresHydrated([useIncomeStore, useExpensesStore, useSavingsGoalsStore]);

  const monthKey = getMonthKey(new Date());

  const totals = economyTotalsForMonth(
    useExpensesStore.getState().expenses,
    useIncomeStore.getState().incomeByMonth,
    monthKey,
  );

  const goals = useSavingsGoalsStore.getState().goals;
  const totalSaved = sumMinorUnits(goals.map((goal) => goal.savedAmount));
  const totalTarget = sumMinorUnits(goals.map((goal) => goal.targetAmount));

  const moneyAvailable = totals.balance;

  return {
    moduleId: 'economy',
    titleKey: 'home.moneySnapshotLabel',
    value: formatDkk(moneyAvailable, moneyLocaleFor(i18n.language)),
    // Sparemålene fylder ikke et helt kort, men er det mest brugbare at vide
    // ved siden af "hvor meget er der tilbage".
    helperKey: totalTarget > 0 ? 'home.moneySnapshotHelperSavings' : 'home.moneySnapshotHelper',
    helperParams: totalTarget > 0 ? { percent: Math.round((totalSaved / totalTarget) * 100) } : undefined,
    priority: moneyAvailable < 0 ? 'urgent' : 'normal',
    sensitivity: 'financial',
    route: '/economy',
  };
}
