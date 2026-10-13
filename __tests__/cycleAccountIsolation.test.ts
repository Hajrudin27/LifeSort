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
let mockErrors: Record<string, unknown> = {};
type Call = { table: string; op: 'upsert' | 'delete'; row?: Record<string, unknown>; user?: unknown; id?: unknown };
const mockCalls: Call[] = [];
/** Every read: the table, the column list and the filters applied (APP-074 pins the clinical queries). */
const mockSelects: Array<{ table: string; columns: unknown; filters: Array<[string, unknown, unknown]> }> = [];

jest.mock('@/core/storage/cycleHealthEncryptedStorage', () => ({
  cycleHealthEncryptedStorage: require('@react-native-async-storage/async-storage'),
}));
jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ session: mockAccount ? { user: { id: mockAccount } } : null }) },
}));
jest.mock('@/lib/supabase', () => {
  const read = (table: string, filters: Array<[string, unknown, unknown]> = []) => {
    const builder: Record<string, unknown> = {
      eq: (column: unknown, value: unknown) => { filters.push(['eq', column, value]); return builder; },
      gte: (column: unknown, value: unknown) => { filters.push(['gte', column, value]); return builder; },
      single: () => builder,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(mockQueryGate)
          .then(() => ({ data: mockTables[table] ?? null, error: mockErrors[table] ?? null }))
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
        select: (columns?: unknown) => {
          const filters: Array<[string, unknown, unknown]> = [];
          mockSelects.push({ table, columns, filters });
          return read(table, filters);
        },
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

import { createJSONStorage } from 'zustand/middleware';
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

const governedCondition = (id = 'governed') => ({
  id, content_version: 2, review_due_at: '2099-01-01', status: 'published',
  name_da: 'Dansk', name_en: 'English', summary_da: 'Dansk summary', summary_en: 'English summary',
  what_it_is_da: 'Dansk detail', what_it_is_en: 'English detail', common_symptoms: ['cramps'],
  what_helps_da: 'Dansk help', what_helps_en: 'English help', when_to_see_doctor_da: 'Dansk care', when_to_see_doctor_en: 'English care',
});
const governedSymptom = (id = 'cramps') => ({
  id, content_version: 2, review_due_at: '2099-01-01', status: 'published',
  name_da: 'Kramper', name_en: 'Cramps', description_da: 'Dansk description', description_en: 'English description',
});

beforeEach(async () => {
  mockAccount = A;
  mockSessionUser = undefined;
  mockSessionGate = null;
  mockQueryGate = null;
  mockTables = serverRows();
  mockErrors = {};
  mockCalls.length = 0;
  mockSelects.length = 0;
  await AsyncStorage.clear();
  useCycleStore.setState({
    cycles: [],
    symptomLogs: [],
    avgCycleLength: 28,
    lutealPhaseLength: 14,
    reminderEnabled: false,
    reminderDaysBefore: 1,
    richNotificationCopyEnabled: false,
    healthConditions: [],
    symptomGlossary: [],
    clinicalContentReady: false,
  });
});

describe('APP-074 governed clinical-reference refresh', () => {
  it('never trusts a legacy cached reference row until this session has a complete governed refresh', () => {
    useCycleStore.setState({ healthConditions: [{ id: 'legacy' } as never], symptomGlossary: [{ id: 'legacy' } as never], clinicalContentReady: false });
    expect(store().clinicalContentReady).toBe(false);
    expect(store().healthConditions.map((row) => row.id)).toEqual(['legacy']);
  });

  it('replaces both collections with a complete successful governed result, including a smaller result', async () => {
    useCycleStore.setState({ healthConditions: [{ id: 'old' } as never], symptomGlossary: [{ id: 'old' } as never], clinicalContentReady: false });
    mockTables = { ...serverRows(), health_conditions: [governedCondition()], symptom_glossary: [governedSymptom()] };
    await store().fetchFromSupabase();
    expect(store().clinicalContentReady).toBe(true);
    expect(store().healthConditions.map((row) => row.id)).toEqual(['governed']);
    expect(store().symptomGlossary.map((row) => row.id)).toEqual(['cramps']);
  });

  it('fails closed for a draft/expired/malformed row or partial error and clears renderable state', async () => {
    for (const conditions of [
      [{ ...governedCondition(), status: 'draft' }],
      [{ ...governedCondition(), review_due_at: '2000-01-01' }],
      [{ id: 'malformed' }],
    ]) {
      mockTables = { ...serverRows(), health_conditions: conditions, symptom_glossary: [governedSymptom()] };
      await store().fetchFromSupabase();
      expect(store().clinicalContentReady).toBe(false);
      expect(store().healthConditions).toEqual([]);
      expect(store().symptomGlossary).toEqual([]);
    }
    mockTables = { ...serverRows(), health_conditions: [governedCondition()], symptom_glossary: [governedSymptom()] };
    mockErrors = { symptom_glossary: { message: 'network failure' } };
    await store().fetchFromSupabase();
    expect(store().clinicalContentReady).toBe(false);
    expect(store().healthConditions).toEqual([]);
  });

  const refresh = async (conditions: unknown, symptoms: unknown = [governedSymptom()]) => {
    mockTables = { ...serverRows(), health_conditions: conditions, symptom_glossary: symptoms };
    await store().fetchFromSupabase();
    return { ready: store().clinicalContentReady, conditions: store().healthConditions.length, symptoms: store().symptomGlossary.length };
  };
  const closed = { ready: false, conditions: 0, symptoms: 0 };

  it.each([
    ['not a date', 'garbage'], ['a word', 'tomorrow'], ['a bare year', '9999'], ['an impossible month', '2099-13-45'],
    ['a rolled-over day', '2099-02-30'], ['a timestamp', '2099-01-01T00:00:00Z'], ['null', null], ['a number', 20990101],
  ])('rejects a malformed review_due_at (%s) instead of string-comparing it', async (_label, dueAt) => {
    expect(await refresh([{ ...governedCondition(), review_due_at: dueAt }])).toEqual(closed);
    expect(await refresh([governedCondition()], [{ ...governedSymptom(), review_due_at: dueAt }])).toEqual(closed);
  });

  it.each([
    ['a null Danish string', { name_da: null }], ['a blank English string', { what_helps_en: '   ' }],
    ['a string content_version', { content_version: '2' }], ['a fractional content_version', { content_version: 1.5 }],
    ['a withdrawn status', { status: 'withdrawn' }], ['an in_review status', { status: 'in_review' }],
    ['null common_symptoms', { common_symptoms: null }], ['a non-string symptom id', { common_symptoms: [1] }],
    ['a blank logical id', { id: '  ' }], ['a legacy row without governance metadata', { status: undefined, content_version: undefined, review_due_at: undefined }],
  ])('never renders a library containing a row with %s', async (_label, patch) => {
    expect(await refresh([{ ...governedCondition(), ...patch }])).toEqual(closed);
  });

  it('is all-or-nothing: one malformed or duplicate row discards the whole refresh', async () => {
    expect(await refresh([governedCondition('ok'), { id: 'bad' }])).toEqual(closed);
    expect(await refresh([governedCondition('dup'), governedCondition('dup')])).toEqual(closed);
    expect(await refresh([governedCondition()], [governedSymptom('ok'), { id: 'bad' }])).toEqual(closed);
  });

  it('accepts a review_due_at of today (Copenhagen) and treats an empty success as authoritative', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date());
    expect(await refresh([{ ...governedCondition(), review_due_at: today }])).toEqual({ ready: true, conditions: 1, symptoms: 1 });
    expect(await refresh([], [])).toEqual({ ready: true, conditions: 0, symptoms: 0 });
  });

  it('does not resurrect previously refreshed content when a later refresh fails', async () => {
    expect(await refresh([governedCondition()])).toEqual({ ready: true, conditions: 1, symptoms: 1 });
    mockErrors = { health_conditions: { message: 'network failure' } };
    expect(await refresh([governedCondition()])).toEqual(closed);
  });

  it('closes the gate when a refresh throws, so earlier content cannot linger as renderable', async () => {
    expect(await refresh([governedCondition()])).toEqual({ ready: true, conditions: 1, symptoms: 1 });
    mockQueryGate = Promise.reject(new Error('boom'));
    mockQueryGate.catch(() => undefined);
    await expect(store().fetchFromSupabase()).rejects.toThrow('boom');
    expect(store().clinicalContentReady).toBe(false);
  });

  it('applies the same expiry and boundary to symptom rows as to condition rows', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date());
    expect(await refresh([governedCondition()], [{ ...governedSymptom(), review_due_at: '2000-01-01' }])).toEqual(closed);
    expect(await refresh([governedCondition()], [{ ...governedSymptom(), review_due_at: today }])).toEqual({ ready: true, conditions: 1, symptoms: 1 });
  });

  it('reads only an explicit column list, filtered to published and unexpired rows', async () => {
    await store().fetchFromSupabase();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date());
    for (const table of ['health_conditions', 'symptom_glossary']) {
      const query = mockSelects.find((candidate) => candidate.table === table);
      expect(query).toBeDefined();
      const columns = String(query!.columns).split(',').map((column) => column.trim());
      expect(columns).not.toContain('*');
      expect(columns).toEqual(expect.arrayContaining(['id', 'content_version', 'review_due_at', 'status']));
      expect(columns).not.toContain('reviewed_by');
      expect(query!.filters).toEqual(expect.arrayContaining([['eq', 'status', 'published'], ['gte', 'review_due_at', today]]));
    }
  });

  describe('runtime-only readiness and the disk cache', () => {
    const legacyCondition = { id: 'WITHDRAWN-LEGACY', nameDa: 'x', nameEn: 'x', summaryDa: 'x', summaryEn: 'x', whatItIsDa: 'x', whatItIsEn: 'x', commonSymptoms: [], whatHelpsDa: 'x', whatHelpsEn: 'x', whenToSeeDoctorDa: 'x', whenToSeeDoctorEn: 'x' };
    const legacySymptom = { id: 'WITHDRAWN-LEGACY-SYMPTOM', nameDa: 'x', nameEn: 'x', descriptionDa: 'x', descriptionEn: 'x' };
    const envelope = (extra: object = {}) => ({
      state: {
        cycles: [], symptomLogs: [], avgCycleLength: 28, lutealPhaseLength: 14, reminderEnabled: false, reminderDaysBefore: 1,
        healthConditions: [legacyCondition], symptomGlossary: [legacySymptom], ...extra,
      },
      version: 0,
    });
    const flush = async () => {
      for (let i = 0; i < 200; i += 1) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    it('never serializes clinicalContentReady into the persisted blob', async () => {
      expect(await refresh([governedCondition()])).toEqual({ ready: true, conditions: 1, symptoms: 1 });
      useCycleStore.getState().startPeriod('2031-01-01');
      await flush();
      const raw = await AsyncStorage.getItem('lifesort-cycle');
      expect(raw).toBeTruthy();
      expect(raw as string).not.toContain('clinicalContentReady');
    });

    it('ignores persisted reference rows and a persisted readiness claim on hydration', async () => {
      await AsyncStorage.setItem('lifesort-cycle', JSON.stringify(envelope({ clinicalContentReady: true })));
      useCycleStore.setState({ healthConditions: [], symptomGlossary: [], clinicalContentReady: false });
      await useCycleStore.persist.rehydrate();
      expect(store().clinicalContentReady).toBe(false);
      expect(store().healthConditions).toEqual([]);
      expect(store().symptomGlossary).toEqual([]);
    });

    it('lets slow disk hydration land after a governed refresh without replacing or de-governing it', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const original = useCycleStore.persist.getOptions().storage;
      useCycleStore.persist.setOptions({
        storage: createJSONStorage(() => ({
          getItem: async () => { await gate; return JSON.stringify(envelope({ reminderDaysBefore: 3 })); },
          setItem: async () => undefined,
          removeItem: async () => undefined,
        })),
      });
      try {
        useCycleStore.setState({ healthConditions: [], symptomGlossary: [], clinicalContentReady: false });
        const hydration = useCycleStore.persist.rehydrate();
        expect(await refresh([governedCondition()])).toEqual({ ready: true, conditions: 1, symptoms: 1 });
        release();
        await hydration;
        expect(store().healthConditions.map((row) => row.id)).toEqual(['governed']);
        expect(store().symptomGlossary.map((row) => row.id)).toEqual(['cramps']);
        expect(store().clinicalContentReady).toBe(true);
        // User-owned Cycle data still hydrates normally.
        expect(store().reminderDaysBefore).toBe(3);
      } finally {
        useCycleStore.persist.setOptions({ storage: original });
      }
    });
  });
});

describe('APP-072 Cycle fetch is retired with its account and dataset', () => {
  it('publishes a same-account fetch', async () => {
    await store().fetchFromSupabase();
    expect(store().cycles.map((c) => c.id)).toEqual(['remote-cycle']);
    expect(store().symptomLogs.map((l) => l.notes)).toEqual([SENTINEL_NOTE]);
    expect(store().avgCycleLength).toBe(31);
    // APP-073: rich lock-screen consent is device-local; a fetch never touches it.
    expect(store().richNotificationCopyEnabled).toBe(false);
    expect(store().clinicalContentReady).toBe(true);
  });

  it('never lets any server value enable rich lock-screen copy, and never reverts a local choice', async () => {
    for (const remote of [true, 'true', 1, {}, null]) {
      mockTables = { ...serverRows(), cycle_settings: { ...serverRows().cycle_settings, rich_notification_copy_enabled: remote } };
      useCycleStore.setState({ richNotificationCopyEnabled: false });
      await store().fetchFromSupabase();
      expect(store().richNotificationCopyEnabled).toBe(false);
    }
    // An explicit local opt-in is likewise neither downgraded nor otherwise changed by a fetch.
    useCycleStore.setState({ richNotificationCopyEnabled: true });
    mockTables = serverRows();
    await store().fetchFromSupabase();
    expect(store().richNotificationCopyEnabled).toBe(true);
  });

  it('keeps an opt-out made while a fetch was in flight', async () => {
    useCycleStore.setState({ richNotificationCopyEnabled: true });
    mockTables = { ...serverRows(), cycle_settings: { ...serverRows().cycle_settings, rich_notification_copy_enabled: true } };
    const release = gate('query');
    const pending = store().fetchFromSupabase();
    await settle();
    store().setRichNotificationCopyEnabled(false);
    release();
    await pending;
    expect(store().richNotificationCopyEnabled).toBe(false);
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

describe('APP-072 / APP-074 clearLocal', () => {
  it('resets the user-owned Cycle state and retires reference-content runtime eligibility', () => {
    const condition = { id: 'pcos', nameDa: 'PCOS', nameEn: 'PCOS' } as never;
    const term = { id: 'cramps', nameDa: 'Kramper', nameEn: 'Cramps' } as never;
    useCycleStore.setState({
      cycles: [{ id: 'c1', startDate: SENTINEL_DATE, createdAt: '2031-03-17T00:00:00.000Z' }],
      symptomLogs: [{ id: 'l1', date: SENTINEL_DATE, symptoms: ['cramps'], notes: SENTINEL_NOTE }],
      avgCycleLength: 33,
      lutealPhaseLength: 11,
      reminderEnabled: true,
      reminderDaysBefore: 4,
      richNotificationCopyEnabled: true,
      healthConditions: [condition],
      symptomGlossary: [term],
      clinicalContentReady: true,
    });

    store().clearLocal();

    expect(store()).toMatchObject({
      cycles: [],
      symptomLogs: [],
      avgCycleLength: 28,
      lutealPhaseLength: 14,
      reminderEnabled: false,
      reminderDaysBefore: 1,
      richNotificationCopyEnabled: false,
      healthConditions: [condition],
      symptomGlossary: [term],
      clinicalContentReady: false,
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

describe('APP-073 rich lock-screen consent is device-local', () => {
  it('is never sent to the server, even with a live session', async () => {
    store().setRichNotificationCopyEnabled(true);
    await settle();
    expect(store().richNotificationCopyEnabled).toBe(true);
    expect(mockCalls).toEqual([]);
  });
});
