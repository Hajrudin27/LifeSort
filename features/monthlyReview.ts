import type { MonthlyReviewProviders } from '@/core/modules/monthlyReview';

import { economyMonthlyReview } from './economy/monthlyReview';
import { foodMonthlyReview } from './food/monthlyReview';
import { habitsMonthlyReview } from './habits/monthlyReview';
import { homeMonthlyReview } from './home/monthlyReview';
import { tasksMonthlyReview } from './tasks/monthlyReview';

/**
 * Modulerne der bidrager til det månedlige tilbageblik.
 *
 * Cyklus er bevidst ikke med. Et tilbageblik er en side, man ruller igennem og
 * viser frem; helbredstal hører ikke til i en tværgående opsamling, når modulet
 * selv har sin egen historik. Se docs/monthly-review.md.
 */
export const MONTHLY_REVIEW_PROVIDERS: MonthlyReviewProviders = {
  economy: economyMonthlyReview,
  food: foodMonthlyReview,
  tasks: tasksMonthlyReview,
  habits: habitsMonthlyReview,
  home: homeMonthlyReview,
};
