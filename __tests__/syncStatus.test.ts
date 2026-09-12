import { projectSyncStatus, syncSafeError, type SyncSafeErrorCode } from '@/core/sync/syncStatus';
import type { OutboxMutation } from '@/core/sync/outbox';

const entry: OutboxMutation = {
  mutationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', dataDomain: 'core.module-choice',
  entityType: 'module-choice', entityId: 'habits', operation: 'upsert', payload: { enabled: true },
  createdAt: '2026-09-11T00:00:00Z', status: 'pending', attempts: 0,
};
const snapshot = (mutations: OutboxMutation[]) => ({ accountId: 'a', mutations });
const project = (mutations: OutboxMutation[], errors = new Map<string, SyncSafeErrorCode>(), flight: string | null = null) =>
  projectSyncStatus('a', snapshot(mutations), errors, flight);

it('empty current-account outbox is clear', () => {
  expect(project([])).toMatchObject({ status: 'clear', count: 0, retryMutationId: null });
});
it('pending is immediate, with an explicitly supported one-shot action', () => {
  expect(project([entry])).toMatchObject({ status: 'pending', count: 1, retryMutationId: entry.mutationId });
});
it('pending action follows durable order rather than timestamps or lexical UUID order', () => {
  const second = { ...entry, mutationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', createdAt: '2000-01-01' };
  expect(project([second, entry])).toMatchObject({ status: 'pending', retryMutationId: second.mutationId });
  expect(project([entry, second]).retryMutationId).toBe(entry.mutationId);
  expect(project([entry, second]).count).toBe(2);
});
it('known retryable failed mutation is failed', () => {
  expect(project([{ ...entry, status: 'failed' }], new Map([[entry.mutationId, 'unavailable']])))
    .toMatchObject({ status: 'failed', errorCode: 'unavailable', retryMutationId: entry.mutationId });
});
it.each<SyncSafeErrorCode>(['conflict', 'validation', 'auth-required', 'unknown'])('%s cannot be blindly retried', (code) => {
  expect(project([{ ...entry, status: 'failed' }], new Map([[entry.mutationId, code]])))
    .toMatchObject({ status: 'needs-attention', retryMutationId: null });
});
it('a restored failure without a safe classification fails closed', () => {
  expect(project([{ ...entry, status: 'failed' }])).toMatchObject({ status: 'needs-attention', retryMutationId: null });
});
it('retrying outranks pending', () => {
  expect(project([entry], new Map(), entry.mutationId)).toMatchObject({ status: 'retrying', retrying: true });
});
it('needs-attention > failed > retrying > pending, independent of array order', () => {
  const failed = { ...entry, mutationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'failed' as const };
  const attention = { ...entry, mutationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', baseRevision: 1 };
  const errors = new Map<string, SyncSafeErrorCode>([[failed.mutationId, 'unavailable']]);
  expect(project([entry, failed], errors, entry.mutationId)).toMatchObject({ status: 'failed', retrying: true });
  const result = project([entry, failed, attention], errors, entry.mutationId);
  expect(result).toMatchObject({ status: 'needs-attention', count: 3, retryMutationId: null });
  expect(project([attention, failed, entry], errors, entry.mutationId))
    .toMatchObject({ status: 'needs-attention', count: 3, retryMutationId: null });
});
it.each([null, 'b'])('ignores another account when active account is %s', (account) => {
  expect(projectSyncStatus(account, snapshot([entry]))).toMatchObject({ status: 'clear', count: 0, accountId: null });
});
it('auth-required copy classification has deterministic priority among attention conditions', () => {
  expect(project([{ ...entry, status: 'failed' }], new Map([[entry.mutationId, 'auth-required']])).errorCode)
    .toBe('auth-required');
});
it.each(['divorce-contract.pdf', 'pregnancy complication', 'salary 48,000', 'PT409 SQL apply_sync_mutation',
  'Error: stack at private.ts:10', 'file:///private/health.pdf'])('never copies sensitive-looking payload or backend details (%#)', (detail) => {
  const result = project([{ ...entry, payload: { detail }, message: detail, stack: detail } as OutboxMutation]);
  expect(JSON.stringify(result)).not.toContain(detail);
  expect(Object.keys(result).sort()).toEqual(['accountId', 'count', 'errorCode', 'retryMutationId', 'retrying', 'status']);
});
it.each([
  [{ ok: false, reason: 'authorization' }, 'auth-required'],
  [{ ok: false, reason: 'unavailable' }, 'unavailable'],
  [{ kind: 'unresolved', reason: 'document-conflict' }, 'conflict'],
  [{ kind: 'invariant-error', reason: 'restore-forbidden' }, 'conflict'],
] as const)('maps typed protocol/policy failure without carrying details (%#)', (result, expected) => {
  expect(syncSafeError(result)).toBe(expected);
});
it('the Retry action selects a failed candidate before a pending candidate', () => {
  const failed = { ...entry, entityId: 'food', mutationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', status: 'failed' as const };
  expect(project([entry, failed], new Map([[failed.mutationId, 'unavailable']])).retryMutationId).toBe(failed.mutationId);
});

it('a transient head remains the action even with a future retry and a newer pending follower', () => {
  const head = { ...entry, mutationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', status: 'failed' as const,
    nextRetryAt: '2099-01-01T00:00:00Z' };
  expect(project([head, entry])).toMatchObject({ status: 'failed', retryMutationId: head.mutationId });
});

it.each(['pending', 'failed'] as const)('a permanent head suppresses global Retry even with an unrelated %s head', (status) => {
  const head = { ...entry, mutationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', status: 'failed' as const };
  expect(project([head, entry])).toMatchObject({ status: 'needs-attention', retryMutationId: null });
  const other = { ...entry, entityId: 'food', mutationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status,
    ...(status === 'failed' ? { nextRetryAt: '2099-01-01T00:00:00Z' } : {}) };
  expect(project([other])).toMatchObject({ status, retryMutationId: other.mutationId });
  expect(project([head, entry, other])).toMatchObject({ status: 'needs-attention', retryMutationId: null });
  expect(project([other, head, entry])).toMatchObject({ status: 'needs-attention', retryMutationId: null });
});

it('selects pending entity heads in durable order even when the later UUID sorts first', () => {
  const older = { ...entry, entityId: 'food', mutationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' };
  expect(project([older, entry])).toMatchObject({ status: 'pending', retryMutationId: older.mutationId });
  expect(project([entry, older])).toMatchObject({ status: 'pending', retryMutationId: entry.mutationId });
});
