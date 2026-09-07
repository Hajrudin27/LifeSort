import type { HomeSnapshot } from '@/core/modules/moduleRegistry';
import { useFoodStore } from '@/store/useFoodStore';
import { getISOWeekKey, getWeeksInMonth } from '@/utils/food/foodWeek';
import { getMonthKey } from '@/utils/shared/monthKey';

/** Mad-modulets kort til Home (APP-011): hvad er der tilbage af ugens budget. */
export async function foodHomeSnapshot(): Promise<HomeSnapshot | null> {
  const now = new Date();
  const monthKey = getMonthKey(now);
  const weekKey = getISOWeekKey(now);

  const state = useFoodStore.getState();
  const monthlyBudget = state.monthlyBudgetByMonth[monthKey] ?? null;

  // Uden et budget er der ingen rest at vise. Kortet siger det i stedet for at
  // vise et opdigtet nul.
  if (monthlyBudget === null) {
    return {
      moduleId: 'food',
      titleKey: 'home.foodSnapshotLabel',
      value: '—',
      helperKey: 'home.foodSnapshotMissing',
      priority: 'normal',
      sensitivity: 'ordinary',
      route: '/food',
    };
  }

  const weeklyBudget = monthlyBudget / getWeeksInMonth(monthKey).length;
  const spentThisWeek = state.purchases
    .filter((purchase) => getISOWeekKey(new Date(purchase.date)) === weekKey)
    .reduce((sum, purchase) => sum + purchase.amount, 0);
  const remaining = weeklyBudget - spentThisWeek;

  return {
    moduleId: 'food',
    titleKey: 'home.foodSnapshotLabel',
    value: `${remaining.toFixed(0)} kr.`,
    helperKey: 'home.foodSnapshotHelper',
    priority: remaining < 0 ? 'important' : 'normal',
    sensitivity: 'financial',
    route: '/food',
  };
}
