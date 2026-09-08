import type { DataSensitivity, ModuleId } from './moduleRegistry';

/**
 * Månedligt tilbageblik (APP-016).
 *
 * Regler, i den rækkefølge de betyder noget:
 *
 * 1. Kun udledte kendsgerninger. Hvert tal skal kunne genfindes i brugerens
 *    egne poster. Ingen score, intet indeks, ingen "du er 20 % bedre end sidst"
 *    uden at begge måneder findes.
 * 2. Ingen ros og ingen bebrejdelse. Et tilbageblik på økonomi, vaner og hjem
 *    må ikke føles som en karakterbog — specifikationen §8.4 og §25 er
 *    tydelige: sundhed, penge og vaner er ikke steder at presse nogen.
 * 3. Har et modul intet at fortælle om måneden, siger det ingenting. En side
 *    fuld af nuller er ikke information.
 *
 * AI må senere formulere de her kendsgerninger, men aldrig producere dem.
 * Derfor er det tal og nøgler her — ikke sætninger.
 */

export type MonthlyFact = {
  moduleId: ModuleId;
  /** i18n-nøgle. Modulet skriver ikke tekst; det leverer tal. */
  labelKey: string;
  params?: Record<string, string | number>;
  sensitivity: DataSensitivity;
};

/** `monthKey` er 'YYYY-MM' i brugerens egen kalender. */
export type MonthlyReviewProvider = (monthKey: string) => Promise<MonthlyFact[]>;
export type MonthlyReviewProviders = Partial<Record<ModuleId, MonthlyReviewProvider>>;

/** Måneden der ligger bag os — den man kan se tilbage på. */
export function previousMonthKey(now: Date): string {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indekseret
  const date = new Date(year, month - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Hører ISO-datoen til måneden? Sammenlignet som tekst, så ingen tidszone kan flytte den. */
export function isInMonth(isoDate: string, monthKey: string): boolean {
  return isoDate.slice(0, 7) === monthKey;
}
