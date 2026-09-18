import fs from 'fs';
import path from 'path';

import { minorUnits } from '@/core/money/minorUnits';
import type { SavingsContribution, SavingsGoal } from '@/types/savingsGoal';
import { summarizeSavingsHistory } from '@/utils/savings/savingsHistorySummary';
import {
  estimateMonthsToGoal,
  isDeadlineOverdue,
  monthlyRateForDisplay,
  monthsUntilDeadline,
  requiredMonthlyAmount,
} from '@/utils/savings/savingsPace';

/**
 * APP-043 derived pace values. They are display calculations, never persisted
 * money, and a deadline that has passed is reported as passed — it is never
 * turned into "one month left".
 */

const m = minorUnits;
const TODAY = '2026-09-18';
const goal = (savedAmount: number, deadline?: string, targetAmount = 12_000_00): SavingsGoal => ({
  id: 'g', name: 'Synthetic', icon: 'other', targetAmount: m(targetAmount), savedAmount: m(savedAmount),
  createdAt: '2026-01-01T00:00:00.000Z', ...(deadline === undefined ? {} : { deadline }),
});
const entry = (amount: number, date: string, goalId = 'g'): SavingsContribution => ({ id: `${goalId}-${date}-${amount}`, goalId, amount: m(amount), date });

describe('APP-043 deadline arithmetic', () => {
  it('no deadline: no required rate, no months, never overdue', () => {
    expect(requiredMonthlyAmount(goal(0), TODAY)).toBeNull();
    expect(monthsUntilDeadline(goal(0), TODAY)).toBeNull();
    expect(isDeadlineOverdue(goal(0), TODAY)).toBe(false);
  });

  it('future deadline: whole calendar months from this month', () => {
    const g = goal(0, '2027-03-15');
    expect(monthsUntilDeadline(g, TODAY)).toBe(6);
    expect(requiredMonthlyAmount(g, TODAY)).toBe(2_000_00);
    expect(isDeadlineOverdue(g, TODAY)).toBe(false);
  });

  it('deadline later this month, or today: the current month is the one month left', () => {
    for (const deadline of ['2026-09-30', TODAY]) {
      expect(monthsUntilDeadline(goal(2_000_00, deadline), TODAY)).toBe(1);
      expect(requiredMonthlyAmount(goal(2_000_00, deadline), TODAY)).toBe(10_000_00);
      expect(isDeadlineOverdue(goal(2_000_00, deadline), TODAY)).toBe(false);
    }
  });

  it('past deadline: overdue, and no fake "one month remaining" rate', () => {
    for (const deadline of ['2026-09-17', '2026-08-31', '2020-01-31']) {
      const g = goal(2_000_00, deadline);
      expect(isDeadlineOverdue(g, TODAY)).toBe(true);
      expect(monthsUntilDeadline(g, TODAY)).toBeNull();
      expect(requiredMonthlyAmount(g, TODAY)).toBeNull();
    }
  });

  it('a reached (or overfunded) goal needs nothing and is never overdue, whatever the deadline', () => {
    for (const saved of [12_000_00, 15_000_01]) {
      for (const deadline of ['2026-09-17', '2027-03-15']) {
        expect(requiredMonthlyAmount(goal(saved, deadline), TODAY)).toBe(0);
        expect(isDeadlineOverdue(goal(saved, deadline), TODAY)).toBe(false);
      }
    }
  });

  it('months are read from the date text, not from a UTC-parsed Date that could shift the month', () => {
    // new Date('2026-10-01') is 30 September in any timezone west of UTC.
    expect(monthsUntilDeadline(goal(0, '2026-10-01'), '2026-09-30')).toBe(1);
    expect(monthsUntilDeadline(goal(0, '2027-01-01'), '2026-12-31')).toBe(1);
    expect(monthsUntilDeadline(goal(0, '2027-12-31'), '2027-01-01')).toBe(11);
  });

  it('an unreadable legacy deadline yields no rate instead of NaN', () => {
    expect(requiredMonthlyAmount(goal(0, '2026-02-30'), TODAY)).toBeNull();
    expect(isDeadlineOverdue(goal(0, '2026-02-30'), TODAY)).toBe(false);
  });

  it('display rounding is unchanged (nearest whole krone) and the rate is never stored', () => {
    expect(monthlyRateForDisplay(2_000_00 / 3)).toBe(667_00);
    expect(monthlyRateForDisplay(49)).toBe(0);
  });
});

describe('APP-043 pace estimate from history', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-18T12:00:00Z')); });
  afterEach(() => jest.useRealTimers());

  it('no deposit history: no estimate', () => {
    expect(estimateMonthsToGoal(goal(0), [])).toBeNull();
    expect(estimateMonthsToGoal(goal(0), [entry(-100, '2026-09-01T00:00:00.000Z')])).toBeNull();
  });

  it('reached or overfunded: zero months', () => {
    expect(estimateMonthsToGoal(goal(12_000_00), [])).toBe(0);
    expect(estimateMonthsToGoal(goal(15_000_01), [entry(15_000_01, '2026-09-01T00:00:00.000Z')])).toBe(0);
  });

  it('averages deposits per month since the first deposit; withdrawals and other goals do not count (existing rule)', () => {
    const history = [
      entry(1_000_00, '2026-07-02T00:00:00.000Z'),
      entry(1_000_00, '2026-08-02T00:00:00.000Z'),
      entry(-500_00, '2026-08-20T00:00:00.000Z'),
      entry(1_000_00, '2026-09-02T00:00:00.000Z'),
      entry(9_000_00, '2026-09-02T00:00:00.000Z', 'other-goal'),
    ];
    // 3 000 kr. over July–September = 1 000 kr./month; 9 500 kr. remaining → 10 months.
    expect(estimateMonthsToGoal(goal(2_500_00), history)).toBe(10);
  });
});

describe('APP-043 history summary (the chart as text)', () => {
  it('has nothing to say about no history', () => {
    expect(summarizeSavingsHistory([])).toBeNull();
  });

  it('reports count, first and last date, amounts in and out, and the net — in chart order', () => {
    const summary = summarizeSavingsHistory([
      entry(-250, '2026-09-10T08:00:00.000Z'),
      entry(1_000, '2026-09-01T08:00:00.000Z'),
      entry(500, '2026-09-05T08:00:00.000Z'),
      entry(-1_250, '2026-09-12T08:00:00.000Z'),
    ]);
    expect(summary).toEqual({
      count: 4,
      firstDate: '2026-09-01T08:00:00.000Z',
      lastDate: '2026-09-12T08:00:00.000Z',
      added: 1_500,
      takenOut: 1_500,
      net: 0,
    });
  });
});

describe('APP-043 date boundary', () => {
  it('Savings reads calendar dates through the shared date helper, not through Economy recurrence', () => {
    const dir = path.join(__dirname, '../utils/savings');
    for (const file of fs.readdirSync(dir)) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      expect({ file, importsRecurrence: source.includes('core/economy/recurrence') }).toEqual({ file, importsRecurrence: false });
    }
  });
});
