import type {
  Habit,
  HabitDirection,
  HabitLog,
  HabitSchedule,
  HabitSchedulePeriod,
  IsoWeekday,
} from '@/types/life';
import { parseCalendarDate } from '@/utils/shared/localDate';

/**
 * APP-064 — the persisted Habit FORMAT, and nothing else.
 *
 * What a stored habit looks like (exact key sets, the three schedule shapes, the schedule
 * history invariants, one entry per local date), how a list of them is decoded strictly, and
 * the frozen mapping of the pre-APP-064 shape onto it. The local migration and the backup
 * parser — both core — must validate exactly what the store persists, so this is the
 * documented C2 exception for a persisted-format contract (like core/goals/persistedGoal,
 * core/home/moving; docs/core-contract.md). It depends only on shared entity types and the
 * calendar primitive.
 *
 * Deliberately NOT here: what a day's status is, which schedule applies, week facts, how a
 * schedule may be changed, input parsing, server-row mapping, display. Those are the Habits
 * module's rules and live in features/habits/domain, which imports from here: the dependency
 * points inward.
 *
 * Nothing in this file reads the clock. Whether a stored date is in the future is a question
 * about "today", and a decoder that answered it would reject the same bytes tomorrow that it
 * accepted today (or the reverse after a timezone change). A future-dated entry is preserved;
 * the rules decide how it is shown and that it may be cleared.
 */
export const HABIT_DIRECTIONS: readonly HabitDirection[] = Object.freeze(['build', 'quit']);
export const ISO_WEEKDAYS: readonly IsoWeekday[] = Object.freeze([1, 2, 3, 4, 5, 6, 7]);
export const MIN_WEEKLY_TARGET = 1;
export const MAX_WEEKLY_TARGET = 7;

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnly = (value: Json, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key));
const has = (value: Json, key: string) => Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined;
const nonEmptyText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

export const isIsoWeekday = (value: unknown): value is IsoWeekday =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7;
export const isWeeklyTarget = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= MIN_WEEKLY_TARGET && value <= MAX_WEEKLY_TARGET;
export const isHabitDirection = (value: unknown): value is HabitDirection =>
  typeof value === 'string' && (HABIT_DIRECTIONS as readonly string[]).includes(value);

// ---------- schedules ---------------------------------------------------------------------

/** Strict: exact key set per kind; weekdays non-empty, unique and ascending; weekly 1–7 integer. */
export function decodeSchedule(value: unknown): HabitSchedule | null {
  if (!record(value)) return null;
  if (value.kind === 'open') return hasOnly(value, ['kind']) ? { kind: 'open' } : null;
  if (value.kind === 'weekly') {
    if (!hasOnly(value, ['kind', 'target']) || !isWeeklyTarget(value.target)) return null;
    return { kind: 'weekly', target: value.target };
  }
  if (value.kind === 'weekdays') {
    if (!hasOnly(value, ['kind', 'days']) || !Array.isArray(value.days) || value.days.length === 0) return null;
    const days: IsoWeekday[] = [];
    for (const day of value.days) {
      if (!isIsoWeekday(day) || (days.length > 0 && day <= days[days.length - 1])) return null;
      days.push(day);
    }
    return { kind: 'weekdays', days };
  }
  return null;
}

export function schedulesEqual(a: HabitSchedule, b: HabitSchedule): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'weekly') return b.kind === 'weekly' && a.target === b.target;
  if (a.kind === 'weekdays') {
    return b.kind === 'weekdays' && a.days.length === b.days.length && a.days.every((day, i) => day === b.days[i]);
  }
  return true;
}

function decodeSchedulePeriod(value: unknown): HabitSchedulePeriod | null {
  if (!record(value) || !hasOnly(value, ['effectiveFrom', 'schedule'])) return null;
  if (parseCalendarDate(value.effectiveFrom) === null) return null;
  const schedule = decodeSchedule(value.schedule);
  return schedule ? { effectiveFrom: value.effectiveFrom as string, schedule } : null;
}

/**
 * At least one period, the first effective on the habit's start date, `effectiveFrom`
 * strictly increasing. There is deliberately no "not in the future" rule: a change that takes
 * effect next Monday is a period that has not started yet.
 */
export function decodeScheduleHistory(value: unknown, startDate: string): HabitSchedulePeriod[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: HabitSchedulePeriod[] = [];
  for (const entry of value) {
    const period = decodeSchedulePeriod(entry);
    if (!period) return null;
    if (out.length === 0 ? period.effectiveFrom !== startDate : period.effectiveFrom <= out[out.length - 1].effectiveFrom) return null;
    out.push(period);
  }
  return out;
}

// ---------- logs --------------------------------------------------------------------------

function decodeHabitLog(value: unknown): HabitLog | null {
  if (!record(value) || !hasOnly(value, ['id', 'date'])) return null;
  if (!nonEmptyText(value.id) || parseCalendarDate(value.date) === null) return null;
  return { id: value.id, date: value.date as string };
}

/**
 * All-or-nothing. Ids unique, and at most ONE entry per local date: a duplicate is rejected,
 * never merged, because which of two ids to keep is a guess. No entry may precede the start
 * date. A date after "today" is allowed (see the file comment).
 */
export function decodeHabitLogs(value: unknown, startDate: string): HabitLog[] | null {
  if (!Array.isArray(value)) return null;
  const out: HabitLog[] = [];
  const ids = new Set<string>();
  const dates = new Set<string>();
  for (const entry of value) {
    const log = decodeHabitLog(entry);
    if (!log || ids.has(log.id) || dates.has(log.date) || log.date < startDate) return null;
    ids.add(log.id);
    dates.add(log.date);
    out.push(log);
  }
  return out;
}

// ---------- habits ------------------------------------------------------------------------

const HABIT_KEYS = ['id', 'title', 'direction', 'createdAt', 'startDate', 'scheduleHistory', 'logs'] as const;

/** Strict canonical decode: exact key set, fresh object out. */
export function decodeHabit(value: unknown): Habit | null {
  if (!record(value) || !hasOnly(value, HABIT_KEYS) || !HABIT_KEYS.every((key) => has(value, key))) return null;
  if (!nonEmptyText(value.id) || !nonEmptyText(value.title) || !isHabitDirection(value.direction)) return null;
  if (!instant(value.createdAt) || parseCalendarDate(value.startDate) === null) return null;
  const startDate = value.startDate as string;
  const scheduleHistory = decodeScheduleHistory(value.scheduleHistory, startDate);
  const logs = decodeHabitLogs(value.logs, startDate);
  if (!scheduleHistory || !logs) return null;
  return {
    id: value.id, title: value.title, direction: value.direction,
    createdAt: value.createdAt, startDate, scheduleHistory, logs,
  };
}

export function decodeHabits(value: unknown): Habit[] | null {
  if (!Array.isArray(value)) return null;
  const out: Habit[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const habit = decodeHabit(entry);
    if (!habit || seen.has(habit.id)) return null;
    seen.add(habit.id);
    out.push(habit);
  }
  return out;
}

// ---------- the pre-APP-064 shape ---------------------------------------------------------

/**
 * `targetPerWeek` of the old shape, as a schedule. Absent or null is `open`; an integer 1–7
 * is `weekly`; any OTHER number (0, negative, above 7, fractional, NaN) is `open` — a lossy
 * repair that is documented, never clamped, and never turned into weekdays the user did not
 * choose. A value that is not a number at all is malformed (`null`), not repaired.
 */
export function legacySchedule(target: unknown): HabitSchedule | null {
  if (target === undefined || target === null) return { kind: 'open' };
  if (typeof target !== 'number') return null;
  return isWeeklyTarget(target) ? { kind: 'weekly', target } : { kind: 'open' };
}

/**
 * The first date a legacy habit can be said to count from: the civil date written at the head
 * of `createdAt`, or an earlier logged date. Stored dates are NEVER moved or repaired — a
 * pre-dd16507 week-row entry stored a day early in timezones east of UTC stays where it is.
 */
export function legacyStartDate(createdAt: string, logDates: readonly string[]): string | null {
  const created = createdAt.slice(0, 10);
  if (parseCalendarDate(created) === null) return null;
  return logDates.reduce((earliest, date) => (date < earliest ? date : earliest), created);
}

const LEGACY_KEYS = ['id', 'title', 'direction', 'targetPerWeek', 'logs', 'createdAt'] as const;

/**
 * `{ id, title, direction, targetPerWeek?, logs, createdAt }` → canonical. Id, title,
 * direction, createdAt and every log id/date are kept verbatim. A log is read as "the
 * commitment was kept on that date" for both directions (ADR-0052); nothing is inferred from
 * the title. A malformed row, an unknown field, a non-calendar log date or a duplicate date
 * returns null, so the caller fails closed and the original bytes stay untouched.
 */
export function decodeLegacyHabit(value: unknown): Habit | null {
  if (!record(value) || !hasOnly(value, LEGACY_KEYS)) return null;
  if (!instant(value.createdAt) || !Array.isArray(value.logs)) return null;
  const schedule = legacySchedule(value.targetPerWeek);
  if (!schedule) return null;
  const rawLogs = value.logs as unknown[];
  const logDates = rawLogs.map((log) => (record(log) && parseCalendarDate(log.date) !== null ? (log.date as string) : ''));
  if (logDates.includes('')) return null;
  const startDate = legacyStartDate(value.createdAt, logDates);
  if (!startDate) return null;
  return decodeHabit({
    id: value.id, title: value.title, direction: value.direction, createdAt: value.createdAt,
    startDate, scheduleHistory: [{ effectiveFrom: startDate, schedule }], logs: rawLogs,
  });
}

export function decodeLegacyHabits(value: unknown): Habit[] | null {
  if (!Array.isArray(value)) return null;
  const out: Habit[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const habit = decodeLegacyHabit(entry);
    if (!habit || seen.has(habit.id)) return null;
    seen.add(habit.id);
    out.push(habit);
  }
  return out;
}
