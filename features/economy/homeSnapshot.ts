import { prepareEconomyMonth } from './currentPeriod';
import { economyTotalsForMonth } from './monthlyTotals';
import { budgetPeriodForInstant } from '@/core/dates/budgetPeriod';
import { formatDkk, moneyLocaleFor } from '@/core/money/format';
import { sumMinorUnits } from '@/core/money/minorUnits';
import type { HomeSnapshot } from '@/core/modules/moduleRegistry';
import { whenStoresHydrated } from '@/core/storage/storeHydration';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import i18n from '@/localization/i18n';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';

/**
 * Økonomi-modulets kort til Home (APP-011).
 *
 * Modulet bestemmer selv, hvad der er værd at vise — og hvad der ikke er.
 * Home får ét tal og en hjælpetekst, aldrig en liste af udgifter.
 *
 * APP-045: samme måned og samme tal som Økonomi-fanen for samme øjeblik —
 * Københavns måned, og månedens faste udgifter materialiseret først.
 */
export async function economyHomeSnapshot(now: Date = new Date()): Promise<HomeSnapshot | null> {
  const { monthKey } = budgetPeriodForInstant(now);

  // Vent på disken og materialisér månedens faste udgifter (APP-042), så kortet
  // aldrig afhænger af, hvilken skærm brugeren åbnede først. Ellers regnes kortet
  // også ud på en tom store, og brugeren får "0 kr." serveret som et faktum (APP-014).
  await prepareEconomyMonth(monthKey);
  await whenStoresHydrated([useSavingsGoalsStore]);

  const totals = economyTotalsForMonth(
    useExpensesStore.getState().expenses,
    useIncomeStore.getState().incomeByMonth,
    monthKey,
  );

  // Manglende indkomst er ikke en indkomst på 0 kr. Uden den er der ingen rest at
  // vise, så kortet siger det i stedet for at vise udgifterne som et minus.
  if (!totals.hasIncome) {
    return {
      moduleId: 'economy',
      titleKey: 'home.moneySnapshotLabel',
      value: '—',
      helperKey: 'home.moneySnapshotMissingIncome',
      priority: 'normal',
      sensitivity: 'financial',
      route: '/economy',
    };
  }

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
