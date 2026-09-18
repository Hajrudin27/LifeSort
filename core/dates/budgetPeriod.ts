import { addDaysIso, parseCalendarDate } from '@/utils/shared/localDate';

/**
 * APP-045: which budget period an instant or a recorded date belongs to.
 *
 * Budget periods, the calendar day, month and ISO week that Home, Economy and
 * Food call "current", are Europe/Copenhagen calendar periods, whatever the
 * device's timezone (ADR-0037). An absolute instant is first converted to its
 * Copenhagen calendar date. A date-only value already is a calendar date and is
 * taken literally, never moved through UTC.
 *
 * The runtime's IANA time-zone data (iOS, Android and browser tz databases, via
 * Intl) owns Copenhagen's offsets and summer time. LifeSort owns only the choice
 * of zone and the calendar and ISO-week arithmetic once the date is known.
 *
 * Deterministic: no clock, store, storage or network. A screen passes
 * `new Date()`. Nothing here reads the device's timezone, so it cannot change
 * the answer.
 */

/** The IANA zone that defines every budget period (ADR-0037). */
export const BUDGET_TIME_ZONE = 'Europe/Copenhagen';

export type BudgetPeriod = {
  /** The Copenhagen calendar date, YYYY-MM-DD. */
  readonly dateKey: string;
  /** Its calendar month, YYYY-MM. */
  readonly monthKey: string;
  /** Its ISO 8601 week, YYYY-Www, where YYYY is the ISO week-year. */
  readonly weekKey: string;
};

/** Fixed, value-free codes. */
export class BudgetPeriodError extends Error {
  constructor(
    readonly code:
      | 'budget_period_invalid_instant'
      | 'budget_period_invalid_month'
      // The runtime could not give a Europe/Copenhagen calendar date. Never
      // replaced by the device's own timezone.
      | 'budget_period_time_zone_unavailable',
  ) {
    super(code);
    this.name = 'BudgetPeriodError';
  }
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const pad2 = (value: number) => String(value).padStart(2, '0');
const pad4 = (value: number) => String(value).padStart(4, '0');

/** Days since 1970-01-01 of a calendar date. setUTCFullYear keeps years below 100 literal. */
function epochDay(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime() / MS_PER_DAY;
}

type CopenhagenCalendar = { readonly year: Intl.DateTimeFormat; readonly month: Intl.DateTimeFormat; readonly day: Intl.DateTimeFormat };
let copenhagenCalendar: CopenhagenCalendar | null = null;

/**
 * One formatter per calendar field, each asking the runtime for the literal IANA
 * zone. Only `format` and `resolvedOptions` are used: Hermes supports both on
 * iOS and Android, but not `formatToParts`. 'en-US' writes Latin digits without
 * the `numberingSystem` option, which Hermes on iOS lacks, and keeps the
 * Gregorian calendar whatever the device's calendar setting is.
 */
function copenhagenFormatters(): CopenhagenCalendar {
  if (copenhagenCalendar) return copenhagenCalendar;
  let formatters: CopenhagenCalendar;
  try {
    const field = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en-US', { ...options, timeZone: BUDGET_TIME_ZONE });
    formatters = { year: field({ year: 'numeric' }), month: field({ month: '2-digit' }), day: field({ day: '2-digit' }) };
  } catch {
    // An engine without this zone throws RangeError; answer with a fixed code.
    throw new BudgetPeriodError('budget_period_time_zone_unavailable');
  }
  // An engine that silently used another zone would be worse than one that failed.
  if (Object.values(formatters).some((formatter) => formatter.resolvedOptions().timeZone !== BUDGET_TIME_ZONE)) {
    throw new BudgetPeriodError('budget_period_time_zone_unavailable');
  }
  copenhagenCalendar = formatters;
  return formatters;
}

function calendarNumber(formatter: Intl.DateTimeFormat, instant: Date): number {
  // Strip direction marks some platforms add; what remains must be digits.
  const text = formatter.format(instant).replace(/[‎‏؜\s]/g, '');
  if (!/^\d+$/.test(text)) throw new BudgetPeriodError('budget_period_time_zone_unavailable');
  return Number(text);
}

// Intl is far costlier than arithmetic, and Food places every purchase on each
// render, so recent answers are kept. A pure function's results, bounded in size.
const MEMO_LIMIT = 4096;
const periodByInstant = new Map<number, BudgetPeriod>();

/** Monday 1 … Sunday 7. 1970-01-01 was a Thursday. */
function isoWeekdayOfEpochDay(day: number): number {
  return ((((day + 3) % 7) + 7) % 7) + 1;
}

/**
 * ISO 8601: weeks start on Monday, and a week belongs to the year of its
 * Thursday. So 1 January can be in week 52 or 53 of the year before, and
 * 29–31 December in week 1 of the year after.
 */
function isoWeekKey(year: number, month: number, day: number): string {
  const dayNumber = epochDay(year, month, day);
  const thursday = dayNumber + 4 - isoWeekdayOfEpochDay(dayNumber);
  const weekYear = new Date(thursday * MS_PER_DAY).getUTCFullYear();
  const week = Math.floor((thursday - epochDay(weekYear, 1, 1)) / 7) + 1;
  return `${pad4(weekYear)}-W${pad2(week)}`;
}

function periodOf(year: number, month: number, day: number): BudgetPeriod {
  const monthKey = `${pad4(year)}-${pad2(month)}`;
  return { dateKey: `${monthKey}-${pad2(day)}`, monthKey, weekKey: isoWeekKey(year, month, day) };
}

/** The Europe/Copenhagen calendar period of an absolute instant, from the runtime's IANA data. */
export function budgetPeriodForInstant(instant: Date): BudgetPeriod {
  const epochMs = instant.getTime();
  if (!Number.isFinite(epochMs)) throw new BudgetPeriodError('budget_period_invalid_instant');
  const known = periodByInstant.get(epochMs);
  if (known) return known;

  const calendar = copenhagenFormatters();
  const [year, month, day] = [calendarNumber(calendar.year, instant), calendarNumber(calendar.month, instant), calendarNumber(calendar.day, instant)];
  if (!parseCalendarDate(`${pad4(year)}-${pad2(month)}-${pad2(day)}`)) {
    throw new BudgetPeriodError('budget_period_time_zone_unavailable');
  }

  const period = periodOf(year, month, day);
  if (periodByInstant.size >= MEMO_LIMIT) periodByInstant.clear();
  periodByInstant.set(epochMs, period);
  return period;
}

/** The period of a calendar date, YYYY-MM-DD, taken literally; null when it is not a real date. */
export function budgetPeriodForCalendarDate(dateKey: unknown): BudgetPeriod | null {
  const date = parseCalendarDate(dateKey);
  return date ? periodOf(date.year, date.month, date.day) : null;
}

// An instant must say which instant it is: Z or an explicit ±HH[:MM] offset.
const INSTANT = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:([Zz])|([+-])(\d{2})(?::?(\d{2}))?)$/;

/**
 * The period of a stored record date. Two contracts are recognised, and nothing
 * is guessed in between:
 *
 *  - a date-only `YYYY-MM-DD` is a calendar date and keeps that exact date;
 *  - a timestamp with `Z` or an offset (what `toISOString()` writes and what
 *    PostgreSQL returns for `timestamptz`) is an instant, placed in Copenhagen.
 *
 * Anything else, including a local date-time without an offset, returns null.
 */
export function budgetPeriodForRecordedDate(value: unknown): BudgetPeriod | null {
  if (typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return budgetPeriodForCalendarDate(value);

  const match = INSTANT.exec(value);
  if (!match) return null;
  const [, datePart, hours, minutes, seconds = '0', fraction = '', zulu, sign, offsetHours = '0', offsetMinutes = '0'] = match;
  const date = parseCalendarDate(datePart);
  const [hour, minute, second] = [Number(hours), Number(minutes), Number(seconds)];
  if (!date || hour > 23 || minute > 59 || second > 59) return null;
  if (Number(offsetHours) > 23 || Number(offsetMinutes) > 59) return null;

  const offset = zulu ? 0 : (sign === '-' ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes));
  const wallClock = new Date(0);
  wallClock.setUTCFullYear(date.year, date.month - 1, date.day);
  wallClock.setUTCHours(hour, minute, second, Number(fraction.slice(0, 3).padEnd(3, '0')));
  return budgetPeriodForInstant(new Date(wallClock.getTime() - offset * MS_PER_MINUTE));
}

/**
 * The ISO weeks that touch a calendar month, in order, derived from the month's
 * calendar dates. Food divides a monthly budget by this count.
 */
export function isoWeeksInMonth(monthKey: string): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  const [year, month] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
  if (!match || month < 1 || month > 12) throw new BudgetPeriodError('budget_period_invalid_month');

  const lastDay = epochDay(year, month + 1, 1) - epochDay(year, month, 1);
  const weeks: string[] = [];
  for (let day = 1; day <= lastDay; day++) {
    const week = isoWeekKey(year, month, day);
    if (weeks[weeks.length - 1] !== week) weeks.push(week);
  }
  return weeks;
}

/** A month key shifted by whole calendar months: ('2026-01', -1) → '2025-12'. */
export function addMonthsToMonthKey(monthKey: string, months: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  const [year, month] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
  if (!match || month < 1 || month > 12 || !Number.isSafeInteger(months)) {
    throw new BudgetPeriodError('budget_period_invalid_month');
  }
  const index = year * 12 + (month - 1) + months;
  return `${pad4(Math.floor(index / 12))}-${pad2((((index % 12) + 12) % 12) + 1)}`;
}

/** The period `days` calendar days from a period's date (negative goes back). */
export function budgetPeriodDaysFrom(period: BudgetPeriod, days: number): BudgetPeriod {
  return budgetPeriodForCalendarDate(addDaysIso(period.dateKey, days))!;
}

/** Monday 1 … Sunday 7 of a period's date. */
export function isoWeekdayOf(period: BudgetPeriod): number {
  const [year, month, day] = period.dateKey.split('-').map(Number);
  return isoWeekdayOfEpochDay(epochDay(year, month, day));
}
