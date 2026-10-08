import AsyncStorage from '@react-native-async-storage/async-storage';

import { HabitError } from '@/features/habits/domain/habitCommands';
import type { Habit, HabitSchedule } from '@/types/life';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let mockAccount: string | null = A;
/** undefined = the session follows the signed-in account; otherwise it is forced. */
let mockSessionUser: string | null | undefined;
let mockSessionGate: Promise<void> | null = null;
let mockQueryGate: Promise<void> | null = null;
let mockRows: unknown[] = [];
let mockSelected = '';
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
      if (table !== 'habits') throw new Error(`unexpected table ${table}`);
      return {
        select: (columns: string) => ({ eq: async () => {
          mockSelected = columns;
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

import { useHabitsStore } from '@/store/useHabitsStore';

const store = () => useHabitsStore.getState();
const settle = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
const persisted = async () => {
  await settle();
  const raw = await AsyncStorage.getItem('lifesort-habits');
  return raw === null ? null : JSON.parse(raw) as { version: number; state: Record<string, unknown> };
};
const everyDay: HabitSchedule = { kind: 'weekdays', days: [1, 2, 3, 4, 5, 6, 7] };
const habit = (): string => store().addHabit({ title: 'Habit', direction: 'build', schedule: everyDay });
const gate = () => {
  let release!: () => void;
  mockSessionGate = new Promise((resolve) => { release = resolve; });
  return () => { mockSessionGate = null; release(); };
};
/** Only `Date` is faked: promises, timers and the AsyncStorage mock keep running for real. */
const setToday = (year: number, month: number, day: number, hour = 12, minute = 0) => {
  jest.useFakeTimers({
    now: new Date(year, month - 1, day, hour, minute),
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'performance', 'hrtime'],
  });
};
const remote = (extra: Record<string, unknown> = {}) => ({
  id: 'r1', title: 'Remote', direction: 'build', target_per_week: null, logs: [], created_at: '2026-10-01T10:00:00+00:00',
  start_date: null, schedule_history: null, ...extra,
});
const canonicalRow = (extra: Record<string, unknown> = {}) => remote({
  start_date: '2026-10-01', schedule_history: [{ effectiveFrom: '2026-10-01', schedule: { kind: 'weekdays', days: [1, 3] } }], ...extra,
});
const fails = (action: () => unknown, code: string) => {
  try { action(); } catch (error) { expect(error).toBeInstanceOf(HabitError); expect((error as HabitError).code).toBe(code); return; }
  throw new Error(`expected HabitError ${code}`);
};

beforeEach(async () => {
  jest.useRealTimers();
  setToday(2026, 10, 8); // Thursday
  mockAccount = A;
  mockSessionUser = undefined;
  mockSessionGate = null;
  mockQueryGate = null;
  mockRows = [];
  mockSelected = '';
  mockCalls.length = 0;
  await AsyncStorage.clear();
  store().clearLocal();
  await useHabitsStore.persist.rehydrate();
  store().clearLocal();
  await settle();
  mockCalls.length = 0;
});
afterEach(() => jest.useRealTimers());

describe('APP-064 habit mutations', () => {
  it('creates a canonical habit with a fresh UUID that counts from the device-local date', () => {
    setToday(2026, 10, 8, 0, 30); // 22:30 on 7 October in UTC
    const id = store().addHabit({ title: '  Walk ', direction: 'quit', schedule: { kind: 'weekdays', days: [5, 1] } });
    expect(id).toMatch(UUID);
    expect(store().habits[0]).toEqual({
      id, title: 'Walk', direction: 'quit', createdAt: expect.any(String), startDate: '2026-10-08',
      scheduleHistory: [{ effectiveFrom: '2026-10-08', schedule: { kind: 'weekdays', days: [1, 5] } }], logs: [],
    });
    // createdAt is the instant itself, whatever the zone; only startDate follows the local calendar.
    // (In UTC+ zones its UTC date is 2026-10-07 — buildHabit's own test pins that case with explicit inputs.)
    expect(store().habits[0].createdAt).toBe(new Date(2026, 9, 8, 0, 30).toISOString());
  });

  it('refuses invalid input with a fixed code and leaves state and sync untouched', async () => {
    fails(() => store().addHabit({ title: ' ', direction: 'build', schedule: everyDay }), 'habit_title_invalid');
    fails(() => store().addHabit({ title: 'x', direction: 'maintain' as never, schedule: everyDay }), 'habit_direction_invalid');
    fails(() => store().addHabit({ title: 'x', direction: 'build', schedule: { kind: 'weekly', target: 0 } }), 'habit_schedule_invalid');
    fails(() => store().addHabit({ title: 'x', direction: 'build', schedule: { kind: 'weekdays', days: [] } }), 'habit_schedule_invalid');
    fails(() => store().addHabit({ title: 'x', direction: 'build', schedule: everyDay, targetPerWeek: 3 } as never), 'habit_field_invalid');
    await settle();
    expect(store().habits).toEqual([]);
    expect(mockCalls).toEqual([]);
  });

  it('setHabitDateCompleted is idempotent: a repeat adds no entry, no new id and no sync write', async () => {
    const id = habit();
    store().setHabitDateCompleted(id, '2026-10-08', true);
    const entry = store().habits[0].logs[0];
    expect(entry.id).toMatch(UUID);
    await settle();
    mockCalls.length = 0;
    store().setHabitDateCompleted(id, '2026-10-08', true);
    expect(store().habits[0].logs).toEqual([entry]);
    await settle();
    expect(mockCalls).toEqual([]);
    store().setHabitDateCompleted(id, '2026-10-08', false);
    store().setHabitDateCompleted(id, '2026-10-08', false);
    expect(store().habits[0].logs).toEqual([]);
    await settle();
    expect(mockCalls).toHaveLength(1);
  });

  it('refuses a future completion and a completion before the start date without any change', async () => {
    const id = habit();
    await settle();
    mockCalls.length = 0;
    const before = store().habits;
    fails(() => store().setHabitDateCompleted(id, '2026-10-09', true), 'habit_date_future');
    fails(() => store().setHabitDateCompleted(id, '2026-10-07', true), 'habit_date_before_start');
    fails(() => store().setHabitDateCompleted(id, '2026-10-8', true), 'habit_date_invalid');
    expect(store().habits).toBe(before);
    await settle();
    expect(mockCalls).toEqual([]);
  });

  it('clears a legacy future-dated entry that arrived from elsewhere', async () => {
    mockRows = [canonicalRow({ id: 'f', start_date: '2026-10-01', logs: [{ id: 'x', date: '2099-01-01' }] })];
    await store().fetchFromSupabase();
    expect(store().habits[0].logs).toHaveLength(1);
    store().setHabitDateCompleted('f', '2099-01-01', false);
    expect(store().habits[0].logs).toEqual([]);
  });

  it('title changes freely; direction only while there are no entries', () => {
    const id = habit();
    store().updateHabit(id, { title: ' Renamed ', direction: 'quit' });
    expect(store().habits[0]).toMatchObject({ title: 'Renamed', direction: 'quit' });
    store().setHabitDateCompleted(id, '2026-10-08', true);
    fails(() => store().updateHabit(id, { direction: 'build' }), 'habit_direction_locked');
    expect(store().habits[0].direction).toBe('quit');
    store().updateHabit(id, { title: 'Still free' });
    expect(store().habits[0].title).toBe('Still free');
  });

  it('a Wednesday weekly change waits for Monday; a Wednesday weekday change applies today', () => {
    setToday(2026, 10, 7);
    const id = habit();
    store().setHabitSchedule(id, { kind: 'weekdays', days: [2] });
    expect(store().habits[0].scheduleHistory).toEqual([{ effectiveFrom: '2026-10-07', schedule: { kind: 'weekdays', days: [2] } }]);
    store().setHabitSchedule(id, { kind: 'weekly', target: 3 });
    expect(store().habits[0].scheduleHistory).toEqual([
      { effectiveFrom: '2026-10-07', schedule: { kind: 'weekdays', days: [2] } },
      { effectiveFrom: '2026-10-12', schedule: { kind: 'weekly', target: 3 } },
    ]);
  });

  it('unknown ids are ignored; removing a habit removes it', () => {
    habit();
    store().setHabitDateCompleted('missing', '2026-10-08', true);
    store().setHabitSchedule('missing', { kind: 'open' });
    store().updateHabit('missing', { title: 'x' });
    expect(store().habits).toHaveLength(1);
    store().removeHabit(store().habits[0].id);
    expect(store().habits).toEqual([]);
  });

  it('has no toggle: the only completion action states the wanted outcome', () => {
    expect((store() as unknown as Record<string, unknown>).toggleLogForDate).toBeUndefined();
    expect(typeof store().setHabitDateCompleted).toBe('function');
  });
});

describe('APP-064 persistence', () => {
  it('persists canonical habits only, at format 1, and restores them', async () => {
    const id = habit();
    store().setHabitDateCompleted(id, '2026-10-08', true);
    const disk = await persisted();
    expect(disk).toEqual({ version: 1, state: { habits: store().habits } });
    expect(Object.keys(disk!.state)).toEqual(['habits']);
    await useHabitsStore.persist.rehydrate();
    expect(store().habits).toEqual(disk!.state.habits);
  });

  it('upgrades Z0 bytes found on disk when the app starts, keeping every habit and entry', async () => {
    await AsyncStorage.setItem('lifesort-habits', JSON.stringify({
      state: { habits: [{ id: 'old', title: 'Old', direction: 'quit', targetPerWeek: 4, logs: [{ id: 'e', date: '2026-09-02' }], createdAt: '2026-09-01T10:00:00.000Z' }] },
      version: 0,
    }));
    await useHabitsStore.persist.rehydrate();
    expect(store().habits).toEqual([{
      id: 'old', title: 'Old', direction: 'quit', createdAt: '2026-09-01T10:00:00.000Z', startDate: '2026-09-01',
      scheduleHistory: [{ effectiveFrom: '2026-09-01', schedule: { kind: 'weekly', target: 4 } }],
      logs: [{ id: 'e', date: '2026-09-02' }],
    }]);
    expect((await persisted())!.version).toBe(1);
  });

  it('clearLocal empties state', () => {
    habit();
    store().clearLocal();
    expect(store().habits).toEqual([]);
  });
});

describe('APP-064 sync rows (best-effort write, as before)', () => {
  it('writes the canonical columns and the legacy mirror with the initiating account as owner', async () => {
    const id = store().addHabit({ title: 'Run', direction: 'build', schedule: { kind: 'weekly', target: 3 } });
    await settle();
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0].row).toMatchObject({
      id, user_id: A, title: 'Run', direction: 'build', target_per_week: 3, logs: [], start_date: '2026-10-08',
      schedule_history: [{ effectiveFrom: '2026-10-08', schedule: { kind: 'weekly', target: 3 } }],
    });
    store().setHabitDateCompleted(id, '2026-10-08', true);
    store().removeHabit(id);
    await settle();
    expect(mockCalls[1].row).toMatchObject({ logs: [expect.objectContaining({ date: '2026-10-08' })] });
    expect(mockCalls[2]).toMatchObject({ op: 'delete', user: A, id });
  });

  it('a weekday or open schedule writes a NULL mirror', async () => {
    store().addHabit({ title: 'a', direction: 'build', schedule: everyDay });
    store().addHabit({ title: 'b', direction: 'build', schedule: { kind: 'open' } });
    await settle();
    expect(mockCalls.map((call) => call.row?.target_per_week)).toEqual([null, null]);
  });
});

describe('APP-064 target_per_week mirror in the row the store sends', () => {
  it('does not announce a weekly change that is still waiting for Monday, and does once Monday has come', async () => {
    setToday(2026, 10, 7); // Wednesday
    const id = store().addHabit({ title: 'Gym', direction: 'build', schedule: { kind: 'weekdays', days: [1, 3] } });
    store().setHabitSchedule(id, { kind: 'weekly', target: 3 });
    await settle();
    expect(mockCalls.at(-1)!.row).toMatchObject({
      target_per_week: null,
      schedule_history: [
        { effectiveFrom: '2026-10-07', schedule: { kind: 'weekdays', days: [1, 3] } },
        { effectiveFrom: '2026-10-12', schedule: { kind: 'weekly', target: 3 } },
      ],
    });
    setToday(2026, 10, 12); // Monday: the change is in effect, and the next write says so
    store().updateHabit(id, { title: 'Gym 2' });
    await settle();
    expect(mockCalls.at(-1)!.row).toMatchObject({ target_per_week: 3, title: 'Gym 2' });
  });

  it('uses the day the user acted, not the day the request is finally built', async () => {
    setToday(2026, 10, 8); // Thursday
    const id = store().addHabit({ title: 'Gym', direction: 'build', schedule: { kind: 'weekly', target: 2 } });
    await settle();
    mockCalls.length = 0;
    const release = gate();
    store().setHabitSchedule(id, { kind: 'open' }); // pending until Monday 12 October: still weekly 2 today
    setToday(2026, 10, 13); // the session answer arrives after the change has taken effect
    release();
    await settle();
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0].row).toMatchObject({ target_per_week: 2 });
  });
});

describe('APP-064 an older client\'s entry dated before start_date', () => {
  const row = () => JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures/habits/old-client-pre-start-row.json'), 'utf8'));

  it('keeps the habit visible after a fetch, and the stored state is strictly valid', async () => {
    mockRows = [row()];
    await store().fetchFromSupabase();
    expect(store().habits).toHaveLength(1);
    expect(store().habits[0]).toMatchObject({ startDate: '2026-09-30', logs: [{ id: '1757000000000-123456', date: '2026-09-30' }] });
    const disk = await persisted();
    expect(disk!.version).toBe(1);
    await useHabitsStore.persist.rehydrate(); // the Z1 gate re-validates what was stored: it must not brick the boot
    expect(store().habits).toEqual(disk!.state.habits);
  });

  it('writes the coherent state back on the next change, so the server row becomes strictly valid too', async () => {
    mockRows = [row()];
    await store().fetchFromSupabase();
    mockCalls.length = 0;
    store().updateHabit(store().habits[0].id, { title: 'Renamed' });
    await settle();
    expect(mockCalls[0].row).toMatchObject({
      start_date: '2026-09-30',
      schedule_history: [{ effectiveFrom: '2026-09-30', schedule: { kind: 'weekdays', days: [1, 3, 5] } }],
      logs: [{ id: '1757000000000-123456', date: '2026-09-30' }],
    });
  });

  it('can be cleared and then no longer counts before the original start', async () => {
    mockRows = [row()];
    await store().fetchFromSupabase();
    const id = store().habits[0].id;
    store().setHabitDateCompleted(id, '2026-09-30', false);
    expect(store().habits[0].logs).toEqual([]);
    fails(() => store().setHabitDateCompleted(id, '2026-09-29', true), 'habit_date_before_start');
  });
});

describe('APP-064 account binding (a delayed write is never re-owned)', () => {
  const doAction: Record<string, () => string> = {
    create: () => store().addHabit({ title: 'Account A habit', direction: 'build', schedule: everyDay }),
    title: () => { const id = habit(); mockCalls.length = 0; store().updateHabit(id, { title: 'Changed by A' }); return id; },
    direction: () => { const id = habit(); mockCalls.length = 0; store().updateHabit(id, { direction: 'quit' }); return id; },
    schedule: () => { const id = habit(); mockCalls.length = 0; store().setHabitSchedule(id, { kind: 'open' }); return id; },
    mark: () => { const id = habit(); mockCalls.length = 0; store().setHabitDateCompleted(id, '2026-10-08', true); return id; },
    clear: () => {
      const id = habit(); store().setHabitDateCompleted(id, '2026-10-08', true); mockCalls.length = 0;
      store().setHabitDateCompleted(id, '2026-10-08', false); return id;
    },
    delete: () => { const id = habit(); mockCalls.length = 0; store().removeHabit(id); return id; },
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
    store().addHabit({ title: 'Account A habit', direction: 'build', schedule: everyDay });
    mockAccount = B;
    release();
    await settle();
    expect(mockCalls.map((call) => call.row?.user_id)).toEqual([A]);
  });

  it('A to B and back to A before the write resolves: still A\'s own write, never B\'s', async () => {
    const release = gate();
    store().addHabit({ title: 'Account A habit', direction: 'build', schedule: everyDay });
    mockAccount = B;
    mockAccount = A;
    release();
    await settle();
    expect(mockCalls.map((call) => call.row?.user_id)).toEqual([A]);
  });

  it('a delete started by A is addressed to A, whatever the session says afterwards', async () => {
    const id = habit();
    await settle();
    mockCalls.length = 0;
    mockSessionUser = A;
    const release = gate();
    store().removeHabit(id);
    mockAccount = B;
    release();
    await settle();
    expect(mockCalls).toEqual([{ op: 'delete', user: A, id }]);
  });

  it('logout while a write is pending drops it', async () => {
    const release = gate();
    store().addHabit({ title: 'x', direction: 'build', schedule: everyDay });
    mockAccount = null;
    store().clearLocal();
    release();
    await settle();
    expect(mockCalls).toEqual([]);
    expect(store().habits).toEqual([]);
  });

  it('signed out: local state changes, nothing is sent', async () => {
    mockAccount = null;
    store().addHabit({ title: 'offline', direction: 'build', schedule: everyDay });
    await settle();
    expect(store().habits).toHaveLength(1);
    expect(mockCalls).toEqual([]);
  });
});

describe('APP-064 remote rows and stale fetch', () => {
  it('selects the canonical columns', async () => {
    await store().fetchFromSupabase();
    expect(mockSelected).toBe('id, title, direction, target_per_week, logs, created_at, start_date, schedule_history');
  });

  it('applies valid rows, maps legacy NULL-column rows and drops malformed ones without crashing', async () => {
    mockRows = [
      remote({ id: 'legacy', target_per_week: 3, logs: [{ id: 'a', date: '2026-10-02' }] }),
      canonicalRow({ id: 'canonical' }),
      remote({ id: 'bad-json', logs: 'oops' }),
      canonicalRow({ id: 'bad-history', schedule_history: [] }),
      canonicalRow({ id: 'bad-dupe', logs: [{ id: 'x', date: '2026-10-02' }, { id: 'y', date: '2026-10-02' }] }),
      remote({ id: 'half', start_date: '2026-10-01' }),
      null,
    ];
    await store().fetchFromSupabase();
    expect(store().habits.map((entry) => entry.id)).toEqual(['legacy', 'canonical']);
    expect(store().habits[0]).toMatchObject({ startDate: '2026-10-01', scheduleHistory: [{ schedule: { kind: 'weekly', target: 3 } }] });
    expect(store().habits[1].scheduleHistory[0].schedule).toEqual({ kind: 'weekdays', days: [1, 3] });
  });

  it('stays append-only: a habit already held locally is never overwritten by a fetch', async () => {
    const id = habit();
    mockRows = [canonicalRow({ id, title: 'Server version' })];
    await store().fetchFromSupabase();
    expect(store().habits).toHaveLength(1);
    expect(store().habits[0].title).toBe('Habit');
  });

  it('a fetch that finishes after logout never repopulates the store', async () => {
    mockRows = [canonicalRow()];
    let release!: () => void;
    mockQueryGate = new Promise((resolve) => { release = resolve; });
    const pending = store().fetchFromSupabase();
    await settle();
    mockAccount = null;
    store().clearLocal();
    release();
    await pending;
    expect(store().habits).toEqual([]);
  });

  it('a fetch started for Account A never applies after Account B signs in', async () => {
    mockRows = [canonicalRow({ title: 'Account A private habit' })];
    let release!: () => void;
    mockQueryGate = new Promise((resolve) => { release = resolve; });
    const pending = store().fetchFromSupabase();
    await settle();
    mockAccount = B;
    store().clearLocal();
    release();
    await pending;
    expect(store().habits).toEqual([]);
  });

  it('A to B to A while a fetch is in flight: the dataset epoch still retires it', async () => {
    mockRows = [canonicalRow()];
    let release!: () => void;
    mockQueryGate = new Promise((resolve) => { release = resolve; });
    const pending = store().fetchFromSupabase();
    await settle();
    mockAccount = B;
    store().clearLocal();
    mockAccount = A;
    release();
    await pending;
    expect(store().habits).toEqual([]);
  });

  it('a fetch interrupted by a restore does not apply', async () => {
    mockRows = [canonicalRow()];
    let release!: () => void;
    mockQueryGate = new Promise((resolve) => { release = resolve; });
    const pending = store().fetchFromSupabase();
    await settle();
    store().restoreBackup({ habits: [] });
    release();
    await pending;
    expect(store().habits).toEqual([]);
  });

  it('a fetch while the session no longer matches does not apply', async () => {
    mockRows = [canonicalRow()];
    mockSessionUser = B;
    await store().fetchFromSupabase();
    expect(store().habits).toEqual([]);
  });

  it('a malformed row never partially mutates state: the whole response is applied row by row or not at all', async () => {
    const before = store().habits;
    mockRows = [canonicalRow({ id: 'bad', schedule_history: 'x' })];
    await store().fetchFromSupabase();
    expect(store().habits).toEqual(before);
  });

  it('restoreBackup replaces only the supplied habits', () => {
    habit();
    const before = store().habits;
    store().restoreBackup({});
    expect(store().habits).toBe(before);
    const restored: Habit[] = [{
      id: 'z', title: 'Z', direction: 'build', createdAt: '2026-10-01T10:00:00.000Z', startDate: '2026-10-01',
      scheduleHistory: [{ effectiveFrom: '2026-10-01', schedule: { kind: 'open' } }], logs: [],
    }];
    store().restoreBackup({ habits: restored });
    expect(store().habits).toEqual(restored);
  });
});
