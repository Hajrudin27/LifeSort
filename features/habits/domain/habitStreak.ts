import type { Habit } from '@/types/life';
import { addDaysIso } from '@/utils/shared/localDate';

import { isScheduledOn } from './habitStatus';

/**
 * APP-065 — the optional streak. Pure: `today` is passed in, nothing reads the clock, a store
 * or i18n, and nothing here is ever stored. The number is recomputed from the habit's own
 * history every time, so a correction to a past day can never contradict it.
 *
 * A streak is the number of consecutive SCHEDULED COMMITMENTS kept inside the current
 * contiguous weekday-schedule regime. It is not consecutive calendar days: an unscheduled day
 * neither counts nor breaks. A log means the commitment was kept, in both directions, so build
 * and quit use exactly the same arithmetic.
 *
 * - Only a `weekdays` schedule is eligible. `weekly` and `open` habits have no streak.
 * - A `weekly` or `open` period is a hard boundary: a streak never bridges across one, so
 *   weekdays → open → weekdays starts a new run at the second weekdays period. Consecutive
 *   `weekdays` periods (a changed day list) are the same regime and the run continues.
 * - Today without an entry is pending: it neither adds nor breaks, so the number does not
 *   fall to zero at midnight.
 * - The only thing that ends a run is a scheduled day strictly before today, inside the
 *   regime, with no entry. Future dates, dates before the start date and entries on
 *   unscheduled days never take part.
 * - Current only. There is no best or longest streak.
 */
export type HabitStreak = { kind: 'ineligible' } | { kind: 'current'; count: number };

/** First date of the contiguous run of `weekdays` periods that ends with the period in effect on `today`, or null when that period is not `weekdays`. */
function weekdayRegimeStart(habit: Habit, today: string): string | null {
  const { scheduleHistory } = habit;
  // The period in effect today; before the start date the first period is the one that will apply.
  let index = 0;
  while (index + 1 < scheduleHistory.length && scheduleHistory[index + 1].effectiveFrom <= today) index += 1;
  if (scheduleHistory[index].schedule.kind !== 'weekdays') return null;
  while (index > 0 && scheduleHistory[index - 1].schedule.kind === 'weekdays') index -= 1;
  return scheduleHistory[index].effectiveFrom;
}

export function habitStreak(habit: Habit, today: string): HabitStreak {
  const regimeStart = weekdayRegimeStart(habit, today);
  if (regimeStart === null) return { kind: 'ineligible' };

  const floor = regimeStart > habit.startDate ? regimeStart : habit.startDate;
  const entries = new Set(habit.logs.map((log) => log.date));
  let count = 0;
  // Newest to oldest, stopping at the first scheduled miss: an old habit with a recent gap is cheap.
  for (let date = today; date >= floor; date = addDaysIso(date, -1)) {
    if (!isScheduledOn(habit, date)) continue;
    if (entries.has(date)) count += 1;
    else if (date < today) break;
  }
  return { kind: 'current', count };
}
