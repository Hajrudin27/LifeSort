import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * APP-072 - a Cycle fetch or write started by one account can never reach another account.
 *
 * Health rows are special-category data. A response for account A that resolves after A logged out
 * must not enter memory, and - through persist - must not be written to the encrypted disk store
 * of the next session. A write the user made as A must never be re-owned by B.
 * These writes stay best-effort (no outbox/retry/revisions: APP-076); only isolation is tested.
 */

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SENTINEL_DATE = '2031-03-17';
const SENTINEL_NOTE = 'sentinel-note-A-only';

let mockAccount: string | null = A;
/** undefined = the live session follows the signed-in account; otherwise it is forced. */
let mockSessionUser: string | null | undefined;
let mockSessionGate: Promise<void> | null = null;
let mockQueryGate: Promise<void> | null = null;
let mockTables: Record<string, unknown> = {};
type Call = { table: string; op: 'upsert' | 'delete'; row?: Record<string, unknown>; user?: unknown; id?: unknown };
const mockCalls: Call[] = [];

jest.mock('@/core/storage/cycleHealthEncryptedStorage', () => ({
  cycleHealthEncryptedStorage: require('@react-native-async-storage/async-storage'),
}));
jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ session: mockAccount ? { user: { id: mockAccount } } : null }) },
}));
jest.mock('@/lib/supabase', () => {
  const read = (table: string) => {
    const builder: Record<string, unknown> = {
      eq: () => builder,
      single: () => builder,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(mockQueryGate)
          .then(() => ({ data: mockTables[table] ?? null, error: null }))
          .then(resolve, reject),
    };
    return builder;
  };
  return {
    supabase: {
      auth: {
        getSession: async () => {
          if (mockSessionGate) await mockSessionGate;
          const id = mockSessionUser === undefined ? mockAccount : mockSessionUser;
          return { data: { session: id ? { user: { id }, access_token: 'token' } : null }, error: null };
        },
      },
      from: (table: string) => ({
        select: () => read(table),
        upsert: (row: Record<string, unknown>) => {
          mockCalls.push({ table, op: 'upsert', row });
          return Promise.resolve({ error: null });
        },
        delete: () => ({
          eq: (_c1: string, user: unknown) => ({
            eq: (_c2: string, id: unknown) => {
              mockCalls.push({ table, op: 'delete', user, id });
              return Promise.resolve({ error: null });
            },
          }),
        }),
      }),
    },
  };
});

import { useCycleStore } from '@/store/useCycleStore';

const store = () => useCycleStore.getState();
const settle = async () => {
  for (let i = 0; i < 60; i += 1) await Promise.resolve();
};
const gate = (kind: 'session' | 'query') => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  if (kind === 'session') mockSessionGate = promise;
  else mockQueryGate = promise;
  return () => {
    if (kind === 'session') mockSessionGate = null;
    else mockQueryGate = null;
    release();
  };
};

const serverRows = () => ({
  cycles: [{ id: 'remote-cycle', start_date: SENTINEL_DATE, end_date: null, created_at: '2031-03-17T00:00:00.000Z' }],
  symptom_logs: [{ id: 'remote-log', date: SENTINEL_DATE, symptoms: ['cramps'], flow: null, notes: SENTINEL_NOTE }],
  cycle_settings: { avg_cycle_length: 31, luteal_phase_length: 12, reminder_enabled: true, reminder_days_before: 3 },
  health_conditions: [],
  symptom_glossary: [],
});

beforeEach(async () => {
  mockAccount = A;
  mockSessionUser = undefined;
  mockSessionGate = null;
  mockQueryGate = null;
  mockTables = serverRows();
  mockCalls.length = 0;
  await AsyncStorage.clear();
  useCycleStore.setState({
    cycles: [],
    symptomLogs: [],
    avgCycleLength: 28,
    lutealPhaseLength: 14,
    reminderEnabled: false,
    reminderDaysBefore: 1,
    healthConditions: [],
    symptomGlossary: [],
  });
});

describe('APP-072 Cycle fetch is retired with its account and dataset', () => {
  it('publishes a same-account fetch', async () => {
    await store().fetchFromSupabase();
    expect(store().cycles.map((c) => c.id)).toEqual(['remote-cycle']);
    expect(store().symptomLogs.map((l) => l.notes)).toEqual([SENTINEL_NOTE]);
    expect(store().avgCycleLength).toBe(31);
  });

  it('does nothing without a signed-in account', async () => {
    mockAccount = null;
    await store().fetchFromSupabase();
    expect(store().cycles).toEqual([]);
  });

  it('never publishes a response that resolves after logout', async () => {
    const release = gate('query');
    const pending = store().fetchFromSupabase();
    await settle();

    mockAccount = null;
    store().clearLocal(); // what logout does, through LOCAL_STORE_RESETS
    release();
    await pending;
    await settle();

    expect(store().cycles).toEqual([]);
    expect(store().symptomLogs).toEqual([]);
    expect(store().avgCycleLength).toBe(28);
  });

  it('never publishes account A rows while account B is signed in', async () => {
    const release = gate('query');
    const pending = store().fetchFromSupabase();
    await settle();

    store().clearLocal();
    mockAccount = B;
    release();
    await pending;
    await settle();

    expect(store().cycles).toEqual([]);
    expect(store().symptomLogs).toEqual([]);
    // ... and persist never wrote A's health rows into the next session's disk store.
    const raw = (await AsyncStorage.getItem('lifesort-cycle')) ?? '';
    expect(raw).not.toContain(SENTINEL_NOTE);
    expect(raw).not.toContain(SENTINEL_DATE);
  });

  it('retires on the in-memory account alone, even if no reset ran and the live session still says A', async () => {
    const release = gate('query');
    const pending = store().fetchFromSupabase();
    await settle();

    mockSessionUser = A; // isolates the in-memory account check from the live-session check
    mockAccount = B;
    release();
    await pending;
    await settle();

    expect(store().cycles).toEqual([]);
  });

  it('retires on the dataset alone: clearLocal retires a fetch for the very same account id', async () => {
    const release = gate('query');
    const pending = store().fetchFromSupabase();
    await settle();

    store().clearLocal(); // logout, then the same account signs in again before the response
    release();
    await pending;
    await settle();

    expect(store().cycles).toEqual([]);
  });

  it('drops a response whose live session changed after the request', async () => {
    const release = gate('query');
    const pending = store().fetchFromSupabase();
    await settle();

    mockSessionUser = B; // the in-memory account still says A; the live session does not
    release();
    await pending;
    await settle();

    expect(store().cycles).toEqual([]);
  });

  it('publishes again for a fetch started after the reset', async () => {
    store().clearLocal();
    await store().fetchFromSupabase();
    expect(store().cycles).toHaveLength(1);
  });
});

describe('APP-072 clearLocal', () => {
  it('resets the user-owned Cycle state and keeps the reviewed reference content', () => {
    const condition = { id: 'pcos', nameDa: 'PCOS', nameEn: 'PCOS' } as never;
    const term = { id: 'cramps', nameDa: 'Kramper', nameEn: 'Cramps' } as never;
    useCycleStore.setState({
      cycles: [{ id: 'c1', startDate: SENTINEL_DATE, createdAt: '2031-03-17T00:00:00.000Z' }],
      symptomLogs: [{ id: 'l1', date: SENTINEL_DATE, symptoms: ['cramps'], notes: SENTINEL_NOTE }],
      avgCycleLength: 33,
      lutealPhaseLength: 11,
      reminderEnabled: true,
      reminderDaysBefore: 4,
      healthConditions: [condition],
      symptomGlossary: [term],
    });

    store().clearLocal();

    expect(store()).toMatchObject({
      cycles: [],
      symptomLogs: [],
      avgCycleLength: 28,
      lutealPhaseLength: 14,
      reminderEnabled: false,
      reminderDaysBefore: 1,
      healthConditions: [condition],
      symptomGlossary: [term],
    });
  });

  it('is what the logout registry calls for the lifesort-cycle key', () => {
    // Importing the registry pulls every store; its source is the contract here.
    const source = require('fs').readFileSync(require('path').join(__dirname, '../features/localStores.ts'), 'utf8') as string;
    expect(source).toMatch(/key: 'lifesort-cycle',\s*reset: \(\) => useCycleStore\.getState\(\)\.clearLocal\(\)/);
  });
});

describe('APP-072 Cycle writes are bound to the account that acted', () => {
  const actions: Record<string, { run: () => void; table: string; op: 'upsert' | 'delete' }> = {
    startPeriod: { run: () => store().startPeriod('2031-04-01'), table: 'cycles', op: 'upsert' },
    endPeriod: {
      run: () => {
        useCycleStore.setState({ cycles: [{ id: 'c1', startDate: '2031-04-01', createdAt: 'x' }] });
        store().endPeriod('c1', '2031-04-05');
      },
      table: 'cycles',
      op: 'upsert',
    },
    updateCycle: {
      run: () => {
        useCycleStore.setState({ cycles: [{ id: 'c1', startDate: '2031-04-01', createdAt: 'x' }] });
        store().updateCycle('c1', { startDate: '2031-04-02' });
      },
      table: 'cycles',
      op: 'upsert',
    },
    removeCycle: { run: () => store().removeCycle('c1'), table: 'cycles', op: 'delete' },
    logSymptoms: { run: () => store().logSymptoms('2031-04-01', ['cramps'], undefined, SENTINEL_NOTE), table: 'symptom_logs', op: 'upsert' },
    removeSymptomLog: { run: () => store().removeSymptomLog('l1'), table: 'symptom_logs', op: 'delete' },
    setAvgCycleLength: { run: () => store().setAvgCycleLength(30), table: 'cycle_settings', op: 'upsert' },
    setLutealPhaseLength: { run: () => store().setLutealPhaseLength(13), table: 'cycle_settings', op: 'upsert' },
    setReminderEnabled: { run: () => store().setReminderEnabled(true), table: 'cycle_settings', op: 'upsert' },
    setReminderDaysBefore: { run: () => store().setReminderDaysBefore(2), table: 'cycle_settings', op: 'upsert' },
  };

  it.each(Object.keys(actions))('%s writes with the initiating account as owner', async (name) => {
    const { run, table, op } = actions[name];
    run();
    await settle();
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0]).toMatchObject({ table, op });
    const owner = mockCalls[0].op === 'upsert' ? mockCalls[0].row!.user_id : mockCalls[0].user;
    expect(owner).toBe(A);
  });

  it.each(Object.keys(actions))('%s pending across an account switch is dropped, never written under the new account', async (name) => {
    const release = gate('session');
    actions[name].run();
    await settle();

    mockAccount = B;
    mockSessionUser = B;
    release();
    await settle();

    expect(mockCalls).toEqual([]);
  });

  it.each(Object.keys(actions))('%s pending across logout is dropped', async (name) => {
    const release = gate('session');
    actions[name].run();
    await settle();

    mockAccount = null;
    mockSessionUser = null;
    release();
    await settle();

    expect(mockCalls).toEqual([]);
  });

  it('a signed-out action changes memory but never reaches the server', async () => {
    mockAccount = null;
    store().setReminderEnabled(true);
    await settle();
    expect(store().reminderEnabled).toBe(true);
    expect(mockCalls).toEqual([]);
  });

  it('a session that already belongs to another account refuses the write', async () => {
    mockSessionUser = B; // in-memory state still says A
    store().startPeriod('2031-04-01');
    await settle();
    expect(mockCalls).toEqual([]);
  });
});
