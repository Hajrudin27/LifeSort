/**
 * APP-042: the recurrence contract for manual Economy costs.
 *
 * One declaration of what "recurring" means — the frequencies, the coherence
 * rule, the day anchor and the calendar arithmetic — so the store, the local
 * migration, the server boundary, the backup parser, the screens and the future
 * bank recurring-candidate boundary cannot drift apart.
 *
 * Only whole-month cadences are supported. LifeSort materializes at most one
 * instance of a series per month (see `store/useExpensesStore.ts`), so a weekly
 * cadence would be a different scheduling model and is deliberately out of scope.
 */

export const RECURRENCE_FREQUENCIES = ['monthly', 'quarterly', 'yearly'] as const;

export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** The cadence in whole calendar months. Never approximated in days. */
export const RECURRENCE_INTERVAL_MONTHS: Readonly<Record<RecurrenceFrequency, number>> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/** Historical LifeSort recurrence was monthly; migrated data and new toggles use it. */
export const DEFAULT_RECURRENCE_FREQUENCY: RecurrenceFrequency = 'monthly';

export function isRecurrenceFrequency(value: unknown): value is RecurrenceFrequency {
  return typeof value === 'string' && (RECURRENCE_FREQUENCIES as readonly string[]).includes(value);
}

/**
 * The day of the month the user's schedule is anchored to, 1–31. Internal
 * schedule metadata derived from the payment date the user picked — never a
 * separate form field.
 */
export function isRecurrenceAnchorDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31;
}

/**
 * The one invariant: a one-time cost has no frequency and no anchor, and a
 * recurring cost has exactly one supported frequency and a 1–31 anchor day. No
 * other combination may enter app state, persisted state, a backup or the server.
 */
export function isCoherentRecurrence(isRecurring: unknown, frequency: unknown, anchorDay: unknown): boolean {
  if (isRecurring === false) {
    return (frequency === null || frequency === undefined) && (anchorDay === null || anchorDay === undefined);
  }
  if (isRecurring === true) return isRecurrenceFrequency(frequency) && isRecurrenceAnchorDay(anchorDay);
  return false;
}

export class RecurrenceError extends Error {
  constructor(readonly code: 'recurrence_incoherent') {
    super(code);
    this.name = 'RecurrenceError';
  }
}

export type RecurrenceState = {
  readonly recurrenceFrequency: RecurrenceFrequency | null;
  readonly recurrenceAnchorDay: number | null;
};

/** Validating constructor for the whole triple. Fails closed; never guesses. */
export function coherentRecurrence(
  isRecurring: boolean,
  frequency: RecurrenceFrequency | null | undefined,
  anchorDay: number | null | undefined,
): RecurrenceState {
  if (!isCoherentRecurrence(isRecurring, frequency ?? null, anchorDay ?? null)) {
    throw new RecurrenceError('recurrence_incoherent');
  }
  return isRecurring
    ? { recurrenceFrequency: frequency as RecurrenceFrequency, recurrenceAnchorDay: anchorDay as number }
    : { recurrenceFrequency: null, recurrenceAnchorDay: null };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const pad = (value: number) => String(value).padStart(2, '0');

/** Days in a calendar month (1-indexed), leap years included. UTC keeps it device-independent. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

type DateParts = { year: number; month: number; day: number };

/** Strict ISO yyyy-mm-dd, rejecting dates the calendar does not have (2027-02-30). */
export function parseIsoDate(value: unknown): DateParts | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/**
 * The anchor day of a real calendar date. This is the ONLY helper current
 * application writes may use: a date the app is storing now must exist, so
 * "2026-02-31" has no anchor and the caller fails closed.
 */
export function anchorDayFromIsoDate(value: unknown): number | null {
  return parseIsoDate(value)?.day ?? null;
}

/**
 * LEGACY REPAIR ONLY — not for current writes; use `anchorDayFromIsoDate`.
 *
 * The day token of a written date, 1–31, even when that day does not exist in
 * that month. Pre-APP-042 `rollForwardMonth` concatenated the previous day
 * number onto a new month without checking the calendar, so stored strings like
 * "2026-02-31" exist on devices and in old backups; the token is still the day
 * the user intended. Only the local v1 → v2 migration and pre-format-3 backup
 * normalization read dates this permissively, through `repairLegacyOccurrenceDate`.
 */
export function anchorDayFromDateText(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || !isRecurrenceAnchorDay(day)) return null;
  return day;
}

/**
 * A stored occurrence date, repaired if it is the known legacy defect: a valid
 * year and month with a day token of 1–31 that the month does not have. The date
 * is clamped to that same month's last day, and the intended day survives as the
 * anchor. Anything else — a bad month, a day of 0 or 32, a non-date — returns
 * null so callers fail closed.
 */
export function repairLegacyOccurrenceDate(value: unknown): { date: string; anchorDay: number } | null {
  const anchorDay = anchorDayFromDateText(value);
  if (anchorDay === null) return null;
  const match = ISO_DATE.exec(value as string)!;
  const [year, month] = [Number(match[1]), Number(match[2])];
  const day = Math.min(anchorDay, daysInMonth(year, month));
  return { date: `${match[1]}-${match[2]}-${pad(day)}`, anchorDay };
}

function parseMonthKey(value: string): { year: number; month: number } | null {
  const match = MONTH_KEY.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year: Number(match[1]), month } : null;
}

const monthIndex = (year: number, month: number) => year * 12 + (month - 1);

/**
 * The occurrence date in `targetMonthKey` for a series whose latest occurrence is
 * `baseDate` and whose schedule is anchored to `anchorDay`, or null when that
 * month is not due.
 *
 * Due months are whole calendar-month multiples of the cadence after the base
 * month: monthly every month, quarterly every third, yearly every twelfth. A
 * month that is not a multiple produces nothing, and the past is never generated.
 *
 * THE DAY IS ALWAYS `min(anchorDay, last day of the target month)`. Clamping
 * applies to one occurrence only and never changes the anchor, so a schedule on
 * the 30th survives February: 30 Jan → 28 Feb → 30 Mar. There is no separate
 * "last day of month" recurrence mode: an occurrence that happens to fall on the
 * last day of a short month is not evidence of one. The result is always a real
 * calendar date.
 */
export function occurrenceDateForMonth(
  baseDate: string,
  frequency: RecurrenceFrequency,
  anchorDay: number,
  targetMonthKey: string,
): string | null {
  const base = parseIsoDate(baseDate);
  const target = parseMonthKey(targetMonthKey);
  if (!base || !target || !isRecurrenceAnchorDay(anchorDay)) return null;

  const distance = monthIndex(target.year, target.month) - monthIndex(base.year, base.month);
  if (distance <= 0) return null;
  if (distance % RECURRENCE_INTERVAL_MONTHS[frequency] !== 0) return null;

  const day = Math.min(anchorDay, daysInMonth(target.year, target.month));
  return `${targetMonthKey}-${pad(day)}`;
}
