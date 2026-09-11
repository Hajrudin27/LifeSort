import { createOutbox } from '@/core/sync/outbox';
import type { JsonValue, OutboxMutation } from '@/core/sync/outbox';
import { sendServerMutation } from '@/core/sync/serverMutations';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockSession = jest.fn();
const mockRpc = jest.fn();
const mockHeader = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => mockSession(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args) },
}));
const accountId = 'account-a';
const entry: OutboxMutation = {
  mutationId: 'abcdefab-abcd-4abc-8abc-abcdefabcdef', dataDomain: 'core.module-choice',
  entityType: 'module-choice', entityId: 'habits', operation: 'upsert', payload: { enabled: true },
  createdAt: '2026-09-11T00:00:00.000Z', status: 'pending', attempts: 0,
};
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockSession.mockResolvedValue({ data: { session: { user: { id: accountId }, access_token: 'test-token' } }, error: null });
  mockRpc.mockReturnValue({ setHeader: mockHeader });
  mockHeader.mockResolvedValue({ data: 'applied', error: null });
});
it('sends a durable APP-031 ID unchanged across explicit sends, leaving queue ownership to caller', async () => {
  const outbox = createOutbox(accountId);
  const queued = await outbox.enqueue({ dataDomain: entry.dataDomain, entityType: entry.entityType,
    entityId: entry.entityId, operation: entry.operation, payload: entry.payload });
  const [persisted] = await createOutbox(accountId).list();
  expect(await sendServerMutation(accountId, persisted)).toEqual({ ok: true, status: 'applied' });
  mockHeader.mockResolvedValue({ data: 'replayed', error: null });
  expect(await sendServerMutation(accountId, persisted)).toEqual({ ok: true, status: 'replayed' });
  expect(mockRpc).toHaveBeenCalledTimes(2);
  expect(mockRpc).toHaveBeenLastCalledWith('apply_sync_mutation', {
    p_mutation_id: queued.mutationId, p_data_domain: 'core.module-choice', p_entity_type: 'module-choice',
    p_entity_id: 'habits', p_operation: 'upsert', p_payload: { enabled: true },
  });
  expect(await outbox.list()).toEqual([persisted]);
});
it('pins authorization to the account session used for this send', async () => {
  await sendServerMutation(accountId, entry);
  expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer test-token');
});
it.each([null, { user: { id: 'account-b' }, access_token: 'other' }])('rejects missing/wrong-account session %j', async (session) => {
  mockSession.mockResolvedValue({ data: { session }, error: null });
  expect(await sendServerMutation(accountId, entry)).toEqual({ ok: false, reason: 'authorization' });
  expect(mockRpc).not.toHaveBeenCalled();
});
it('snapshots identity and payload before awaiting auth', async () => {
  let resume!: (value: unknown) => void;
  mockSession.mockReturnValue(new Promise((resolve) => { resume = resolve; }));
  const mutable = { ...entry, payload: { enabled: true } };
  const result = sendServerMutation(accountId, mutable);
  mutable.entityId = 'food'; mutable.payload.enabled = false;
  resume({ data: { session: { user: { id: accountId }, access_token: 'original-token' } } });
  await result;
  expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_entity_id: 'habits', p_payload: { enabled: true } });
  expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer original-token');
});
it.each([
  ['PT409', 'conflict'], ['PT400', 'validation'], ['PT422', 'validation'], ['PT401', 'authorization'],
  ['42501', 'authorization'], ['PGRST301', 'authorization'], ['PGRST302', 'authorization'],
  ['PGRST303', 'authorization'], ['PT500', 'unavailable'], ['PT503', 'unavailable'],
])('maps %s to a safe %s result without server details', async (code, reason) => {
  mockHeader.mockResolvedValue({ error: { code, message: 'private server detail', details: 'private payload' } });
  expect(await sendServerMutation(accountId, entry)).toEqual({ ok: false, reason });
  expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('does not interpret later-story revisions', async () => {
  expect(await sendServerMutation(accountId, { ...entry, baseRevision: 0 })).toEqual({ ok: false, reason: 'validation' });
  expect(mockRpc).not.toHaveBeenCalled();
});
it.each([
  { ...entry, dataDomain: 'cycle.user-health' as const },
  { ...entry, payload: { enabled: true, privateNote: 'must not be sent' } },
  { ...entry, entityType: 'other' },
  { ...entry, operation: 'delete' as const },
  { ...entry, payload: undefined },
])('rejects unsupported envelopes before sending data', async (mutation) => {
  expect(await sendServerMutation(accountId, mutation)).toEqual({ ok: false, reason: 'validation' });
  expect(mockSession).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
});
it('maps transport exceptions without retrying or leaking errors', async () => {
  mockHeader.mockRejectedValue(new Error('private headers'));
  expect(await sendServerMutation(accountId, entry)).toEqual({ ok: false, reason: 'unavailable' });
  expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('rejects an unknown success response', async () => {
  mockHeader.mockResolvedValue({ data: 'unexpected', error: null });
  expect(await sendServerMutation(accountId, entry)).toEqual({ ok: false, reason: 'unavailable' });
});

it('APP-034: sends a persisted payload-free delete with canonical null and replays its durable ID', async () => {
  const outbox = createOutbox(accountId);
  const queued = await outbox.enqueue({ dataDomain: entry.dataDomain, entityType: entry.entityType,
    entityId: entry.entityId, operation: 'delete' });
  const [persisted] = await createOutbox(accountId).list();
  expect(persisted.payload).toBeUndefined();
  expect(await sendServerMutation(accountId, persisted)).toEqual({ ok: true, status: 'applied' });
  mockHeader.mockResolvedValue({ data: 'replayed' });
  expect(await sendServerMutation(accountId, persisted)).toEqual({ ok: true, status: 'replayed' });
  expect(mockRpc).toHaveBeenCalledTimes(2);
  expect(mockRpc).toHaveBeenLastCalledWith('apply_sync_mutation', {
    p_mutation_id: queued.mutationId, p_data_domain: entry.dataDomain, p_entity_type: entry.entityType,
    p_entity_id: entry.entityId, p_operation: 'delete', p_payload: null,
  });
  expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer test-token');
  expect(await outbox.list()).toEqual([persisted]);
});
it('APP-034: accepts explicit null for delete', async () => {
  expect(await sendServerMutation(accountId, { ...entry, operation: 'delete', payload: null }))
    .toEqual({ ok: true, status: 'applied' });
});
it.each<JsonValue>([{}, false, { deleted_at: '2099-01-01' }, { enabled: true }])
('APP-034: rejects delete payload %j without transport', async (payload) => {
  expect(await sendServerMutation(accountId, { ...entry, operation: 'delete', payload }))
    .toEqual({ ok: false, reason: 'validation' });
  expect(mockSession).not.toHaveBeenCalled();
});
it('APP-034: a tombstoned entity produces a safe conflict without a retry or queue acknowledgement', async () => {
  mockHeader.mockResolvedValue({ error: { code: 'PT409', message: 'entity_deleted' } });
  expect(await sendServerMutation(accountId, entry)).toEqual({ ok: false, reason: 'conflict' });
  expect(mockRpc).toHaveBeenCalledTimes(1);
});
it('APP-034: delete does not make baseRevision authoritative', async () => {
  expect(await sendServerMutation(accountId, { ...entry, operation: 'delete', payload: undefined, baseRevision: 5 }))
    .toEqual({ ok: false, reason: 'validation' });
  expect(mockRpc).not.toHaveBeenCalled();
});
