import AsyncStorage from '@react-native-async-storage/async-storage';

import { GoalError } from '@/features/goals/domain/goal';
import type { LifeGoal } from '@/types/life';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let mockAccount: string | null = A;
/** undefined = the session follows the signed-in account; otherwise it is forced. */
let mockSessionUser: string | null | undefined;
let mockSessionGate: Promise<void> | null = null;
let mockQueryGate: Promise<void> | null = null;
let mockRows: unknown[] = [];
type Call = { op: 'upsert' | 'delete'; row?: Record<string, unknown>; user?: unknown; id?: unknown };
const mockCalls: Call[] = [];

jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ session: mockAccount ? { user: { id: mockAccount } } : null }) },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => {
        if (mockSessionGate) await mockSessionGate;
        const id = mockSessionUser === undefined ? mockAccount : mockSessionUser;
        return { data: { session: id ? { user: { id }, access_token: 'token' } : null }, error: null };
      },
    },
    from: (table: string) => {
      if (table !== 'life_goals') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({ eq: async () => {
          if (mockQueryGate) await mockQueryGate;
          return { data: mockRows, error: null };
        } }),
        upsert: (row: Record<string, unknown>) => { mockCalls.push({ op: 'upsert', row }); return Promise.resolve({ error: null }); },
        delete: () => ({ eq: (_c1: string, user: unknown) => ({ eq: (_c2: string, id: unknown) => {
          mockCalls.push({ op: 'delete', user, id });
          return Promise.resolve({ error: null });
        } }) }),
      };
    },
  },
}));

import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';

const store = () => useLifeGoalsStore.getState();
const settle = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
const persisted = async () => {
  await settle();
  const raw = await AsyncStorage.getItem('lifesort-life-goals');
  return raw === null ? null : JSON.parse(raw) as { version: number; state: Record<string, unknown> };
};
const goal = (id = 'g'): string => store().addGoal({ title: `Goal ${id}`, type: 'count', target: 10 });
const gate = () => {
  let release!: () => void;
  mockSessionGate = new Promise((resolve) => { release = resolve; });
  return () => { mockSessionGate = null; release(); };
};
const remote = (extra: Record<string, unknown> = {}) => ({
  id: 'r1', title: 'Remote', description: null, deadline: null, sub_goals: [], created_at: '2026-10-01T10:00:00+00:00',
  goal_type: null, target_value: null, current_value: null, unit: null, completed: null, ...extra,
});
const fails = (action: () => unknown, code: string) => {
  try { action(); } catch (error) { expect(error).toBeInstanceOf(GoalError); expect((error as GoalError).code).toBe(code); return; }
  throw new Error(`expected GoalError ${code}`);
};

beforeEach(async () => {
  mockAccount = A;
  mockSessionUser = undefined;
  mockSessionGate = null;
  mockQueryGate = null;
  mockRows = [];
  mockCalls.length = 0;
  await AsyncStorage.clear();
  store().clearLocal();
  await useLifeGoalsStore.persist.rehydrate();
  store().clearLocal();
  await settle();
  mockCalls.length = 0;
});

describe('APP-063 goal mutations', () => {
  it('creates each type with canonical state and a fresh UUID', () => {
    const ids = [
      store().addGoal({ title: 'Licence', type: 'binary' }),
      store().addGoal({ title: 'Books', type: 'count', target: 12, current: 3 }),
      store().addGoal({ title: 'Run', type: 'amount', target: 10_000, unit: 'km' }),
      store().addGoal({ title: 'Study', type: 'duration', target: 6000 }),
    ];
    expect(new Set(ids).size).toBe(4);
    ids.forEach((id) => expect(id).toMatch(UUID));
    expect(store().goals.map((entry) => entry.type)).toEqual(['binary', 'count', 'amount', 'duration']);
    expect(store().goals[0]).toMatchObject({ completed: false, milestones: [] });
    expect(store().goals[1]).toMatchObject({ target: 12, current: 3 });
    expect(store().goals[2]).toMatchObject({ target: 10_000, current: 0, unit: 'km' });
  });

  it('refuses invalid input with a fixed code and leaves state and sync untouched', async () => {
    fails(() => store().addGoal({ title: ' ', type: 'binary' }), 'goal_title_invalid');
    fails(() => store().addGoal({ title: 'x', type: 'count', target: 0 }), 'goal_target_invalid');
    fails(() => store().addGoal({ title: 'x', type: 'amount', target: 5, unit: '' }), 'goal_unit_invalid');
    fails(() => store().addGoal({ title: 'x', type: 'binary', deadline: '2026-02-30' }), 'goal_deadline_invalid');
    await settle();
    expect(store().goals).toEqual([]);
    expect(mockCalls).toEqual([]);
  });

  it('setGoalCurrent is absolute, idempotent and refused for binary goals or bad values without any change', async () => {
    const id = goal();
    store().setGoalCurrent(id, 7);
    store().setGoalCurrent(id, 7);
    expect(store().goals[0]).toMatchObject({ current: 7 });
    store().setGoalCurrent(id, 25);
    expect(store().goals[0]).toMatchObject({ current: 25 });
    const before = store().goals;
    fails(() => store().setGoalCurrent(id, -1), 'goal_current_invalid');
    fails(() => store().setGoalCurrent(id, 1.5), 'goal_current_invalid');
    expect(store().goals).toBe(before);
    const binaryId = store().addGoal({ title: 'B', type: 'binary' });
    fails(() => store().setGoalCurrent(binaryId, 1), 'goal_type_mismatch');
    fails(() => store().setGoalCompleted(id, true), 'goal_type_mismatch');
  });

  it('binary goals are marked done and reopened; milestones do not complete them', () => {
    const id = store().addGoal({ title: 'B', type: 'binary' });
    store().addMilestone(id, 'Step');
    store().toggleMilestone(id, store().goals[0].milestones[0].id);
    expect(store().goals[0]).toMatchObject({ completed: false });
    store().setGoalCompleted(id, true);
    expect(store().goals[0]).toMatchObject({ completed: true });
    store().addMilestone(id, 'Another');
    expect(store().goals[0]).toMatchObject({ completed: true });
    store().setGoalCompleted(id, false);
    expect(store().goals[0]).toMatchObject({ completed: false });
  });

  it('milestones are added, toggled and removed; a blank title is refused', () => {
    const id = goal();
    store().addMilestone(id, '  First ');
    store().addMilestone(id, 'Second');
    const [first, second] = store().goals[0].milestones;
    expect(first).toMatchObject({ title: 'First', completed: false });
    expect(first.id).toMatch(UUID);
    store().toggleMilestone(id, first.id);
    store().removeMilestone(id, second.id);
    expect(store().goals[0].milestones).toEqual([{ ...first, completed: true }]);
    fails(() => store().addMilestone(id, '   '), 'goal_milestone_invalid');
    expect(store().goals[0]).toMatchObject({ current: 0 });
  });

  it('update changes only the allowed fields, clears the deadline and refuses type-foreign fields', () => {
    const id = store().addGoal({ title: 'T', type: 'amount', target: 100, unit: 'kg', deadline: '2026-10-07', description: 'D' });
    store().updateGoal(id, { title: ' New ', target: 250, unit: 'lb', description: null, deadline: null });
    expect(store().goals[0]).toEqual({
      id, title: 'New', milestones: [], createdAt: expect.any(String), type: 'amount', target: 250, current: 0, unit: 'lb',
    });
    fails(() => store().updateGoal(id, { target: 0 }), 'goal_target_invalid');
    const bin = store().addGoal({ title: 'B', type: 'binary' });
    fails(() => store().updateGoal(bin, { target: 3 }), 'goal_field_invalid');
    fails(() => store().updateGoal(bin, { unit: 'km' }), 'goal_field_invalid');
  });

  it('a deadline of today or in the past is kept and never changes completion', () => {
    const id = goal();
    for (const deadline of ['2026-10-07', '2001-01-01']) {
      store().updateGoal(id, { deadline });
      expect(store().goals[0]).toMatchObject({ deadline, current: 0 });
    }
  });

  it('unknown ids are ignored; removing a goal removes it', () => {
    goal();
    store().setGoalCurrent('missing', 3);
    store().toggleMilestone('missing', 'x');
    expect(store().goals).toHaveLength(1);
    store().removeGoal(store().goals[0].id);
    expect(store().goals).toEqual([]);
  });
});

describe('APP-063 persistence', () => {
  it('persists canonical goals only, at format 1, and restores them', async () => {
    const id = store().addGoal({ title: 'Books', type: 'count', target: 12, current: 30 });
    store().addMilestone(id, 'Step');
    const disk = await persisted();
    expect(disk).toEqual({ version: 1, state: { goals: store().goals } });
    await useLifeGoalsStore.persist.rehydrate();
    expect(store().goals).toEqual(disk!.state.goals);
  });

  it('upgrades Z0 bytes found on disk when the app starts, keeping every goal', async () => {
    await AsyncStorage.setItem('lifesort-life-goals', JSON.stringify({
      state: { goals: [{ id: 'old', title: 'Old', subGoals: [{ id: 's', title: 'S', completed: true }], createdAt: '2026-09-01T10:00:00.000Z' }] },
      version: 0,
    }));
    await useLifeGoalsStore.persist.rehydrate();
    expect(store().goals).toEqual([{
      id: 'old', title: 'Old', milestones: [{ id: 's', title: 'S', completed: true }],
      createdAt: '2026-09-01T10:00:00.000Z', type: 'binary', completed: true,
    }]);
    expect((await persisted())!.version).toBe(1);
  });

  it('clearLocal empties state', () => {
    goal();
    store().clearLocal();
    expect(store().goals).toEqual([]);
  });
});

describe('APP-063 sync rows (best-effort write, as before)', () => {
  it('writes the typed columns with the initiating account as owner', async () => {
    const id = store().addGoal({ title: 'Run', type: 'amount', target: 10_000, current: 250, unit: 'km' });
    await settle();
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0].row).toMatchObject({
      id, user_id: A, title: 'Run', goal_type: 'amount', target_value: 10_000, current_value: 250, unit: 'km', completed: null, sub_goals: [],
    });
    store().setGoalCurrent(id, 300);
    store().removeGoal(id);
    await settle();
    expect(mockCalls[1].row).toMatchObject({ current_value: 300 });
    expect(mockCalls[2]).toMatchObject({ op: 'delete', user: A, id });
  });

  it('writes a binary goal without numeric columns and milestones in sub_goals', async () => {
    const id = store().addGoal({ title: 'B', type: 'binary' });
    store().addMilestone(id, 'Step');
    store().setGoalCompleted(id, true);
    await settle();
    expect(mockCalls.at(-1)!.row).toMatchObject({
      goal_type: 'binary', completed: true, target_value: null, current_value: null, unit: null,
      sub_goals: [expect.objectContaining({ title: 'Step' })],
    });
  });
});

describe('APP-063 account binding (a delayed write is never re-owned)', () => {
  const doAction: Record<string, () => string> = {
    create: () => store().addGoal({ title: 'Account A goal', type: 'binary' }),
    update: () => { const id = goal(); mockCalls.length = 0; store().updateGoal(id, { title: 'Changed by A' }); return id; },
    progress: () => { const id = goal(); mockCalls.length = 0; store().setGoalCurrent(id, 4); return id; },
    done: () => { const id = store().addGoal({ title: 'B', type: 'binary' }); mockCalls.length = 0; store().setGoalCompleted(id, true); return id; },
    milestone: () => { const id = goal(); mockCalls.length = 0; store().addMilestone(id, 'Step'); return id; },
    toggle: () => { const id = goal(); store().addMilestone(id, 'Step'); mockCalls.length = 0; store().toggleMilestone(id, store().goals[0].milestones[0].id); return id; },
    delete: () => { const id = goal(); mockCalls.length = 0; store().removeGoal(id); return id; },
  };

  it.each(Object.keys(doAction))('%s pending across an account switch is dropped, never written under the new account', async (name) => {
    await settle();
    const release = gate();
    doAction[name]();
    mockAccount = B;
    release();
    await settle();
    expect(mockCalls).toEqual([]);
  });

  it('a request that does go out carries the initiator as owner, so it can never be B\'s row', async () => {
    mockSessionUser = A; // the live session still answers as A while the shell already shows B
    const release = gate();
    store().addGoal({ title: 'Account A goal', type: 'binary' });
    mockAccount = B;
    release();
    await settle();
    expect(mockCalls.map((call) => call.row?.user_id)).toEqual([A]);
  });

  it('A to B and back to A before the write resolves: still A\'s own write, never B\'s', async () => {
    const release = gate();
    store().addGoal({ title: 'Account A goal', type: 'binary' });
    mockAccount = B;
    mockAccount = A;
    release();
    await settle();
    expect(mockCalls.map((call) => call.row?.user_id)).toEqual([A]);
  });

  it('logout while a write is pending drops it', async () => {
    const release = gate();
    store().addGoal({ title: 'x', type: 'binary' });
    mockAccount = null;
    store().clearLocal();
    release();
    await settle();
    expect(mockCalls).toEqual([]);
    expect(store().goals).toEqual([]);
  });

  it('signed out: local state changes, nothing is sent', async () => {
    mockAccount = null;
    store().addGoal({ title: 'offline', type: 'binary' });
    await settle();
    expect(store().goals).toHaveLength(1);
    expect(mockCalls).toEqual([]);
  });
});

describe('APP-063 remote rows and stale fetch', () => {
  it('applies valid rows, maps legacy NULL-type rows and drops malformed ones without crashing', async () => {
    mockRows = [
      remote({ id: 'legacy', sub_goals: [{ id: 'a', title: 'A', completed: true }] }),
      remote({ id: 'typed', goal_type: 'count', target_value: 12, current_value: 30 }),
      remote({ id: 'bad-json', sub_goals: 'oops' }),
      remote({ id: 'bad-shape', goal_type: 'binary', completed: true, target_value: 5 }),
      null,
    ];
    await store().fetchFromSupabase();
    expect(store().goals.map((entry) => entry.id)).toEqual(['legacy', 'typed']);
    expect(store().goals[0]).toMatchObject({ type: 'binary', completed: true });
    expect(store().goals[1]).toMatchObject({ type: 'count', target: 12, current: 30 });
  });

  it('stays append-only: a goal already held locally is never overwritten by a fetch', async () => {
    const id = store().addGoal({ title: 'Local', type: 'count', target: 3 });
    mockRows = [remote({ id, title: 'Server version', goal_type: 'count', target_value: 99, current_value: 1 })];
    await store().fetchFromSupabase();
    expect(store().goals).toHaveLength(1);
    expect(store().goals[0]).toMatchObject({ title: 'Local', target: 3 });
  });

  it('a fetch that finishes after logout never repopulates the store', async () => {
    mockRows = [remote()];
    let release!: () => void;
    mockQueryGate = new Promise((resolve) => { release = resolve; });
    const pending = store().fetchFromSupabase();
    await settle();
    mockAccount = null;
    store().clearLocal();
    release();
    await pending;
    expect(store().goals).toEqual([]);
  });

  it('a fetch started for Account A never applies after Account B signs in', async () => {
    mockRows = [remote({ title: 'Account A private goal' })];
    let release!: () => void;
    mockQueryGate = new Promise((resolve) => { release = resolve; });
    const pending = store().fetchFromSupabase();
    await settle();
    mockAccount = B;
    store().clearLocal();
    release();
    await pending;
    expect(store().goals).toEqual([]);
  });

  it('a fetch interrupted by a restore does not apply', async () => {
    mockRows = [remote()];
    let release!: () => void;
    mockQueryGate = new Promise((resolve) => { release = resolve; });
    const pending = store().fetchFromSupabase();
    await settle();
    store().restoreBackup({ goals: [] });
    release();
    await pending;
    expect(store().goals).toEqual([]);
  });

  it('a fetch while the session no longer matches does not apply', async () => {
    mockRows = [remote()];
    mockSessionUser = B;
    await store().fetchFromSupabase();
    expect(store().goals).toEqual([]);
  });

  it('restoreBackup replaces only the supplied goals', () => {
    goal();
    const before = store().goals;
    store().restoreBackup({});
    expect(store().goals).toBe(before);
    const restored: LifeGoal[] = [{ id: 'z', title: 'Z', milestones: [], createdAt: '2026-10-01T10:00:00.000Z', type: 'binary', completed: true }];
    store().restoreBackup({ goals: restored });
    expect(store().goals).toEqual(restored);
  });
});
