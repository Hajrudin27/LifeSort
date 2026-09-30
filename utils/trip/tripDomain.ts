import { parseCalendarDate } from '@/utils/shared/localDate';

/**
 * The trip's own rules (APP-058), pure so they can be tested directly.
 *
 * Start and end are calendar dates, 'YYYY-MM-DD', checked by the repository's one
 * strict parser — never by `new Date('YYYY-MM-DD')`, which reads a date as UTC
 * midnight and lands on the previous day west of Greenwich. Nothing here repairs a
 * value: an impossible day, a timestamp or an unpadded date is refused.
 */

/** Matches the database CHECK on trips.destination. */
export const MAX_TRIP_DESTINATION_LENGTH = 200;

export type TripProblem =
  | 'destination-required'
  | 'destination-too-long'
  | 'invalid-start-date'
  | 'invalid-end-date'
  | 'end-before-start';

/** Trimmed text, or undefined when there is nothing left. Never invents a value. */
export function normalizeDestination(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** The first date rule a pair of dates breaks, or null. Same-day trips are valid. */
export function tripDateProblem(dates: { startDate: unknown; endDate: unknown }): TripProblem | null {
  if (parseCalendarDate(dates.startDate) === null) return 'invalid-start-date';
  if (parseCalendarDate(dates.endDate) === null) return 'invalid-end-date';
  // Two validated 'YYYY-MM-DD' strings order exactly as their calendar days do.
  return (dates.endDate as string) < (dates.startDate as string) ? 'end-before-start' : null;
}

/**
 * The first rule a trip breaks. A trip being created must name a destination.
 * A trip that already exists without one (it predates APP-058) may stay that way,
 * but once it has one, it cannot be blanked.
 */
export function tripProblem(
  fields: { destination?: unknown; startDate: unknown; endDate: unknown },
  options: { destinationRequired: boolean },
): TripProblem | null {
  const destination = normalizeDestination(fields.destination);
  if (destination === undefined && options.destinationRequired) return 'destination-required';
  if (destination !== undefined && destination.length > MAX_TRIP_DESTINATION_LENGTH) return 'destination-too-long';
  return tripDateProblem(fields);
}
