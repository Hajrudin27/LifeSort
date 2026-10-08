import fs from 'fs';
import path from 'path';

import { migrateLocalStore } from '@/core/storage/migrations/harness';
import { goalsMigration } from '@/core/storage/migrations/goals';
import { decodeGoals } from '@/features/goals/domain/goal';

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/local-migrations/goals/9c5330f-v0.json'), 'utf8');
const memory = (raw: string) => {
  let current = raw;
  return {
    getItem: jest.fn(async () => current),
    setItem: jest.fn(async (_key: string, next: string) => { current = next; }),
    raw: () => current,
  };
};
const z0 = (goals: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ state: { goals, ...extra }, version: 0 });
const sub = (id: string, completed: boolean) => ({ id, title: `Step ${id}`, completed });
const goal = (subGoals: unknown, extra: Record<string, unknown> = {}) => ({
  id: 'g', title: 'Goal', subGoals, createdAt: '2026-09-01T10:00:00.000Z', ...extra,
});
const migrate = async (raw: string) => {
  const storage = memory(raw);
  await migrateLocalStore(goalsMigration, storage);
  const envelope = JSON.parse(storage.raw());
  return { storage, version: envelope.version, goals: envelope.state.goals, envelope };
};

describe('APP-063 Life Goals Z0 to Z1', () => {
  it('upgrades the 9c5330f fixture: binary goals, every historical field and milestone kept exactly', async () => {
    const original = JSON.parse(fixture).state.goals;
    const { storage, version, goals, envelope } = await migrate(fixture);
    expect(version).toBe(1);
    expect(Object.keys(envelope)).toEqual(['state', 'version']);
    expect(Object.keys(envelope.state)).toEqual(['goals']);
    expect(goals).toHaveLength(3);
    original.forEach((old: Record<string, unknown>, index: number) => {
      expect(goals[index]).toMatchObject({
        id: old.id, title: old.title, createdAt: old.createdAt, type: 'binary', milestones: old.subGoals,
        ...(old.description === undefined ? {} : { description: old.description }),
        ...(old.deadline === undefined ? {} : { deadline: old.deadline }),
      });
      expect('subGoals' in goals[index]).toBe(false);
      expect('target' in goals[index] || 'current' in goals[index] || 'unit' in goals[index]).toBe(false);
    });
    // The fixture's three shapes: partial, finished, and no steps at all.
    expect(goals.map((entry: { completed: boolean }) => entry.completed)).toEqual([false, true, false]);
    expect(decodeGoals(goals)).not.toBeNull();
    storage.setItem.mockClear();
    await migrateLocalStore(goalsMigration, storage);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('a partially completed goal keeps its 2/3 milestones and becomes open, never a numeric target', async () => {
    const { goals } = await migrate(z0([goal([sub('1', true), sub('2', true), sub('3', false)])]));
    expect(goals[0]).toMatchObject({ type: 'binary', completed: false });
    expect(goals[0].milestones.filter((m: { completed: boolean }) => m.completed)).toHaveLength(2);
    expect(goals[0].milestones).toHaveLength(3);
  });

  it('no milestones is open; all complete with at least one is completed', async () => {
    const { goals } = await migrate(z0([
      goal([], { id: 'a' }), goal([sub('1', true)], { id: 'b' }), goal([sub('1', true), sub('2', true)], { id: 'c' }),
      goal([sub('1', false)], { id: 'd' }),
    ]));
    expect(goals.map((entry: { completed: boolean }) => entry.completed)).toEqual([false, true, true, false]);
  });

  it('an empty goal list stays empty', async () => {
    expect((await migrate(z0([]))).goals).toEqual([]);
  });

  it('a long historical milestone list migrates without any count limit', async () => {
    const many = Array.from({ length: 300 }, (_, index) => sub(`m${index}`, true));
    const { goals } = await migrate(z0([goal(many)]));
    expect(goals[0].milestones).toHaveLength(300);
    expect(goals[0].completed).toBe(true);
  });

  it('keeps legacy timestamp ids, the description and a past deadline untouched', async () => {
    const { goals } = await migrate(z0([goal([], { id: '1757000000000-123456', description: 'Why', deadline: '2020-02-29' })]));
    expect(goals[0]).toMatchObject({ id: '1757000000000-123456', description: 'Why', deadline: '2020-02-29' });
  });

  it.each([
    ['a milestone without a title', z0([goal([{ id: 'a', completed: true }])])],
    ['a milestone with a non-boolean completed', z0([goal([{ id: 'a', title: 'A', completed: 1 }])])],
    ['duplicate milestone ids', z0([goal([sub('a', true), sub('a', false)])])],
    ['subGoals that is not an array', z0([goal({ a: 1 })])],
    ['a goal without a title', z0([{ id: 'g', subGoals: [], createdAt: '2026-09-01T10:00:00.000Z' }])],
    ['a blank title', z0([goal([], { title: '  ' })])],
    ['an unparseable createdAt', z0([goal([], { createdAt: 'soon' })])],
    ['an impossible deadline', z0([goal([], { deadline: '2026-02-30' })])],
    ['an unknown field on a goal', z0([goal([], { priority: 'high' })])],
    ['a stored type that did not exist in Z0', z0([goal([], { type: 'binary' })])],
    ['a duplicate goal id', z0([goal([]), goal([])])],
    ['a goal that is not an object', z0(['x'])],
    ['goals that is not an array', z0({})],
    ['an unknown state field', z0([], { habits: [] })],
  ])('fails closed on %s and preserves the original bytes', async (_label, raw) => {
    const storage = memory(raw);
    await expect(migrateLocalStore(goalsMigration, storage)).rejects.toMatchObject({ code: 'transform-failed' });
    expect(storage.raw()).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('fails closed on a future version and keeps the bytes', async () => {
    const raw = JSON.stringify({ state: { goals: [] }, version: 2 });
    const storage = memory(raw);
    await expect(migrateLocalStore(goalsMigration, storage)).rejects.toMatchObject({ code: 'unsupported-newer-version' });
    expect(storage.raw()).toBe(raw);
  });
});

describe('APP-063 current Z1 validation', () => {
  const z1 = (goals: unknown) => JSON.stringify({ state: { goals }, version: 1 });
  const common = { title: 'A', milestones: [], createdAt: '2026-10-01T10:00:00.000Z' };
  const binary = { ...common, id: 'a', type: 'binary', completed: false };
  const count = { ...common, id: 'b', type: 'count', target: 12, current: 30 };
  const amount = { ...common, id: 'c', type: 'amount', target: 100, current: 0, unit: 'km' };
  const duration = { ...common, id: 'd', type: 'duration', target: 60, current: 1 };

  it.each([
    ['an empty list', []],
    ['binary and a count goal above target', [binary, count]],
    ['amount and duration', [amount, duration]],
  ])('accepts %s untouched', async (_label, goals) => {
    const storage = memory(z1(goals));
    await migrateLocalStore(goalsMigration, storage);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each([
    ['a legacy-shaped goal in current data', [goal([])]],
    ['a binary goal with a target', [{ ...binary, target: 1 }]],
    ['a count goal with completed', [{ ...count, completed: true }]],
    ['a zero target', [{ ...count, target: 0 }]],
    ['a fractional value', [{ ...count, current: 1.5 }]],
    ['an unknown type', [{ ...binary, type: 'habit' }]],
    ['an amount without a unit', [(({ unit, ...rest }) => rest)(amount)]],
    ['a duration with a unit', [{ ...duration, unit: 'min' }]],
    ['a negative current', [{ ...count, current: -1 }]],
    ['an unsafe value', [{ ...count, current: Number.MAX_SAFE_INTEGER + 1 }]],
    ['a value above the bound', [{ ...count, target: 1_000_000_000_001 }]],
  ])('rejects %s', async (_label, goals) => {
    await expect(migrateLocalStore(goalsMigration, memory(z1(goals)))).rejects.toMatchObject({ code: 'validation-failed' });
  });
});
