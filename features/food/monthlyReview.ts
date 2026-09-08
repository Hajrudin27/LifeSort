import { isInMonth, type MonthlyFact } from '@/core/modules/monthlyReview';
import { whenStoresHydrated } from '@/core/storage/storeHydration';
import { useFoodStore } from '@/store/useFoodStore';

/** Madbudgettets kendsgerninger. Budgettet nævnes kun, hvis brugeren har sat et. */
export async function foodMonthlyReview(monthKey: string): Promise<MonthlyFact[]> {
  await whenStoresHydrated([useFoodStore]);

  const state = useFoodStore.getState();
  const purchases = state.purchases.filter((purchase) => isInMonth(purchase.date, monthKey));
  if (purchases.length === 0) return [];

  const spent = purchases.reduce((sum, purchase) => sum + purchase.amount, 0);
  const budget = state.monthlyBudgetByMonth[monthKey] ?? null;

  const facts: MonthlyFact[] = [
    {
      moduleId: 'food',
      labelKey: 'review.foodSpent',
      params: { amount: spent.toFixed(0), count: purchases.length },
      sensitivity: 'financial',
    },
  ];

  // Sammenligning kun når begge tal findes. Ellers ville "over budget" være
  // opfundet ud af ingenting.
  if (budget !== null) {
    facts.push({
      moduleId: 'food',
      labelKey: 'review.foodBudget',
      params: { budget: budget.toFixed(0) },
      sensitivity: 'financial',
    });
  }

  return facts;
}
