import { newEntityId } from '@/core/ids';
import {
  MAX_TRIP_DESTINATION_LENGTH,
  normalizeDestination,
  tripDateProblem,
  tripProblem,
} from '@/utils/trip/tripDomain';

/**
 * APP-058 — the trip's own rules. Dates are calendar dates checked by the strict
 * parser, never by `new Date('YYYY-MM-DD')`; nothing is repaired; a same-day trip is
 * a trip; a trip that predates destinations stays valid without one.
 */

describe('APP-058 destination', () => {
  it('trims, and treats blank or non-text as not set — never invents a value', () => {
    expect(normalizeDestination('  Rome  ')).toBe('Rome');
    expect(normalizeDestination('   ')).toBeUndefined();
    expect(normalizeDestination('')).toBeUndefined();
    expect(normalizeDestination(undefined)).toBeUndefined();
    expect(normalizeDestination(null)).toBeUndefined();
    expect(normalizeDestination(42)).toBeUndefined();
  });

  it('is required for a trip being created, and its length matches the database check', () => {
    const dates = { startDate: '2027-05-01', endDate: '2027-05-08' };
    expect(tripProblem({ ...dates, destination: '' }, { destinationRequired: true })).toBe('destination-required');
    expect(tripProblem({ ...dates, destination: '   ' }, { destinationRequired: true })).toBe('destination-required');
    expect(tripProblem({ ...dates }, { destinationRequired: true })).toBe('destination-required');
    expect(tripProblem({ ...dates, destination: 'Rome' }, { destinationRequired: true })).toBeNull();
    expect(tripProblem({ ...dates, destination: 'x'.repeat(MAX_TRIP_DESTINATION_LENGTH) }, { destinationRequired: true })).toBeNull();
    expect(tripProblem({ ...dates, destination: 'x'.repeat(MAX_TRIP_DESTINATION_LENGTH + 1) }, { destinationRequired: true })).toBe('destination-too-long');
  });

  it('is optional for a trip that already exists without one', () => {
    const dates = { startDate: '2026-07-01', endDate: '2026-07-01' };
    expect(tripProblem({ ...dates }, { destinationRequired: false })).toBeNull();
    expect(tripProblem({ ...dates, destination: '  ' }, { destinationRequired: false })).toBeNull();
  });
});

describe('APP-058 strict calendar dates', () => {
  it('accepts an ordered pair, a same-day trip and a leap day', () => {
    expect(tripDateProblem({ startDate: '2027-05-01', endDate: '2027-05-08' })).toBeNull();
    expect(tripDateProblem({ startDate: '2027-05-01', endDate: '2027-05-01' })).toBeNull();
    expect(tripDateProblem({ startDate: '2028-02-29', endDate: '2028-02-29' })).toBeNull();
    expect(tripDateProblem({ startDate: '2027-12-30', endDate: '2028-01-02' })).toBeNull();
  });

  it('refuses an end before the start, by a day or across a year', () => {
    expect(tripDateProblem({ startDate: '2027-05-02', endDate: '2027-05-01' })).toBe('end-before-start');
    expect(tripDateProblem({ startDate: '2028-01-01', endDate: '2027-12-31' })).toBe('end-before-start');
  });

  it.each([
    ['2027-02-29', 'not a leap year'],
    ['2027-04-31', 'no such day'],
    ['2027-13-01', 'no such month'],
    ['2027-5-1', 'not zero-padded'],
    ['2027-05-01T00:00:00.000Z', 'a timestamp, not a calendar date'],
    ['', 'empty'],
  ])('refuses %s (%s) as either date, without repairing it', (value: string, _reason: string) => {
    expect(tripDateProblem({ startDate: value, endDate: '2029-01-01' })).toBe('invalid-start-date');
    expect(tripDateProblem({ startDate: '2027-01-01', endDate: value })).toBe('invalid-end-date');
  });

  it('refuses non-strings rather than coercing them', () => {
    expect(tripDateProblem({ startDate: new Date(2027, 4, 1), endDate: '2027-05-08' })).toBe('invalid-start-date');
    expect(tripDateProblem({ startDate: '2027-05-01', endDate: 20270508 })).toBe('invalid-end-date');
    expect(tripDateProblem({ startDate: null, endDate: undefined })).toBe('invalid-start-date');
  });

  it('does not depend on the host timezone', () => {
    // The same answer at a Copenhagen DST edge as anywhere: no Date object is built.
    expect(tripDateProblem({ startDate: '2027-03-28', endDate: '2027-03-28' })).toBeNull();
    expect(tripDateProblem({ startDate: '2026-10-25', endDate: '2026-10-24' })).toBe('end-before-start');
  });
});

describe('APP-058 identifiers', () => {
  it('new trip ids are crypto UUIDs, distinct within one tick', () => {
    const ids = Array.from({ length: 50 }, () => newEntityId());
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(new Set(ids).size).toBe(ids.length);
  });
  // Legacy timestamp-shaped ids staying opaque and editable is proved where it matters,
  // in tripStore.test.ts: a '1693000000000-abc' trip hydrates, updates and deletes.
});
