import type { Habit, HabitSchedule, HabitSchedulePeriod, IsoWeekday } from '@/types/life';
import { addDaysIso, isoWeekday, startOfIsoWeek } from '@/utils/shared/localDate';

/**
 * APP-064 — what a habit's days and weeks MEAN. Pure functions of (habit, date, today): no
 * clock, no store, no i18n. The caller passes `today` (the device-local calendar date) so the
 * same inputs always give the same answer and a test never needs fake timers.
 *
 * A log is the user saying "I kept the commitment on this date", for both directions. The
 * absence of a log is never a success, and it is a MISS only in one narrow case: a day that is
 * strictly before today, was scheduled by a `weekdays` schedule in effect on that day, and has
 * no entry. Nothing here is stored; a miss is derived every time and can never contradict the
 * history it comes from.
 */
export type HabitDayStatus =
  /** After today. Cannot be completed (a legacy future entry is still listed, see `hasEntryOn`). */
  | 'future'
  /** Before the habit's start date. */
  | 'before-start'
  /** An entry exists. */
  | 'completed'
  /** A scheduled weekday, strictly before today, no entry. */
  | 'missed'
  /** A scheduled weekday that is today, no entry yet. Today is never a miss. */
  | 'pending'
  /** Nothing was expected: an unscheduled weekday, a weekly target or an open habit. */
  | 'optional';

/** The schedule in effect on `date`: the latest period starting on or before it. Null before the start date. */
export function scheduleOn(habit: Habit, date: string): HabitSchedule | null {
  let found: HabitSchedule | null = null;
  for (const period of habit.scheduleHistory) {
    if (period.effectiveFrom > date) break;
    found = period.schedule;
  }
  return found;
}

/** For display only: before the start date this is the first schedule rather than none. */
export function scheduleForDisplay(habit: Habit, today: string): HabitSchedule {
  return scheduleOn(habit, today) ?? habit.scheduleHistory[0].schedule;
}

/** The next change that has not taken effect yet (a weekly change waiting for Monday), if any. */
export function pendingSchedulePeriod(habit: Habit, today: string): HabitSchedulePeriod | null {
  return habit.scheduleHistory.find((period) => period.effectiveFrom > today) ?? null;
}

/** True when a `weekdays` schedule is in effect on `date` and lists that date's ISO weekday. */
export function isScheduledOn(habit: Habit, date: string): boolean {
  const schedule = scheduleOn(habit, date);
  return schedule?.kind === 'weekdays' && schedule.days.includes(isoWeekday(date) as IsoWeekday);
}

export function hasEntryOn(habit: Habit, date: string): boolean {
  return habit.logs.some((log) => log.date === date);
}

export function habitDayStatus(habit: Habit, date: string, today: string): HabitDayStatus {
  if (date > today) return 'future';
  if (date < habit.startDate) return 'before-start';
  if (hasEntryOn(habit, date)) return 'completed';
  if (isScheduledOn(habit, date)) return date < today ? 'missed' : 'pending';
  return 'optional';
}

// ---------- week facts ---------------------------------------------------------------------

export type HabitWeekFacts =
  /** `scheduled` counts the scheduled days of the whole ISO week from the start date onward. */
  | { kind: 'weekdays'; scheduled: number; completedScheduled: number; completedOther: number }
  | { kind: 'weekly'; target: number; completed: number }
  | { kind: 'open'; completed: number };

function entriesBetween(habit: Habit, from: string, to: string): number {
  return habit.logs.filter((log) => log.date >= from && log.date <= to).length;
}

/**
 * What happened in the ISO week (Monday–Sunday) that contains `today`. A neutral count, never
 * a verdict. Entries after `today` (a legacy future date) are not counted. Days before the
 * start date are not part of the week for this habit.
 *
 * Which kind of fact is shown follows the schedule in effect TODAY. A weekly change only ever
 * takes effect on a Monday (habitCommands), so within one ISO week the habit is either weekly
 * for the whole week or not weekly at all.
 */
export function habitWeekFacts(habit: Habit, today: string): HabitWeekFacts | null {
  if (today < habit.startDate) return null;
  const schedule = scheduleOn(habit, today);
  if (!schedule) return null;
  const weekStart = startOfIsoWeek(today);
  const from = weekStart > habit.startDate ? weekStart : habit.startDate;

  if (schedule.kind === 'weekly') return { kind: 'weekly', target: schedule.target, completed: entriesBetween(habit, from, today) };
  if (schedule.kind === 'open') return { kind: 'open', completed: entriesBetween(habit, from, today) };

  let scheduled = 0;
  let completedScheduled = 0;
  for (let date = from, last = addDaysIso(weekStart, 6); date <= last; date = addDaysIso(date, 1)) {
    if (!isScheduledOn(habit, date)) continue;
    scheduled += 1;
    if (date <= today && hasEntryOn(habit, date)) completedScheduled += 1;
  }
  const completed = entriesBetween(habit, from, today);
  return { kind: 'weekdays', scheduled, completedScheduled, completedOther: completed - completedScheduled };
}

/** Entries from the start of the ISO week of `today` through `today`, across the given habits. */
export function weekEntryCount(habits: readonly Habit[], today: string): number {
  const weekStart = startOfIsoWeek(today);
  return habits.reduce((sum, habit) => sum + entriesBetween(habit, weekStart > habit.startDate ? weekStart : habit.startDate, today), 0);
}

// ---------- today -------------------------------------------------------------------------

export interface HabitTodaySummary {
  /** Habits a `weekdays` schedule asks for today. */
  scheduled: number;
  /** Of those, the ones with an entry today. */
  completed: number;
}

export function scheduledTodaySummary(habits: readonly Habit[], today: string): HabitTodaySummary {
  const scheduled = habits.filter((habit) => today >= habit.startDate && isScheduledOn(habit, today));
  return { scheduled: scheduled.length, completed: scheduled.filter((habit) => hasEntryOn(habit, today)).length };
}

/**
 * Every scheduled day from each habit's start date up to and including `today` that has an
 * outcome: an entry (completed) or none on a day strictly before today (missed). Today without
 * an entry is still open and is not reported. Consumers that want a per-day picture (the cycle
 * insights) take this plain list and never see the schedule model.
 */
export function scheduledDayOutcomes(habits: readonly Habit[], today: string): { date: string; completed: boolean }[] {
  const out: { date: string; completed: boolean }[] = [];
  for (const habit of habits) {
    const entries = new Set(habit.logs.map((log) => log.date));
    // Same definition as habitDayStatus ('completed' on a scheduled day, or 'missed'), without rescanning the logs per day.
    for (let date = habit.startDate; date <= today; date = addDaysIso(date, 1)) {
      if (!isScheduledOn(habit, date)) continue;
      if (entries.has(date)) out.push({ date, completed: true });
      else if (date < today) out.push({ date, completed: false });
    }
  }
  return out;
}
