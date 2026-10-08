import { daysInMonthKey, getMonthCalendarWeeks, shiftMonthKey } from '@/utils/habit/habitMonth';
import { isDateInCurrentWeek } from '@/utils/habit/habitWeek';

// Kører i Europe/Copenhagen. Onsdag 1. juli 2026 er sommertid (UTC+2), så kl.
// 00:30 lokalt er klokken 22:30 den 30. juni i UTC — netop der hvor en
// UTC-baseret "i dag" peger på gårsdagen.

function at(y: number, m: number, d: number, h = 12, min = 0) {
  jest.useFakeTimers().setSystemTime(new Date(y, m - 1, d, h, min));
}

afterEach(() => jest.useRealTimers());

describe('isDateInCurrentWeek', () => {
  it('spans Monday to Sunday of the ISO week, whatever the day of the week is today', () => {
    for (const day of [29, 30, 31]) {
      at(2026, 7, 1); // Wednesday
      expect(isDateInCurrentWeek(`2026-06-${day}`)).toBe(day >= 29);
    }
    at(2026, 7, 5); // Sunday is the last day of its week, not the first of the next
    expect(isDateInCurrentWeek('2026-06-29')).toBe(true);
    expect(isDateInCurrentWeek('2026-07-06')).toBe(false);
    at(2026, 7, 6); // Monday starts a new week
    expect(isDateInCurrentWeek('2026-07-05')).toBe(false);
    expect(isDateInCurrentWeek('2026-07-06')).toBe(true);
  });
});

describe('isDateInCurrentWeek around local midnight', () => {
  it('reads the local date: 00:30 on Wednesday 1 July in Copenhagen is still Wednesday, though it is Tuesday in UTC', () => {
    at(2026, 7, 1, 0, 30);
    expect(isDateInCurrentWeek('2026-06-29')).toBe(true);
    expect(isDateInCurrentWeek('2026-07-05')).toBe(true);
    expect(isDateInCurrentWeek('2026-07-06')).toBe(false);
  });

  it('keeps the week across the spring-forward change', () => {
    at(2026, 3, 30); // the Monday after the clocks moved
    expect(isDateInCurrentWeek('2026-03-29')).toBe(false);
    expect(isDateInCurrentWeek('2026-03-30')).toBe(true);
    expect(isDateInCurrentWeek('2026-04-05')).toBe(true);
  });
});

describe('month helpers (text and integers, no device timezone)', () => {
  it('knows the length of every month, leap Februaries included', () => {
    expect(daysInMonthKey('2026-02')).toBe(28);
    expect(daysInMonthKey('2028-02')).toBe(29);
    expect(daysInMonthKey('2100-02')).toBe(28);
    expect(daysInMonthKey('2026-04')).toBe(30);
    expect(daysInMonthKey('2026-12')).toBe(31);
  });

  it('moves between months across year ends', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
    expect(shiftMonthKey('2026-10', 14)).toBe('2027-12');
    expect(shiftMonthKey('2026-10', -10)).toBe('2025-12');
    expect(shiftMonthKey('2026-10', 0)).toBe('2026-10');
  });

  it('lays out a month with Monday first and pads to whole weeks', () => {
    const weeks = getMonthCalendarWeeks('2026-10', '2026-10-08'); // 1 October 2026 is a Thursday
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0].map((day) => day.dayNumber)).toEqual([null, null, null, 1, 2, 3, 4]);
    expect(weeks[weeks.length - 1].map((day) => day.dayNumber)).toEqual([26, 27, 28, 29, 30, 31, null]);
    const days = weeks.flat().filter((day) => day.key !== null);
    expect(days).toHaveLength(31);
    expect(days.filter((day) => day.isToday).map((day) => day.key)).toEqual(['2026-10-08']);
    expect(days.filter((day) => day.isFuture)).toHaveLength(23);
  });

  it('starts a Sunday-first month with six empty cells', () => {
    const weeks = getMonthCalendarWeeks('2026-02', '2026-02-01'); // 1 February 2026 is a Sunday
    expect(weeks[0].map((day) => day.dayNumber)).toEqual([null, null, null, null, null, null, 1]);
  });
});
