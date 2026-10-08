import { decodeHabit, decodeLegacyHabit, legacyStartDate } from '@/core/habits/persistedHabit';
import { decodeRemoteHabitRow, habitToRow, mirroredTargetPerWeek } from '@/features/habits/domain/habitRow';
import type { Habit, HabitSchedule } from '@/types/life';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TODAY = '2026-10-08'; // a Thursday
const weekly = (target: number): HabitSchedule => ({ kind: 'weekly', target });
const habit = (extra: Partial<Habit> = {}): Habit => ({
  id: 'h', title: 'Habit', direction: 'build', createdAt: '2026-09-01T10:00:00.000Z', startDate: '2026-09-01',
  scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule: { kind: 'weekdays', days: [1, 3] } }],
  logs: [{ id: 'l1', date: '2026-09-02' }], ...extra,
});
const legacyRow = (extra: Record<string, unknown> = {}) => ({
  id: 'h', title: 'Habit', direction: 'build', target_per_week: null, logs: [{ id: 'l1', date: '2026-09-02' }],
  created_at: '2026-09-01T10:00:00+00:00', start_date: null, schedule_history: null, ...extra,
});

describe('APP-064 persisted habit format', () => {
  it('round-trips a canonical habit to an equal, fresh object', () => {
    const original = habit();
    const decoded = decodeHabit(JSON.parse(JSON.stringify(original)));
    expect(decoded).toEqual(original);
    expect(decoded).not.toBe(original);
    expect(decoded!.logs).not.toBe(original.logs);
  });

  it('has exactly the persisted key set: any extra, derived or missing key is rejected', () => {
    for (const extra of ['targetPerWeek', 'status', 'missed', 'streak', 'weekFacts', 'revision', 'syncedAt', 'quantity']) {
      expect(decodeHabit({ ...habit(), [extra]: 1 })).toBeNull();
    }
    for (const key of Object.keys(habit())) {
      const { [key as keyof Habit]: _dropped, ...rest } = habit();
      expect(decodeHabit(rest)).toBeNull();
    }
  });

  it('validates every field', () => {
    for (const patch of [
      { id: '' }, { id: 5 }, { title: ' ' }, { title: null }, { direction: 'maintain' }, { direction: 'BUILD' },
      { createdAt: 'soon' }, { createdAt: 5 }, { startDate: '2026-9-1' }, { startDate: '2026-09-01T00:00:00Z' }, { startDate: '2026-02-30' },
      { logs: 'x' }, { scheduleHistory: 'x' },
    ]) expect(decodeHabit({ ...habit(), ...patch })).toBeNull();
  });

  it('does not depend on the clock: a future-dated entry decodes the same today and in a hundred years', () => {
    const withFuture = habit({ logs: [{ id: 'l1', date: '2099-01-01' }] });
    jest.useFakeTimers().setSystemTime(new Date('2001-01-01T00:00:00Z'));
    const early = decodeHabit(withFuture);
    jest.setSystemTime(new Date('2199-01-01T00:00:00Z'));
    const late = decodeHabit(withFuture);
    jest.useRealTimers();
    expect(early).toEqual(withFuture);
    expect(late).toEqual(early);
  });

  it('rejects, never merges, a second entry for one date, a reused entry id, and an entry before the start', () => {
    expect(decodeHabit(habit({ logs: [{ id: 'a', date: '2026-09-02' }, { id: 'b', date: '2026-09-02' }] }))).toBeNull();
    expect(decodeHabit(habit({ logs: [{ id: 'a', date: '2026-09-02' }, { id: 'a', date: '2026-09-03' }] }))).toBeNull();
    expect(decodeHabit(habit({ logs: [{ id: 'a', date: '2026-08-31' }] }))).toBeNull();
    expect(decodeHabit(habit({ logs: [{ id: 'a', date: '2026-09-01' }] }))).not.toBeNull();
  });
});

describe('APP-064 legacy mapping', () => {
  const legacy = (extra: Record<string, unknown> = {}) => ({
    id: 'h', title: 'Habit', direction: 'quit', logs: [], createdAt: '2026-09-01T10:00:00.000Z', ...extra,
  });
  const scheduleOf = (target: unknown) => decodeLegacyHabit(legacy({ targetPerWeek: target }))?.scheduleHistory[0].schedule;

  it('maps targetPerWeek: 1 to 7 weekly; anything else numeric, absent or null open', () => {
    for (const target of [1, 2, 3, 4, 5, 6, 7]) expect(scheduleOf(target)).toEqual(weekly(target));
    for (const target of [0, -1, -100, 8, 9, 100, 2.5, 0.5, NaN, Infinity, undefined, null]) expect(scheduleOf(target)).toEqual({ kind: 'open' });
  });

  it('rejects a target that is not a number at all rather than repairing it', () => {
    for (const target of ['3', '', true, [], {}]) expect(decodeLegacyHabit(legacy({ targetPerWeek: target }))).toBeNull();
  });

  it('never invents weekdays for a legacy habit', () => {
    for (const target of [undefined, 0, 3, 7, 12]) expect(scheduleOf(target)).not.toMatchObject({ kind: 'weekdays' });
  });

  it('start date is the earlier of the createdAt date and the earliest log', () => {
    expect(legacyStartDate('2026-09-01T10:00:00.000Z', [])).toBe('2026-09-01');
    expect(legacyStartDate('2026-09-01T10:00:00.000Z', ['2026-09-05', '2026-09-03'])).toBe('2026-09-01');
    expect(legacyStartDate('2026-09-01T10:00:00.000Z', ['2026-08-31', '2026-09-03'])).toBe('2026-08-31');
    expect(legacyStartDate('2026-09-01T10:00:00.000Z', ['2026-09-01'])).toBe('2026-09-01');
    expect(legacyStartDate('garbage', [])).toBeNull();
  });

  it('uses the civil date written at the head of createdAt, not a converted one', () => {
    expect(decodeLegacyHabit(legacy({ createdAt: '2026-09-01T23:30:00.000Z' }))!.startDate).toBe('2026-09-01');
    expect(decodeLegacyHabit(legacy({ createdAt: '2026-09-01T00:30:00+02:00' }))!.startDate).toBe('2026-09-01');
  });

  it('keeps ids, titles, directions, createdAt, entry ids, dates and their order verbatim', () => {
    const logs = [{ id: '1757000000000-123456', date: '2026-09-04' }, { id: 'b', date: '2026-09-02' }];
    const mapped = decodeLegacyHabit(legacy({ title: ' Spaced Title ', logs }))!;
    expect(mapped).toMatchObject({ id: 'h', title: ' Spaced Title ', direction: 'quit', createdAt: '2026-09-01T10:00:00.000Z', logs });
  });

  it('rejects duplicate dates, timestamp dates and unknown fields (fail closed)', () => {
    expect(decodeLegacyHabit(legacy({ logs: [{ id: 'a', date: '2026-09-02' }, { id: 'b', date: '2026-09-02' }] }))).toBeNull();
    expect(decodeLegacyHabit(legacy({ logs: [{ id: 'a', date: '2026-09-02T00:00:00.000Z' }] }))).toBeNull();
    expect(decodeLegacyHabit(legacy({ streak: 2 }))).toBeNull();
    expect(decodeLegacyHabit(legacy({ startDate: '2026-09-01' }))).toBeNull();
  });
});

describe('APP-064 server row', () => {
  it('writes the legacy columns plus the two canonical ones, and nothing derived', () => {
    const row = habitToRow(USER, habit(), TODAY);
    expect(Object.keys(row).sort()).toEqual([
      'created_at', 'direction', 'id', 'logs', 'schedule_history', 'start_date', 'target_per_week', 'title', 'user_id',
    ]);
    expect(row).toMatchObject({ user_id: USER, start_date: '2026-09-01', logs: [{ id: 'l1', date: '2026-09-02' }] });
  });

  describe('target_per_week mirror (a compatibility value for older clients, never read back)', () => {
    const open: HabitSchedule = { kind: 'open' };
    const days: HabitSchedule = { kind: 'weekdays', days: [1] };
    const make = (...periods: Array<[string, HabitSchedule]>) => habit({
      startDate: periods[0][0], scheduleHistory: periods.map(([effectiveFrom, schedule]) => ({ effectiveFrom, schedule })),
    });

    it('is the weekly target in effect today, otherwise NULL', () => {
      expect(mirroredTargetPerWeek(make(['2026-09-01', weekly(3)]), TODAY)).toBe(3);
      expect(mirroredTargetPerWeek(make(['2026-09-01', open]), TODAY)).toBeNull();
      expect(mirroredTargetPerWeek(make(['2026-09-01', days]), TODAY)).toBeNull();
    });

    it('follows a change that has already taken effect, in either direction', () => {
      expect(mirroredTargetPerWeek(make(['2026-09-01', weekly(3)], ['2026-10-05', open]), TODAY)).toBeNull();
      expect(mirroredTargetPerWeek(make(['2026-09-01', open], ['2026-10-05', weekly(5)]), TODAY)).toBe(5);
      expect(mirroredTargetPerWeek(make(['2026-09-01', weekly(3)], ['2026-10-05', weekly(4)]), TODAY)).toBe(4);
    });

    it('does NOT announce a change that is still waiting for Monday: an older client must not show next week\'s target today', () => {
      // TODAY is Thursday 2026-10-08; the change takes effect on Monday 2026-10-12.
      expect(mirroredTargetPerWeek(make(['2026-09-01', days], ['2026-10-12', weekly(3)]), TODAY)).toBeNull();
      expect(mirroredTargetPerWeek(make(['2026-09-01', weekly(2)], ['2026-10-12', weekly(5)]), TODAY)).toBe(2);
      expect(mirroredTargetPerWeek(make(['2026-09-01', weekly(2)], ['2026-10-12', open]), TODAY)).toBe(2);
    });

    it('takes the pending target up once the day arrives, at the next write', () => {
      const pending = make(['2026-09-01', days], ['2026-10-12', weekly(3)]);
      expect(mirroredTargetPerWeek(pending, '2026-10-11')).toBeNull();
      expect(mirroredTargetPerWeek(pending, '2026-10-12')).toBe(3);
      expect(habitToRow(USER, pending, '2026-10-12').target_per_week).toBe(3);
      expect(habitToRow(USER, pending, TODAY).target_per_week).toBeNull();
    });

    it('a habit that has not started yet mirrors its first schedule', () => {
      expect(mirroredTargetPerWeek(make(['2026-10-20', weekly(4)]), TODAY)).toBe(4);
    });

    it('the row still carries the whole history, pending period included', () => {
      const pending = make(['2026-09-01', days], ['2026-10-12', weekly(3)]);
      expect(habitToRow(USER, pending, TODAY).schedule_history).toEqual(pending.scheduleHistory);
    });

    it('is never read back: a canonical row\'s schedule comes from schedule_history alone', () => {
      const written = habitToRow(USER, make(['2026-09-01', weekly(3)]), TODAY);
      expect(decodeRemoteHabitRow({ ...written, target_per_week: 6 })!.scheduleHistory[0].schedule).toEqual(weekly(3));
      expect(decodeRemoteHabitRow({ ...written, target_per_week: null })!.scheduleHistory[0].schedule).toEqual(weekly(3));
    });
  });

  it('round-trips a canonical habit through its row for every schedule kind', () => {
    for (const schedule of [{ kind: 'weekdays', days: [1, 2, 3, 4, 5, 6, 7] }, weekly(2), { kind: 'open' }] as HabitSchedule[]) {
      const original = habit({ scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule }] });
      expect(decodeRemoteHabitRow(JSON.parse(JSON.stringify(habitToRow(USER, original, TODAY))))).toEqual(original);
    }
  });

  it('reads a row with both new columns NULL as a legacy habit, using target_per_week and a derived start date', () => {
    expect(decodeRemoteHabitRow(legacyRow({ target_per_week: 3 }))).toEqual({
      id: 'h', title: 'Habit', direction: 'build', createdAt: '2026-09-01T10:00:00+00:00', startDate: '2026-09-01',
      scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule: weekly(3) }], logs: [{ id: 'l1', date: '2026-09-02' }],
    });
    expect(decodeRemoteHabitRow(legacyRow())!.scheduleHistory[0].schedule).toEqual({ kind: 'open' });
    expect(decodeRemoteHabitRow(legacyRow({ target_per_week: 0 }))!.scheduleHistory[0].schedule).toEqual({ kind: 'open' });
    expect(decodeRemoteHabitRow(legacyRow({ target_per_week: 99 }))!.scheduleHistory[0].schedule).toEqual({ kind: 'open' });
    const early = decodeRemoteHabitRow(legacyRow({ logs: [{ id: 'x', date: '2026-08-30' }] }))!;
    expect(early.startDate).toBe('2026-08-30');
  });

  it('ignores target_per_week whenever schedule_history is present (an older client cannot change a canonical schedule)', () => {
    const base = habitToRow(USER, habit({ scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule: { kind: 'open' } }] }), TODAY);
    expect(decodeRemoteHabitRow({ ...base, target_per_week: 5 })!.scheduleHistory[0].schedule).toEqual({ kind: 'open' });
  });

  it('drops a row that has only one of the two canonical columns, or any malformed part', () => {
    const canonical = habitToRow(USER, habit(), TODAY);
    expect(decodeRemoteHabitRow({ ...canonical, start_date: null })).toBeNull();
    expect(decodeRemoteHabitRow({ ...canonical, schedule_history: null })).toBeNull();
    expect(decodeRemoteHabitRow({ ...canonical, schedule_history: [] })).toBeNull();
    expect(decodeRemoteHabitRow({ ...canonical, schedule_history: 'x' })).toBeNull();
    expect(decodeRemoteHabitRow({ ...canonical, start_date: '2026-09-02' })).toBeNull(); // first period starts 2026-09-01
    expect(decodeRemoteHabitRow({ ...canonical, direction: 'maintain' })).toBeNull();
    expect(decodeRemoteHabitRow({ ...canonical, logs: [{ id: 'a', date: '2026-09-02' }, { id: 'b', date: '2026-09-02' }] })).toBeNull();
    expect(decodeRemoteHabitRow({ ...canonical, logs: 'x' })).toBeNull();
    expect(decodeRemoteHabitRow({ ...canonical, title: '' })).toBeNull();
    expect(decodeRemoteHabitRow(null)).toBeNull();
    expect(decodeRemoteHabitRow('row')).toBeNull();
    expect(decodeRemoteHabitRow(legacyRow({ logs: [{ id: 'a', date: '2026-09-02T10:00:00Z' }] }))).toBeNull();
    expect(decodeRemoteHabitRow(legacyRow({ logs: [{ id: 'a', date: '2026-09-02' }, { id: 'b', date: '2026-09-02' }] }))).toBeNull();
  });

  it.each([
    ['an unknown schedule kind', { effectiveFrom: '2026-09-01', schedule: { kind: 'daily' } }],
    ['a weekly target of 8', { effectiveFrom: '2026-09-01', schedule: { kind: 'weekly', target: 8 } }],
    ['a weekly target of 0', { effectiveFrom: '2026-09-01', schedule: { kind: 'weekly', target: 0 } }],
    ['unsorted weekdays', { effectiveFrom: '2026-09-01', schedule: { kind: 'weekdays', days: [3, 1] } }],
    ['duplicate weekdays', { effectiveFrom: '2026-09-01', schedule: { kind: 'weekdays', days: [1, 1] } }],
    ['no weekdays', { effectiveFrom: '2026-09-01', schedule: { kind: 'weekdays', days: [] } }],
    ['an extra key on a schedule', { effectiveFrom: '2026-09-01', schedule: { kind: 'open', target: 3 } }],
    ['a timestamp as a period start', { effectiveFrom: '2026-09-01T00:00:00Z', schedule: { kind: 'open' } }],
  ])('drops a canonical row whose first period has %s', (_label, period) => {
    expect(decodeRemoteHabitRow({ ...habitToRow(USER, habit(), TODAY), schedule_history: [period] })).toBeNull();
  });

  it('drops a canonical row whose later periods are out of order or repeat a date', () => {
    const first = { effectiveFrom: '2026-09-01', schedule: { kind: 'open' } };
    const base = habitToRow(USER, habit(), TODAY);
    expect(decodeRemoteHabitRow({ ...base, schedule_history: [first, { effectiveFrom: '2026-09-01', schedule: { kind: 'weekly', target: 2 } }] })).toBeNull();
    expect(decodeRemoteHabitRow({ ...base, schedule_history: [first, { effectiveFrom: '2026-10-12', schedule: { kind: 'weekly', target: 2 } }, { effectiveFrom: '2026-10-05', schedule: { kind: 'open' } }] })).toBeNull();
    expect(decodeRemoteHabitRow({ ...base, schedule_history: [first, { effectiveFrom: '2026-10-12', schedule: { kind: 'weekly', target: 2 } }] })).not.toBeNull();
  });

  it('accepts a future period (a change waiting for Monday) without reading the clock', () => {
    jest.useFakeTimers().setSystemTime(new Date('2001-01-01T00:00:00Z'));
    const decoded = decodeRemoteHabitRow({ ...habitToRow(USER, habit(), TODAY),
      schedule_history: [{ effectiveFrom: '2026-09-01', schedule: { kind: 'open' } }, { effectiveFrom: '2026-10-12', schedule: { kind: 'weekly', target: 3 } }] });
    jest.useRealTimers();
    expect(decoded!.scheduleHistory).toHaveLength(2);
  });

  it('treats a missing logs column as an empty history', () => {
    expect(decodeRemoteHabitRow(legacyRow({ logs: null }))!.logs).toEqual([]);
  });

  it('an entry before the start date but inside the older client\'s legal range is kept; one older than that still drops the row', () => {
    const canonical = habitToRow(USER, habit({ startDate: '2026-09-02', scheduleHistory: [{ effectiveFrom: '2026-09-02', schedule: { kind: 'open' } }], logs: [] }), TODAY);
    // created_at is 2026-09-01T10:00Z, so 2026-09-01 is the first day the older client enables.
    expect(decodeRemoteHabitRow({ ...canonical, logs: [{ id: 'old', date: '2026-09-01' }] })).toMatchObject({ startDate: '2026-09-01' });
    expect(decodeRemoteHabitRow({ ...canonical, logs: [{ id: 'old', date: '2026-08-31' }] })).toBeNull();
  });
});

describe('APP-064 old client: an entry on the UTC creation date, one day before the local start date', () => {
  /**
   * The row an older client leaves behind. A current client in Copenhagen creates a habit at 00:30 on
   * 1 October (CEST): created_at is 22:30 on 30 September UTC and start_date is the local date, 2026-10-01.
   * The older client enables every day from `created_at.slice(0, 10)`, i.e. 2026-09-30, so its user can mark
   * that day; the upsert lists only the historical columns, so start_date and schedule_history survive.
   * The same literal is asserted against real PostgreSQL in tests/db/app064.test.cjs.
   */
  const row = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures/habits/old-client-pre-start-row.json'), 'utf8'));

  it('stays visible: the habit decodes, nothing is dropped and no entry is changed or lost', () => {
    const decoded = decodeRemoteHabitRow(row);
    expect(decoded).not.toBeNull();
    expect(decoded!.logs).toEqual([{ id: '1757000000000-123456', date: '2026-09-30' }]);
    expect(decoded!.title).toBe(row.title);
    expect(decoded!.id).toBe(row.id);
  });

  it('counts from the day of the entry, like a legacy habit does, and keeps the user\'s own schedule', () => {
    const decoded = decodeRemoteHabitRow(row)!;
    expect(decoded.startDate).toBe('2026-09-30');
    expect(decoded.scheduleHistory).toEqual([{ effectiveFrom: '2026-09-30', schedule: { kind: 'weekdays', days: [1, 3, 5] } }]);
  });

  it('is then a fully valid canonical habit: strict local and backup validation is unchanged and still accepts it', () => {
    const decoded = decodeRemoteHabitRow(row)!;
    expect(decodeHabit(JSON.parse(JSON.stringify(decoded)))).toEqual(decoded);
    expect(decodeRemoteHabitRow(JSON.parse(JSON.stringify(habitToRow(USER, decoded, '2026-10-05'))))).toEqual(decoded);
  });

  it('moves only the start of the FIRST period: later periods keep their dates', () => {
    const decoded = decodeRemoteHabitRow({
      ...row,
      schedule_history: [...row.schedule_history, { effectiveFrom: '2026-10-12', schedule: { kind: 'weekly', target: 3 } }],
    })!;
    expect(decoded.scheduleHistory.map((period) => period.effectiveFrom)).toEqual(['2026-09-30', '2026-10-12']);
  });

  it('strict validation still refuses the same data when it arrives as a Z1 store or a v12 backup', () => {
    expect(decodeHabit({
      id: row.id, title: row.title, direction: row.direction, createdAt: row.created_at, startDate: row.start_date,
      scheduleHistory: row.schedule_history, logs: row.logs,
    })).toBeNull();
  });

  it('covers EVERY entry the older client\'s UI could ever write: all offsets from UTC-12 to UTC+14, every creation hour', () => {
    // The older client enables [createdAt UTC date, today]. The local date differs from the UTC date by at most one day.
    const civil = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    for (let offsetHours = -12; offsetHours <= 14; offsetHours += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const instant = Date.UTC(2026, 9, 1, hour, 30);
        const utcDate = civil(instant);
        const localDate = civil(instant + offsetHours * 3_600_000);
        const legalDays = [utcDate, localDate, civil(instant + 86_400_000), civil(instant + 2 * 86_400_000)].filter((day, i, all) => day >= utcDate && all.indexOf(day) === i);
        for (const day of legalDays) {
          const decoded = decodeRemoteHabitRow({
            ...row, created_at: new Date(instant).toISOString().replace('Z', '+00:00'),
            start_date: localDate, schedule_history: [{ effectiveFrom: localDate, schedule: { kind: 'open' } }],
            logs: [{ id: 'old', date: day }],
          });
          expect({ offsetHours, hour, day, visible: decoded !== null }).toEqual({ offsetHours, hour, day, visible: true });
          expect(decoded!.startDate).toBe(day < localDate ? day : localDate);
          expect(decoded!.logs).toEqual([{ id: 'old', date: day }]);
        }
      }
    }
  });

  it('is deliberately narrow: an entry before the creation date, or on a row that was never written this way, still drops the row', () => {
    expect(decodeRemoteHabitRow({ ...row, logs: [{ id: 'x', date: '2026-09-29' }] })).toBeNull(); // before created_at's UTC date
    expect(decodeRemoteHabitRow({ ...row, logs: [{ id: 'x', date: '2026-09-30' }, { id: 'y', date: '2026-09-30' }] })).toBeNull(); // duplicate date
    expect(decodeRemoteHabitRow({ ...row, created_at: '2026-10-01T10:00:00+00:00' })).toBeNull(); // created on the start date: no window
    expect(decodeRemoteHabitRow({ ...row, created_at: '2026-10-02T10:00:00+00:00' })).toBeNull();
    expect(decodeRemoteHabitRow({ ...row, schedule_history: [] })).toBeNull();
    expect(decodeRemoteHabitRow({ ...row, schedule_history: [{ effectiveFrom: '2026-10-01' }] })).toBeNull(); // malformed first period
    expect(decodeRemoteHabitRow({ ...row, logs: [{ id: 'x', date: '2026-09-30T10:00:00Z' }] })).toBeNull();
  });

  it('never reads the clock', () => {
    jest.useFakeTimers().setSystemTime(new Date('2001-01-01T00:00:00Z'));
    const early = decodeRemoteHabitRow(row);
    jest.setSystemTime(new Date('2099-01-01T00:00:00Z'));
    expect(decodeRemoteHabitRow(row)).toEqual(early);
    jest.useRealTimers();
  });
});
