import fs from 'fs';
import path from 'path';

import { BACKUP_VERSION, parseBackupFile } from '@/utils/shared/backupValidation';

let mockFileContent = '';
let mockWritten = '';
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: false, assets: [{ uri: 'file:///synthetic/backup.json' }] })),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///synthetic/',
  readAsStringAsync: jest.fn(() => Promise.resolve(mockFileContent)),
  writeAsStringAsync: jest.fn((_uri: string, content: string) => { mockWritten = content; return Promise.resolve(); }),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(false)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

import { useHabitsStore } from '@/store/useHabitsStore';
import type { Habit } from '@/types/life';
import { exportBackup, importBackup } from '@/utils/shared/dataBackup';

const file = (version: number, habits: Record<string, unknown>) =>
  JSON.stringify({ version, exportedAt: '2026-10-08T00:00:00.000Z', data: { habits } });
const parsed = (raw: string) => {
  const result = parseBackupFile(raw);
  return result.ok ? result.data.habits : result;
};
const legacy = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Habit ${id}`, direction: 'build', logs: [{ id: `${id}-1`, date: '2026-09-02' }], createdAt: '2026-09-01T10:00:00.000Z', ...extra,
});
const canonical: Habit[] = [
  {
    id: 'b', title: 'Walk', direction: 'build', createdAt: '2026-09-01T10:00:00.000Z', startDate: '2026-09-01',
    scheduleHistory: [
      { effectiveFrom: '2026-09-01', schedule: { kind: 'weekdays', days: [1, 3, 5] } },
      { effectiveFrom: '2026-09-15', schedule: { kind: 'open' } },
      { effectiveFrom: '2026-10-12', schedule: { kind: 'weekly', target: 3 } },
    ],
    logs: [{ id: 'l1', date: '2026-09-02' }, { id: 'l2', date: '2026-09-04' }],
  },
  {
    id: 'q', title: 'No sugar', direction: 'quit', createdAt: '2026-09-02T00:30:00.000Z', startDate: '2026-09-02',
    scheduleHistory: [{ effectiveFrom: '2026-09-02', schedule: { kind: 'weekdays', days: [1, 2, 3, 4, 5, 6, 7] } }],
    logs: [{ id: 'f', date: '2099-01-01' }], // a legacy future-dated entry is preserved
  },
  {
    id: 'n', title: 'Nothing logged', direction: 'build', createdAt: '2026-09-03T10:00:00.000Z', startDate: '2026-09-03',
    scheduleHistory: [{ effectiveFrom: '2026-09-03', schedule: { kind: 'weekly', target: 7 } }], logs: [],
  },
  {
    id: 'o', title: 'Open', direction: 'quit', createdAt: '2026-09-04T10:00:00.000Z', startDate: '2026-09-04',
    scheduleHistory: [{ effectiveFrom: '2026-09-04', schedule: { kind: 'open' } }], logs: [],
  },
];

describe('APP-064 backup v12', () => {
  it('is format 12', () => expect(BACKUP_VERSION).toBe(12));

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])('format %i: old habits are mapped, never guessed', (version) => {
    const result = parsed(file(version, { habits: [
      legacy('w', { targetPerWeek: 3 }),
      legacy('o'),
      legacy('z', { targetPerWeek: 0 }),
      legacy('big', { targetPerWeek: 12 }),
      legacy('q', { direction: 'quit', logs: [{ id: 'e', date: '2026-08-31' }] }),
    ] })) as { habits: Habit[] };
    expect(result.habits.map((habit) => [habit.id, habit.startDate, habit.scheduleHistory])).toEqual([
      ['w', '2026-09-01', [{ effectiveFrom: '2026-09-01', schedule: { kind: 'weekly', target: 3 } }]],
      ['o', '2026-09-01', [{ effectiveFrom: '2026-09-01', schedule: { kind: 'open' } }]],
      ['z', '2026-09-01', [{ effectiveFrom: '2026-09-01', schedule: { kind: 'open' } }]],
      ['big', '2026-09-01', [{ effectiveFrom: '2026-09-01', schedule: { kind: 'open' } }]],
      ['q', '2026-08-31', [{ effectiveFrom: '2026-08-31', schedule: { kind: 'open' } }]],
    ]);
    expect(result.habits[0]).toMatchObject({ id: 'w', title: 'Habit w', direction: 'build', createdAt: '2026-09-01T10:00:00.000Z', logs: [{ id: 'w-1', date: '2026-09-02' }] });
    for (const habit of result.habits) expect('targetPerWeek' in habit).toBe(false);
  });

  it('v12 round-trips build, quit, every schedule kind, a multi-period history, entries, no entries and a legacy future entry', () => {
    expect(parsed(file(12, { habits: canonical }))).toEqual({ habits: canonical });
  });

  it('v12 keeps an empty list', () => expect(parsed(file(12, { habits: [] }))).toEqual({ habits: [] }));

  it('v12 does not accept the old shape, and an old format does not accept the new one', () => {
    expect(parsed(file(12, { habits: [legacy('p')] }))).toEqual({ ok: false, error: 'invalid_format' });
    expect(parsed(file(11, { habits: [canonical[0]] }))).toEqual({ ok: false, error: 'invalid_format' });
  });

  it.each([
    ['two entries on one date', { ...canonical[0], logs: [{ id: 'a', date: '2026-09-02' }, { id: 'b', date: '2026-09-02' }] }],
    ['a reused entry id', { ...canonical[0], logs: [{ id: 'a', date: '2026-09-02' }, { id: 'a', date: '2026-09-03' }] }],
    ['an entry before the start date', { ...canonical[0], logs: [{ id: 'a', date: '2026-08-31' }] }],
    ['a timestamp as an entry date', { ...canonical[0], logs: [{ id: 'a', date: '2026-09-02T10:00:00.000Z' }] }],
    ['no schedule history', { ...canonical[0], scheduleHistory: [] }],
    ['a history not starting on the start date', { ...canonical[0], startDate: '2026-08-30' }],
    ['periods out of order', { ...canonical[0], scheduleHistory: [canonical[0].scheduleHistory[0], canonical[0].scheduleHistory[2], canonical[0].scheduleHistory[1]] }],
    ['an unsorted weekday list', { ...canonical[0], scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule: { kind: 'weekdays', days: [3, 1] } }] }],
    ['a weekly target of 8', { ...canonical[0], scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule: { kind: 'weekly', target: 8 } }] }],
    ['a persisted miss list', { ...canonical[0], missed: ['2026-09-03'] }],
    ['a persisted streak', { ...canonical[0], streak: 4 }],
    ['a week cache', { ...canonical[0], thisWeek: { done: 1, of: 3 } }],
    ['sync metadata', { ...canonical[0], revision: 3 }],
    ['targetPerWeek next to the schedule', { ...canonical[0], targetPerWeek: 3 }],
    ['a start date that is not a calendar date', { ...canonical[0], startDate: '2026-02-30' }],
    ['an unknown direction', { ...canonical[0], direction: 'maintain' }],
  ])('v12 rejects %s', (_label, habit) => {
    expect(parsed(file(12, { habits: [habit] }))).toEqual({ ok: false, error: 'invalid_format' });
  });

  it.each([1, 11])('format %i rejects duplicate dates instead of collapsing them', (version) => {
    expect(parsed(file(version, { habits: [legacy('x', { logs: [{ id: 'a', date: '2026-09-02' }, { id: 'b', date: '2026-09-02' }] })] })))
      .toEqual({ ok: false, error: 'invalid_format' });
  });

  it.each([
    ['a timestamp entry date', legacy('x', { logs: [{ id: 'a', date: '2026-09-02T00:00:00.000Z' }] })],
    ['a string target', legacy('x', { targetPerWeek: '3' })],
    ['an unknown field', legacy('x', { streak: 3 })],
    ['a duplicate habit id', legacy('x')],
  ])('an old format rejects %s', (label, habit) => {
    expect(parsed(file(11, { habits: label === 'a duplicate habit id' ? [habit, habit] : [habit] }))).toEqual({ ok: false, error: 'invalid_format' });
  });

  it('v12 rejects two habits with one id, and keeps the order of distinct ones', () => {
    expect(parsed(file(12, { habits: [canonical[0], canonical[0]] }))).toEqual({ ok: false, error: 'invalid_format' });
    expect((parsed(file(12, { habits: [canonical[1], canonical[0]] })) as { habits: Habit[] }).habits.map((habit) => habit.id)).toEqual(['q', 'b']);
  });

  it('a backup without habits restores nothing for habits', () => {
    expect(parsed(file(11, {}))).toBeUndefined();
    expect(parseBackupFile(JSON.stringify({ version: 12, data: { todos: { todos: [] } } }))).toMatchObject({ ok: true, data: { todos: { todos: [] } } });
  });

  it('a file from a newer app version is refused', () => {
    expect(parseBackupFile(file(13, { habits: [] }))).toEqual({ ok: false, error: 'unsupported_version' });
  });
});

describe('APP-064 backup through the real store', () => {
  beforeEach(() => useHabitsStore.getState().clearLocal());

  it('exports exactly the habits: no derived status, week fact, streak, miss, sync or UI state', async () => {
    useHabitsStore.setState({ habits: canonical });
    await exportBackup();
    const exported = JSON.parse(mockWritten);
    expect(exported.version).toBe(12);
    expect(exported.data.habits).toEqual({ habits: canonical });
    expect(Object.keys(exported.data.habits)).toEqual(['habits']);
    const text = JSON.stringify(exported.data.habits);
    for (const forbidden of ['streak', 'missed', 'pending', 'weekFacts', 'targetPerWeek', 'revision', 'syncedAt', 'epoch']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('round-trips through export and import, including an empty list', async () => {
    for (const habits of [canonical, []]) {
      useHabitsStore.setState({ habits });
      await exportBackup();
      useHabitsStore.getState().clearLocal();
      mockFileContent = mockWritten;
      expect(await importBackup()).toMatchObject({ success: true });
      expect(useHabitsStore.getState().habits).toEqual(habits);
    }
  });

  it('restores an old backup through the legacy mapping', async () => {
    mockFileContent = file(11, { habits: [legacy('p', { targetPerWeek: 2 })] });
    expect(await importBackup()).toMatchObject({ success: true });
    expect(useHabitsStore.getState().habits).toMatchObject([
      { id: 'p', startDate: '2026-09-01', scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule: { kind: 'weekly', target: 2 } }] },
    ]);
  });

  it('a malformed habits backup restores nothing and keeps the current habits', async () => {
    useHabitsStore.setState({ habits: canonical });
    mockFileContent = file(12, { habits: [{ ...canonical[0], logs: [{ id: 'a', date: '2026-09-02' }, { id: 'b', date: '2026-09-02' }] }] });
    expect(await importBackup()).toMatchObject({ success: false, error: 'invalid_format' });
    expect(useHabitsStore.getState().habits).toEqual(canonical);
  });

  it('a partial restore without habits keeps the current habits', async () => {
    useHabitsStore.setState({ habits: canonical });
    mockFileContent = JSON.stringify({ version: 12, exportedAt: 'x', data: { todos: { todos: [] } } });
    expect(await importBackup()).toMatchObject({ success: true });
    expect(useHabitsStore.getState().habits).toEqual(canonical);
    mockFileContent = file(12, {});
    await importBackup();
    expect(useHabitsStore.getState().habits).toEqual(canonical);
  });

  it('exports through an explicit whitelist rather than the whole store state', () => {
    const source = fs.readFileSync(path.join(__dirname, '../utils/shared/dataBackup.ts'), 'utf8');
    expect(source).toContain("key === 'habits'");
    expect(source).toMatch(/useHabitsStore\.getState\(\)\.restoreBackup/);
  });
});
