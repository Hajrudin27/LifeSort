import { daysUntilIso } from '@/utils/shared/localDate';

/**
 * Hele kalenderdage fra i dag til den givne dato. 0 = i dag, negativ = passeret.
 *
 * Regner i kalenderdage frem for millisekunder, så hverken tidszone,
 * klokkeslæt eller sommertid forskyder svaret — se utils/shared/localDate.ts.
 */
export function daysUntil(dateStr: string): number {
  return daysUntilIso(dateStr.slice(0, 10));
}
