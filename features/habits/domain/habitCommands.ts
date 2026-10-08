import {
  decodeSchedule,
  decodeScheduleHistory,
  isHabitDirection,
  isIsoWeekday,
  schedulesEqual,
} from '@/core/habits/persistedHabit';
import type { Habit, HabitDirection, HabitSchedule, HabitSchedulePeriod } from '@/types/life';
import { addDaysIso, isoWeekday, parseCalendarDate } from '@/utils/shared/localDate';

/**
 * APP-064 — building and changing habits. Pure: each function takes the habit, the input and
 * `today` (the device-local calendar date, supplied by the caller) and returns a NEW canonical
 * habit, the SAME object when nothing would change, or throws one fixed `HabitError` code and
 * changes nothing. No store, no clock, no i18n.
 */
export type HabitErrorCode =
  | 'habit_title_invalid' | 'habit_direction_invalid' | 'habit_direction_locked'
  | 'habit_schedule_invalid' | 'habit_date_invalid' | 'habit_date_future' | 'habit_date_before_start'
  | 'habit_field_invalid';

/** Fixed codes only: never a title, id or date. */
export class HabitError extends Error {
  constructor(readonly code: HabitErrorCode) {
    super(code);
    this.name = 'HabitError';
  }
}

const fail = (code: HabitErrorCode): never => { throw new HabitError(code); };

const validToday = (today: string) => (parseCalendarDate(today) === null ? fail('habit_date_invalid') : today);

/**
 * User input → canonical schedule, or `habit_schedule_invalid`. Weekdays may arrive in any
 * order and are stored ascending; a duplicate, an empty list, a day outside 1–7 and an
 * unknown key are rejected. A weekly target outside 1–7 is rejected, never clamped.
 */
export function normalizeSchedule(input: unknown): HabitSchedule {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return fail('habit_schedule_invalid');
  const candidate = input as { kind?: unknown; days?: unknown };
  const ready = candidate.kind === 'weekdays' && Array.isArray(candidate.days) && candidate.days.every(isIsoWeekday)
    ? { ...candidate, days: [...(candidate.days as number[])].sort((a, b) => a - b) }
    : input;
  return decodeSchedule(ready) ?? fail('habit_schedule_invalid');
}

const cleanTitle = (value: unknown): string => {
  const title = typeof value === 'string' ? value.trim() : '';
  return title || fail('habit_title_invalid');
};

export interface NewHabitInput {
  title: string;
  direction: HabitDirection;
  schedule: HabitSchedule;
}

/**
 * A new habit counts from `today` — the device-local date at creation, not the UTC date of
 * `createdAt` — and starts with one schedule period effective from that same date.
 */
export function buildHabit(input: NewHabitInput, id: string, createdAt: string, today: string): Habit {
  if (typeof input !== 'object' || input === null ||
    Object.keys(input).some((key) => !['title', 'direction', 'schedule'].includes(key))) return fail('habit_field_invalid');
  const title = cleanTitle(input.title);
  if (!isHabitDirection(input.direction)) fail('habit_direction_invalid');
  const schedule = normalizeSchedule(input.schedule);
  const startDate = validToday(today);
  return { id, title, direction: input.direction, createdAt, startDate, scheduleHistory: [{ effectiveFrom: startDate, schedule }], logs: [] };
}

export interface HabitUpdate {
  title?: string;
  direction?: HabitDirection;
}

/**
 * Title is free to change. The direction can change only while the habit has no entries:
 * every entry means "kept the commitment", and flipping what the commitment is would
 * silently rewrite what each stored entry means.
 */
export function updateHabitFields(habit: Habit, update: HabitUpdate): Habit {
  if (typeof update !== 'object' || update === null ||
    Object.keys(update).some((key) => key !== 'title' && key !== 'direction')) return fail('habit_field_invalid');
  const title = update.title === undefined ? habit.title : cleanTitle(update.title);
  let direction = habit.direction;
  if (update.direction !== undefined) {
    if (!isHabitDirection(update.direction)) fail('habit_direction_invalid');
    if (update.direction !== habit.direction && habit.logs.length > 0) fail('habit_direction_locked');
    direction = update.direction;
  }
  return title === habit.title && direction === habit.direction ? habit : { ...habit, title, direction };
}

/**
 * When a schedule change takes effect.
 *
 *  - Neither the old nor the new schedule is weekly: today.
 *  - Either is weekly: the next ISO Monday, or today when today is Monday. A weekly target
 *    counts one whole ISO week, so changing it mid-week would make "2 of 3" mean two
 *    different things inside one week.
 *
 * `from` is the schedule in effect today.
 */
export function scheduleChangeEffectiveFrom(from: HabitSchedule, to: HabitSchedule, today: string): string {
  if (from.kind !== 'weekly' && to.kind !== 'weekly') return today;
  const weekday = isoWeekday(today);
  return weekday === 1 ? today : addDaysIso(today, 8 - weekday);
}

/**
 * Change the schedule going forward. Periods that have begun are never edited — except one
 * that began today, which is replaced (the user is correcting what they just set). A change
 * still waiting for Monday is superseded by the newest decision, and choosing what is
 * already in effect cancels it. Adjacent equal periods are never left behind.
 */
export function withSchedule(habit: Habit, schedule: unknown, today: string): Habit {
  const next = normalizeSchedule(schedule);
  // If the clock is earlier than the start date, the habit has not begun: treat "now" as its start.
  const now = validToday(today) < habit.startDate ? habit.startDate : today;
  const begun = habit.scheduleHistory.filter((period) => period.effectiveFrom <= now);
  const last = begun[begun.length - 1]; // never empty: the first period starts on the start date
  const current = last.schedule;

  let history: HabitSchedulePeriod[];
  if (schedulesEqual(current, next)) {
    history = begun; // nothing to change; this also cancels a change still waiting for Monday
  } else {
    const effectiveFrom = scheduleChangeEffectiveFrom(current, next, now);
    const kept = effectiveFrom === last.effectiveFrom ? begun.slice(0, -1) : begun; // replace a period that began today
    const previous = kept[kept.length - 1];
    history = previous && schedulesEqual(previous.schedule, next) ? kept : [...kept, { effectiveFrom, schedule: next }];
  }
  const unchanged = history.length === habit.scheduleHistory.length &&
    history.every((period, i) => period.effectiveFrom === habit.scheduleHistory[i].effectiveFrom &&
      schedulesEqual(period.schedule, habit.scheduleHistory[i].schedule));
  if (unchanged) return habit;
  return { ...habit, scheduleHistory: decodeScheduleHistory(history, habit.startDate) ?? fail('habit_schedule_invalid') };
}

/**
 * Mark or clear the completion of one local date. Idempotent: it states the wanted outcome,
 * not a flip, so replaying it is harmless and a double tap cannot undo itself.
 *
 *  - `completed: true` needs `startDate <= date <= today`. A future date is refused (nothing
 *    can have been kept yet); a date before the habit began is refused.
 *  - `completed: false` removes the entry for that date if there is one — including a future
 *    one that legacy, remote or backup data brought in — and is a no-op otherwise.
 */
export function withDateCompleted(
  habit: Habit, date: string, completed: boolean, today: string, makeId: () => string,
): Habit {
  if (parseCalendarDate(date) === null || parseCalendarDate(today) === null) return fail('habit_date_invalid');
  if (typeof completed !== 'boolean') return fail('habit_field_invalid');
  const existing = habit.logs.find((log) => log.date === date);
  if (!completed) return existing ? { ...habit, logs: habit.logs.filter((log) => log.date !== date) } : habit;
  if (date > today) return fail('habit_date_future');
  if (date < habit.startDate) return fail('habit_date_before_start');
  return existing ? habit : { ...habit, logs: [...habit.logs, { id: makeId(), date }] };
}
