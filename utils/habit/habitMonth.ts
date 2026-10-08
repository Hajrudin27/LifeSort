import { isoWeekday } from '@/utils/shared/localDate';

export interface MonthDayInfo {
  key: string | null; // ISO-dato, eller null = udfyldning uden for måneden
  dayNumber: number | null;
  isToday: boolean;
  isFuture: boolean;
}

/** Antal dage i 'YYYY-MM'. Regnet i UTC af månedens egne tal, så ingen tidszone kan flytte det. */
export function daysInMonthKey(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(year, month, 0); // dag 0 i næste måned = sidste dag i denne
  return lastDay.getUTCDate();
}

/** 'YYYY-MM' en eller flere måneder frem eller tilbage. Ren tekst og heltal — ingen Date, ingen tidszone. */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function getMonthCalendarWeeks(monthKey: string, todayKey: string): MonthDayInfo[][] {
  const daysInMonth = daysInMonthKey(monthKey);
  const firstWeekday = isoWeekday(`${monthKey}-01`); // mandag = 1 … søndag = 7, uafhængigt af enhedens tidszone

  const days: MonthDayInfo[] = [];

  for (let i = 1; i < firstWeekday; i++) {
    days.push({ key: null, dayNumber: null, isToday: false, isFuture: false });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${monthKey}-${d.toString().padStart(2, '0')}`;
    days.push({ key, dayNumber: d, isToday: key === todayKey, isFuture: key > todayKey });
  }

  while (days.length % 7 !== 0) {
    days.push({ key: null, dayNumber: null, isToday: false, isFuture: false });
  }

  const weeks: MonthDayInfo[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

export function getWeekdayNarrowLabels(locale: string): string[] {
  // 1. januar 2024 var en mandag — bruges kun som fast reference til at generere ugedags-navne
  return Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i))
  );
}
