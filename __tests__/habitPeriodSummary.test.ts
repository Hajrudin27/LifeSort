import { habitPeriodStart, habitPeriodSummary, type HabitPeriodKind, type HabitPeriodSummary } from '@/features/habits/domain/habitPeriodSummary';
import type { Habit, HabitSchedule } from '@/types/life';

/** 2026-10-05 is a Monday, so 2026-10-08 is a Thursday and 2026-10-01 a Thursday too. */
const MWF: HabitSchedule = { kind: 'weekdays', days: [1, 3, 5] };
const TTH: HabitSchedule = { kind: 'weekdays', days: [2, 4] };
const EVERY_DAY: HabitSchedule = { kind: 'weekdays', days: [1, 2, 3, 4, 5, 6, 7] };
const WEEKLY: HabitSchedule = { kind: 'weekly', target: 3 };
const OPEN: HabitSchedule = { kind: 'open' };

const habit = (periods: [string, HabitSchedule][], logs: string[], extra: Partial<Habit> = {}): Habit => ({
  id: 'h', title: 'Habit', direction: 'build', createdAt: '2026-01-01T10:00:00.000Z', startDate: periods[0][0],
  scheduleHistory: periods.map(([effectiveFrom, schedule]) => ({ effectiveFrom, schedule })),
  logs: logs.map((date, i) => ({ id: `l${i}`, date })), ...extra,
});
const one = (schedule: HabitSchedule, logs: string[], start = '2026-09-01', extra: Partial<Habit> = {}) => habit([[start, schedule]], logs, extra);
const facts = (summary: HabitPeriodSummary) => [summary.scheduled.completed, summary.scheduled.total, summary.otherEntries];
const week = (habits: Habit[], today: string) => habitPeriodSummary(habits, 'week', today);
const month = (habits: Habit[], today: string) => habitPeriodSummary(habits, 'month', today);

describe('APP-066 habitPeriodSummary: period bounds', () => {
  it('week is the ISO Monday through today, never a rolling 7 days or the future Sunday', () => {
    expect(week([], '2026-10-08').period).toEqual({ kind: 'week', from: '2026-10-05', to: '2026-10-08' });
    expect(week([], '2026-10-04').period).toEqual({ kind: 'week', from: '2026-09-28', to: '2026-10-04' }); // a Sunday ends its own week
    expect(week([], '2026-10-05').period.from).toBe('2026-10-05'); // a Monday starts it
  });

  it('month is the first of the current YYYY-MM through today, never a rolling 30 days or the full month', () => {
    expect(month([], '2026-10-08').period).toEqual({ kind: 'month', from: '2026-10-01', to: '2026-10-08' });
    expect(habitPeriodStart('month', '2026-10-31')).toBe('2026-10-01');
  });
});

describe('APP-066 habitPeriodSummary: nothing, or nothing yet', () => {
  it('1. no habits', () => {
    expect(facts(week([], '2026-10-08'))).toEqual([0, 0, 0]);
    expect(facts(month([], '2026-10-08'))).toEqual([0, 0, 0]);
  });

  it('2. a habit that starts after today contributes nothing, even with a legacy entry', () => {
    const h = one(EVERY_DAY, ['2026-10-12'], '2026-10-12');
    expect(facts(week([h], '2026-10-08'))).toEqual([0, 0, 0]);
    expect(facts(month([h], '2026-10-08'))).toEqual([0, 0, 0]);
  });

  it('3. a habit that starts inside the week is judged from its start date', () => {
    const h = one(MWF, [], '2026-10-07'); // Wed 7 is the first scheduled day; Monday 5 is before the start
    expect(facts(week([h], '2026-10-08'))).toEqual([0, 1, 0]);
  });

  it('4. a habit that starts inside the month is judged from its start date', () => {
    const h = one(MWF, ['2026-10-05'], '2026-10-05'); // Fri 2 Oct is before the start
    expect(facts(month([h], '2026-10-08'))).toEqual([1, 2, 0]); // Mon 5 done, Wed 7 not
  });
});

describe('APP-066 habitPeriodSummary: weekday habits', () => {
  it('5-6. Monday/Wednesday/Friday: a past scheduled completion counts, a past scheduled day without one is resolved too', () => {
    const h = one(MWF, ['2026-10-05']);
    expect(facts(week([h], '2026-10-08'))).toEqual([1, 2, 0]); // Mon done, Wed not
    expect(facts(month([h], '2026-10-08'))).toEqual([1, 3, 0]); // + Fri 2 Oct
  });

  it('7. a scheduled past day without an entry only raises the total; no standalone missed number exists', () => {
    const summary = week([one(MWF, [])], '2026-10-08');
    expect(summary.scheduled).toEqual({ completed: 0, total: 2 });
    expect(Object.keys(summary).sort()).toEqual(['otherEntries', 'period', 'scheduled']);
    expect(Object.keys(summary.scheduled).sort()).toEqual(['completed', 'total']);
  });

  it('8. a scheduled today without an entry is pending: not in the total, not completed', () => {
    expect(facts(week([one(MWF, ['2026-10-05'])], '2026-10-07'))).toEqual([1, 1, 0]); // Wed 7 pending
    expect(facts(week([one(MWF, [])], '2026-10-07'))).toEqual([0, 1, 0]); // only Monday is resolved
  });

  it('9. a scheduled today with an entry counts as completed and in the total', () => {
    expect(facts(week([one(MWF, ['2026-10-05', '2026-10-07'])], '2026-10-07'))).toEqual([2, 2, 0]);
  });

  it('10. a scheduled day after today never enters the denominator (a future Friday on a Wednesday)', () => {
    const h = one(MWF, ['2026-10-05', '2026-10-07']);
    expect(week([h], '2026-10-07').scheduled.total).toBe(2);
    expect(week([h], '2026-10-09').scheduled.total).toBe(2); // Friday is today and still pending
    expect(week([h], '2026-10-10').scheduled.total).toBe(3); // Friday joins once it is behind us
  });
});

describe('APP-066 habitPeriodSummary: entries that are not a scheduled commitment', () => {
  it('11. an entry on an unscheduled weekday is an other entry and never inflates completed', () => {
    const summary = week([one(MWF, ['2026-10-06'])], '2026-10-08'); // Tuesday
    expect(summary.scheduled).toEqual({ completed: 0, total: 2 });
    expect(summary.otherEntries).toBe(1);
  });

  it('12. a future legacy entry contributes nothing', () => {
    expect(facts(week([one(MWF, ['2026-10-09', '2026-10-10', '2026-11-02'])], '2026-10-08'))).toEqual([0, 2, 0]);
    expect(facts(month([one(OPEN, ['2026-10-09'])], '2026-10-08'))).toEqual([0, 0, 0]);
  });

  it('13. an entry before the start date contributes nothing', () => {
    expect(facts(week([one(MWF, ['2026-10-05'], '2026-10-06')], '2026-10-08'))).toEqual([0, 1, 0]);
    expect(facts(week([one(OPEN, ['2026-10-05'], '2026-10-06')], '2026-10-08'))).toEqual([0, 0, 0]);
  });

  it('14. a duplicate date counts once, in every schedule kind, and the habit is not mutated', () => {
    const duplicates = ['2026-10-05', '2026-10-05', '2026-10-05'];
    const h = one(MWF, duplicates);
    const before = JSON.stringify(h);
    expect(facts(week([h], '2026-10-08'))).toEqual([1, 2, 0]);
    expect(facts(week([one(WEEKLY, duplicates)], '2026-10-08'))).toEqual([0, 0, 1]);
    expect(facts(week([one(OPEN, duplicates)], '2026-10-08'))).toEqual([0, 0, 1]);
    expect(facts(week([one(MWF, ['2026-10-06', '2026-10-06'])], '2026-10-08'))[2]).toBe(1);
    expect(JSON.stringify(h)).toBe(before);
  });

  it('ignores log dates that are not real calendar dates', () => {
    expect(facts(week([one(OPEN, ['2026-13-40', 'garbage', '2026-10-6'])], '2026-10-08'))).toEqual([0, 0, 0]);
  });
});

describe('APP-066 habitPeriodSummary: the schedule in effect on each date', () => {
  it('15. a weekday schedule change inside the week never rewrites earlier dates', () => {
    // Mon/Wed/Fri until Monday 5 Oct; Tuesday/Thursday from Tuesday 6 Oct.
    const h = habit([['2026-09-01', MWF], ['2026-10-06', TTH]], ['2026-10-05', '2026-10-07']);
    // Mon 5: scheduled, done. Tue 6: scheduled, none. Wed 7: no longer scheduled, an entry. Thu 8 (today): pending.
    expect(facts(week([h], '2026-10-08'))).toEqual([1, 2, 1]);
  });

  it('16. weekdays then weekly inside the month: later weekly logs are other entries, earlier days keep weekday semantics', () => {
    const h = habit([['2026-09-01', MWF], ['2026-10-12', WEEKLY]], ['2026-10-02', '2026-10-09', '2026-10-12', '2026-10-13']);
    expect(facts(month([h], '2026-10-14'))).toEqual([2, 4, 2]); // Fri 2, Mon 5, Wed 7, Fri 9 scheduled
  });

  it('17. weekly then weekdays inside the month', () => {
    const h = habit([['2026-09-01', WEEKLY], ['2026-10-12', MWF]], ['2026-10-02', '2026-10-06', '2026-10-12', '2026-10-13']);
    // Weekly period: 2 and 6 are plain entries. From Mon 12: Mon done, Tue an unscheduled entry, Wed 14 is today and pending.
    expect(facts(month([h], '2026-10-14'))).toEqual([1, 1, 3]);
  });

  it('18. weekdays then open inside the month', () => {
    const h = habit([['2026-09-01', MWF], ['2026-10-06', OPEN]], ['2026-10-02', '2026-10-06', '2026-10-07']);
    expect(facts(month([h], '2026-10-08'))).toEqual([1, 2, 2]); // Fri 2 done, Mon 5 not; the open days are entries only
  });

  it('19. open then weekdays inside the month', () => {
    const h = habit([['2026-09-01', OPEN], ['2026-10-05', MWF]], ['2026-10-01', '2026-10-05', '2026-10-06']);
    expect(facts(month([h], '2026-10-08'))).toEqual([1, 2, 2]);
    expect(facts(week([h], '2026-10-08'))).toEqual([1, 2, 1]);
  });
});

describe('APP-066 habitPeriodSummary: weekly and open habits are entry counts only', () => {
  it('20. weekly logs are other entries and nothing else', () => {
    expect(facts(week([one(WEEKLY, ['2026-10-05', '2026-10-06', '2026-10-07'])], '2026-10-08'))).toEqual([0, 0, 3]);
  });

  it('21. a weekly target creates no denominator and no achieved verdict', () => {
    expect(facts(week([one(WEEKLY, [])], '2026-10-08'))).toEqual([0, 0, 0]);
    expect(facts(week([one({ kind: 'weekly', target: 1 }, ['2026-10-05', '2026-10-06', '2026-10-07'])], '2026-10-08')))
      .toEqual(facts(week([one({ kind: 'weekly', target: 7 }, ['2026-10-05', '2026-10-06', '2026-10-07'])], '2026-10-08')));
  });

  it('22. open logs are other entries and nothing else', () => {
    expect(facts(month([one(OPEN, ['2026-10-01', '2026-10-05', '2026-10-08'])], '2026-10-08'))).toEqual([0, 0, 3]);
    expect(facts(month([one(OPEN, [])], '2026-10-08'))).toEqual([0, 0, 0]);
  });

  it('deduplicates per habit, not across habits: two habits logging the same date are two entries', () => {
    const same = ['2026-10-05'];
    expect(facts(week([one(OPEN, same), one(OPEN, same)], '2026-10-08'))).toEqual([0, 0, 2]);
    expect(facts(week([one(WEEKLY, same), one(OPEN, same)], '2026-10-08'))).toEqual([0, 0, 2]);
    expect(facts(week([one(MWF, same), one(MWF, same)], '2026-10-08'))).toEqual([2, 4, 0]);
    expect(facts(week([one(MWF, ['2026-10-06']), one(MWF, ['2026-10-06'])], '2026-10-08'))).toEqual([0, 4, 2]);
  });

  it('adds up across habits', () => {
    const habits = [one(MWF, ['2026-10-05']), one(WEEKLY, ['2026-10-06']), one(OPEN, ['2026-10-07', '2026-10-08'])];
    expect(facts(week(habits, '2026-10-08'))).toEqual([1, 2, 3]);
  });
});

describe('APP-066 habitPeriodSummary: direction and corrections', () => {
  it('23. build and quit do the same arithmetic', () => {
    const logs = ['2026-10-05', '2026-10-06'];
    for (const kind of ['week', 'month'] as HabitPeriodKind[]) {
      expect(habitPeriodSummary([one(MWF, logs, '2026-09-01', { direction: 'build' })], kind, '2026-10-08'))
        .toEqual(habitPeriodSummary([one(MWF, logs, '2026-09-01', { direction: 'quit' })], kind, '2026-10-08'));
    }
  });

  it('24. adding a past completion changes only the completed count', () => {
    expect(facts(week([one(MWF, ['2026-10-05'])], '2026-10-08'))).toEqual([1, 2, 0]);
    expect(facts(week([one(MWF, ['2026-10-05', '2026-10-07'])], '2026-10-08'))).toEqual([2, 2, 0]);
  });

  it('25. clearing a past completion changes only the completed count', () => {
    expect(facts(week([one(MWF, ['2026-10-05', '2026-10-07'])], '2026-10-08'))).toEqual([2, 2, 0]);
    expect(facts(week([one(MWF, ['2026-10-07'])], '2026-10-08'))).toEqual([1, 2, 0]);
  });
});

describe('APP-066 habitPeriodSummary: civil dates', () => {
  it('26. spring DST (Sunday 29 Mar 2026, a 23-hour day)', () => {
    const h = one(EVERY_DAY, ['2026-03-28', '2026-03-29'], '2026-03-01');
    expect(week([h], '2026-03-29').period.from).toBe('2026-03-23');
    expect(facts(week([h], '2026-03-29'))).toEqual([2, 7, 0]);
    expect(facts(month([h], '2026-03-29'))).toEqual([2, 29, 0]);
  });

  it('27. autumn DST (Sunday 25 Oct 2026, a 25-hour day)', () => {
    const h = one(EVERY_DAY, ['2026-10-24', '2026-10-25'], '2026-10-01');
    expect(week([h], '2026-10-25').period.from).toBe('2026-10-19');
    expect(facts(week([h], '2026-10-25'))).toEqual([2, 7, 0]);
    expect(facts(month([h], '2026-10-25'))).toEqual([2, 25, 0]);
  });

  it('28. leap day (Tuesday 29 Feb 2028)', () => {
    const h = one(EVERY_DAY, ['2028-02-28', '2028-02-29'], '2028-02-01');
    expect(week([h], '2028-02-29').period.from).toBe('2028-02-28');
    expect(facts(week([h], '2028-02-29'))).toEqual([2, 2, 0]);
    expect(facts(month([h], '2028-02-29'))).toEqual([2, 29, 0]);
    expect(month([h], '2028-03-01').period.from).toBe('2028-03-01');
    expect(facts(month([h], '2028-03-01'))).toEqual([0, 0, 0]); // a new month starts with nothing carried over; the 1st is pending
  });

  it('29. month boundary: the month restarts on the 1st while the week reaches back into the old month', () => {
    const h = one(EVERY_DAY, ['2026-10-31', '2026-11-01'], '2026-10-01');
    expect(month([h], '2026-11-01').period.from).toBe('2026-11-01');
    expect(facts(month([h], '2026-11-01'))).toEqual([1, 1, 0]);
    expect(week([h], '2026-11-01').period.from).toBe('2026-10-26');
    expect(facts(week([h], '2026-11-01'))).toEqual([2, 7, 0]);
  });

  it('30. an ISO week that crosses December into January', () => {
    const h = one(EVERY_DAY, ['2026-12-31', '2027-01-01'], '2026-12-01');
    expect(week([h], '2027-01-01').period).toEqual({ kind: 'week', from: '2026-12-28', to: '2027-01-01' });
    expect(facts(week([h], '2027-01-01'))).toEqual([2, 5, 0]);
    expect(facts(month([h], '2027-01-01'))).toEqual([1, 1, 0]);
  });
});

describe('APP-066 habitPeriodSummary: determinism', () => {
  const habits = () => [
    one(MWF, ['2026-10-07', '2026-10-05', '2026-10-06']),
    habit([['2026-09-01', WEEKLY], ['2026-10-05', OPEN]], ['2026-10-06', '2026-10-01']),
    one(EVERY_DAY, ['2026-10-08', '2026-10-02'], '2026-10-01', { direction: 'quit' }),
  ];

  it('31. does not depend on the order of habits or of logs', () => {
    const forward = habits();
    const shuffled = habits().reverse().map((h) => ({ ...h, logs: [...h.logs].reverse() }));
    for (const kind of ['week', 'month'] as HabitPeriodKind[]) {
      expect(habitPeriodSummary(shuffled, kind, '2026-10-08')).toEqual(habitPeriodSummary(forward, kind, '2026-10-08'));
    }
  });

  it('32. the same input twice gives byte-for-byte the same facts', () => {
    const input = habits();
    expect(JSON.stringify(habitPeriodSummary(input, 'month', '2026-10-08'))).toBe(JSON.stringify(habitPeriodSummary(input, 'month', '2026-10-08')));
  });

  it('33. never reads the clock', () => {
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Date.now was read'); });
    try {
      expect(() => habitPeriodSummary(habits(), 'week', '2026-10-08')).not.toThrow();
      expect(() => habitPeriodSummary(habits(), 'month', '2026-10-08')).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it('only walks the current period: a habit with years of history is judged by this week or month alone', () => {
    const old = habit([['2020-01-06', EVERY_DAY]], ['2020-01-06', '2024-05-05', '2026-09-30', '2026-10-05']);
    expect(facts(week([old], '2026-10-08'))).toEqual([1, 3, 0]); // Mon-Wed resolved, Thursday pending
    expect(facts(month([old], '2026-10-08'))).toEqual([1, 7, 0]);
  });
});
