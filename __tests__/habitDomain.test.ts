import {
  decodeHabit,
  decodeSchedule,
  decodeScheduleHistory,
  schedulesEqual,
} from '@/core/habits/persistedHabit';
import {
  buildHabit,
  HabitError,
  normalizeSchedule,
  scheduleChangeEffectiveFrom,
  updateHabitFields,
  withDateCompleted,
  withSchedule,
} from '@/features/habits/domain/habitCommands';
import {
  habitDayStatus,
  habitWeekFacts,
  hasEntryOn,
  isScheduledOn,
  pendingSchedulePeriod,
  scheduledDayOutcomes,
  scheduledTodaySummary,
  scheduleForDisplay,
  scheduleOn,
  weekEntryCount,
} from '@/features/habits/domain/habitStatus';
import type { Habit, HabitSchedule, HabitSchedulePeriod, IsoWeekday } from '@/types/life';
import { addDaysIso, isoWeekday, startOfIsoWeek } from '@/utils/shared/localDate';

// 2026-10-05 is a Monday. Tests run in Europe/Copenhagen (package.json), but none of the
// habit rules may depend on it: every function below takes "today" as an argument.
const MON = '2026-10-05';
const TUE = '2026-10-06';
const WED = '2026-10-07';
const THU = '2026-10-08';
const FRI = '2026-10-09';
const SUN = '2026-10-11';
const NEXT_MON = '2026-10-12';

const days = (...list: IsoWeekday[]): HabitSchedule => ({ kind: 'weekdays', days: list });
const EVERY: HabitSchedule = days(1, 2, 3, 4, 5, 6, 7);
const weekly = (target: number): HabitSchedule => ({ kind: 'weekly', target });
const OPEN: HabitSchedule = { kind: 'open' };

let counter = 0;
const makeId = () => `log-${++counter}`;
const habit = (overrides: Partial<Habit> & { schedule?: HabitSchedule; entries?: string[] } = {}): Habit => {
  const { schedule, entries, ...rest } = overrides;
  const startDate = rest.startDate ?? '2026-09-01';
  return {
    id: 'h', title: 'Habit', direction: 'build', createdAt: '2026-09-01T10:00:00.000Z', startDate,
    scheduleHistory: [{ effectiveFrom: startDate, schedule: schedule ?? EVERY }],
    logs: (entries ?? []).map((date, i) => ({ id: `e${i}`, date })),
    ...rest,
  };
};
const fails = (action: () => unknown, code: string) => {
  try { action(); } catch (error) { expect(error).toBeInstanceOf(HabitError); expect((error as HabitError).code).toBe(code); return; }
  throw new Error(`expected HabitError ${code}`);
};

describe('ISO weekday and week (locale- and timezone-independent)', () => {
  // Sakamoto's algorithm: pure integer arithmetic with no Date, so it cannot share a timezone bug.
  const reference = (iso: string) => {
    const [y0, m, d] = iso.split('-').map(Number);
    const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    const y = m < 3 ? y0 - 1 : y0;
    return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[m - 1] + d) % 7 || 7;
  };

  it('knows the anchor days', () => {
    expect([MON, TUE, WED, THU, FRI, '2026-10-10', SUN].map(isoWeekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('agrees with an independent integer algorithm for every day from 1900 to 2100', () => {
    let date = '1900-01-01';
    for (let i = 0; i < 73_415; i += 1) {
      if (isoWeekday(date) !== reference(date)) throw new Error(`weekday differs on ${date}`);
      date = addDaysIso(date, 1);
    }
  });

  it('is right on leap days, DST changes, year ends and two-digit years', () => {
    expect(isoWeekday('2028-02-29')).toBe(2);
    expect(isoWeekday('2026-03-29')).toBe(7); // spring-forward Sunday in Copenhagen
    expect(isoWeekday('2026-10-25')).toBe(7); // fall-back Sunday
    expect(isoWeekday('2026-12-31')).toBe(4);
    expect(isoWeekday('2027-01-01')).toBe(5);
    expect(isoWeekday('0050-06-15')).toBe(reference('0050-06-15'));
  });

  it('never reads the device timezone: the source uses UTC fields only', () => {
    const fs = require('fs') as typeof import('fs');
    const source = fs.readFileSync(require('path').join(__dirname, '../utils/shared/localDate.ts'), 'utf8');
    const body = source.slice(source.indexOf('export function isoWeekday'), source.indexOf('export function startOfIsoWeek'));
    expect(body).toContain('getUTCDay');
    expect(body).not.toMatch(/getDay\(|getFullYear\(|getTimezoneOffset|parseIsoDate/);
  });

  it('starts the week on Monday for every weekday, across month and year ends', () => {
    for (const [date, monday] of [
      [MON, MON], [WED, MON], [SUN, MON], [NEXT_MON, NEXT_MON], ['2027-01-01', '2026-12-28'], ['2026-03-01', '2026-02-23'],
    ] as const) expect(startOfIsoWeek(date)).toBe(monday);
  });
});

describe('schedule format', () => {
  it('accepts exactly the three kinds, with exact key sets', () => {
    expect(decodeSchedule({ kind: 'open' })).toEqual({ kind: 'open' });
    expect(decodeSchedule({ kind: 'weekly', target: 7 })).toEqual({ kind: 'weekly', target: 7 });
    expect(decodeSchedule({ kind: 'weekdays', days: [1, 7] })).toEqual({ kind: 'weekdays', days: [1, 7] });
    for (const bad of [
      null, [], 'open', {}, { kind: 'daily' }, { kind: 'open', target: 1 }, { kind: 'weekly' }, { kind: 'weekly', target: 3, days: [1] },
      { kind: 'weekdays' }, { kind: 'weekdays', days: [], extra: 1 }, { kind: 'weekdays', days: [1], target: 1 },
    ]) expect(decodeSchedule(bad)).toBeNull();
  });

  it('weekly targets are integers 1 to 7 and nothing is clamped', () => {
    for (const target of [0, -1, 8, 1.5, NaN, Infinity, '3', null, undefined]) {
      expect(decodeSchedule({ kind: 'weekly', target })).toBeNull();
    }
    for (const target of [1, 2, 3, 4, 5, 6, 7]) expect(decodeSchedule({ kind: 'weekly', target })).toEqual({ kind: 'weekly', target });
  });

  it('weekday lists are non-empty, unique, ascending and within 1 to 7', () => {
    for (const list of [[], [0], [8], [1.5], [2, 1], [1, 1], ['1'], [null], [1, 2, 2]]) {
      expect(decodeSchedule({ kind: 'weekdays', days: list })).toBeNull();
    }
    expect(decodeSchedule({ kind: 'weekdays', days: [1, 2, 3, 4, 5, 6, 7] })).not.toBeNull();
  });

  it('every day is the full weekday list: there is no separate daily variant', () => {
    expect(decodeSchedule({ kind: 'daily' })).toBeNull();
    expect(schedulesEqual(EVERY, days(1, 2, 3, 4, 5, 6, 7))).toBe(true);
    expect(schedulesEqual(EVERY, days(1, 2, 3, 4, 5, 6))).toBe(false);
    expect(schedulesEqual(weekly(3), weekly(3))).toBe(true);
    expect(schedulesEqual(weekly(3), weekly(4))).toBe(false);
    expect(schedulesEqual(weekly(3), OPEN)).toBe(false);
    expect(schedulesEqual(OPEN, OPEN)).toBe(true);
  });

  it('normalizeSchedule orders weekdays but rejects duplicates, bad days and extra keys', () => {
    expect(normalizeSchedule({ kind: 'weekdays', days: [5, 1, 3] })).toEqual(days(1, 3, 5));
    for (const bad of [{ kind: 'weekdays', days: [1, 1] }, { kind: 'weekdays', days: [] }, { kind: 'weekdays', days: [9] },
      { kind: 'weekdays', days: [1], extra: true }, { kind: 'weekly', target: 0 }, { kind: 'weekly', target: 8 }, null, 'open', 3]) {
      fails(() => normalizeSchedule(bad), 'habit_schedule_invalid');
    }
  });
});

describe('schedule history format', () => {
  const period = (effectiveFrom: string, schedule: HabitSchedule): HabitSchedulePeriod => ({ effectiveFrom, schedule });

  it('needs at least one period, the first on the start date, strictly increasing', () => {
    expect(decodeScheduleHistory([period('2026-09-01', EVERY)], '2026-09-01')).not.toBeNull();
    expect(decodeScheduleHistory([], '2026-09-01')).toBeNull();
    expect(decodeScheduleHistory([period('2026-09-02', EVERY)], '2026-09-01')).toBeNull();
    expect(decodeScheduleHistory([period('2026-08-31', EVERY)], '2026-09-01')).toBeNull();
    expect(decodeScheduleHistory([period('2026-09-01', EVERY), period('2026-09-01', OPEN)], '2026-09-01')).toBeNull();
    expect(decodeScheduleHistory([period('2026-09-01', EVERY), period('2026-09-10', OPEN), period('2026-09-05', OPEN)], '2026-09-01')).toBeNull();
    expect(decodeScheduleHistory([period('2026-09-01', EVERY), period('2026-09-10', OPEN), period('2026-09-20', weekly(2))], '2026-09-01')).not.toBeNull();
  });

  it('rejects malformed periods and non-calendar dates', () => {
    for (const bad of [
      [{ effectiveFrom: '2026-09-01' }], [{ schedule: EVERY }], [{ effectiveFrom: '2026-9-1', schedule: EVERY }],
      [{ effectiveFrom: '2026-02-30', schedule: EVERY }], [{ effectiveFrom: '2026-09-01T00:00:00.000Z', schedule: EVERY }],
      [{ effectiveFrom: '2026-09-01', schedule: EVERY, extra: 1 }], 'x', null, {},
    ]) expect(decodeScheduleHistory(bad, '2026-09-01')).toBeNull();
  });
});

describe('schedule resolution', () => {
  const h = habit({
    startDate: '2026-09-28',
    scheduleHistory: [
      { effectiveFrom: '2026-09-28', schedule: days(1) },
      { effectiveFrom: WED, schedule: days(2) },
      { effectiveFrom: NEXT_MON, schedule: weekly(3) },
    ],
  });

  it('uses the latest period that has started, and none before the start date', () => {
    expect(scheduleOn(h, '2026-09-27')).toBeNull();
    expect(scheduleOn(h, '2026-09-28')).toEqual(days(1));
    expect(scheduleOn(h, TUE)).toEqual(days(1));
    expect(scheduleOn(h, WED)).toEqual(days(2));
    expect(scheduleOn(h, SUN)).toEqual(days(2));
    expect(scheduleOn(h, NEXT_MON)).toEqual(weekly(3));
  });

  it('shows the first schedule before the habit has begun and reports a waiting change', () => {
    expect(scheduleForDisplay(h, '2026-09-01')).toEqual(days(1));
    expect(scheduleForDisplay(h, THU)).toEqual(days(2));
    expect(pendingSchedulePeriod(h, THU)).toEqual({ effectiveFrom: NEXT_MON, schedule: weekly(3) });
    expect(pendingSchedulePeriod(h, NEXT_MON)).toBeNull();
  });
});

describe('habitDayStatus', () => {
  // Mon+Wed habit that began on Monday 2026-09-28; the week of 2026-10-05 is in progress.
  const base = { startDate: '2026-09-28', schedule: days(1, 3) };

  it('is future after today, before-start before the start date, and completed with an entry', () => {
    const h = habit({ ...base, entries: [MON] });
    expect(habitDayStatus(h, FRI, THU)).toBe('future');
    expect(habitDayStatus(h, '2026-09-27', THU)).toBe('before-start');
    expect(habitDayStatus(h, MON, THU)).toBe('completed');
  });

  it('is missed ONLY for a scheduled weekday strictly before today with no entry', () => {
    const h = habit(base);
    expect(habitDayStatus(h, MON, THU)).toBe('missed');
    expect(habitDayStatus(h, WED, THU)).toBe('missed');
    expect(habitDayStatus(h, TUE, THU)).toBe('optional'); // not a scheduled weekday
    expect(habitDayStatus(h, THU, THU)).toBe('optional'); // today, not scheduled
    expect(habitDayStatus(h, '2026-09-28', THU)).toBe('missed'); // the start date itself counts
  });

  it('never calls today missed: a scheduled day that is today is pending until it has an entry', () => {
    const h = habit(base);
    expect(habitDayStatus(h, WED, WED)).toBe('pending');
    expect(habitDayStatus(habit({ ...base, entries: [WED] }), WED, WED)).toBe('completed');
    expect(habitDayStatus(h, WED, NEXT_MON)).toBe('missed');
  });

  it('has no miss for weekly or open habits on any day', () => {
    for (const schedule of [weekly(3), weekly(1), weekly(7), OPEN]) {
      const h = habit({ startDate: '2026-09-01', schedule });
      for (let date = '2026-09-01'; date <= '2026-10-08'; date = addDaysIso(date, 1)) {
        expect(['optional']).toContain(habitDayStatus(h, date, '2026-10-08'));
      }
    }
  });

  it('absence is not success: only an entry makes a day completed', () => {
    const h = habit({ startDate: '2026-09-01', schedule: EVERY });
    expect(habitDayStatus(h, '2026-09-15', THU)).toBe('missed');
    expect(habitDayStatus(habit({ startDate: '2026-09-01', schedule: OPEN }), '2026-09-15', THU)).toBe('optional');
  });

  it('judges each day by the schedule in effect on THAT day', () => {
    const h = habit({
      startDate: '2026-09-28',
      scheduleHistory: [{ effectiveFrom: '2026-09-28', schedule: days(1) }, { effectiveFrom: WED, schedule: days(2) }],
    });
    expect(habitDayStatus(h, MON, THU)).toBe('missed'); // Monday was scheduled when it happened
    expect(habitDayStatus(h, '2026-10-12', '2026-10-13')).toBe('optional'); // Monday is no longer scheduled
    expect(habitDayStatus(h, TUE, THU)).toBe('optional'); // Tuesday only became scheduled from Wednesday
    expect(habitDayStatus(h, '2026-10-13', '2026-10-14')).toBe('missed');
  });

  it('a pending future change does not apply before its effective date', () => {
    const h = habit({
      startDate: '2026-09-28',
      scheduleHistory: [{ effectiveFrom: '2026-09-28', schedule: days(1, 2, 3, 4, 5, 6, 7) }, { effectiveFrom: NEXT_MON, schedule: weekly(3) }],
    });
    expect(habitDayStatus(h, WED, THU)).toBe('missed');
    expect(habitDayStatus(h, NEXT_MON, '2026-10-14')).toBe('optional');
  });

  it('is identical for build and quit: the direction never inverts a day', () => {
    for (const schedule of [EVERY, days(1, 3), weekly(2), OPEN]) {
      const build = habit({ startDate: '2026-09-28', schedule, entries: [MON, '2026-10-09'], direction: 'build' });
      const quit = { ...build, direction: 'quit' as const };
      for (let date = '2026-09-25'; date <= '2026-10-15'; date = addDaysIso(date, 1)) {
        expect(habitDayStatus(quit, date, THU)).toBe(habitDayStatus(build, date, THU));
      }
    }
  });

  it('keeps a legacy future entry visible and clearable: status future, entry still present', () => {
    const h = habit({ startDate: '2026-09-01', schedule: EVERY, entries: ['2099-01-01'] });
    expect(habitDayStatus(h, '2099-01-01', THU)).toBe('future');
    expect(hasEntryOn(h, '2099-01-01')).toBe(true);
    expect(withDateCompleted(h, '2099-01-01', false, THU, makeId).logs).toEqual([]);
  });

  it('a legacy future entry, once cleared, cannot be created again while it is still the future', () => {
    const h = habit({ startDate: '2026-09-01', schedule: EVERY, entries: ['2099-01-01'] });
    const cleared = withDateCompleted(h, '2099-01-01', false, THU, makeId);
    expect(cleared.logs).toEqual([]);
    fails(() => withDateCompleted(cleared, '2099-01-01', true, THU, makeId), 'habit_date_future');
    expect(withDateCompleted(cleared, '2099-01-01', false, THU, makeId)).toBe(cleared); // clearing again is a no-op
  });

  it('clearing a past scheduled success makes that day missed again, and re-marking makes it completed (derived, nothing stored)', () => {
    const done = habit({ startDate: '2026-09-28', schedule: days(1, 3), entries: [MON] });
    expect(habitDayStatus(done, MON, THU)).toBe('completed');
    const cleared = withDateCompleted(done, MON, false, THU, makeId);
    expect(habitDayStatus(cleared, MON, THU)).toBe('missed');
    expect(Object.keys(cleared).sort()).toEqual(['createdAt', 'direction', 'id', 'logs', 'scheduleHistory', 'startDate', 'title']);
    expect(habitDayStatus(withDateCompleted(cleared, MON, true, THU, makeId), MON, THU)).toBe('completed');
  });

  it('is deterministic: the same inputs give the same answer however the clock moves', () => {
    const h = habit(base);
    const first = habitDayStatus(h, WED, THU);
    jest.useFakeTimers().setSystemTime(new Date('2031-05-05T12:00:00Z'));
    expect(habitDayStatus(h, WED, THU)).toBe(first);
    jest.useRealTimers();
  });

  it('isScheduledOn is false before the start date and for weekly and open schedules', () => {
    expect(isScheduledOn(habit({ startDate: WED, schedule: EVERY }), TUE)).toBe(false);
    expect(isScheduledOn(habit({ schedule: weekly(7) }), WED)).toBe(false);
    expect(isScheduledOn(habit({ schedule: OPEN }), WED)).toBe(false);
    expect(isScheduledOn(habit({ schedule: days(3) }), WED)).toBe(true);
  });
});

describe('week facts (ISO Monday to Sunday)', () => {
  it('weekdays: completed scheduled days of all scheduled days this week, with unscheduled entries kept apart', () => {
    const h = habit({ schedule: days(1, 3, 5), entries: [MON, WED, TUE] });
    expect(habitWeekFacts(h, THU)).toEqual({ kind: 'weekdays', scheduled: 3, completedScheduled: 2, completedOther: 1 });
  });

  it('weekdays: the denominator is the scheduled days of the WHOLE week, so Friday is counted on Thursday', () => {
    expect(habitWeekFacts(habit({ schedule: days(5) }), THU)).toMatchObject({ scheduled: 1, completedScheduled: 0 });
  });

  it('weekdays: a week that starts mid-week counts only days from the start date', () => {
    const h = habit({ startDate: WED, schedule: EVERY, entries: [WED] });
    expect(habitWeekFacts(h, THU)).toEqual({ kind: 'weekdays', scheduled: 5, completedScheduled: 1, completedOther: 0 });
  });

  it('weekdays: a schedule changed this week is counted per day', () => {
    const h = habit({
      startDate: '2026-09-28',
      scheduleHistory: [{ effectiveFrom: '2026-09-28', schedule: days(1, 2) }, { effectiveFrom: WED, schedule: days(3, 4) }],
      entries: [MON, WED],
    });
    // Mon (old schedule) + Tue (old) + Wed + Thu (new) = 4 scheduled days this week.
    expect(habitWeekFacts(h, THU)).toEqual({ kind: 'weekdays', scheduled: 4, completedScheduled: 2, completedOther: 0 });
  });

  it('weekly: entries of this week against the target; going over is reported as is', () => {
    expect(habitWeekFacts(habit({ schedule: weekly(3), entries: [MON, TUE] }), THU)).toEqual({ kind: 'weekly', target: 3, completed: 2 });
    expect(habitWeekFacts(habit({ schedule: weekly(3), entries: [MON, TUE, WED, THU] }), THU)).toEqual({ kind: 'weekly', target: 3, completed: 4 });
  });

  it('weekly: entries of an earlier week and a later (future) entry never count', () => {
    const h = habit({ schedule: weekly(3), entries: ['2026-10-04', MON, SUN] });
    expect(habitWeekFacts(h, THU)).toEqual({ kind: 'weekly', target: 3, completed: 1 });
  });

  it('open: just the entries of the week, with no target and no denominator', () => {
    expect(habitWeekFacts(habit({ schedule: OPEN, entries: [MON, WED] }), THU)).toEqual({ kind: 'open', completed: 2 });
  });

  it('turns over on Monday: Sunday is the last day of the old week', () => {
    const h = habit({ schedule: weekly(2), entries: [MON, SUN] });
    expect(habitWeekFacts(h, SUN)).toEqual({ kind: 'weekly', target: 2, completed: 2 });
    expect(habitWeekFacts(h, NEXT_MON)).toEqual({ kind: 'weekly', target: 2, completed: 0 });
  });

  it('has nothing to say before the habit has begun', () => {
    expect(habitWeekFacts(habit({ startDate: NEXT_MON }), THU)).toBeNull();
  });

  it('a week target follows a weekly change only from the Monday it took effect', () => {
    const h = habit({
      startDate: '2026-09-28',
      scheduleHistory: [{ effectiveFrom: '2026-09-28', schedule: days(1) }, { effectiveFrom: NEXT_MON, schedule: weekly(3) }],
      entries: [],
    });
    expect(habitWeekFacts(h, SUN)).toMatchObject({ kind: 'weekdays' });
    expect(habitWeekFacts(h, NEXT_MON)).toEqual({ kind: 'weekly', target: 3, completed: 0 });
  });

  it('weekEntryCount sums entries from the start of the ISO week through today, ignoring the future and earlier weeks', () => {
    const a = habit({ entries: ['2026-10-04', MON, THU, FRI] });
    const b = habit({ id: 'b', startDate: WED, entries: [WED] });
    expect(weekEntryCount([a, b], THU)).toBe(3);
    expect(weekEntryCount([], THU)).toBe(0);
  });
});

describe('today summary and scheduled-day outcomes', () => {
  it('counts only habits a weekdays schedule asks for today, and which of them are done', () => {
    const habits = [
      habit({ id: 'a', schedule: days(4), entries: [THU] }),
      habit({ id: 'b', schedule: days(4) }),
      habit({ id: 'c', schedule: days(3) }),
      habit({ id: 'd', schedule: weekly(3) }),
      habit({ id: 'e', schedule: OPEN, entries: [THU] }),
      habit({ id: 'f', schedule: EVERY, startDate: FRI }),
    ];
    expect(scheduledTodaySummary(habits, THU)).toEqual({ scheduled: 2, completed: 1 });
    expect(scheduledTodaySummary([], THU)).toEqual({ scheduled: 0, completed: 0 });
  });

  it('is exactly the completed / missed days of habitDayStatus on scheduled days, for any schedule history', () => {
    const h = habit({
      startDate: '2026-09-21',
      scheduleHistory: [
        { effectiveFrom: '2026-09-21', schedule: days(1, 3, 5) },
        { effectiveFrom: '2026-09-30', schedule: weekly(2) },
        { effectiveFrom: '2026-10-05', schedule: days(2, 4) },
      ],
      entries: ['2026-09-21', '2026-09-23', '2026-09-30', '2026-10-06', '2099-01-01'],
    });
    const expected: { date: string; completed: boolean }[] = [];
    for (let date = h.startDate; date <= THU; date = addDaysIso(date, 1)) {
      const status = habitDayStatus(h, date, THU);
      if (status === 'missed') expected.push({ date, completed: false });
      if (status === 'completed' && isScheduledOn(h, date)) expected.push({ date, completed: true });
    }
    expect(scheduledDayOutcomes([h], THU)).toEqual(expected);
    // Not vacuous: completed and missed days, across three schedule periods, with a weekly gap and a future entry.
    expect(expected.filter((entry) => entry.completed)).toHaveLength(3);
    expect(expected.filter((entry) => !entry.completed)).toHaveLength(2);
  });

  it('reports no outcome for weekly or open habits and none for an unfinished today', () => {
    expect(scheduledDayOutcomes([habit({ schedule: weekly(3), entries: [MON] }), habit({ schedule: OPEN })], THU)).toEqual([]);
    expect(scheduledDayOutcomes([habit({ startDate: THU, schedule: EVERY })], THU)).toEqual([]);
  });
});

describe('buildHabit', () => {
  const input = { title: '  Walk  ', direction: 'build' as const, schedule: days(5, 1) };

  it('counts from the device-local date, not the UTC date of createdAt', () => {
    // 00:30 on 8 October in Copenhagen is 22:30 on 7 October UTC.
    const built = buildHabit(input, 'id1', '2026-10-07T22:30:00.000Z', '2026-10-08');
    expect(built.startDate).toBe('2026-10-08');
    expect(built.createdAt).toBe('2026-10-07T22:30:00.000Z');
    expect(built.scheduleHistory).toEqual([{ effectiveFrom: '2026-10-08', schedule: days(1, 5) }]);
    expect(built).toMatchObject({ id: 'id1', title: 'Walk', direction: 'build', logs: [] });
    expect(decodeHabit(built)).toEqual(built);
  });

  it('accepts every schedule kind for a new habit, including open', () => {
    for (const schedule of [EVERY, days(2), weekly(1), weekly(7), OPEN]) {
      expect(decodeHabit(buildHabit({ ...input, schedule }, 'i', '2026-10-08T10:00:00.000Z', THU))).not.toBeNull();
    }
  });

  it('refuses invalid input with a fixed code', () => {
    const at = (patch: object) => () => buildHabit({ ...input, ...patch } as never, 'i', '2026-10-08T10:00:00.000Z', THU);
    fails(at({ title: '   ' }), 'habit_title_invalid');
    fails(at({ title: 7 }), 'habit_title_invalid');
    fails(at({ direction: 'maintain' }), 'habit_direction_invalid');
    fails(at({ schedule: weekly(0) }), 'habit_schedule_invalid');
    fails(at({ schedule: undefined }), 'habit_schedule_invalid');
    fails(at({ targetPerWeek: 3 }), 'habit_field_invalid');
    fails(() => buildHabit(input, 'i', '2026-10-08T10:00:00.000Z', '2026-02-30'), 'habit_date_invalid');
    fails(() => buildHabit(input, 'i', '2026-10-08T10:00:00.000Z', '2026-10-08T00:00:00Z'), 'habit_date_invalid');
  });
});

describe('direction', () => {
  it('can change while there are no entries, and is locked once there is one', () => {
    const fresh = habit();
    expect(updateHabitFields(fresh, { direction: 'quit' }).direction).toBe('quit');
    const logged = habit({ entries: [MON] });
    fails(() => updateHabitFields(logged, { direction: 'quit' }), 'habit_direction_locked');
    expect(updateHabitFields(logged, { direction: 'build' })).toBe(logged); // same value is not a change
    expect(updateHabitFields(logged, { title: 'Renamed' })).toMatchObject({ title: 'Renamed', direction: 'build' });
  });

  it('is unlocked again once every entry is cleared', () => {
    const cleared = withDateCompleted(habit({ entries: [MON] }), MON, false, THU, makeId);
    expect(updateHabitFields(cleared, { direction: 'quit' }).direction).toBe('quit');
  });

  it('validates title and direction and rejects unknown fields', () => {
    fails(() => updateHabitFields(habit(), { title: '  ' }), 'habit_title_invalid');
    fails(() => updateHabitFields(habit(), { direction: 'sideways' as never }), 'habit_direction_invalid');
    fails(() => updateHabitFields(habit(), { startDate: '2020-01-01' } as never), 'habit_field_invalid');
    fails(() => updateHabitFields(habit(), { targetPerWeek: 2 } as never), 'habit_field_invalid');
    const same = habit();
    expect(updateHabitFields(same, { title: ' Habit ' })).toBe(same);
    expect(updateHabitFields(same, {})).toBe(same);
  });
});

describe('when a schedule change takes effect', () => {
  const WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];

  it('is today for every change between non-weekly schedules, on every weekday', () => {
    for (const today of WEEK) {
      expect(scheduleChangeEffectiveFrom(days(1), days(2), today)).toBe(today);
      expect(scheduleChangeEffectiveFrom(days(1), OPEN, today)).toBe(today);
      expect(scheduleChangeEffectiveFrom(OPEN, EVERY, today)).toBe(today);
    }
  });

  it('is the next ISO Monday when the old OR the new schedule is weekly', () => {
    const expected = [MON, NEXT_MON, NEXT_MON, NEXT_MON, NEXT_MON, NEXT_MON, NEXT_MON];
    WEEK.forEach((today, i) => {
      expect(scheduleChangeEffectiveFrom(days(1), weekly(3), today)).toBe(expected[i]);
      expect(scheduleChangeEffectiveFrom(weekly(3), days(1), today)).toBe(expected[i]);
      expect(scheduleChangeEffectiveFrom(weekly(3), weekly(4), today)).toBe(expected[i]);
      expect(scheduleChangeEffectiveFrom(OPEN, weekly(2), today)).toBe(expected[i]);
      expect(scheduleChangeEffectiveFrom(weekly(2), OPEN, today)).toBe(expected[i]);
    });
  });

  it('crosses a month and year boundary correctly', () => {
    expect(scheduleChangeEffectiveFrom(OPEN, weekly(2), '2026-12-30')).toBe('2027-01-04');
    expect(scheduleChangeEffectiveFrom(OPEN, weekly(2), '2026-09-30')).toBe('2026-10-05');
  });
});

describe('changing a schedule', () => {
  const start = '2026-09-28'; // a Monday
  const base = () => habit({ startDate: start, schedule: days(1, 3) });

  it('Wednesday, neither weekly: takes effect today, and the past keeps the old schedule', () => {
    const next = withSchedule(base(), days(2), WED);
    expect(next.scheduleHistory).toEqual([
      { effectiveFrom: start, schedule: days(1, 3) },
      { effectiveFrom: WED, schedule: days(2) },
    ]);
    expect(habitDayStatus(next, MON, WED)).toBe('missed'); // Monday was scheduled then
    expect(habitDayStatus(next, TUE, WED)).toBe('optional'); // Tuesday was not, and the change starts on Wednesday
    expect(habitDayStatus(next, WED, WED)).toBe('optional'); // Wednesday is no longer scheduled
    expect(habitDayStatus(next, '2026-10-13', '2026-10-14')).toBe('missed');
  });

  it('Wednesday, to weekly: waits for the next Monday, and this week stays as it was', () => {
    const next = withSchedule(base(), weekly(3), WED);
    expect(next.scheduleHistory).toEqual([
      { effectiveFrom: start, schedule: days(1, 3) },
      { effectiveFrom: NEXT_MON, schedule: weekly(3) },
    ]);
    expect(scheduleOn(next, WED)).toEqual(days(1, 3));
    expect(habitDayStatus(next, WED, WED)).toBe('pending');
    expect(habitWeekFacts(next, THU)).toMatchObject({ kind: 'weekdays' });
    expect(habitWeekFacts(next, NEXT_MON)).toMatchObject({ kind: 'weekly', target: 3 });
  });

  it('Wednesday, from weekly: waits for the next Monday', () => {
    const weeklyHabit = habit({ startDate: start, schedule: weekly(3) });
    const next = withSchedule(weeklyHabit, days(1, 3), WED);
    expect(next.scheduleHistory[1]).toEqual({ effectiveFrom: NEXT_MON, schedule: days(1, 3) });
    expect(habitWeekFacts(next, THU)).toEqual({ kind: 'weekly', target: 3, completed: 0 });
  });

  it('Wednesday, weekly to a different weekly target: waits for the next Monday', () => {
    const next = withSchedule(habit({ startDate: start, schedule: weekly(3) }), weekly(4), WED);
    expect(next.scheduleHistory[1]).toEqual({ effectiveFrom: NEXT_MON, schedule: weekly(4) });
    expect(habitWeekFacts(next, THU)).toMatchObject({ target: 3 });
  });

  it('Monday, to weekly: takes effect today', () => {
    const next = withSchedule(base(), weekly(2), MON);
    expect(next.scheduleHistory[1]).toEqual({ effectiveFrom: MON, schedule: weekly(2) });
    expect(habitWeekFacts(next, MON)).toMatchObject({ kind: 'weekly', target: 2 });
  });

  it('every other weekday waits for the next Monday', () => {
    for (const today of [TUE, WED, THU, FRI, '2026-10-10', SUN]) {
      expect(withSchedule(base(), weekly(2), today).scheduleHistory[1].effectiveFrom).toBe(NEXT_MON);
    }
  });

  it('a second change on the same day replaces the period that began today instead of stacking', () => {
    const once = withSchedule(base(), days(2), WED);
    const twice = withSchedule(once, days(4), WED);
    expect(twice.scheduleHistory).toEqual([
      { effectiveFrom: start, schedule: days(1, 3) },
      { effectiveFrom: WED, schedule: days(4) },
    ]);
  });

  it('changing back to what the previous period had leaves no redundant period', () => {
    const once = withSchedule(base(), days(2), WED);
    const back = withSchedule(once, days(1, 3), WED);
    expect(back.scheduleHistory).toEqual([{ effectiveFrom: start, schedule: days(1, 3) }]);
  });

  it('a no-op returns the very same habit', () => {
    const h = base();
    expect(withSchedule(h, days(1, 3), WED)).toBe(h);
    expect(withSchedule(h, { kind: 'weekdays', days: [3, 1] }, WED)).toBe(h);
  });

  it('a newer decision supersedes a change still waiting for Monday, and choosing the current schedule cancels it', () => {
    const waiting = withSchedule(base(), weekly(3), WED);
    const newer = withSchedule(waiting, weekly(4), THU);
    expect(newer.scheduleHistory).toEqual([
      { effectiveFrom: start, schedule: days(1, 3) },
      { effectiveFrom: NEXT_MON, schedule: weekly(4) },
    ]);
    const cancelled = withSchedule(waiting, days(1, 3), THU);
    expect(cancelled.scheduleHistory).toEqual([{ effectiveFrom: start, schedule: days(1, 3) }]);
    expect(pendingSchedulePeriod(cancelled, THU)).toBeNull();
    expect(withSchedule(waiting, weekly(3), THU)).toEqual(waiting);
  });

  it('a non-weekly change made while a weekly one waits takes effect today and drops the waiting one', () => {
    const waiting = withSchedule(base(), weekly(3), WED);
    const next = withSchedule(waiting, days(2), THU);
    expect(next.scheduleHistory).toEqual([
      { effectiveFrom: start, schedule: days(1, 3) },
      { effectiveFrom: THU, schedule: days(2) },
    ]);
  });

  it('never edits a period that has already begun, except one that began today', () => {
    let h = base();
    h = withSchedule(h, days(2), TUE);
    h = withSchedule(h, OPEN, THU);
    const [first, second] = h.scheduleHistory;
    const later = withSchedule(h, days(5), FRI);
    expect(later.scheduleHistory[0]).toEqual(first);
    expect(later.scheduleHistory[1]).toEqual(second);
    expect(later.scheduleHistory).toHaveLength(4);
  });

  it('on the start date itself the first period is replaced, so it keeps starting on the start date', () => {
    const fresh = habit({ startDate: THU, schedule: EVERY });
    const next = withSchedule(fresh, days(2), THU);
    expect(next.scheduleHistory).toEqual([{ effectiveFrom: THU, schedule: days(2) }]);
    const toWeekly = withSchedule(fresh, weekly(3), THU);
    expect(toWeekly.scheduleHistory).toEqual([{ effectiveFrom: THU, schedule: EVERY }, { effectiveFrom: NEXT_MON, schedule: weekly(3) }]);
  });

  it('treats a clock earlier than the start date as the start date', () => {
    const future = habit({ startDate: NEXT_MON, schedule: EVERY });
    const next = withSchedule(future, days(2), THU);
    expect(next.scheduleHistory).toEqual([{ effectiveFrom: NEXT_MON, schedule: days(2) }]);
  });

  it('refuses an invalid schedule and leaves the habit untouched', () => {
    const h = base();
    fails(() => withSchedule(h, weekly(9), WED), 'habit_schedule_invalid');
    fails(() => withSchedule(h, { kind: 'weekdays', days: [] }, WED), 'habit_schedule_invalid');
    fails(() => withSchedule(h, days(1), '2026-13-01'), 'habit_date_invalid');
    expect(h.scheduleHistory).toHaveLength(1);
  });

  it('keeps every invariant under any sequence of changes (seeded random walk)', () => {
    let seed = 20261008;
    const random = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };
    const pick = (): HabitSchedule => [EVERY, days(1, 3), days(2), weekly(2), weekly(5), OPEN][random(6)];
    for (let run = 0; run < 150; run += 1) {
      let h = habit({ startDate: '2026-09-01', schedule: pick() });
      let today = '2026-09-01';
      for (let step = 0; step < 25; step += 1) {
        today = addDaysIso(today, random(5));
        const before = h.scheduleHistory;
        h = withSchedule(h, pick(), today);
        expect(decodeHabit(h)).not.toBeNull(); // first = start date, strictly increasing, valid kinds
        // History is append-only for periods that had begun before this change, bar the one that began today.
        before.filter((period) => period.effectiveFrom < today).forEach((period) => {
          expect(h.scheduleHistory.find((entry) => entry.effectiveFrom === period.effectiveFrom)).toEqual(period);
        });
        // A boundary that involves a weekly schedule always lies on a Monday (or is the first period).
        h.scheduleHistory.forEach((period, i) => {
          if (i === 0) return;
          const previous = h.scheduleHistory[i - 1].schedule;
          if (previous.kind === 'weekly' || period.schedule.kind === 'weekly') expect(isoWeekday(period.effectiveFrom)).toBe(1);
        });
        // No two adjacent periods are equal.
        h.scheduleHistory.slice(1).forEach((period, i) => {
          expect(schedulesEqual(period.schedule, h.scheduleHistory[i].schedule)).toBe(false);
        });
      }
    }
  });
});

describe('every schedule change, from every kind to every kind, on a Wednesday and on a Monday', () => {
  const START = '2026-09-14'; // a Monday
  const kinds: Array<[string, HabitSchedule]> = [['weekdays', days(1, 3)], ['weekly', weekly(3)], ['open', OPEN]];
  const targets: Array<[string, HabitSchedule]> = [['weekdays', days(2, 4)], ['weekly', weekly(2)], ['open', OPEN]];
  const logged = ['2026-09-14', '2026-09-16', '2026-09-30'];

  for (const [today, label] of [[WED, 'Wednesday'], [MON, 'Monday']] as const) {
    for (const [oldName, from] of kinds) {
      for (const [newName, to] of targets) {
        if (schedulesEqual(from, to)) continue; // identical schedules are a no-op, asserted separately below
        it(`${label}: ${oldName} -> ${newName}`, () => {
          const before = habit({ startDate: START, schedule: from, entries: logged });
          const after = withSchedule(before, to, today);
          const involvesWeekly = from.kind === 'weekly' || to.kind === 'weekly';
          const effective = involvesWeekly && today !== MON ? NEXT_MON : today;
          expect(after.scheduleHistory.at(-1)).toEqual({ effectiveFrom: effective, schedule: to });
          expect(after.scheduleHistory[0]).toEqual(before.scheduleHistory[0]); // the original period is untouched
          expect(after.logs).toBe(before.logs); // entries are not touched either
          // No retroactive rewrite: every date before the effective date still resolves, and is judged by, the old schedule.
          for (let date = START; date < effective; date = addDaysIso(date, 1)) {
            expect(scheduleOn(after, date)).toEqual(from);
            expect(habitDayStatus(after, date, effective)).toBe(habitDayStatus(before, date, effective));
          }
          expect(scheduleOn(after, effective)).toEqual(to);
          expect(scheduleOn(after, addDaysIso(effective, 30))).toEqual(to);
          // Until the effective date, "now" still follows the old schedule (the Wednesday weekly change has not started).
          expect(scheduleOn(after, today)).toEqual(effective === today ? to : from);
          expect(decodeHabit(after)).not.toBeNull();
        });
      }
    }
  }

  it('the same schedule is a no-op on both days', () => {
    for (const [, schedule] of kinds) {
      const h = habit({ startDate: START, schedule });
      expect(withSchedule(h, schedule, WED)).toBe(h);
      expect(withSchedule(h, schedule, MON)).toBe(h);
    }
  });

  it('a Wednesday weekly change followed by a Thursday non-weekly one leaves exactly one future-or-current boundary', () => {
    const first = withSchedule(habit({ startDate: START, schedule: days(1, 3) }), weekly(3), WED);
    const second = withSchedule(first, OPEN, THU);
    expect(second.scheduleHistory.map((period) => period.effectiveFrom)).toEqual([START, THU]);
    expect(second.scheduleHistory.filter((period) => period.effectiveFrom > THU)).toEqual([]);
  });

  it('never more than one boundary after today, however often the user changes their mind before Monday', () => {
    let h = habit({ startDate: START, schedule: days(1, 3) });
    for (const next of [weekly(3), weekly(4), days(5), weekly(1), OPEN, weekly(7)]) {
      h = withSchedule(h, next, WED);
      expect(h.scheduleHistory.filter((period) => period.effectiveFrom > WED).length).toBeLessThanOrEqual(1);
    }
    expect(h.scheduleHistory.at(-1)).toEqual({ effectiveFrom: NEXT_MON, schedule: weekly(7) });
  });
});

describe('marking and clearing a date', () => {
  const started = () => habit({ startDate: '2026-09-28', schedule: days(1, 3) });

  it('marks today, a past date and the start date as completed', () => {
    let h = started();
    for (const date of [THU, MON, '2026-09-28']) h = withDateCompleted(h, date, true, THU, makeId);
    expect(h.logs.map((log) => log.date)).toEqual([THU, MON, '2026-09-28']);
  });

  it('is idempotent: marking twice keeps one entry with the same id; clearing twice is harmless', () => {
    const once = withDateCompleted(started(), MON, true, THU, makeId);
    const id = once.logs[0].id;
    const twice = withDateCompleted(once, MON, true, THU, () => 'must-not-be-used');
    expect(twice).toBe(once);
    expect(twice.logs).toEqual([{ id, date: MON }]);
    const cleared = withDateCompleted(twice, MON, false, THU, makeId);
    expect(cleared.logs).toEqual([]);
    expect(withDateCompleted(cleared, MON, false, THU, makeId)).toBe(cleared);
  });

  it('clearing touches only that date', () => {
    const h = habit({ startDate: '2026-09-28', entries: [MON, TUE, WED] });
    expect(withDateCompleted(h, TUE, false, THU, makeId).logs.map((log) => log.date)).toEqual([MON, WED]);
  });

  it('refuses a future completion and a completion before the start date', () => {
    const h = started();
    fails(() => withDateCompleted(h, FRI, true, THU, makeId), 'habit_date_future');
    fails(() => withDateCompleted(h, '2026-09-27', true, THU, makeId), 'habit_date_before_start');
    expect(h.logs).toEqual([]);
  });

  it('can correct any earlier day with no time cutoff', () => {
    const old = habit({ startDate: '2025-01-01', schedule: EVERY });
    const marked = withDateCompleted(old, '2025-01-01', true, THU, makeId);
    expect(marked.logs).toHaveLength(1);
    expect(withDateCompleted(marked, '2025-01-01', false, THU, makeId).logs).toHaveLength(0);
  });

  it('refuses malformed dates and a non-boolean outcome', () => {
    const h = started();
    for (const date of ['2026-10-8', '2026-10-08T00:00:00.000Z', '2026-02-30', '', 'today']) {
      fails(() => withDateCompleted(h, date, true, THU, makeId), 'habit_date_invalid');
    }
    fails(() => withDateCompleted(h, MON, 'yes' as never, THU, makeId), 'habit_field_invalid');
    fails(() => withDateCompleted(h, MON, true, 'not a date', makeId), 'habit_date_invalid');
  });

  it('never produces a second entry for a date, whatever the sequence', () => {
    let seed = 7;
    const random = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    let h = habit({ startDate: '2026-09-01', schedule: EVERY });
    for (let i = 0; i < 400; i += 1) {
      const date = addDaysIso('2026-09-01', random(37));
      h = withDateCompleted(h, date, random(3) > 0, THU, makeId);
      const dates = h.logs.map((log) => log.date);
      expect(new Set(dates).size).toBe(dates.length);
      expect(decodeHabit(h)).not.toBeNull();
    }
  });

  it('behaves the same for build and quit', () => {
    const build = habit({ startDate: '2026-09-28', direction: 'build' });
    const quit = { ...build, direction: 'quit' as const };
    const mark = (h: Habit) => withDateCompleted(h, MON, true, THU, () => 'x').logs;
    expect(mark(quit)).toEqual(mark(build));
  });
});
