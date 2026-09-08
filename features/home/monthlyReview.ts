import { isInMonth, type MonthlyFact } from '@/core/modules/monthlyReview';
import { whenStoresHydrated } from '@/core/storage/storeHydration';
import { useHouseholdStore } from '@/store/useHouseholdStore';

/** Hjemmet. Opgaver der faktisk blev klaret i måneden. */
export async function homeMonthlyReview(monthKey: string): Promise<MonthlyFact[]> {
  await whenStoresHydrated([useHouseholdStore]);

  const done = useHouseholdStore
    .getState()
    .tasks.filter((task) => task.lastDone !== undefined && isInMonth(task.lastDone, monthKey));

  if (done.length === 0) return [];

  return [
    {
      moduleId: 'home',
      labelKey: 'review.homeTasksDone',
      params: { count: done.length },
      sensitivity: 'ordinary',
    },
  ];
}
