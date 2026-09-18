// APP-045: week keys, weeks-in-month and the previous week moved to
// core/dates/budgetPeriod.ts (Copenhagen periods, one ISO-week algorithm).
// Only the weekday labels for the meal plan remain here.

export function getWeekdayNames(locale: string): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(2024, 0, 1 + i))
  );
}
