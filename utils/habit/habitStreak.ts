import { HabitLog } from '@/types/life';
import { addDaysIso, parseIsoDate, todayIso } from '@/utils/shared/localDate';

function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export function getCurrentStreak(logs: HabitLog[]): number {
  const loggedDates = new Set(logs.map((l) => toDateOnly(l.date)));
  let streak = 0;
  let cursor = todayIso();

  while (loggedDates.has(cursor)) {
    streak += 1;
    cursor = addDaysIso(cursor, -1);
  }

  return streak;
}

export function getLoggedThisWeek(logs: HabitLog[]): number {
  const today = todayIso();
  const dayNum = parseIsoDate(today).getDay() || 7; // søndag = 7, ikke 0
  const monday = addDaysIso(today, -(dayNum - 1));

  return logs.filter((l) => toDateOnly(l.date) >= monday).length;
}

export function hasLoggedToday(logs: HabitLog[]): boolean {
  const today = todayIso();
  return logs.some((l) => toDateOnly(l.date) === today);
}
