import { budgetPeriodForInstant } from '@/core/dates/budgetPeriod';
import type { HomeSnapshot } from '@/core/modules/moduleRegistry';
import { whenStoresHydrated } from '@/core/storage/storeHydration';
import { useFoodStore } from '@/store/useFoodStore';

import { foodBudgetFacts } from './budgetReadModel';

/**
 * Mad-modulets kort til Home (APP-011): hvad er der tilbage af ugens budget.
 * APP-045: samme uge og samme tal som Mad-oversigten for samme øjeblik.
 */
export async function foodHomeSnapshot(now: Date = new Date()): Promise<HomeSnapshot | null> {
  await whenStoresHydrated([useFoodStore]);

  const state = useFoodStore.getState();
  const facts = foodBudgetFacts({
    period: budgetPeriodForInstant(now),
    monthlyBudgetByMonth: state.monthlyBudgetByMonth,
    purchases: state.purchases,
  });

  // Uden et budget er der ingen rest at vise. Kortet siger det i stedet for at
  // vise et opdigtet nul.
  if (!facts.hasBudget) {
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

  return {
    moduleId: 'food',
    titleKey: 'home.foodSnapshotLabel',
    value: `${facts.remaining.toFixed(0)} kr.`,
    helperKey: 'home.foodSnapshotHelper',
    priority: facts.remaining < 0 ? 'important' : 'normal',
    sensitivity: 'financial',
    route: '/food',
  };
}
