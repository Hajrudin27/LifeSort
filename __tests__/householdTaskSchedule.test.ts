import type { HouseholdTask } from '@/types/household';
import {
  calendarDateForTask,
  daysUntilDue,
  nextHouseholdTaskDueOn,
  resolvedDeviceTimeZone,
} from '@/utils/household/householdTaskSchedule';

const task = (overrides: Partial<HouseholdTask> = {}): HouseholdTask => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'cleaning',
  title: 'Clean',
  frequency: 'monthly',
  assignedTo: 'me',
  rotates: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  timeZone: 'Europe/Copenhagen',
  ...overrides,
});

describe('APP-061 calendar recurrence', () => {
  it.each([
    ['weekly', '2026-01-31', '2026-02-07'],
    ['monthly', '2026-01-31', '2026-02-28'],
    ['monthly', '2028-01-31', '2028-02-29'],
    ['monthly', '2026-02-28', '2026-03-28'],
    ['quarterly', '2026-11-30', '2027-02-28'],
    ['yearly', '2028-02-29', '2029-02-28'],
  ] as const)('%s advances %s to %s', (frequency, from, expected) => {
    expect(nextHouseholdTaskDueOn(from, frequency)).toBe(expected);
  });

  it('uses calendar days across Copenhagen spring and autumn DST transitions', () => {
    const spring = task({ frequency: 'weekly', lastDone: '2026-03-22' });
    expect(daysUntilDue(spring, new Date('2026-03-29T10:00:00Z'))).toBe(0);
    const autumn = task({ frequency: 'weekly', lastDone: '2026-10-18' });
    expect(daysUntilDue(autumn, new Date('2026-10-25T10:00:00Z'))).toBe(0);
  });

  it('keeps a fixed task zone when the simulated device zone changes', () => {
    const instant = new Date('2026-01-01T23:30:00Z');
    const fixed = task();
    expect(calendarDateForTask(fixed, instant, 'America/New_York')).toBe('2026-01-02');
    expect(calendarDateForTask(fixed, instant, 'Asia/Tokyo')).toBe('2026-01-02');
  });

  it('keeps explicit legacy device-local semantics for null', () => {
    const instant = new Date('2026-01-01T23:30:00Z');
    const legacy = task({ timeZone: null });
    expect(calendarDateForTask(legacy, instant, 'America/New_York')).toBe('2026-01-01');
    expect(calendarDateForTask(legacy, instant, 'Asia/Tokyo')).toBe('2026-01-02');
  });

  it('treats a never-completed task as due now and calculates overdue days', () => {
    expect(daysUntilDue(task(), new Date('2026-05-01T12:00:00Z'))).toBe(0);
    expect(daysUntilDue(task({ lastDone: '2026-01-31' }), new Date('2026-03-02T12:00:00Z'))).toBe(-2);
  });

  it('captures a real resolved IANA zone and fails closed for invalid input', () => {
    expect(resolvedDeviceTimeZone()).toEqual(expect.any(String));
    expect(() => calendarDateForTask(task({ timeZone: 'Not/A_Zone' }))).toThrow('invalid_time_zone');
    expect(() => nextHouseholdTaskDueOn('2026-02-30', 'monthly')).toThrow('invalid_date');
  });
});
