import fs from 'fs';
import path from 'path';

import { decodeHabits } from '@/core/habits/persistedHabit';
import { habitsMigration } from '@/core/storage/migrations/habits';
import { migrateLocalStore } from '@/core/storage/migrations/harness';
import { PERSISTENCE_SURFACES } from '@/core/storage/dataProfileRegistry';
import type { Habit } from '@/types/life';

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/local-migrations/habits/a818c9d-v0.json'), 'utf8');
const memory = (raw: string) => {
  let current = raw;
  return {
    getItem: jest.fn(async () => current),
    setItem: jest.fn(async (_key: string, next: string) => { current = next; }),
    raw: () => current,
  };
};
const z0 = (habits: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ state: { habits, ...extra }, version: 0 });
const log = (id: string, date: string) => ({ id, date });
const habit = (extra: Record<string, unknown> = {}) => ({
  id: 'h', title: 'Habit', direction: 'build', logs: [], createdAt: '2026-09-01T10:00:00.000Z', ...extra,
});
const migrate = async (raw: string) => {
  const storage = memory(raw);
  await migrateLocalStore(habitsMigration, storage);
  const envelope = JSON.parse(storage.raw());
  return { storage, version: envelope.version, habits: envelope.state.habits as Habit[], envelope };
};

describe('APP-064 Habits Z0 to Z1', () => {
  it('is registered as a versioned surface at version 1 and no longer an external adapter', () => {
    const surface = PERSISTENCE_SURFACES.find((entry) => entry.id === 'async-storage:lifesort-habits')!;
    expect(surface.migration).toMatchObject({ kind: 'versioned', currentVersion: 1, owner: 'core/storage/migrations/habits.ts' });
  });

  it('upgrades the a818c9d fixture: every historical field and log kept exactly, schedules and start dates derived', async () => {
    const original = JSON.parse(fixture).state.habits as Array<Record<string, any>>;
    const { storage, version, habits, envelope } = await migrate(fixture);
    expect(version).toBe(1);
    expect(Object.keys(envelope)).toEqual(['state', 'version']);
    expect(Object.keys(envelope.state)).toEqual(['habits']);
    expect(habits).toHaveLength(6);
    original.forEach((old, index) => {
      expect(habits[index]).toMatchObject({ id: old.id, title: old.title, direction: old.direction, createdAt: old.createdAt, logs: old.logs });
      expect('targetPerWeek' in habits[index]).toBe(false);
      expect(habits[index].scheduleHistory).toHaveLength(1);
      expect(habits[index].scheduleHistory[0].effectiveFrom).toBe(habits[index].startDate);
    });
    expect(decodeHabits(habits)).not.toBeNull();
    storage.setItem.mockClear();
    await migrateLocalStore(habitsMigration, storage);
    expect(storage.setItem).not.toHaveBeenCalled(); // already current: no second write
  });

  it('maps targetPerWeek 3 and 7 to weekly, and 0, 9 and -2 to open — never to weekdays and never clamped', async () => {
    const { habits } = await migrate(fixture);
    expect(habits.map((entry) => entry.scheduleHistory[0].schedule)).toEqual([
      { kind: 'weekly', target: 3 },
      { kind: 'open' },
      { kind: 'open' },
      { kind: 'weekly', target: 7 },
      { kind: 'open' },
      { kind: 'open' },
    ]);
  });

  it('derives the start date as the earlier of the createdAt date and the earliest log, and does not repair shifted dates', async () => {
    const { habits } = await migrate(fixture);
    // 2026-09-01 created, first log 2026-09-02.
    expect(habits[0].startDate).toBe('2026-09-01');
    // created 2026-09-02T00:30Z but a log on 2026-08-31 (the week-row bug stored the previous civil day east of UTC):
    // the stored log date is kept as is and the start date moves back to include it.
    expect(habits[1].startDate).toBe('2026-08-31');
    expect(habits[1].logs.map((entry) => entry.date)).toEqual(['2026-08-31', '2026-09-03', '2099-01-01']);
    expect(habits.slice(2).map((entry) => entry.startDate)).toEqual(['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
  });

  it('keeps a legacy future-dated entry (it stays, clearable) and the timestamp-style legacy id', async () => {
    const { habits } = await migrate(fixture);
    expect(habits[1].logs.map((entry) => entry.id)).toContain('1757000000000-123456');
    expect(habits[1].logs.some((entry) => entry.date === '2099-01-01')).toBe(true);
  });

  it('reads a quit habit exactly like a build habit: logs mean the commitment was kept, nothing is inverted', async () => {
    const entries = [log('l1', '2026-09-02')];
    const { habits } = await migrate(z0([habit({ id: 'b', direction: 'build', logs: entries }), habit({ id: 'q', direction: 'quit', logs: entries })]));
    expect(habits[1]).toEqual({ ...habits[0], id: 'q', direction: 'quit' });
  });

  it('absent and null targetPerWeek are open; an empty habit list stays empty', async () => {
    const { habits } = await migrate(z0([habit({ id: 'a' }), habit({ id: 'b', targetPerWeek: null })]));
    expect(habits.map((entry) => entry.scheduleHistory[0].schedule)).toEqual([{ kind: 'open' }, { kind: 'open' }]);
    expect((await migrate(z0([]))).habits).toEqual([]);
  });

  it.each([
    ['a string target', z0([habit({ targetPerWeek: '3' })])],
    ['a boolean target', z0([habit({ targetPerWeek: true })])],
    ['a log date that is a timestamp', z0([habit({ logs: [log('l', '2026-09-02T10:00:00.000Z')] })])],
    ['a log date that is not a calendar date', z0([habit({ logs: [log('l', '2026-02-30')] })])],
    ['a log date written without padding', z0([habit({ logs: [log('l', '2026-9-2')] })])],
    ['two entries on the same date', z0([habit({ logs: [log('a', '2026-09-02'), log('b', '2026-09-02')] })])],
    ['two entries with the same id', z0([habit({ logs: [log('a', '2026-09-02'), log('a', '2026-09-03')] })])],
    ['a log with an extra field', z0([habit({ logs: [{ ...log('a', '2026-09-02'), note: 'x' }] })])],
    ['a log without an id', z0([habit({ logs: [{ date: '2026-09-02' }] })])],
    ['logs that is not an array', z0([habit({ logs: {} })])],
    ['a direction that never existed', z0([habit({ direction: 'maintain' })])],
    ['a blank title', z0([habit({ title: '  ' })])],
    ['a missing title', z0([{ id: 'h', direction: 'build', logs: [], createdAt: '2026-09-01T10:00:00.000Z' }])],
    ['an unparseable createdAt', z0([habit({ createdAt: 'soon' })])],
    ['an unknown field on a habit', z0([habit({ streak: 4 })])],
    ['a canonical-only field in Z0', z0([habit({ startDate: '2026-09-01' })])],
    ['a duplicate habit id', z0([habit(), habit()])],
    ['a habit that is not an object', z0(['x'])],
    ['habits that is not an array', z0({})],
    ['an unknown state field', z0([], { goals: [] })],
  ])('fails closed on %s and preserves the original bytes', async (_label, raw) => {
    const storage = memory(raw);
    await expect(migrateLocalStore(habitsMigration, storage)).rejects.toMatchObject({ code: 'transform-failed' });
    expect(storage.raw()).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('fails closed on a future version and keeps the bytes', async () => {
    const raw = JSON.stringify({ state: { habits: [] }, version: 2 });
    const storage = memory(raw);
    await expect(migrateLocalStore(habitsMigration, storage)).rejects.toMatchObject({ code: 'unsupported-newer-version' });
    expect(storage.raw()).toBe(raw);
  });

  it('does not depend on the clock: the same bytes migrate identically at any time', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2001-01-01T00:00:00Z'));
    const early = await migrate(fixture);
    jest.setSystemTime(new Date('2099-12-31T23:59:59Z'));
    const late = await migrate(fixture);
    jest.useRealTimers();
    expect(late.habits).toEqual(early.habits);
  });
});

describe('APP-064 current Z1 validation', () => {
  const z1 = (habits: unknown) => JSON.stringify({ state: { habits }, version: 1 });
  const canonical = (extra: Record<string, unknown> = {}) => ({
    id: 'h', title: 'Habit', direction: 'quit', createdAt: '2026-09-01T10:00:00.000Z', startDate: '2026-09-01',
    scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule: { kind: 'weekdays', days: [1, 3] } }],
    logs: [log('l1', '2026-09-02')], ...extra,
  });

  it.each([
    ['an empty list', []],
    ['weekdays with a legacy future entry', [canonical({ logs: [log('l1', '2099-01-01')] })]],
    ['every schedule kind and a waiting change', [
      canonical({ id: 'a' }),
      canonical({ id: 'b', scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule: { kind: 'open' } }, { effectiveFrom: '2026-10-12', schedule: { kind: 'weekly', target: 3 } }] }),
    ]],
  ])('accepts %s untouched', async (_label, habits) => {
    const storage = memory(z1(habits));
    await migrateLocalStore(habitsMigration, storage);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each([
    ['a legacy-shaped habit in current data', [habit()]],
    ['targetPerWeek left in current data', [canonical({ targetPerWeek: 3 })]],
    ['a persisted missed state', [canonical({ missed: ['2026-09-03'] })]],
    ['a persisted streak', [canonical({ streak: 3 })]],
    ['no schedule history', [canonical({ scheduleHistory: [] })]],
    ['a history that does not start on the start date', [canonical({ scheduleHistory: [{ effectiveFrom: '2026-09-02', schedule: { kind: 'open' } }] })]],
    ['periods out of order', [canonical({ scheduleHistory: [
      { effectiveFrom: '2026-09-01', schedule: { kind: 'open' } }, { effectiveFrom: '2026-09-10', schedule: { kind: 'open' } },
      { effectiveFrom: '2026-09-05', schedule: { kind: 'open' } }] })]],
    ['an unsorted weekday list', [canonical({ scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule: { kind: 'weekdays', days: [3, 1] } }] })]],
    ['a weekly target of 8', [canonical({ scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule: { kind: 'weekly', target: 8 } }] })]],
    ['an entry before the start date', [canonical({ logs: [log('l1', '2026-08-31')] })]],
    ['two entries on one date', [canonical({ logs: [log('a', '2026-09-02'), log('b', '2026-09-02')] })]],
    ['a timestamp as an entry date', [canonical({ logs: [log('a', '2026-09-02T10:00:00.000Z')] })]],
    ['a start date that is not a calendar date', [canonical({ startDate: '2026-02-30' })]],
    ['a duplicate habit id', [canonical(), canonical()]],
    ['a habit that is not an object', ['x']],
  ])('rejects %s', async (_label, habits) => {
    await expect(migrateLocalStore(habitsMigration, memory(z1(habits)))).rejects.toMatchObject({ code: 'validation-failed' });
  });
});
