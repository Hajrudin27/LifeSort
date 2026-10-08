import { scheduledDayOutcomes } from '@/features/habits/domain/habitStatus';
import { computeHabitRateByPhase } from '@/utils/cycle/cycleInsights';
import type { Habit, HabitSchedule } from '@/types/life';

/**
 * APP-064. The Cycle insights card joins habit behaviour to cycle phase. After the change it reads
 * plain dated outcomes (scheduled days only), so a day nothing was expected of is neither a success
 * nor a failure and a weekly or open habit contributes nothing.
 */
const cycles = [{ id: 'c', startDate: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z' }];
// With a 28-day cycle, 5-day period and 14-day luteal phase: days 1-5 menstrual, 6-9 follicular, 10-15 fertile, 16-28 luteal.
const rate = (outcomes: { date: string; completed: boolean }[]) => computeHabitRateByPhase(outcomes, cycles, 28, 5, 14);

const habit = (schedule: HabitSchedule, entries: string[], startDate = '2026-09-01'): Habit => ({
  id: 'h', title: 'H', direction: 'build', createdAt: `${startDate}T10:00:00.000Z`, startDate,
  scheduleHistory: [{ effectiveFrom: startDate, schedule }], logs: entries.map((date, i) => ({ id: `e${i}`, date })),
});

describe('computeHabitRateByPhase', () => {
  it('counts completed and scheduled-and-missed days per phase', () => {
    const result = rate([
      { date: '2026-09-02', completed: true }, // day 2: menstrual
      { date: '2026-09-03', completed: false }, // day 3: menstrual
      { date: '2026-09-20', completed: true }, // day 20: luteal
    ]);
    expect(result.menstrual).toEqual({ logged: 1, possible: 2, rate: 0.5 });
    expect(result.luteal).toEqual({ logged: 1, possible: 1, rate: 1 });
    expect(result.follicular).toEqual({ logged: 0, possible: 0, rate: 0 });
  });

  it('ignores dates before the first recorded cycle', () => {
    expect(rate([{ date: '2026-08-15', completed: true }]).menstrual.possible).toBe(0);
  });

  it('takes no schedule or habit shape: it cannot treat absence as failure by itself', () => {
    expect(computeHabitRateByPhase.length).toBe(5);
  });
});

describe('scheduledDayOutcomes feeding the insights', () => {
  const TODAY = '2026-09-20';

  it('a weekly or open habit contributes no outcome at all, however few entries it has', () => {
    const outcomes = scheduledDayOutcomes([habit({ kind: 'weekly', target: 3 }, ['2026-09-02']), habit({ kind: 'open' }, [])], TODAY);
    expect(outcomes).toEqual([]);
    expect(rate(outcomes).menstrual.possible).toBe(0);
  });

  it('a weekdays habit contributes only the days it asked for: Monday and Wednesday', () => {
    // 2026-09-14 is a Monday and today: it is still open, so it is not a miss.
    const outcomes = scheduledDayOutcomes([habit({ kind: 'weekdays', days: [1, 3] }, ['2026-09-02', '2026-09-07'])], '2026-09-14');
    expect(outcomes.map((entry) => `${entry.date}:${entry.completed}`)).toEqual([
      '2026-09-02:true', '2026-09-07:true', '2026-09-09:false',
    ]);
  });

  it('days before the start date are not counted, and an unfinished today is not a miss', () => {
    const outcomes = scheduledDayOutcomes([habit({ kind: 'weekdays', days: [1, 2, 3, 4, 5, 6, 7] }, [], '2026-09-18')], TODAY);
    expect(outcomes).toEqual([
      { date: '2026-09-18', completed: false }, { date: '2026-09-19', completed: false },
    ]);
  });

  it('is a function of its inputs only: the clock does not change it', () => {
    const habits = [habit({ kind: 'weekdays', days: [1, 3] }, ['2026-09-02'])];
    const first = scheduledDayOutcomes(habits, '2026-09-14');
    jest.useFakeTimers().setSystemTime(new Date('2040-01-01T00:00:00Z'));
    expect(scheduledDayOutcomes(habits, '2026-09-14')).toEqual(first);
    jest.useRealTimers();
  });
});
