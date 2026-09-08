import { isInMonth, type MonthlyFact } from '@/core/modules/monthlyReview';
import { whenStoresHydrated } from '@/core/storage/storeHydration';
import { useTodoStore } from '@/store/useTodoStore';

/**
 * Gøremål. Tælles på oprettede og afsluttede — ikke på hvor mange der ligger
 * tilbage, for det tal ville kun være en løftet pegefinger.
 */
export async function tasksMonthlyReview(monthKey: string): Promise<MonthlyFact[]> {
  await whenStoresHydrated([useTodoStore]);

  const todos = useTodoStore.getState().todos;
  const created = todos.filter((todo) => isInMonth(todo.createdAt, monthKey));
  const completed = created.filter((todo) => todo.completed);

  if (created.length === 0) return [];

  return [
    {
      moduleId: 'tasks',
      labelKey: 'review.tasksCreated',
      params: { count: created.length },
      sensitivity: 'ordinary',
    },
    ...(completed.length > 0
      ? [
          {
            moduleId: 'tasks' as const,
            labelKey: 'review.tasksCompleted',
            params: { count: completed.length },
            sensitivity: 'ordinary' as const,
          },
        ]
      : []),
  ];
}
