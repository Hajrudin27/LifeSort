import { addDaysIso, parseIsoDate, todayIso } from '@/utils/shared/localDate';

export interface WeekDayInfo {
  key: string; // ISO-dato, fx "2026-08-18"
  label: string; // kort ugedag, fx "M", "T"
  isToday: boolean;
  isFuture: boolean;
}

export function getCurrentWeekDays(locale: string): WeekDayInfo[] {
  const today = todayIso();
  const dayNum = parseIsoDate(today).getDay() || 7; // søndag = 7, ikke 0
  const monday = addDaysIso(today, -(dayNum - 1));

  return Array.from({ length: 7 }, (_, i) => {
    const key = addDaysIso(monday, i);
    return {
      key,
      label: new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(parseIsoDate(key)),
      isToday: key === today,
      isFuture: key > today,
    };
  });
}

export function getTodayKey(): string {
  return todayIso();
}

export function isDateInCurrentWeek(dateKey: string, locale: string): boolean {
  const days = getCurrentWeekDays(locale);
  return dateKey >= days[0].key && dateKey <= days[6].key;
}
