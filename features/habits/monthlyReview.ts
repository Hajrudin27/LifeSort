import { isInMonth, type MonthlyFact } from '@/core/modules/monthlyReview';
import { whenStoresHydrated } from '@/core/storage/storeHydration';
import { useHabitsStore } from '@/store/useHabitsStore';

/**
 * Vaner. Antal registreringer i måneden — ikke en streak og ikke en procent af
 * et mål. En streak, der brydes, er præcis den slags tal, der bebrejder.
 */
export async function habitsMonthlyReview(monthKey: string): Promise<MonthlyFact[]> {
  await whenStoresHydrated([useHabitsStore]);

  const habits = useHabitsStore.getState().habits;
  const logs = habits.flatMap((habit) => habit.logs.filter((log) => isInMonth(log.date, monthKey)));
  if (logs.length === 0) return [];

  const habitsWithLogs = habits.filter((habit) => habit.logs.some((log) => isInMonth(log.date, monthKey)));

  return [
    {
      moduleId: 'habits',
      labelKey: 'review.habitsLogged',
      params: { count: logs.length, habits: habitsWithLogs.length },
      sensitivity: 'ordinary',
    },
  ];
}
