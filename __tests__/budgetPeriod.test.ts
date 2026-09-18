/// <reference types="node" />

import { spawnSync } from 'child_process';
import path from 'path';

import {
  addMonthsToMonthKey,
  BUDGET_TIME_ZONE,
  budgetPeriodDaysFrom,
  budgetPeriodForCalendarDate,
  budgetPeriodForInstant,
  budgetPeriodForRecordedDate,
  isoWeekdayOf,
  isoWeeksInMonth,
} from '@/core/dates/budgetPeriod';
import { emulateUtcHost } from './helpers/utcHost';

/**
 * APP-045: one instant maps to one Europe/Copenhagen budget period, on every
 * device. Every fixture is an explicit UTC instant or a calendar date; none
 * depends on the timezone of the machine running the test.
 * See docs/app-045-budget-periods.md and ADR-0037.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const at = (iso: string) => budgetPeriodForInstant(new Date(iso));
const period = (dateKey: string, monthKey: string, weekKey: string) => ({ dateKey, monthKey, weekKey });

describe('APP-045 Copenhagen calendar boundaries', () => {
  it('changes the date exactly at Copenhagen midnight, in winter (UTC+1) and summer (UTC+2)', () => {
    expect(at('2026-01-14T22:59:59.999Z')).toEqual(period('2026-01-14', '2026-01', '2026-W03'));
    expect(at('2026-01-14T23:00:00.000Z')).toEqual(period('2026-01-15', '2026-01', '2026-W03'));
    expect(at('2026-06-14T21:59:59.999Z')).toEqual(period('2026-06-14', '2026-06', '2026-W24'));
    expect(at('2026-06-14T22:00:00.000Z')).toEqual(period('2026-06-15', '2026-06', '2026-W25'));
  });

  it('turns August into September at Copenhagen midnight, not at the UTC one', () => {
    expect(at('2026-08-31T21:59:59.999Z').monthKey).toBe('2026-08');
    expect(at('2026-08-31T22:00:00.000Z')).toEqual(period('2026-09-01', '2026-09', '2026-W36'));
    // Still 31 August in UTC, already 1 September in Copenhagen.
    expect(at('2026-08-31T23:30:00.000Z').monthKey).toBe('2026-09');
    // The UTC boundary itself is not a budget boundary.
    expect(at('2026-09-01T00:00:00.000Z').dateKey).toBe('2026-09-01');
  });

  it('crosses the year: new date and month, while the ISO week-year stays 2026', () => {
    expect(at('2026-12-31T22:59:59.999Z')).toEqual(period('2026-12-31', '2026-12', '2026-W53'));
    expect(at('2026-12-31T23:00:00.000Z')).toEqual(period('2027-01-01', '2027-01', '2026-W53'));
    expect(at('2027-01-03T22:59:59.999Z').weekKey).toBe('2026-W53'); // Sunday 3 January 2027
    expect(at('2027-01-03T23:00:00.000Z')).toEqual(period('2027-01-04', '2027-01', '2027-W01'));
  });

  it('uses the ISO week-year, not the calendar year, at both ends of the year', () => {
    expect(budgetPeriodForCalendarDate('2021-01-01')?.weekKey).toBe('2020-W53'); // January in the previous week-year
    expect(budgetPeriodForCalendarDate('2021-01-04')?.weekKey).toBe('2021-W01');
    expect(budgetPeriodForCalendarDate('2025-12-29')?.weekKey).toBe('2026-W01'); // December in the next week-year
    expect(budgetPeriodForCalendarDate('2024-12-30')?.weekKey).toBe('2025-W01');
    expect(budgetPeriodForCalendarDate('2020-12-31')?.weekKey).toBe('2020-W53'); // week 53
  });

  it('keeps a leap day as its own date, month and week', () => {
    expect(at('2028-02-28T22:59:59.999Z').dateKey).toBe('2028-02-28');
    expect(at('2028-02-28T23:00:00.000Z')).toEqual(period('2028-02-29', '2028-02', '2028-W09'));
    expect(at('2028-02-29T23:00:00.000Z')).toEqual(period('2028-03-01', '2028-03', '2028-W09'));
  });

  it('classifies both sides of the spring-forward change (29 March 2026, 01:00 UTC)', () => {
    // 01:59:59.999 CET, then straight to 03:00 CEST: one day, one month, one week.
    expect(at('2026-03-29T00:59:59.999Z')).toEqual(period('2026-03-29', '2026-03', '2026-W13'));
    expect(at('2026-03-29T01:00:00.000Z')).toEqual(period('2026-03-29', '2026-03', '2026-W13'));
    // The first CEST midnight is 22:00 UTC.
    expect(at('2026-03-29T21:59:59.999Z').dateKey).toBe('2026-03-29');
    expect(at('2026-03-29T22:00:00.000Z')).toEqual(period('2026-03-30', '2026-03', '2026-W14'));
  });

  it('classifies both instants of the repeated hour when summer time ends (25 October 2026)', () => {
    // 02:30 CEST and, an hour later, 02:30 CET: the same local time twice.
    expect(at('2026-10-25T00:30:00.000Z')).toEqual(period('2026-10-25', '2026-10', '2026-W43'));
    expect(at('2026-10-25T01:30:00.000Z')).toEqual(period('2026-10-25', '2026-10', '2026-W43'));
    // Midnight before is CEST (22:00 UTC), midnight after is CET (23:00 UTC).
    expect(at('2026-10-24T22:00:00.000Z').dateKey).toBe('2026-10-25');
    expect(at('2026-10-25T22:59:59.999Z').dateKey).toBe('2026-10-25');
    expect(at('2026-10-25T23:00:00.000Z')).toEqual(period('2026-10-26', '2026-10', '2026-W44'));
  });

  it("assembles the zone's full calendar date at every instant through each transition, 2024–2040", () => {
    // A single full-date formatter for the same IANA zone checks how the three
    // single-field answers are read and put together.
    const iana = new Intl.DateTimeFormat('en-CA', {
      timeZone: BUDGET_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const ianaDate = (instant: Date) => {
      const parts = Object.fromEntries(iana.formatToParts(instant).map((part) => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    };
    const instants: Date[] = [];
    for (let year = 2024; year <= 2040; year += 1) {
      for (const month of [2, 9]) {
        // Every 15 minutes through the last week of March and of October.
        for (let t = Date.UTC(year, month, 24); t < Date.UTC(year, month + 1, 1); t += 15 * 60_000) instants.push(new Date(t));
      }
      for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += 7 * 3_600_000 + 1_234_567) instants.push(new Date(t));
    }
    const mismatches = instants.filter((instant) => budgetPeriodForInstant(instant).dateKey !== ianaDate(instant));
    expect(instants.length).toBeGreaterThan(30_000);
    expect(mismatches.map((instant) => instant.toISOString())).toEqual([]);
  });

  it('keeps the week keys the previous Food helper produced for every calendar date, 2000–2040', () => {
    // The pre-APP-045 getISOWeekKey arithmetic on calendar fields: stored keys such
    // as "2026-W38" keep meaning the same week, so none needs migrating.
    const previousWeekKey = (year: number, month: number, day: number) => {
      const date = new Date(Date.UTC(year, month - 1, day));
      date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
      const isoYear = date.getUTCFullYear();
      const week = Math.ceil(((date.getTime() - Date.UTC(isoYear, 0, 1)) / 86_400_000 + 1) / 7);
      return `${isoYear}-W${String(week).padStart(2, '0')}`;
    };
    const differences: string[] = [];
    for (let t = Date.UTC(2000, 0, 1); t < Date.UTC(2041, 0, 1); t += 86_400_000) {
      const date = new Date(t);
      const dateKey = date.toISOString().slice(0, 10);
      const expected = previousWeekKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
      if (budgetPeriodForCalendarDate(dateKey)?.weekKey !== expected) differences.push(dateKey);
    }
    expect(differences).toEqual([]);
  });
});

describe('APP-045 the zone comes from the runtime IANA data, or not at all', () => {
  type PeriodModule = typeof import('@/core/dates/budgetPeriod');
  const RealDateTimeFormat = Intl.DateTimeFormat;
  const instant = new Date('2026-08-31T22:30:00.000Z'); // 1 September in Copenhagen, 31 August in UTC

  /** A fresh module (its formatters are cached per module) under a replaced Intl.DateTimeFormat. */
  function withIntl<T>(fake: (locale: string, options: Intl.DateTimeFormatOptions) => unknown, run: (module: PeriodModule) => T): T {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(fake as never);
    try {
      let result!: T;
      jest.isolateModules(() => { result = run(require('@/core/dates/budgetPeriod')); });
      return result;
    } finally {
      spy.mockRestore();
    }
  }
  const failureOf = (run: () => unknown) => {
    try { run(); } catch (error) { return { name: (error as Error).name, code: (error as { code?: string }).code }; }
    return null;
  };

  it('asks the runtime for the literal IANA zone Europe/Copenhagen, using only format and resolvedOptions', () => {
    const requests: { locale: string; options: Intl.DateTimeFormatOptions }[] = [];
    const result = withIntl((locale, options) => {
      requests.push({ locale, options });
      const real = new RealDateTimeFormat(locale, options);
      // Exactly what Hermes supports on both iOS and Android: no formatToParts.
      return { format: (date: Date) => real.format(date), resolvedOptions: () => real.resolvedOptions() };
    }, (module) => module.budgetPeriodForInstant(instant));

    expect(result).toEqual(period('2026-09-01', '2026-09', '2026-W36'));
    expect(requests.length).toBeGreaterThan(0);
    for (const { locale, options } of requests) {
      expect({ locale, timeZone: options.timeZone, numberingSystem: options.numberingSystem, calendar: options.calendar })
        .toEqual({ locale: 'en-US', timeZone: 'Europe/Copenhagen', numberingSystem: undefined, calendar: undefined });
    }
  });

  it('fails closed with a fixed code when the runtime does not know the zone', () => {
    const failure = withIntl(() => { throw new RangeError('Invalid time zone'); }, (module) => failureOf(() => module.budgetPeriodForInstant(instant)));
    expect(failure).toEqual({ name: 'BudgetPeriodError', code: 'budget_period_time_zone_unavailable' });
  });

  it('fails closed rather than use another zone when the runtime ignores the request', () => {
    // An engine resolving the device zone (here UTC) would put this instant in August.
    const failure = withIntl(
      (locale, options) => new RealDateTimeFormat(locale, { ...options, timeZone: 'UTC' }),
      (module) => failureOf(() => module.budgetPeriodForInstant(instant)),
    );
    expect(failure).toEqual({ name: 'BudgetPeriodError', code: 'budget_period_time_zone_unavailable' });
  });

  it('fails closed when the runtime answers with something other than Latin digits', () => {
    // A year of only a direction mark would otherwise read as year 0000, a valid calendar date.
    for (const yearText of ['二〇二六', '٢٠٢٦', '‎', '']) {
      const failure = withIntl(
        (locale, options) => {
          const real = new RealDateTimeFormat(locale, options);
          const format = (date: Date) => (options.year ? yearText : real.format(date));
          return { format, resolvedOptions: () => real.resolvedOptions() };
        },
        (module) => failureOf(() => module.budgetPeriodForInstant(instant)),
      );
      expect({ yearText, failure }).toEqual({ yearText, failure: { name: 'BudgetPeriodError', code: 'budget_period_time_zone_unavailable' } });
    }
  });
});

describe('APP-045 date-only values are calendar dates', () => {
  it('takes YYYY-MM-DD literally, never through UTC, around DST and month boundaries', () => {
    for (const dateKey of ['2026-03-29', '2026-10-25', '2026-08-31', '2026-09-01', '2026-12-31', '2027-01-01']) {
      expect(budgetPeriodForCalendarDate(dateKey)?.dateKey).toBe(dateKey);
      expect(budgetPeriodForRecordedDate(dateKey)?.dateKey).toBe(dateKey);
    }
    expect(budgetPeriodForRecordedDate('2026-09-01')).toEqual(period('2026-09-01', '2026-09', '2026-W36'));
  });

  it('rejects dates the calendar does not have, and malformed text', () => {
    for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-9-1', '20260901', '', null, 42]) {
      expect(budgetPeriodForCalendarDate(value)).toBeNull();
      expect(budgetPeriodForRecordedDate(value)).toBeNull();
    }
  });
});

describe('APP-045 recorded timestamps are instants', () => {
  it('places toISOString and PostgreSQL timestamptz values in Copenhagen', () => {
    expect(budgetPeriodForRecordedDate('2026-08-31T22:30:00.000Z')?.dateKey).toBe('2026-09-01');
    expect(budgetPeriodForRecordedDate('2026-08-31T22:30:00.123456+00:00')?.dateKey).toBe('2026-09-01');
    expect(budgetPeriodForRecordedDate('2026-08-31T22:30:00+00')?.dateKey).toBe('2026-09-01');
    expect(budgetPeriodForRecordedDate('2026-08-31T21:59:59.999Z')?.dateKey).toBe('2026-08-31');
    expect(budgetPeriodForRecordedDate('2026-09-01T00:30:00+02:00')?.dateKey).toBe('2026-09-01');
    expect(budgetPeriodForRecordedDate('2026-08-31T17:30:00-05:00')?.dateKey).toBe('2026-09-01');
    expect(budgetPeriodForRecordedDate('2026-08-31 22:30:00Z')?.dateKey).toBe('2026-09-01');
  });

  it('refuses to guess an instant without an offset, or an impossible time', () => {
    for (const value of ['2026-09-01T10:00:00', '2026-09-01T24:00:00Z', '2026-09-01T10:60:00Z', '2026-02-30T10:00:00Z', '2026-09-01T10:00:00+25:00', 'yesterday']) {
      expect(budgetPeriodForRecordedDate(value)).toBeNull();
    }
  });
});

describe('APP-045 weeks in a month', () => {
  it('lists the ISO weeks that touch a month, from its calendar dates', () => {
    expect(isoWeeksInMonth('2026-09')).toEqual(['2026-W36', '2026-W37', '2026-W38', '2026-W39', '2026-W40']);
    expect(isoWeeksInMonth('2027-02')).toEqual(['2027-W05', '2027-W06', '2027-W07', '2027-W08']);
    // January 2027 starts in the last week of ISO year 2026.
    expect(isoWeeksInMonth('2027-01')).toEqual(['2026-W53', '2027-W01', '2027-W02', '2027-W03', '2027-W04']);
    expect(isoWeeksInMonth('2028-02')).toHaveLength(5);
  });

  it('throws a fixed code for a malformed month key', () => {
    for (const monthKey of ['2026-13', '2026-9', '2026-00', 'September']) {
      expect(() => isoWeeksInMonth(monthKey)).toThrow('budget_period_invalid_month');
    }
  });
});

describe('APP-045 period helpers', () => {
  it('shifts month keys across years', () => {
    expect(addMonthsToMonthKey('2026-01', -1)).toBe('2025-12');
    expect(addMonthsToMonthKey('2026-12', 1)).toBe('2027-01');
    expect(addMonthsToMonthKey('2026-09', -5)).toBe('2026-04');
    expect(addMonthsToMonthKey('2026-09', 0)).toBe('2026-09');
    expect(() => addMonthsToMonthKey('2026-9', 1)).toThrow('budget_period_invalid_month');
  });

  it('moves a period by calendar days and names its ISO weekday', () => {
    const friday = budgetPeriodForCalendarDate('2026-01-02')!;
    expect(budgetPeriodDaysFrom(friday, -7)).toEqual(period('2025-12-26', '2025-12', '2025-W52'));
    expect(isoWeekdayOf(friday)).toBe(5);
    expect(isoWeekdayOf(budgetPeriodForCalendarDate('2026-09-20')!)).toBe(7);
    expect(isoWeekdayOf(budgetPeriodForCalendarDate('2026-09-21')!)).toBe(1);
  });

  it('rejects an invalid instant with a fixed code', () => {
    expect(() => budgetPeriodForInstant(new Date(Number.NaN))).toThrow('budget_period_invalid_instant');
  });
});

describe('APP-045 the period does not depend on the host', () => {
  it('reads no clock: the same instant gives the same period at any system time', () => {
    const instant = new Date('2026-05-31T22:30:00.000Z');
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const first = budgetPeriodForInstant(instant);
    jest.setSystemTime(new Date('2031-07-15T12:00:00Z'));
    expect(budgetPeriodForInstant(instant)).toEqual(first);
    jest.useRealTimers();
  });

  it('ignores host-local Date getters (emulated UTC host)', () => {
    const restore = emulateUtcHost();
    try {
      // Sunday 31 May in UTC, Monday 1 June in Copenhagen: month and week both differ.
      expect(new Date('2026-05-31T22:30:00.000Z').getDate()).toBe(31); // the emulation is active
      expect(at('2026-05-31T22:30:00.000Z')).toEqual(period('2026-06-01', '2026-06', '2026-W23'));
      expect(isoWeeksInMonth('2026-09')).toHaveLength(5);
    } finally {
      restore();
    }
  });

  it('gives identical periods in real processes running in six different timezones', () => {
    // A child Node process loads the real TypeScript sources afresh under each TZ,
    // which Jest cannot do in-process. `hostDate` proves each switch took effect.
    const script = `
      const ts = require('typescript'), Module = require('module'), fs = require('fs'), path = require('path');
      const root = process.cwd();
      const resolve = Module._resolveFilename;
      Module._resolveFilename = function (request, ...rest) {
        return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...rest);
      };
      require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
      const results = {};
      for (const zone of ['UTC', 'Europe/Copenhagen', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Los_Angeles', 'Asia/Kolkata']) {
        process.env.TZ = zone;
        // Fresh modules per host, so nothing created under an earlier zone is reused.
        for (const key of Object.keys(require.cache)) if (key.startsWith(root) && !key.includes('node_modules')) delete require.cache[key];
        const periods = require(path.join(root, 'core/dates/budgetPeriod.ts'));
        const food = require(path.join(root, 'features/food/budgetReadModel.ts'));
        const now = new Date('2026-05-31T22:30:00.000Z');
        results[zone] = {
          hostDate: now.getDate(),
          periods: ['2026-05-31T22:30:00.000Z', '2026-08-31T22:00:00.000Z', '2026-12-31T23:00:00.000Z', '2026-10-25T01:30:00.000Z']
            .map((iso) => periods.budgetPeriodForInstant(new Date(iso))),
          recorded: ['2026-08-31T22:30:00.000Z', '2026-09-01'].map(periods.budgetPeriodForRecordedDate),
          weeks: ['2026-09', '2027-01'].map(periods.isoWeeksInMonth),
          food: food.foodBudgetFacts({
            period: periods.budgetPeriodForInstant(now),
            monthlyBudgetByMonth: { '2026-06': 3000 },
            purchases: [{ id: 'a', amount: 120, date: '2026-05-31T22:15:00.000Z' }, { id: 'b', amount: 80, date: '2026-05-31T21:45:00.000Z' }],
          }),
        };
      }
      process.stdout.write(JSON.stringify(results));
    `;
    const child = spawnSync(process.execPath, ['-e', script], { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env } });
    expect(child.stderr).toBe('');
    const results: Record<string, { hostDate: number } & Record<string, unknown>> = JSON.parse(child.stdout);

    const expected = {
      periods: [
        period('2026-06-01', '2026-06', '2026-W23'),
        period('2026-09-01', '2026-09', '2026-W36'),
        period('2027-01-01', '2027-01', '2026-W53'),
        period('2026-10-25', '2026-10', '2026-W43'),
      ],
      recorded: [period('2026-09-01', '2026-09', '2026-W36'), period('2026-09-01', '2026-09', '2026-W36')],
      weeks: [isoWeeksInMonth('2026-09'), isoWeeksInMonth('2027-01')],
      // June 2026 touches 5 ISO weeks: 3000 / 5 = 600; only the purchase after Copenhagen midnight counts.
      food: { monthKey: '2026-06', weekKey: '2026-W23', spentThisWeek: 120, hasBudget: true, monthlyBudget: 3000, weeklyBudget: 600, remaining: 480 },
    };
    for (const [zone, result] of Object.entries(results)) {
      const { hostDate, ...facts } = result;
      expect({ zone, ...facts }).toEqual({ zone, ...expected });
    }
    // The hosts really differed: 1 June in Copenhagen, Kiritimati and Kolkata; 31 May elsewhere.
    expect(Object.fromEntries(Object.entries(results).map(([zone, result]) => [zone, result.hostDate]))).toEqual({
      'Europe/Copenhagen': 1, UTC: 31, 'Pacific/Kiritimati': 1, 'Pacific/Pago_Pago': 31, 'America/Los_Angeles': 31, 'Asia/Kolkata': 1,
    });
  });
});
