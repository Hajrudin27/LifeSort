import { habitStreak, type HabitStreak } from '@/features/habits/domain/habitStreak';
import type { Habit, HabitSchedule } from '@/types/life';

/** 2026-10-05 is a Monday. */
const MWF: HabitSchedule = { kind: 'weekdays', days: [1, 3, 5] };
const EVERY_DAY: HabitSchedule = { kind: 'weekdays', days: [1, 2, 3, 4, 5, 6, 7] };

const habit = (periods: [string, HabitSchedule][], logs: string[], extra: Partial<Habit> = {}): Habit => ({
  id: 'h', title: 'Habit', direction: 'build', createdAt: '2026-01-01T10:00:00.000Z', startDate: periods[0][0],
  scheduleHistory: periods.map(([effectiveFrom, schedule]) => ({ effectiveFrom, schedule })),
  logs: logs.map((date, i) => ({ id: `l${i}`, date })), ...extra,
});
const count = (result: HabitStreak) => (result.kind === 'current' ? result.count : null);
const mwf = (logs: string[], extra: Partial<Habit> = {}) => habit([['2026-09-28', MWF]], logs, extra);

describe('APP-065 habitStreak: scheduled commitments', () => {
  it('counts consecutive scheduled commitments and ignores the unscheduled weekend', () => {
    const h = mwf(['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-05']);
    expect(count(habitStreak(h, '2026-10-05'))).toBe(4); // Fri -> Mon is consecutive: Sat and Sun were never asked for
    expect(count(habitStreak(h, '2026-10-04'))).toBe(3); // Sunday: nothing pending, nothing broken
  });

  it('is ended by a scheduled day strictly before today with no entry', () => {
    expect(count(habitStreak(mwf(['2026-09-28', '2026-10-02', '2026-10-05']), '2026-10-05'))).toBe(2); // Wednesday was missed
  });

  it('never lets an unscheduled Saturday end a Monday/Wednesday/Friday run', () => {
    expect(count(habitStreak(mwf(['2026-10-02']), '2026-10-03'))).toBe(1);
    expect(count(habitStreak(mwf(['2026-10-02']), '2026-10-04'))).toBe(1);
  });

  it('treats today, scheduled and without an entry, as pending: it neither adds nor breaks', () => {
    const h = mwf(['2026-09-28', '2026-09-30']);
    expect(count(habitStreak(h, '2026-10-02'))).toBe(2); // Friday pending
    expect(count(habitStreak(mwf(['2026-09-28', '2026-09-30', '2026-10-02']), '2026-10-02'))).toBe(3); // completed today
  });

  it('does not fall to zero at midnight', () => {
    const h = mwf(['2026-09-28', '2026-09-30', '2026-10-02']);
    expect(count(habitStreak(h, '2026-10-02'))).toBe(3); // the evening of the last completion
    expect(count(habitStreak(h, '2026-10-05'))).toBe(3); // Monday 00:00: a new scheduled day, not yet completed
  });

  it('does not count an entry on an unscheduled day', () => {
    expect(count(habitStreak(mwf(['2026-09-28', '2026-09-29', '2026-09-30']), '2026-09-30'))).toBe(2);
  });

  it('ignores entries after today and entries before the start date', () => {
    expect(count(habitStreak(mwf(['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-05', '2026-10-07']), '2026-10-02'))).toBe(3);
    expect(count(habitStreak(mwf(['2026-09-25', '2026-09-28']), '2026-09-28'))).toBe(1);
  });

  it('is zero with no entries, never a negative or missing number', () => {
    expect(habitStreak(mwf([]), '2026-10-05')).toEqual({ kind: 'current', count: 0 });
    expect(habitStreak(mwf([]), '2026-09-27')).toEqual({ kind: 'current', count: 0 }); // before the start date
  });

  it('works for one weekday and for seven', () => {
    const mondays = habit([['2026-09-28', { kind: 'weekdays', days: [1] }]], ['2026-09-28', '2026-10-05']);
    expect(count(habitStreak(mondays, '2026-10-05'))).toBe(2);
    const week = habit([['2026-09-28', EVERY_DAY]], ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(count(habitStreak(week, '2026-10-04'))).toBe(7);
  });

  it('uses the same arithmetic for build and quit', () => {
    const logs = ['2026-09-28', '2026-09-30', '2026-10-05'];
    expect(habitStreak(mwf(logs, { direction: 'quit' }), '2026-10-05')).toEqual(habitStreak(mwf(logs, { direction: 'build' }), '2026-10-05'));
  });

  it('is cheap for a habit that is years old with a recent gap', () => {
    const logs = ['2026-10-01'];
    const old = habit([['2020-01-06', EVERY_DAY]], logs, { startDate: '2020-01-06' });
    expect(count(habitStreak(old, '2026-10-04'))).toBe(0); // 2 Oct onward were missed
  });
});

describe('APP-065 habitStreak: eligibility and schedule boundaries', () => {
  it('is ineligible for weekly and open schedules', () => {
    expect(habitStreak(habit([['2026-09-28', { kind: 'weekly', target: 3 }]], ['2026-09-28']), '2026-10-05')).toEqual({ kind: 'ineligible' });
    expect(habitStreak(habit([['2026-09-28', { kind: 'open' }]], ['2026-09-28']), '2026-10-05')).toEqual({ kind: 'ineligible' });
  });

  it('continues across a change between two weekday schedules, judging each day by the schedule it had', () => {
    const h = habit(
      [['2026-09-28', { kind: 'weekdays', days: [1, 3] }], ['2026-10-05', { kind: 'weekdays', days: [2, 4] }]],
      ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-06', '2026-10-08'],
    );
    // 09-29 (Tue) was unscheduled then and is not counted; Mon, Wed, Tue, Thu are.
    expect(count(habitStreak(h, '2026-10-08'))).toBe(4);
    // Missing the Wednesday under the OLD schedule still ends it, even after the change.
    const missed = habit(
      [['2026-09-28', { kind: 'weekdays', days: [1, 3] }], ['2026-10-05', { kind: 'weekdays', days: [2, 4] }]],
      ['2026-09-28', '2026-10-06', '2026-10-08'],
    );
    expect(count(habitStreak(missed, '2026-10-08'))).toBe(2);
  });

  it('does not bridge weekdays -> open -> weekdays', () => {
    const h = habit(
      [['2026-09-28', MWF], ['2026-10-05', { kind: 'open' }], ['2026-10-19', MWF]],
      ['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-19'],
    );
    expect(count(habitStreak(h, '2026-10-19'))).toBe(1); // not 4
    expect(habitStreak(h, '2026-10-12')).toEqual({ kind: 'ineligible' }); // while it is open
  });

  it('does not bridge weekdays -> weekly -> weekdays', () => {
    const h = habit(
      [['2026-09-28', MWF], ['2026-10-05', { kind: 'weekly', target: 2 }], ['2026-10-19', MWF]],
      ['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-19', '2026-10-21'],
    );
    expect(count(habitStreak(h, '2026-10-21'))).toBe(2);
  });

  it('starts a new run when an open or weekly habit becomes weekday-scheduled', () => {
    const fromOpen = habit([['2026-09-28', { kind: 'open' }], ['2026-10-05', MWF]], ['2026-09-28', '2026-09-30', '2026-10-05']);
    expect(count(habitStreak(fromOpen, '2026-10-05'))).toBe(1);
    const fromWeekly = habit([['2026-09-28', { kind: 'weekly', target: 3 }], ['2026-10-05', MWF]], ['2026-09-29', '2026-10-05', '2026-10-07']);
    expect(count(habitStreak(fromWeekly, '2026-10-07'))).toBe(2);
  });

  it('ignores a period that has not taken effect yet', () => {
    const h = habit([['2026-09-28', MWF], ['2026-10-12', { kind: 'open' }]], ['2026-09-28', '2026-09-30']);
    expect(count(habitStreak(h, '2026-09-30'))).toBe(2);
  });
});

describe('APP-065 habitStreak: the number is always derived', () => {
  it('recomputes when a past day is corrected or cleared', () => {
    const gap = mwf(['2026-09-28', '2026-10-02', '2026-10-05']);
    expect(count(habitStreak(gap, '2026-10-05'))).toBe(2);
    const repaired = { ...gap, logs: [...gap.logs, { id: 'fix', date: '2026-09-30' }] };
    expect(count(habitStreak(repaired, '2026-10-05'))).toBe(4);
    const cleared = { ...repaired, logs: repaired.logs.filter((log) => log.date !== '2026-10-02') };
    expect(count(habitStreak(cleared, '2026-10-05'))).toBe(1);
  });

  it('keeps a legacy future entry inert until its day arrives', () => {
    const h = mwf(['2026-09-28', '2026-10-12']);
    expect(count(habitStreak(h, '2026-09-28'))).toBe(1);
    expect(count(habitStreak(h, '2026-10-05'))).toBe(0); // 09-30 and 10-02 were missed, and the 10-12 entry has not happened yet
  });
});

describe('APP-065 habitStreak: calendar edge cases with real years', () => {
  const run = (start: string, end: string): string[] => {
    const out: string[] = [];
    for (let [y, m, d] = start.split('-').map(Number); ; ) {
      const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      out.push(date);
      if (date === end) return out;
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      [y, m, d] = [next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()];
    }
  };
  const daily = (start: string, logs: string[]) => habit([[start, EVERY_DAY]], logs, { startDate: start });

  it('crosses the spring DST change (2026-03-29) without losing a day', () => {
    const logs = run('2026-03-27', '2026-03-31');
    expect(count(habitStreak(daily('2026-03-20', logs), '2026-03-31'))).toBe(5);
  });

  it('crosses the autumn DST change (2026-10-25) without gaining a day', () => {
    const logs = run('2026-10-23', '2026-10-27');
    expect(count(habitStreak(daily('2026-10-20', logs), '2026-10-27'))).toBe(5);
  });

  it('counts the leap day in 2028 and not in 2027', () => {
    expect(count(habitStreak(daily('2028-02-20', run('2028-02-28', '2028-03-01')), '2028-03-01'))).toBe(3);
    expect(count(habitStreak(daily('2027-02-20', run('2027-02-28', '2027-03-01')), '2027-03-01'))).toBe(2);
    // Skipping 29 Feb 2028 is a miss; skipping a date that does not exist in 2027 is not possible.
    expect(count(habitStreak(daily('2028-02-20', ['2028-02-28', '2028-03-01']), '2028-03-01'))).toBe(1);
  });

  it('gives the same answer in any device timezone, because stored dates are civil dates', () => {
    const logs = run('2026-03-27', '2026-03-31');
    const h = daily('2026-03-20', logs);
    const original = process.env.TZ;
    try {
      const answers = ['Europe/Copenhagen', 'Pacific/Auckland', 'America/Los_Angeles', 'UTC'].map((zone) => {
        process.env.TZ = zone;
        return count(habitStreak(h, '2026-03-31'));
      });
      expect(new Set(answers)).toEqual(new Set([5]));
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });

  it('never reads the clock', () => {
    const now = jest.spyOn(Date, 'now');
    habitStreak(mwf(['2026-09-28']), '2026-10-05');
    expect(now).not.toHaveBeenCalled();
    now.mockRestore();
  });
});
