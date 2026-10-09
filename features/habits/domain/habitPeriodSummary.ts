import type { Habit } from '@/types/life';
import { addDaysIso, startOfIsoWeek } from '@/utils/shared/localDate';
import { isScheduledOn } from './habitStatus';

/**
 * APP-066 — "what has been recorded so far" in the CURRENT ISO week or calendar month. Pure
 * function of (habits, kind, today): no clock, no store, no i18n, no persistence, no prose. The
 * caller passes `today` (the device-local calendar date), so the same inputs always give the same
 * facts and a test never needs fake timers.
 *
 * The period is always `[start of the week/month, today]`. Days after today never enter the
 * result, so a Friday cannot sit in Wednesday's denominator.
 *
 * Only ONE kind of commitment has a denominator: a scheduled `weekdays` day. It is a RESOLVED
 * commitment once its date is strictly before today (entry or not) or it has an entry. A
 * scheduled today with no entry is still pending and is not counted at all. Everything else is
 * a plain count of entries: an entry on an unscheduled day, any entry under a `weekly` schedule
 * (no target comparison, no partial-week rule) and any entry under an `open` schedule. There is
 * no percentage, no score and no separate "missed" number; `total - completed` is arithmetic the
 * caller may do but this module does not name it.
 *
 * Each date is judged with the schedule in effect ON THAT DATE (`isScheduledOn`), never today's.
 * This is deliberately not `habitWeekFacts`, which has a whole-week denominator and a weekly
 * target; this answers "progress so far" (ADR-0054).
 */

/** A civil calendar date, 'YYYY-MM-DD' (see utils/shared/localDate.ts). */
export type LocalDate = string;

export type HabitPeriodKind = 'week' | 'month';

export interface HabitPeriodSummary {
  period: { kind: HabitPeriodKind; from: LocalDate; to: LocalDate };
  /** Resolved scheduled-weekday commitments in the period: how many have an entry, out of how many are resolved. */
  scheduled: { completed: number; total: number };
  /** Entries that are not a scheduled-weekday commitment: other days, weekly and open schedules. Distinct per habit and date. */
  otherEntries: number;
}

/** First day of the period that contains `today`: the ISO Monday, or the first of the calendar month. */
export function habitPeriodStart(kind: HabitPeriodKind, today: LocalDate): LocalDate {
  return kind === 'week' ? startOfIsoWeek(today) : `${today.slice(0, 7)}-01`;
}

export function habitPeriodSummary(habits: readonly Habit[], kind: HabitPeriodKind, today: LocalDate): HabitPeriodSummary {
  const from = habitPeriodStart(kind, today);
  let completed = 0;
  let total = 0;
  let otherEntries = 0;

  for (const habit of habits) {
    const first = habit.startDate > from ? habit.startDate : from;
    if (first > today) continue;
    // A set: a hostile duplicate date counts once. Dates outside the period are simply never visited.
    const entries = new Set(habit.logs.map((log) => log.date));
    for (let date = first; date <= today; date = addDaysIso(date, 1)) {
      const hasEntry = entries.has(date);
      if (isScheduledOn(habit, date)) {
        if (hasEntry) {
          completed += 1;
          total += 1;
        } else if (date < today) {
          total += 1;
        }
      } else if (hasEntry) {
        otherEntries += 1;
      }
    }
  }

  return { period: { kind, from, to: today }, scheduled: { completed, total }, otherEntries };
}
