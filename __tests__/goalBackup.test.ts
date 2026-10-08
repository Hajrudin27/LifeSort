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

import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';
import type { LifeGoal } from '@/types/life';
import { exportBackup, importBackup } from '@/utils/shared/dataBackup';

const file = (version: number, lifeGoals: Record<string, unknown>) =>
  JSON.stringify({ version, exportedAt: '2026-10-07T00:00:00.000Z', data: { lifeGoals } });
const sub = (id: string, completed: boolean) => ({ id, title: `Step ${id}`, completed });
const legacy = (id: string, subGoals: unknown[], extra: Record<string, unknown> = {}) =>
  ({ id, title: `Goal ${id}`, subGoals, createdAt: '2026-09-01T10:00:00.000Z', ...extra });
const common = { title: 'T', milestones: [sub('m', true)], createdAt: '2026-10-01T10:00:00.000Z', deadline: '2026-12-31', description: 'D' };
const canonical: LifeGoal[] = [
  { ...common, id: 'b', type: 'binary', completed: true },
  { ...common, id: 'c', type: 'count', target: 12, current: 30 },
  { ...common, id: 'a', type: 'amount', target: 10_000, current: 1250, unit: 'km' },
  { ...common, id: 'd', type: 'duration', target: 6000, current: 0 },
  { id: 'plain', title: 'No extras', milestones: [], createdAt: '2026-10-02T10:00:00.000Z', type: 'binary', completed: false },
];
const parsed = (raw: string) => {
  const result = parseBackupFile(raw);
  return result.ok ? result.data.lifeGoals : result;
};

describe('APP-063 backup v11', () => {
  it('is at least format 11, where goal types were introduced (now 12)', () => expect(BACKUP_VERSION).toBe(12));

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('format %i: old goals become binary goals with their sub-goals as milestones', (version) => {
    const result = parsed(file(version, { goals: [
      legacy('p', [sub('1', true), sub('2', false)], { description: 'Why', deadline: '2020-02-29' }),
      legacy('f', [sub('1', true), sub('2', true)]),
      legacy('n', []),
    ] })) as { goals: LifeGoal[] };
    expect(result.goals).toEqual([
      { id: 'p', title: 'Goal p', description: 'Why', deadline: '2020-02-29', milestones: [sub('1', true), sub('2', false)], createdAt: '2026-09-01T10:00:00.000Z', type: 'binary', completed: false },
      { id: 'f', title: 'Goal f', milestones: [sub('1', true), sub('2', true)], createdAt: '2026-09-01T10:00:00.000Z', type: 'binary', completed: true },
      { id: 'n', title: 'Goal n', milestones: [], createdAt: '2026-09-01T10:00:00.000Z', type: 'binary', completed: false },
    ]);
    for (const goal of result.goals) expect('target' in goal || 'current' in goal || 'unit' in goal).toBe(false);
  });

  it('a backup without goals restores nothing for goals (partial restore)', () => {
    expect(parseBackupFile(JSON.stringify({ version: 10, data: { habits: { habits: [] } } }))).toMatchObject({ ok: true, data: { habits: { habits: [] } } });
    expect(parsed(file(10, {}))).toBeUndefined();
  });

  it('v11 round-trips all four types, milestones, optional fields and values above target', () => {
    expect(parsed(file(11, { goals: canonical }))).toEqual({ goals: canonical });
  });

  it('v11 keeps an empty list', () => expect(parsed(file(11, { goals: [] }))).toEqual({ goals: [] }));

  it('v11 does not accept the old shape, and an old format does not accept the new one', () => {
    expect(parsed(file(11, { goals: [legacy('p', [])] }))).toEqual({ ok: false, error: 'invalid_format' });
    expect(parsed(file(10, { goals: [canonical[0]] }))).toEqual({ ok: false, error: 'invalid_format' });
  });

  it.each([
    ['a binary goal with a target', { ...canonical[0], target: 1 }],
    ['a count goal with completed', { ...canonical[1], completed: true }],
    ['an amount goal without a unit', (({ unit, ...rest }) => rest)(canonical[2] as LifeGoal & { unit: string })],
    ['a duration goal with a unit', { ...canonical[3], unit: 'min' }],
    ['a zero target', { ...canonical[1], target: 0 }],
    ['a negative value', { ...canonical[1], current: -1 }],
    ['a fractional value', { ...canonical[1], current: 0.5 }],
    ['an unsafe value', { ...canonical[1], current: Number.MAX_SAFE_INTEGER + 1 }],
    ['a value above the bound', { ...canonical[1], target: 1_000_000_000_001 }],
    ['an unknown type', { ...canonical[0], type: 'habit' }],
    ['a malformed milestone', { ...canonical[0], milestones: [{ id: 'a' }] }],
    ['duplicate milestone ids', { ...canonical[0], milestones: [sub('a', true), sub('a', false)] }],
    ['an impossible deadline', { ...canonical[0], deadline: '2026-02-30' }],
    ['an unknown field', { ...canonical[0], address: 'Main St 1' }],
  ])('v11 rejects %s', (_label, goal) => {
    expect(parsed(file(11, { goals: [goal] }))).toEqual({ ok: false, error: 'invalid_format' });
  });

  it.each([
    ['a milestone without a title', legacy('x', [{ id: 'a', completed: true }])],
    ['duplicate milestone ids', legacy('x', [sub('a', true), sub('a', false)])],
    ['a non-array sub-goal list', legacy('x', 'nope' as unknown as unknown[])],
    ['a duplicate goal id', legacy('x', [])],
  ])('an old format rejects %s', (label, goal) => {
    const goals = label === 'a duplicate goal id' ? [goal, goal] : [goal];
    expect(parsed(file(10, { goals }))).toEqual({ ok: false, error: 'invalid_format' });
  });

  it('a long historical milestone list is not rejected for its length', () => {
    const many = Array.from({ length: 400 }, (_, index) => sub(`m${index}`, false));
    expect((parsed(file(10, { goals: [legacy('big', many)] })) as { goals: LifeGoal[] }).goals[0].milestones).toHaveLength(400);
  });
});

describe('APP-063 backup through the real store', () => {
  beforeEach(() => useLifeGoalsStore.getState().clearLocal());

  it('exports exactly the goals: no runtime state, no functions, no validators', async () => {
    useLifeGoalsStore.setState({ goals: canonical });
    await exportBackup();
    const exported = JSON.parse(mockWritten);
    expect(exported.version).toBe(12);
    expect(exported.data.lifeGoals).toEqual({ goals: canonical });
    expect(Object.keys(exported.data.lifeGoals)).toEqual(['goals']);
  });

  it('round-trips through export and import, including an empty list', async () => {
    for (const goals of [canonical, []]) {
      useLifeGoalsStore.setState({ goals });
      await exportBackup();
      useLifeGoalsStore.getState().clearLocal();
      mockFileContent = mockWritten;
      expect(await importBackup()).toMatchObject({ success: true });
      expect(useLifeGoalsStore.getState().goals).toEqual(goals);
    }
  });

  it('restores an old backup as binary goals', async () => {
    mockFileContent = file(8, { goals: [legacy('p', [sub('1', true), sub('2', false)])] });
    expect(await importBackup()).toMatchObject({ success: true });
    expect(useLifeGoalsStore.getState().goals).toMatchObject([{ id: 'p', type: 'binary', completed: false, milestones: [sub('1', true), sub('2', false)] }]);
  });

  it('a malformed goals backup restores nothing and keeps the current goals', async () => {
    useLifeGoalsStore.setState({ goals: canonical });
    mockFileContent = file(11, { goals: [{ ...canonical[0], target: 1 }] });
    expect(await importBackup()).toMatchObject({ success: false, error: 'invalid_format' });
    expect(useLifeGoalsStore.getState().goals).toEqual(canonical);
  });

  it('a partial restore without goals keeps the current goals', async () => {
    useLifeGoalsStore.setState({ goals: canonical });
    mockFileContent = JSON.stringify({ version: 11, exportedAt: 'x', data: { habits: { habits: [] } } });
    expect(await importBackup()).toMatchObject({ success: true });
    expect(useLifeGoalsStore.getState().goals).toEqual(canonical);
  });
});
