const mockSession = jest.fn();
const mockRpc = jest.fn();
const mockHeader = jest.fn();
const mockRetry = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => mockSession(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import type { PregnancyQueuedMutation } from '@/core/pregnancy/protectedRepository';
import { sendPregnancyMutation } from '@/core/pregnancy/syncTransport';

const accountId = 'account-a';
const live = () => true;
const mutation: PregnancyQueuedMutation = {
  mutationId: 'mutation-1', entityType: 'pregnancy', entityId: 'pregnancy-1', operation: 'upsert',
  payload: { note: 'private pregnancy note' }, consentId: 'consent-1', createdAt: '2026-10-14T12:00:00.000Z',
  status: 'pending', attempts: 0, baseRevision: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue({ data: { session: { user: { id: accountId }, access_token: 'pregnancy-token' } }, error: null });
  mockRpc.mockReturnValue({ setHeader: (...args: unknown[]) => { mockHeader(...args); return { retry: mockRetry }; } });
  mockRetry.mockResolvedValue({ data: { status: 'applied', entityType: 'pregnancy', entityId: 'pregnancy-1', revision: 4, deleted: false, changeSeq: 9 }, error: null, status: 200 });
});

describe('APP-076 B2A Pregnancy transport', () => {
  it('pins the session, maps every RPC argument exactly, and returns success without any ACK path', async () => {
    await expect(sendPregnancyMutation(accountId, mutation, live)).resolves.toEqual({
      ok: true, status: 'applied', entityType: 'pregnancy', entityId: 'pregnancy-1', revision: 4, deleted: false, changeSeq: 9,
    });
    expect(mockRpc).toHaveBeenCalledWith('apply_pregnancy_sync_mutation', {
      p_mutation_id: 'mutation-1', p_entity_type: 'pregnancy', p_entity_id: 'pregnancy-1',
      p_operation: 'upsert', p_expected_revision: 3, p_payload: { note: 'private pregnancy note' }, p_consent_id: 'consent-1',
    });
    expect(mockHeader).toHaveBeenCalledWith('Authorization', 'Bearer pregnancy-token');
    expect(mockRetry).toHaveBeenCalledWith(false);
  });

  it('maps a payload-free delete using canonical nulls', async () => {
    const deletion = { ...mutation, operation: 'delete' as const, payload: undefined, consentId: undefined, baseRevision: undefined };
    mockRetry.mockResolvedValue({ data: { status: 'applied', entityType: 'pregnancy', entityId: 'pregnancy-1', revision: 5, deleted: true, changeSeq: 10 }, error: null, status: 200 });
    await expect(sendPregnancyMutation(accountId, deletion, live)).resolves.toMatchObject({ ok: true, deleted: true });
    expect(mockRpc).toHaveBeenCalledWith('apply_pregnancy_sync_mutation', expect.objectContaining({
      p_operation: 'delete', p_expected_revision: null, p_payload: null, p_consent_id: null,
    }));
  });

  it('snapshots identity and payload before auth, and never dispatches after an account/epoch guard flips', async () => {
    let resume!: (value: unknown) => void;
    mockSession.mockReturnValue(new Promise((resolve) => { resume = resolve; }));
    const mutable = { ...mutation, payload: { note: 'original' } };
    const pending = sendPregnancyMutation(accountId, mutable, live);
    mutable.entityId = 'other-entity'; mutable.payload.note = 'changed';
    resume({ data: { session: { user: { id: accountId }, access_token: 'original-token' } }, error: null });
    await pending;
    expect(mockRpc).toHaveBeenCalledWith('apply_pregnancy_sync_mutation', expect.objectContaining({
      p_entity_id: 'pregnancy-1', p_payload: { note: 'original' },
    }));

    let active = true;
    mockSession.mockImplementation(async () => { active = false; return { data: { session: { user: { id: accountId }, access_token: 'old-token' } }, error: null }; });
    await expect(sendPregnancyMutation(accountId, mutation, () => active)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: false });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ code: 'PT428', message: 'consent_required' }, 428, 'consent-required'],
    [{ code: 'PT409', message: 'revision_conflict' }, 409, 'revision-conflict'],
    [{ code: 'PT409', message: 'mutation_id_conflict' }, 409, 'mutation-id-conflict'],
    [{ code: 'PT409', message: 'parent_unavailable' }, 409, 'parent-unavailable'],
    [{ code: 'PT409', message: 'something_else' }, 409, 'unknown-conflict'],
    [{ code: 'PT401', message: 'private server response' }, 401, 'authorization'],
    [{ code: 'unexpected', message: 'private server response' }, 429, 'rate-limited'],
    [{ code: 'PT503', message: 'private server response' }, 503, 'unavailable'],
  ])('maps %j / %s to a safe %s result with no raw server data', async (error, status, reason) => {
    mockRetry.mockResolvedValue({ data: null, error: { ...error, details: 'sensitive server diagnostic' }, status });
    await expect(sendPregnancyMutation(accountId, mutation, live)).resolves.toEqual({ ok: false, reason, attempted: true });
  });

  it('never dispatches with a session that belongs to another account, or when the session cannot be read', async () => {
    mockSession.mockResolvedValue({ data: { session: { user: { id: 'account-b' }, access_token: 'other-token' } }, error: null });
    await expect(sendPregnancyMutation(accountId, mutation, live)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: false });
    mockSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(sendPregnancyMutation(accountId, mutation, live)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: false });
    mockSession.mockResolvedValue({ data: { session: { user: { id: accountId }, access_token: 'token' } }, error: { message: 'private' } });
    await expect(sendPregnancyMutation(accountId, mutation, live)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: false });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([
    ['an upsert without consent', { consentId: undefined }],
    ['an upsert without a payload', { payload: undefined }],
    ['a delete that carries a consent', { operation: 'delete' as const, payload: undefined }],
    ['a delete that carries a payload', { operation: 'delete' as const, consentId: undefined }],
  ])('refuses %s before any session or network work', async (_label, patch) => {
    await expect(sendPregnancyMutation(accountId, { ...mutation, ...patch }, live)).resolves.toEqual({ ok: false, reason: 'validation', attempted: false });
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('fails closed on malformed/mismatched success and on a stale handle after dispatch', async () => {
    mockRetry.mockResolvedValue({ data: { status: 'applied', entityType: 'log', entityId: 'pregnancy-1', revision: 4, deleted: false }, error: null, status: 200 });
    await expect(sendPregnancyMutation(accountId, mutation, live)).resolves.toEqual({ ok: false, reason: 'unknown-conflict', attempted: true });
    let active = true;
    mockRetry.mockImplementation(async () => { active = false; return { data: { status: 'applied', entityType: 'pregnancy', entityId: 'pregnancy-1', revision: 4, deleted: false }, error: null, status: 200 }; });
    await expect(sendPregnancyMutation(accountId, mutation, () => active)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: true });
  });
});

describe('APP-076 B2B1 transport hardening', () => {
  const deletion = { ...mutation, operation: 'delete' as const, payload: undefined, consentId: undefined };
  const respond = (data: Record<string, unknown>) => mockRetry.mockResolvedValue({ data, error: null, status: 200 });
  const applied = (patch: Record<string, unknown> = {}) => ({ status: 'applied', entityType: 'pregnancy', entityId: 'pregnancy-1', revision: 4, deleted: false, changeSeq: 9, ...patch });

  it('requires the reported deletion state to match the mutation operation, in both directions', async () => {
    respond(applied({ deleted: true }));
    await expect(sendPregnancyMutation(accountId, mutation, live)).resolves.toEqual({ ok: false, reason: 'unknown-conflict', attempted: true });
    respond(applied({ deleted: false }));
    await expect(sendPregnancyMutation(accountId, deletion, live)).resolves.toEqual({ ok: false, reason: 'unknown-conflict', attempted: true });
    respond(applied({ deleted: true }));
    await expect(sendPregnancyMutation(accountId, deletion, live)).resolves.toMatchObject({ ok: true, deleted: true });
  });

  it.each([
    ['an applied success without a ledger position', applied({ changeSeq: undefined })],
    ['a zero ledger position', applied({ changeSeq: 0 })],
    ['a fractional ledger position', applied({ changeSeq: 1.5 })],
    ['an unsafe ledger position', applied({ changeSeq: 2 ** 53 })],
    ['a string ledger position', applied({ changeSeq: '9' })],
    ['a replay that carries a ledger position', applied({ status: 'replayed' })],
    ['an unsafe revision', applied({ revision: 2 ** 53 })],
    ['a zero revision', applied({ revision: 0 })],
    ['an unknown status', applied({ status: 'maybe' })],
  ])('fails closed on %s', async (_label, data) => {
    respond(data as Record<string, unknown>);
    await expect(sendPregnancyMutation(accountId, mutation, live)).resolves.toEqual({ ok: false, reason: 'unknown-conflict', attempted: true });
  });

  it('accepts a replay without a ledger position', async () => {
    respond({ status: 'replayed', entityType: 'pregnancy', entityId: 'pregnancy-1', revision: 4, deleted: false });
    await expect(sendPregnancyMutation(accountId, mutation, live)).resolves.toEqual({
      ok: true, status: 'replayed', entityType: 'pregnancy', entityId: 'pregnancy-1', revision: 4, deleted: false,
    });
  });

  it('classifies parent_unavailable explicitly rather than as a mutation-id conflict', async () => {
    mockRetry.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'parent_unavailable' }, status: 409 });
    await expect(sendPregnancyMutation(accountId, mutation, live)).resolves.toEqual({ ok: false, reason: 'parent-unavailable', attempted: true });
  });

  it('counts a session read that throws as a failure BEFORE dispatch: attempted is false and no RPC is made', async () => {
    mockSession.mockRejectedValue(new Error('keychain locked: private detail'));
    const result = await sendPregnancyMutation(accountId, mutation, live);
    expect(result).toEqual({ ok: false, reason: 'unavailable', attempted: false });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('records no result for a handle that went stale after dispatch, and never leaks a raw error', async () => {
    let flag = true;
    mockRetry.mockImplementation(async () => { flag = false; return { data: null, error: { code: 'PT409', message: 'revision_conflict', details: 'private' }, status: 409 }; });
    await expect(sendPregnancyMutation(accountId, mutation, () => flag)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: true });
    mockRetry.mockRejectedValue(new Error('private network detail'));
    const thrown = await sendPregnancyMutation(accountId, mutation, live);
    expect(thrown).toEqual({ ok: false, reason: 'unavailable', attempted: true });
  });
});
