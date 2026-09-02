import { HabitLog } from '@/types/life';

function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export function getCurrentStreak(logs: HabitLog[]): number {
  const loggedDates = new Set(logs.map((l) => toDateOnly(l.date)));
  let streak = 0;
  const cursor = new Date();

  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!loggedDates.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

export function getLoggedThisWeek(logs: HabitLog[]): number {
  const now = new Date();
  const startOfWeek = new Date(now);
  const dayNum = startOfWeek.getDay() || 7; // søndag = 7, ikke 0
  startOfWeek.setDate(startOfWeek.getDate() - dayNum + 1); // mandag
  startOfWeek.setHours(0, 0, 0, 0);

  return logs.filter((l) => new Date(l.date) >= startOfWeek).length;
}

export function hasLoggedToday(logs: HabitLog[]): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return logs.some((l) => toDateOnly(l.date) === today);
}