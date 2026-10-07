import AsyncStorage from '@react-native-async-storage/async-storage';
import { supportsServerMutation } from '@/core/sync/mutationSupport';
import { createOutbox, withOutboxCleanup } from '@/core/sync/outbox';
import type { HouseholdTask } from '@/types/household';
import { calendarDateForTask } from '@/utils/household/householdTaskSchedule';

let mockAccount: string | null = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let mockTaskRows: Promise<{ data: unknown[]; error: null }> = Promise.resolve({ data: [], error: null });

jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ session: mockAccount ? { user: { id: mockAccount } } : null }) },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockAccount ? { id: mockAccount } : null } }),
      getSession: () => Promise.resolve({
        data: { session: mockAccount ? { user: { id: mockAccount }, access_token: 'token' } : null },
        error: null,
      }),
    },
    from: (table: string) => ({
      select: () => ({ eq: () => table === 'household_tasks'
        ? mockTaskRows
        : Promise.resolve({ data: [], error: null }) }),
      upsert: () => Promise.resolve({ error: null }),
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    }),
  },
}));

import { useHouseholdStore } from '@/store/useHouseholdStore';

const ACCOUNT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const settle = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const canonical = (overrides: Partial<HouseholdTask> = {}): HouseholdTask => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'cleaning',
  title: 'Clean',
  frequency: 'weekly',
  assignedTo: 'me',
  rotates: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  timeZone: 'Europe/Copenhagen',
  lastDone: '2026-01-01',
  ...overrides,
});
const remoteRow = (task: HouseholdTask, revision = '6') => ({
  id: task.id,
  kind: task.kind,
  title: task.title,
  frequency: task.frequency,
  last_done: task.lastDone ?? null,
  assigned_to: task.assignedTo,
  rotates: task.rotates,
  created_at: task.createdAt,
  time_zone: task.timeZone,
  revision,
  updated_at: '2026-10-07T12:00:00.000Z',
  deleted_at: null,
});

beforeEach(async () => {
  mockAccount = ACCOUNT_A;
  mockTaskRows = Promise.resolve({ data: [], error: null });
  await withOutboxCleanup(async () => { await AsyncStorage.clear(); });
  useHouseholdStore.getState().clearLocal();
  await useHouseholdStore.persist.rehydrate();
  useHouseholdStore.getState().clearLocal();
});

describe('APP-061 durable Home task writes', () => {
  it('captures a timezone and queues create then edit as one ordered revision chain', async () => {
    useHouseholdStore.getState().addTask({
      kind: 'cleaning', title: 'Kitchen', frequency: 'monthly', assignedTo: 'me', rotates: false,
    });
    const created = useHouseholdStore.getState().tasks[0];
    expect(created.timeZone).toEqual(expect.any(String));
    useHouseholdStore.getState().updateTask(created.id, { title: 'Kitchen floor' });
    await settle();
    const entries = await createOutbox(ACCOUNT_A).list();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => [entry.dataDomain, entry.entityType, entry.baseRevision])).toEqual([
      ['home.household', 'home-task', undefined],
      ['home.household', 'home-task', 1],
    ]);
    expect(entries[0].payload).toMatchObject({ action: 'create', task: { timeZone: expect.any(String) } });
    expect(entries[1].payload).toMatchObject({ action: 'edit', task: { title: 'Kitchen floor' } });
  });

  it('deduplicates a same-day double tap and rotates only once', async () => {
    const today = calendarDateForTask(canonical());
    useHouseholdStore.setState({
      tasks: [canonical({ lastDone: undefined })],
      taskSync: { [canonical().id]: {
        revision: '5', plannedRevision: '5', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null,
      } },
    });
    useHouseholdStore.getState().markTaskDone(canonical().id);
    useHouseholdStore.getState().markTaskDone(canonical().id);
    expect(useHouseholdStore.getState().tasks[0]).toMatchObject({ lastDone: today, assignedTo: 'partner' });
    await settle();
    const entries = await createOutbox(ACCOUNT_A).list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ baseRevision: 5, payload: { action: 'complete', completedOn: today } });
  });

  it('keeps an offline mutation and task across rehydration', async () => {
    useHouseholdStore.getState().addTask({
      kind: 'maintenance', title: 'Filter', frequency: 'quarterly', rotates: false,
    });
    await settle();
    const id = useHouseholdStore.getState().tasks[0].id;
    await useHouseholdStore.persist.rehydrate();
    expect(useHouseholdStore.getState().tasks.some((task) => task.id === id)).toBe(true);
    expect((await createOutbox(ACCOUNT_A).list()).some((entry) => entry.entityId === id)).toBe(true);
  });

  it('completes without rotating when rotation is disabled', async () => {
    const task = canonical({ rotates: false, lastDone: undefined });
    useHouseholdStore.setState({
      tasks: [task],
      taskSync: { [task.id]: {
        revision: '5', plannedRevision: '5', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null,
      } },
    });
    useHouseholdStore.getState().markTaskDone(task.id);
    expect(useHouseholdStore.getState().tasks[0]).toMatchObject({
      lastDone: calendarDateForTask(task),
      assignedTo: 'me',
    });
    await settle();
    expect(await createOutbox(ACCOUNT_A).list()).toHaveLength(1);
  });

  it('discards an Account A fetch completion after account replacement', async () => {
    let resolve!: (value: { data: unknown[]; error: null }) => void;
    mockTaskRows = new Promise((done) => { resolve = done; });
    const pending = useHouseholdStore.getState().fetchFromSupabase();
    await settle();
    mockAccount = ACCOUNT_B;
    useHouseholdStore.getState().clearLocal();
    resolve({ data: [{
      id: canonical().id, kind: 'cleaning', title: 'A secret', frequency: 'weekly',
      last_done: null, assigned_to: 'me', rotates: false,
      created_at: canonical().createdAt, time_zone: 'Europe/Copenhagen',
      revision: '1', updated_at: '2026-01-01T00:00:00Z', deleted_at: null,
    }], error: null });
    await pending;
    expect(useHouseholdStore.getState().tasks).toEqual([]);
    expect(useHouseholdStore.getState().myUserId).toBeNull();
  });

  it('protects a local edit made while an older fetch is in flight', async () => {
    const original = canonical({ title: 'Original' });
    useHouseholdStore.setState({
      tasks: [original],
      taskSync: { [original.id]: {
        revision: '5', plannedRevision: '5', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null,
      } },
    });
    let resolve!: (value: { data: unknown[]; error: null }) => void;
    mockTaskRows = new Promise((done) => { resolve = done; });
    const pending = useHouseholdStore.getState().fetchFromSupabase();
    await settle();
    useHouseholdStore.getState().updateTask(original.id, { title: 'Local pending edit' });
    await settle();
    resolve({ data: [remoteRow({ ...original, title: 'Older fetch result' })], error: null });
    await pending;
    expect(useHouseholdStore.getState().tasks[0].title).toBe('Local pending edit');
  });

  it('keeps current lists when a restored Household section omits them', () => {
    useHouseholdStore.setState({ shoppingItems: [{ id: 's', label: 'Milk', checked: false }] });
    useHouseholdStore.getState().restoreBackup({ tasks: [canonical()] });
    expect(useHouseholdStore.getState().shoppingItems).toEqual([{ id: 's', label: 'Milk', checked: false }]);
    expect(Array.isArray(useHouseholdStore.getState().movingItems)).toBe(true);
    expect(useHouseholdStore.getState().tasks).toEqual([canonical()]);
  });

  it.each([
    ['restored UUID task', canonical().id],
    ['pre-APP-030 legacy ID task', '1757000000000-123456'],
  ])('adopts a %s the server has never seen, so it can then be completed', async (_label, id) => {
    const { lastDone: _never, ...local } = canonical({ id });
    useHouseholdStore.getState().restoreBackup({ tasks: [local] });
    mockTaskRows = Promise.resolve({ data: [], error: null });
    await useHouseholdStore.getState().fetchFromSupabase();
    await settle();
    useHouseholdStore.getState().markTaskDone(id);
    await settle();
    const entries = await createOutbox(ACCOUNT_A).list();
    expect(entries.map((entry) => [entry.entityId, entry.baseRevision, (entry.payload as { action: string }).action]))
      .toEqual([[id, undefined, 'create'], [id, 1, 'complete']]);
    expect(entries.every(supportsServerMutation)).toBe(true);
    expect(useHouseholdStore.getState().tasks[0]).toMatchObject({ lastDone: expect.any(String), assignedTo: 'partner' });
  });

  it('does not adopt a task the server already returned', async () => {
    useHouseholdStore.getState().restoreBackup({ tasks: [canonical({ title: 'Restored' })] });
    mockTaskRows = Promise.resolve({ data: [remoteRow(canonical({ title: 'Server' }))], error: null });
    await useHouseholdStore.getState().fetchFromSupabase();
    await settle();
    expect(await createOutbox(ACCOUNT_A).list()).toEqual([]);
    expect(useHouseholdStore.getState().tasks[0].title).toBe('Server');
  });

  it('does not repopulate Account A after logout clears the local dataset', async () => {
    let resolve!: (value: { data: unknown[]; error: null }) => void;
    mockTaskRows = new Promise((done) => { resolve = done; });
    const pending = useHouseholdStore.getState().fetchFromSupabase();
    await settle();
    mockAccount = null;
    useHouseholdStore.getState().clearLocal();
    resolve({ data: [remoteRow(canonical())], error: null });
    await pending;
    expect(useHouseholdStore.getState().tasks).toEqual([]);
    expect(useHouseholdStore.getState().myUserId).toBeNull();
  });
});
