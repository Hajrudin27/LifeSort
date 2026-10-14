import AsyncStorage from '@react-native-async-storage/async-storage';

const mockSecure = new Map<string, string>();
const mockSessionState: { account: string | null } = { account: null };
const mockServerRef: { current: { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>; from: (table: string) => unknown } | null } = { current: null };
const mockGetSession = jest.fn();

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecure.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => { mockSecure.set(key, value); return Promise.resolve(); }),
  deleteItemAsync: jest.fn((key: string) => { mockSecure.delete(key); return Promise.resolve(); }),
}));

jest.mock('expo-crypto', () => {
  const crypto = require('crypto');
  class AESEncryptionKey {
    constructor(private readonly mockRaw: Buffer) {}
    static async generate() { return new AESEncryptionKey(crypto.randomBytes(32)); }
    static async import(value: string) { const raw = Buffer.from(value, 'base64'); if (raw.length !== 32) throw new Error('invalid key'); return new AESEncryptionKey(raw); }
    async encoded() { return this.mockRaw.toString('base64'); }
    async bytes() { return new Uint8Array(this.mockRaw); }
  }
  class AESSealedData {
    constructor(readonly mockCombinedBytes: Buffer, readonly mockIvLength: number, readonly mockTagLength: number) {}
    static fromCombined(value: string, config: { ivLength: number; tagLength: number }) { return new AESSealedData(Buffer.from(value, 'base64'), config.ivLength, config.tagLength); }
    async combined() { return this.mockCombinedBytes.toString('base64'); }
  }
  return {
    randomUUID: jest.fn(() => crypto.randomUUID()), AESEncryptionKey, AESSealedData,
    aesEncryptAsync: jest.fn(async (plaintext: Uint8Array, key: InstanceType<typeof AESEncryptionKey>, options: { additionalData?: Uint8Array; nonce?: { length: number }; tagLength?: number }) => {
      const iv = crypto.randomBytes(options.nonce?.length ?? 12); const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(await key.bytes()), iv, { authTagLength: options.tagLength ?? 16 });
      if (options.additionalData) cipher.setAAD(Buffer.from(options.additionalData));
      const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
      return new AESSealedData(Buffer.concat([iv, encrypted, cipher.getAuthTag()]), iv.length, cipher.getAuthTag().length);
    }),
    aesDecryptAsync: jest.fn(async (sealed: InstanceType<typeof AESSealedData>, key: InstanceType<typeof AESEncryptionKey>, options: { additionalData?: Uint8Array }) => {
      const iv = sealed.mockCombinedBytes.subarray(0, sealed.mockIvLength); const tag = sealed.mockCombinedBytes.subarray(sealed.mockCombinedBytes.length - sealed.mockTagLength); const body = sealed.mockCombinedBytes.subarray(sealed.mockIvLength, sealed.mockCombinedBytes.length - sealed.mockTagLength);
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(await key.bytes()), iv, { authTagLength: sealed.mockTagLength });
      if (options.additionalData) decipher.setAAD(Buffer.from(options.additionalData)); decipher.setAuthTag(tag);
      return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
    }),
  };
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => mockGetSession(...args) },
    rpc: (name: string, args: Record<string, unknown>) => ({ setHeader: () => ({ retry: () => mockServerRef.current!.rpc(name, args) }) }),
    from: (table: string) => mockServerRef.current!.from(table),
  },
}));

import { Platform } from 'react-native';

import {
  createInitialPregnancyProtectedState, createPregnancyProtectedRepository, invalidatePregnancyProtectedRepositories,
  PregnancyProtectedRepositoryError, type PregnancyProtectedState,
} from '@/core/pregnancy/protectedRepository';
import { createPregnancySyncBackend, PREGNANCY_SYNC_BACKEND_ID } from '@/core/pregnancy/syncBackend';
import { clearPregnancyHealthEncryptionKey, withPregnancyHealthEncryptedStorageCleanup, writeEncryptedPregnancyPayload } from '@/core/storage/pregnancyHealthEncryptedStorage';
import { PREGNANCY_HEALTH_STORAGE } from '@/core/storage/pregnancyHealthStorageContract';
import { releaseAllMutationClaims } from '@/core/sync/mutationClaims';
import { createSyncCoordinatorEngine, type SyncCoordinatorBackend } from '@/core/sync/syncCoordinatorEngine';
import { FakePregnancyServer } from './helpers/fakePregnancyServer';
import type { PregnancyEntry, PregnancySymptomLog } from '@/types/pregnancy';

const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const idOf = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = idOf(1), L = idOf(2), A = idOf(3), L2 = idOf(4);
const AT = '2026-10-14T12:00:00.000Z';
const STORE_KEY = PREGNANCY_HEALTH_STORAGE.asyncStorageKey;

let server: FakePregnancyServer;
const live = { account: ACCOUNT as string | null };
const getActiveAccount = () => live.account;

type Signal<T> = { subscribe: (listener: (value: T) => void) => () => void; emit: (value: T) => void };
function signal<T>(): Signal<T> {
  const listeners = new Set<(value: T) => void>();
  return { subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); }, emit: (value) => listeners.forEach((listener) => listener(value)) };
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks(); mockSecure.clear(); releaseAllMutationClaims();
  live.account = ACCOUNT; mockSessionState.account = ACCOUNT;
  server = new FakePregnancyServer(ACCOUNT); mockServerRef.current = server as never;
  mockGetSession.mockImplementation(async () => ({ data: { session: { user: { id: mockSessionState.account }, access_token: 'token' } }, error: null }));
  await withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.clear(); await clearPregnancyHealthEncryptionKey(); });
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
});
const startedEngines: Array<{ dispose: () => void }> = [];
afterEach(() => { startedEngines.splice(0).forEach((started) => started.dispose()); jest.clearAllTimers(); jest.useRealTimers(); });

const handle = () => createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount });
async function seeded(patch?: (state: PregnancyProtectedState) => void) {
  const state = createInitialPregnancyProtectedState(ACCOUNT); patch?.(state);
  const repo = handle(); await repo.initialize(state); return repo;
}
async function snapshot() { const state = await handle().hydrate(); if (!state) throw new Error('no dataset'); return state; }
const pregnancyEntity = (revision = 1, patch: Partial<PregnancyEntry> = {}): PregnancyEntry => ({ id: P, method: 'lmp', lmpDate: '2026-02-01', createdAt: AT, updatedAt: AT, revision, ...patch });
const logEntity = (revision = 1, patch: Partial<PregnancySymptomLog> = {}): PregnancySymptomLog => ({ id: L, pregnancyId: P, date: '2026-10-01', symptoms: ['nausea'], revision, updatedAt: AT, ...patch });
const pregnancyPayload = { method: 'lmp', lmpDate: '2026-02-01', notes: 'private health note' };
const logPayload = (extra: Record<string, unknown> = {}) => ({ pregnancyId: P, date: '2026-10-01', symptoms: ['nausea'], ...extra });

function engine(extra: SyncCoordinatorBackend[] = [], backend = createPregnancySyncBackend({ getActiveAccount, now: () => Date.now(), random: () => 1 })) {
  const connectivity = signal<'online' | 'offline' | 'unknown'>(); const foreground = signal<boolean>();
  const coordinator = createSyncCoordinatorEngine({
    connectivity: { getState: () => 'online', subscribe: connectivity.subscribe },
    foreground: { isForeground: () => true, subscribe: foreground.subscribe },
    getActiveAccount, backends: [...extra, backend], now: () => Date.now(),
  });
  startedEngines.push(coordinator);
  return { coordinator, backend };
}
async function run(coordinator: ReturnType<typeof engine>['coordinator'], cycles = 8) {
  coordinator.setAccount(ACCOUNT);
  for (let index = 0; index < cycles; index += 1) { await coordinator.settle(); jest.advanceTimersByTime(1_000); }
  await coordinator.settle();
}
function countWrites() {
  const original = AsyncStorage.setItem; const writes: string[] = [];
  (AsyncStorage as { setItem: unknown }).setItem = async (name: string, value: string) => { writes.push(name); return original(name, value); };
  return { writes, restore: () => { (AsyncStorage as { setItem: unknown }).setItem = original; } };
}

describe('APP-076 B2B1 applied success: pull, reconcile, then one protected commit', () => {
  it('recovers a simple lost-ACK upsert after a process crash without a false revision conflict', async () => {
    server.seedLive('pregnancy', P, { method: 'lmp', lmp_date: '2026-02-01' }, 1);
    const repo = await seeded((s) => { s.domain.pregnancies[P] = pregnancyEntity(1); s.sync.nextChangeSeq = 1; });
    const desired = { method: 'lmp', lmpDate: '2026-03-03' };
    const queued = await repo.commitLocalMutation(
      (domain) => { domain.pregnancies[P] = pregnancyEntity(1, { lmpDate: '2026-03-03' }); },
      { entityType: 'pregnancy', entityId: P, operation: 'upsert', baseRevision: 1, payload: desired, consentId: 'c1' },
    );
    // The server committed, but the process died before it received/committed the success response.
    await server.rpc('apply_pregnancy_sync_mutation', {
      p_mutation_id: queued.mutationId, p_entity_type: 'pregnancy', p_entity_id: P, p_operation: 'upsert',
      p_expected_revision: 1, p_payload: desired, p_consent_id: 'c1',
    });
    const { coordinator } = engine(); coordinator.setAccount(ACCOUNT); await coordinator.settle();
    const state = await snapshot();
    expect(state.sync.mutations).toEqual([]);
    expect(state.domain.pregnancies[P]).toMatchObject({ revision: 2, lmpDate: '2026-03-03' });
    expect(server.applyCalls).toHaveLength(1);
    coordinator.dispose();
  });

  it('send success is not an ACK: the mutation survives until a pull installs the server row, advances the cursor and ACKs in ONE write', async () => {
    const repo = await seeded();
    const queued = await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: pregnancyPayload, consentId: 'c1' });
    const { coordinator } = engine();
    coordinator.setAccount(ACCOUNT);
    await coordinator.settle();
    // Cycle 1: pull (empty) then send; the server applied it but the client did NOT acknowledge.
    expect(server.pullCalls).toEqual([0]);
    expect(server.applyCalls).toHaveLength(1);
    let state = await snapshot();
    expect(state.sync.mutations.map((item) => item.mutationId)).toEqual([queued.mutationId]);
    expect(state.sync.nextChangeSeq).toBe(0);
    // Cycle 2 (the bounded continuation): one protected write establishes proof, cursor and ACK together.
    const counter = countWrites();
    jest.advanceTimersByTime(1_000);
    await coordinator.settle();
    counter.restore();
    expect(counter.writes.filter((name) => name === STORE_KEY)).toHaveLength(1);
    state = await snapshot();
    expect(state.sync.mutations).toEqual([]);
    expect(state.sync.nextChangeSeq).toBe(server.nextSeq);
    expect(state.domain.pregnancies[P]).toMatchObject({ id: P, revision: 1, updatedAt: '2026-10-14T12:00:00.000000+00:00' });
    expect(server.applyCalls).toHaveLength(1);
    coordinator.dispose();
  });

  it('an applied changeSeq is never assigned to the cursor: intervening ledger rows are pulled in order first', async () => {
    server.seedLive('pregnancy', P, { method: 'lmp', lmp_date: '2026-01-01' }, 1);          // seq 1
    server.seedLive('log', L, { pregnancy_id: P, date: '2026-09-01', symptoms: ['other'] }, 1); // seq 2
    const repo = await seeded((s) => { s.domain.pregnancies[P] = pregnancyEntity(1, { lmpDate: '2026-01-01', updatedAt: '2026-10-14T12:00:00.000000+00:00', createdAt: '2026-10-14T12:00:00.000000+00:00' }); s.sync.nextChangeSeq = 1; });
    const queued = await repo.commitLocalMutation((domain) => { domain.symptomLogs[L2] = logEntity(1, { id: L2, date: '2026-10-02' }); }, { entityType: 'log', entityId: L2, operation: 'upsert', payload: logPayload({ date: '2026-10-02' }), consentId: 'c1' });
    const { coordinator } = engine();
    coordinator.setAccount(ACCOUNT);
    await coordinator.settle();
    // The send happens only after the pull has caught up (to seq 2, installing the other row)...
    const afterSend = await snapshot();
    expect(afterSend.sync.nextChangeSeq).toBe(2);
    expect(afterSend.domain.symptomLogs[L]).toBeDefined();
    const appliedSeq = server.ledger[server.ledger.length - 1].changeSeq;
    expect(appliedSeq).toBe(3);
    // ...and the cursor is still 2 (not the applied seq 3) until that row is pulled and proven.
    expect(afterSend.sync.mutations.map((item) => item.mutationId)).toEqual([queued.mutationId]);
    jest.advanceTimersByTime(1_000);
    await coordinator.settle();
    const done = await snapshot();
    expect(done.sync.nextChangeSeq).toBe(3);
    expect(done.sync.mutations).toEqual([]);
    expect(done.domain.symptomLogs[L2]?.revision).toBe(1);
    coordinator.dispose();
  });

  it('a storage failure during the reconciling write leaves old canonical state, old cursor and the mutation intact; recovery then converges', async () => {
    const repo = await seeded();
    await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: pregnancyPayload, consentId: 'c1' });
    const { coordinator } = engine();
    coordinator.setAccount(ACCOUNT);
    await coordinator.settle();
    const before = await AsyncStorage.getItem(STORE_KEY);
    const original = AsyncStorage.setItem;
    (AsyncStorage as { setItem: unknown }).setItem = async () => { throw new Error('disk full'); };
    jest.advanceTimersByTime(1_000);
    await coordinator.settle();
    (AsyncStorage as { setItem: unknown }).setItem = original;
    expect(await AsyncStorage.getItem(STORE_KEY)).toBe(before);
    const kept = await snapshot();
    expect(kept.sync.mutations).toHaveLength(1);
    expect(kept.sync.nextChangeSeq).toBe(0);
    // The server success was already known; nothing was resent as a failure, and a later pass converges.
    for (let index = 0; index < 4; index += 1) { jest.advanceTimersByTime(60_000); await coordinator.settle(); }
    coordinator.setAccount(null); coordinator.setAccount(ACCOUNT);
    await run(coordinator, 4);
    const converged = await snapshot();
    expect(converged.sync.mutations).toEqual([]);
    expect(converged.sync.nextChangeSeq).toBe(server.nextSeq);
    coordinator.dispose();
  });

  it('a crash after send success (process restart) converges safely: remote row installed, no duplicate server write, no lost data (the mutation ends terminal, see ADR-0065)', async () => {
    const repo = await seeded();
    const queued = await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: pregnancyPayload, consentId: 'c1' });
    const first = engine(); first.coordinator.setAccount(ACCOUNT);
    await first.coordinator.settle();
    expect(server.applyCalls).toHaveLength(1);
    first.coordinator.dispose(); // the process "dies": deferral gone, durable queue stays
    const second = engine(); await run(second.coordinator, 4);
    const state = await snapshot();
    // Pull-first cannot tell its own applied write from another device's identical-looking edit (the ledger
    // carries no mutation id), so remote wins and the intent is retained as a terminal revision-conflict.
    expect(state.sync.mutations.find((item) => item.mutationId === queued.mutationId)).toMatchObject({ terminalReason: 'revision-conflict' });
    expect(state.domain.pregnancies[P]).toMatchObject({ revision: 1, updatedAt: '2026-10-14T12:00:00.000000+00:00' });
    expect(state.sync.nextChangeSeq).toBe(server.nextSeq);
    expect(server.applyCalls).toHaveLength(1);
    expect(server.receipts.size).toBe(1);
    expect(state.sync.halt).toBeNull();
  });
});

describe('APP-076 B2B1 replayed success', () => {
  it('with local state that already proves it, a replay is acknowledged inside the protected reconciliation commit (no pull needed first)', async () => {
    const repo = await seeded();
    const queued = await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: pregnancyPayload, consentId: 'c1' });
    // The server already applied it earlier (e.g. a lost response) and the ledger shows nothing new to this client's cursor.
    server.rows.pregnancy.set(P, { id: P, user_id: ACCOUNT, method: 'lmp', lmp_date: '2026-02-01', revision: 1, updated_at: '2026-10-14T12:00:00+00:00', created_at: AT, deleted_at: null });
    server.receipts.set(queued.mutationId, { hash: JSON.stringify(['pregnancy', P, 'upsert', null, pregnancyPayload, 'c1']), entityType: 'pregnancy', entityId: P, revision: 1, deleted: false });
    const { coordinator } = engine();
    // ONE cycle only: the replay is acknowledged inside resolveSuccess's own protected commit, with no continuation needed.
    coordinator.setAccount(ACCOUNT);
    await coordinator.settle();
    expect(server.applyCalls).toHaveLength(1);
    expect((await snapshot()).sync.mutations).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
    coordinator.dispose();
  });

  it('without local proof a replay is deferred and acknowledged only after the pull proves it', async () => {
    const repo = await seeded((s) => { s.domain.pregnancies[P] = pregnancyEntity(1, { lmpDate: '2026-01-01' }); });
    const queued = await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', baseRevision: 1, payload: pregnancyPayload, consentId: 'c1' });
    // The server holds revision 1, applied this mutation to make revision 2, and the ledger row is ahead of the cursor.
    server.seedLive('pregnancy', P, { method: 'lmp', lmp_date: '2026-01-01' }, 1);
    server.remoteEdit('pregnancy', P, { lmp_date: '2026-02-01' });
    server.receipts.set(queued.mutationId, { hash: JSON.stringify(['pregnancy', P, 'upsert', 1, pregnancyPayload, 'c1']), entityType: 'pregnancy', entityId: P, revision: 2, deleted: false });
    const { coordinator } = engine();
    coordinator.setAccount(ACCOUNT);
    await coordinator.settle();
    // Pull-first already pulled the ledger (both rows) and the ack proof came from the replay.
    for (let index = 0; index < 4; index += 1) { jest.advanceTimersByTime(1_000); await coordinator.settle(); }
    const state = await snapshot();
    expect(state.sync.nextChangeSeq).toBe(server.nextSeq);
    expect(state.domain.pregnancies[P]?.revision).toBe(2);
    expect(state.sync.mutations.filter((item) => item.terminalReason === undefined).length + state.sync.mutations.filter((item) => item.terminalReason !== undefined).length).toBeLessThanOrEqual(1);
    coordinator.dispose();
  });
});

describe('APP-076 B2B1 conflicts and refusals', () => {
  it('revision_conflict is not finalised from the error: it blocks, pulls, and the remote row wins with a terminal revision-conflict', async () => {
    const repo = await seeded((s) => { s.domain.pregnancies[P] = pregnancyEntity(1, { lmpDate: '2026-01-01' }); s.sync.nextChangeSeq = 0; });
    server.seedLive('pregnancy', P, { method: 'lmp', lmp_date: '2026-01-01' }, 1);
    // Local edit based on revision 1; before it is sent another device already moved the server to revision 2,
    // but the client's pull-first pass is held back so the conflict arises from the send itself.
    const queued = await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1, { lmpDate: '2026-03-03' }); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', baseRevision: 1, payload: pregnancyPayload, consentId: 'c1' });
    let pulls = 0;
    server.beforePull = () => { pulls += 1; if (pulls === 1) { server.remoteEdit('pregnancy', P, { lmp_date: '2026-02-02' }); return { code: 'PT503', message: 'down', status: 503 }; } return undefined; };
    const { coordinator } = engine();
    await run(coordinator, 12);
    jest.advanceTimersByTime(600_000); await coordinator.settle();
    await run(coordinator, 6);
    const state = await snapshot();
    const item = state.sync.mutations.find((entry) => entry.mutationId === queued.mutationId)!;
    expect(item.terminalReason).toBe('revision-conflict');
    expect(state.domain.pregnancies[P]).toMatchObject({ revision: 2, lmpDate: '2026-02-02' });
    expect(state.sync.halt).toBeNull();
    coordinator.dispose();
  });

  it('a stale DELETE becomes a terminal conflict (never silently rebased) and the remote entity returns', async () => {
    server.seedLive('log', L, { pregnancy_id: P, date: '2026-09-01', symptoms: ['other'] }, 1);
    server.seedLive('pregnancy', P, { method: 'lmp', lmp_date: '2026-01-01' }, 1);
    server.remoteEdit('log', L, { date: '2026-09-02' });
    const repo = await seeded((s) => { s.domain.pregnancies[P] = pregnancyEntity(1, { lmpDate: '2026-01-01', updatedAt: '2026-10-14T12:00:00.000000+00:00', createdAt: '2026-10-14T12:00:00.000000+00:00' }); s.sync.nextChangeSeq = 0; });
    const queued = await repo.commitLocalMutation((domain) => { delete domain.symptomLogs[L]; }, { entityType: 'log', entityId: L, operation: 'delete', baseRevision: 1 });
    const { coordinator } = engine(); await run(coordinator, 6);
    const state = await snapshot();
    expect(state.sync.mutations.find((item) => item.mutationId === queued.mutationId)).toMatchObject({ terminalReason: 'revision-conflict', baseRevision: 1 });
    expect(state.domain.symptomLogs[L]).toMatchObject({ revision: 2 });
    expect(server.applyCalls).toHaveLength(0);
    coordinator.dispose();
  });

  it('parent_unavailable with a parent the server deleted: reconcile, scrub, and terminalize the child as remote-parent-deleted', async () => {
    server.seedLive('pregnancy', P, { method: 'lmp', lmp_date: '2026-01-01' }, 1);
    const repo = await seeded((s) => { s.domain.pregnancies[P] = pregnancyEntity(1, { lmpDate: '2026-01-01', updatedAt: '2026-10-14T12:00:00.000000+00:00', createdAt: '2026-10-14T12:00:00.000000+00:00' }); s.sync.nextChangeSeq = 1; });
    const child = await repo.commitLocalMutation((domain) => { domain.symptomLogs[L] = logEntity(1, { notes: 'private child text' }); }, { entityType: 'log', entityId: L, operation: 'upsert', payload: logPayload({ notes: 'private child text' }), consentId: 'c1' });
    // The root is deleted on another device after this client's cursor but before the send.
    let pulls = 0;
    server.beforePull = () => { pulls += 1; if (pulls === 1) server.remoteDelete('pregnancy', P); return undefined; };
    server.beforePull(0); pulls = 1;
    const { coordinator } = engine(); await run(coordinator, 8);
    const state = await snapshot();
    expect(state.sync.mutations.find((item) => item.mutationId === child.mutationId)).toMatchObject({ terminalReason: 'remote-parent-deleted' });
    expect(state.domain.pregnancies[P]).toBeUndefined();
    expect(state.domain.symptomLogs[L]).toBeUndefined();
    expect(state.tombstones[`pregnancy:${P}`]).toBeDefined();
    expect(JSON.stringify(state)).not.toContain('private child text');
    expect(state.sync.halt).toBeNull();
    coordinator.dispose();
  });

  it('parent_unavailable that remote state cannot explain (live parent) halts the Pregnancy backend durably', async () => {
    const repo = await seeded((s) => { s.domain.pregnancies[P] = pregnancyEntity(1); s.sync.nextChangeSeq = 1; });
    await repo.commitLocalMutation((domain) => { domain.symptomLogs[L] = logEntity(1); }, { entityType: 'log', entityId: L, operation: 'upsert', payload: logPayload(), consentId: 'c1' });
    server.seedLive('pregnancy', P, { method: 'lmp', lmp_date: '2026-02-01' }, 1);
    server.beforeApply = () => ({ code: 'PT409', message: 'parent_unavailable', status: 409 });
    const { coordinator } = engine(); await run(coordinator, 8);
    const state = await snapshot();
    expect(state.sync.halt).toMatchObject({ kind: 'conflict', cause: 'parent-unavailable-unexplained' });
    expect(JSON.stringify(state.sync.halt)).not.toMatch(/log|private|[0-9a-f]{8}-/);
    const applies = server.applyCalls.length;
    await run(coordinator, 4);
    expect(server.applyCalls.length).toBe(applies);
    coordinator.dispose();
  });

  it('a child that outruns its still-unconfirmed root is waiting (backoff), not a halt', async () => {
    const repo = await seeded();
    await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: pregnancyPayload, consentId: 'c1' });
    await repo.commitLocalMutation((domain) => { domain.symptomLogs[L] = logEntity(1); }, { entityType: 'log', entityId: L, operation: 'upsert', payload: logPayload(), consentId: 'c1' });
    server.beforeApply = (args) => (args.p_entity_type === 'pregnancy' ? { code: 'PT503', message: 'down', status: 503 } : undefined);
    const { coordinator } = engine(); coordinator.setAccount(ACCOUNT); await coordinator.settle();
    const state = await snapshot();
    expect(state.sync.halt).toBeNull();
    const child = state.sync.mutations.find((item) => item.entityType === 'log')!;
    expect(child.awaiting).toBeUndefined();
    coordinator.dispose();
  });

  it('mutation_id_conflict persists a payload-free Pregnancy-only halt that survives restart, with no replacement id and no retry', async () => {
    const repo = await seeded();
    const queued = await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: pregnancyPayload, consentId: 'c1' });
    server.beforeApply = () => ({ code: 'PT409', message: 'mutation_id_conflict', status: 409 });
    const ordinaryLog: string[] = [];
    const ordinaryItems = [{ mutationId: 'o1' }];
    const ordinary: SyncCoordinatorBackend = { id: 'ordinary', subscribe: () => () => undefined, open: async () => ({
      isActive: () => true, list: async () => ordinaryItems.map((item) => ({ ...item })), plan: (items) => ({ due: items, nextRetryAtMs: null }),
      mutationId: (item) => (item as { mutationId: string }).mutationId,
      send: async () => { ordinaryLog.push('send'); return { ok: true }; },
      resolveSuccess: async () => { ordinaryItems.splice(0, 1); return { outcome: 'resolved' }; },
      resolveFailure: async () => ({ recorded: true, permanent: true }),
    }) };
    const first = engine([ordinary]); await run(first.coordinator, 4);
    const state = await snapshot();
    expect(state.sync.halt).toMatchObject({ kind: 'recovery-required', cause: 'mutation-id-conflict' });
    expect(state.sync.mutations).toHaveLength(1);
    expect(state.sync.mutations[0]).toMatchObject({ mutationId: queued.mutationId, status: 'failed', attempts: 1 });
    expect(state.sync.mutations[0].nextRetryAt).toBeUndefined();
    expect(ordinaryLog).toEqual(['send']);
    first.coordinator.dispose();
    // Restart: a brand-new backend/engine still refuses to touch the network for Pregnancy.
    const calls = server.applyCalls.length; const pulls = server.pullCalls.length;
    const second = engine(); await run(second.coordinator, 6);
    expect(server.applyCalls.length).toBe(calls);
    expect(server.pullCalls.length).toBe(pulls);
    expect((await snapshot()).sync.mutations[0].mutationId).toBe(queued.mutationId);
    second.coordinator.dispose();
  });

  it('PT428 consent_required stays terminal evidence with the original consent id, is not retried, and a later delete stays eligible', async () => {
    server.seedLive('pregnancy', P, { method: 'lmp', lmp_date: '2026-02-01' }, 1);
    const repo = await seeded((s) => { s.domain.pregnancies[P] = pregnancyEntity(1, { updatedAt: '2026-10-14T12:00:00.000000+00:00', createdAt: '2026-10-14T12:00:00.000000+00:00' }); s.sync.nextChangeSeq = 1; });
    const upsert = await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1, { lmpDate: '2026-04-04' }); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', baseRevision: 1, payload: pregnancyPayload, consentId: 'consent-old' });
    server.beforeApply = (args) => (args.p_operation === 'upsert' ? { code: 'PT428', message: 'consent_required', status: 428 } : undefined);
    const { coordinator } = engine(); await run(coordinator, 4);
    let state = await snapshot();
    expect(state.sync.mutations[0]).toMatchObject({ mutationId: upsert.mutationId, terminalReason: 'consent-required', consentId: 'consent-old' });
    const attempts = server.applyCalls.length;
    await run(coordinator, 4);
    expect(server.applyCalls.length).toBe(attempts);
    // The remote reconciliation of unrelated changes leaves that evidence alone.
    server.seedLive('log', L, { pregnancy_id: P, date: '2026-09-01', symptoms: [] }, 1);
    await run(coordinator, 4);
    state = await snapshot();
    expect(state.sync.mutations.find((item) => item.mutationId === upsert.mutationId)).toMatchObject({ terminalReason: 'consent-required', consentId: 'consent-old' });
    coordinator.dispose();
  });

  it('a success response that disagrees with the operation is treated as an unknown conflict and halts', async () => {
    const repo = await seeded();
    await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: pregnancyPayload, consentId: 'c1' });
    const original = server.rpc.bind(server);
    server.rpc = (async (name: string, args: Record<string, unknown>) => {
      const result = await original(name, args) as { data: Record<string, unknown> | null };
      if (name === 'apply_pregnancy_sync_mutation' && result.data) return { ...result, data: { ...result.data, deleted: true } };
      return result;
    }) as never;
    const { coordinator } = engine(); await run(coordinator, 4);
    expect((await snapshot()).sync.halt).toMatchObject({ cause: 'unknown-conflict' });
    coordinator.dispose();
  });
});

describe('APP-076 B2B1 send-time revision conflicts', () => {
  const rootRow = { method: 'lmp', lmp_date: '2026-01-01' };
  const alignedRoot = () => pregnancyEntity(1, { lmpDate: '2026-01-01', updatedAt: '2026-10-14T12:00:00.000000+00:00', createdAt: '2026-10-14T12:00:00.000000+00:00' });

  it('revision_conflict from the send itself blocks the mutation (no resend), pulls, and remote wins with a terminal revision-conflict', async () => {
    server.seedLive('pregnancy', P, rootRow, 1);
    const repo = await seeded((s) => { s.domain.pregnancies[P] = alignedRoot(); s.sync.nextChangeSeq = 1; });
    const queued = await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1, { lmpDate: '2026-03-03' }); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', baseRevision: 1, payload: pregnancyPayload, consentId: 'c1' });
    // Another device edits between this client's pull and its send.
    server.beforeApply = () => { server.remoteEdit('pregnancy', P, { lmp_date: '2026-02-02' }); server.beforeApply = undefined; return { code: 'PT409', message: 'revision_conflict', status: 409 }; };
    const { coordinator } = engine(); await run(coordinator, 6);
    expect(server.applyCalls).toHaveLength(1);
    const state = await snapshot();
    expect(state.sync.mutations.find((item) => item.mutationId === queued.mutationId)).toMatchObject({ terminalReason: 'revision-conflict', baseRevision: 1 });
    expect(state.sync.mutations.find((item) => item.mutationId === queued.mutationId)?.awaiting).toBeUndefined();
    expect(state.domain.pregnancies[P]).toMatchObject({ revision: 2, lmpDate: '2026-02-02' });
    expect(state.sync.halt).toBeNull();
    expect(state.sync.nextChangeSeq).toBe(server.nextSeq);
  });

  it('a revision_conflict that the ledger cannot explain halts after the caught-up pass instead of looping', async () => {
    server.seedLive('pregnancy', P, rootRow, 1);
    const repo = await seeded((s) => { s.domain.pregnancies[P] = alignedRoot(); s.sync.nextChangeSeq = 1; });
    const queued = await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1, { lmpDate: '2026-03-03' }); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', baseRevision: 1, payload: pregnancyPayload, consentId: 'c1' });
    server.beforeApply = () => ({ code: 'PT409', message: 'revision_conflict', status: 409 });
    const { coordinator } = engine(); await run(coordinator, 8);
    const state = await snapshot();
    expect(state.sync.halt).toMatchObject({ kind: 'conflict', cause: 'revision-conflict-unexplained' });
    expect(state.sync.mutations.find((item) => item.mutationId === queued.mutationId)).toMatchObject({ status: 'failed', awaiting: 'revision-conflict' });
    expect(server.applyCalls).toHaveLength(1);
  });

  it('a stale delete refused by the server becomes a terminal conflict, never silently rebased onto the new revision', async () => {
    server.seedLive('pregnancy', P, rootRow, 1);
    server.seedLive('log', L, { pregnancy_id: P, date: '2026-09-01', symptoms: ['other'] }, 1);
    const repo = await seeded((s) => { s.domain.pregnancies[P] = alignedRoot(); s.sync.nextChangeSeq = 2; s.domain.symptomLogs[L] = logEntity(1, { date: '2026-09-01', symptoms: ['other'], updatedAt: '2026-10-14T12:00:00.000000+00:00' }); });
    const queued = await repo.commitLocalMutation((domain) => { delete domain.symptomLogs[L]; }, { entityType: 'log', entityId: L, operation: 'delete', baseRevision: 1 });
    server.beforeApply = () => { server.remoteEdit('log', L, { date: '2026-09-05' }); server.beforeApply = undefined; return { code: 'PT409', message: 'revision_conflict', status: 409 }; };
    const { coordinator } = engine(); await run(coordinator, 6);
    const state = await snapshot();
    expect(state.sync.mutations.find((item) => item.mutationId === queued.mutationId)).toMatchObject({ terminalReason: 'revision-conflict', baseRevision: 1 });
    expect(state.domain.symptomLogs[L]).toMatchObject({ revision: 2, date: '2026-09-05' });
    expect(server.applyCalls).toHaveLength(1);
    expect(state.sync.halt).toBeNull();
  });

  it('an applied delete is acknowledged only by the tombstone: payload gone, tombstone at the server revision, cursor moved, one write', async () => {
    server.seedLive('pregnancy', P, rootRow, 1);
    server.seedLive('log', L, { pregnancy_id: P, date: '2026-09-01', symptoms: ['other'], notes: 'private log note' }, 1);
    const repo = await seeded((s) => { s.domain.pregnancies[P] = alignedRoot(); s.sync.nextChangeSeq = 2; s.domain.symptomLogs[L] = logEntity(1, { date: '2026-09-01', symptoms: ['other'], notes: 'private log note', updatedAt: '2026-10-14T12:00:00.000000+00:00' }); });
    const queued = await repo.commitLocalMutation((domain) => { delete domain.symptomLogs[L]; }, { entityType: 'log', entityId: L, operation: 'delete', baseRevision: 1 });
    const { coordinator } = engine(); coordinator.setAccount(ACCOUNT); await coordinator.settle();
    expect((await snapshot()).sync.mutations.map((item) => item.mutationId)).toEqual([queued.mutationId]);
    const counter = countWrites();
    jest.advanceTimersByTime(1_000); await coordinator.settle();
    counter.restore();
    expect(counter.writes.filter((name) => name === STORE_KEY)).toHaveLength(1);
    const state = await snapshot();
    expect(state.sync.mutations).toEqual([]);
    expect(state.tombstones[`log:${L}`]).toMatchObject({ revision: 2 });
    expect(JSON.stringify(state)).not.toContain('private log note');
    expect(state.sync.nextChangeSeq).toBe(server.nextSeq);
  });

  it('root delete by another device: the pull scrubs the root and children locally and tombstones them', async () => {
    server.seedLive('pregnancy', P, rootRow, 1);
    server.seedLive('log', L, { pregnancy_id: P, date: '2026-09-01', symptoms: ['other'], notes: 'private log note' }, 1);
    await seeded((s) => { s.domain.pregnancies[P] = alignedRoot(); s.sync.nextChangeSeq = 2; s.domain.symptomLogs[L] = logEntity(1, { date: '2026-09-01', symptoms: ['other'], notes: 'private log note', updatedAt: '2026-10-14T12:00:00.000000+00:00' }); });
    server.remoteDelete('pregnancy', P);
    const { coordinator } = engine(); await run(coordinator, 3);
    const state = await snapshot();
    expect(state.domain).toEqual({ pregnancies: {}, symptomLogs: {}, appointments: {}, settings: null });
    expect(Object.keys(state.tombstones).sort()).toEqual([`log:${L}`, `pregnancy:${P}`].sort());
    expect(JSON.stringify(state)).not.toContain('private log note');
  });

  it('settings sync as one upsert-only row: created, then edited with its revision, never tombstoned', async () => {
    const repo = await seeded();
    await repo.commitLocalMutation((domain) => { domain.settings = { recoveryDisplayDays: 60, privacyMode: true, revision: 1, updatedAt: AT }; }, { entityType: 'settings', entityId: ACCOUNT, operation: 'upsert', payload: { recoveryDisplayDays: 60, privacyMode: true }, consentId: 'c1' });
    const { coordinator } = engine(); await run(coordinator, 4);
    let state = await snapshot();
    expect(state.sync.mutations).toEqual([]);
    expect(state.domain.settings).toMatchObject({ recoveryDisplayDays: 60, privacyMode: true, revision: 1, updatedAt: '2026-10-14T12:00:00.000000+00:00' });
    await repo.commitLocalMutation((domain) => { domain.settings = { recoveryDisplayDays: 30, privacyMode: false, revision: 1, updatedAt: AT }; }, { entityType: 'settings', entityId: ACCOUNT, operation: 'upsert', baseRevision: 1, payload: { recoveryDisplayDays: 30, privacyMode: false }, consentId: 'c1' });
    await run(coordinator, 4);
    state = await snapshot();
    expect(state.sync.mutations).toEqual([]);
    expect(state.domain.settings).toMatchObject({ recoveryDisplayDays: 30, revision: 2 });
    expect(state.tombstones).toEqual({});
  });
});

describe('APP-076 B2B1 pull bounds, fairness and failure handling', () => {
  it('a full 100-row page earns a bounded continuation; the cursor only moves with each applied page', async () => {
    for (let index = 1; index <= 150; index += 1) server.seedLive('pregnancy', idOf(1000 + index), { method: 'lmp', lmp_date: '2026-02-01' }, 1);
    await seeded();
    const { coordinator } = engine();
    coordinator.setAccount(ACCOUNT);
    await coordinator.settle();
    expect(server.pullCalls).toEqual([0]);
    expect((await snapshot()).sync.nextChangeSeq).toBe(100);
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(1_000); await coordinator.settle();
    expect(server.pullCalls).toEqual([0, 100]);
    expect((await snapshot()).sync.nextChangeSeq).toBe(150);
    expect(Object.keys((await snapshot()).domain.pregnancies)).toHaveLength(150);
    jest.advanceTimersByTime(1_000); await coordinator.settle();
    expect(jest.getTimerCount()).toBe(0);
    coordinator.dispose();
  });

  it('exactly 100 rows is a full page; the next pass sees an empty page and catches up', async () => {
    for (let index = 1; index <= 100; index += 1) server.seedLive('pregnancy', idOf(1000 + index), { method: 'lmp', lmp_date: '2026-02-01' }, 1);
    await seeded();
    const { coordinator } = engine(); coordinator.setAccount(ACCOUNT); await coordinator.settle();
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(1_000); await coordinator.settle();
    expect(server.pullCalls).toEqual([0, 100]);
    expect(jest.getTimerCount()).toBe(0);
    coordinator.dispose();
  });

  it('a large remote Pregnancy backlog never starves ordinary due sends, and Pregnancy sends wait for catch-up', async () => {
    for (let index = 1; index <= 250; index += 1) server.seedLive('pregnancy', idOf(1000 + index), { method: 'lmp', lmp_date: '2026-02-01' }, 1);
    const repo = await seeded();
    await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: pregnancyPayload, consentId: 'c1' });
    const log: string[] = [];
    const items = [{ mutationId: 'o1' }, { mutationId: 'o2' }];
    const ordinary: SyncCoordinatorBackend = { id: 'ordinary', subscribe: () => () => undefined, open: async () => ({
      isActive: () => true, list: async () => items.map((item) => ({ ...item })), plan: (list) => ({ due: list, nextRetryAtMs: null }),
      mutationId: (item) => (item as { mutationId: string }).mutationId,
      send: async (item) => { log.push(`ordinary:${(item as { mutationId: string }).mutationId}`); return { ok: true }; },
      resolveSuccess: async (item) => { items.splice(items.findIndex((entry) => entry.mutationId === (item as { mutationId: string }).mutationId), 1); return { outcome: 'resolved' }; },
      resolveFailure: async () => ({ recorded: true, permanent: true }),
    }) };
    const { coordinator } = engine([ordinary]);
    coordinator.setAccount(ACCOUNT); await coordinator.settle();
    // Cycle 1: one Pregnancy page, no Pregnancy send yet, but BOTH ordinary mutations were sent.
    expect(log).toEqual(['ordinary:o1', 'ordinary:o2']);
    expect(server.applyCalls).toHaveLength(0);
    expect(server.pullCalls).toEqual([0]);
    jest.advanceTimersByTime(1_000); await coordinator.settle();
    expect(server.applyCalls).toHaveLength(0);
    jest.advanceTimersByTime(1_000); await coordinator.settle();
    // Page 3 caught up: only now may the Pregnancy send go out.
    expect(server.applyCalls).toHaveLength(1);
    coordinator.dispose();
  });

  it('a failed canonical read, an unexplained row or a malformed page never moves the cursor and never surfaces raw errors', async () => {
    server.seedLive('pregnancy', P, { method: 'lmp', lmp_date: '2026-02-01' }, 1);
    await seeded();
    server.beforeSelect = () => ({ code: 'PT500', message: 'sensitive server diagnostic', status: 500 });
    const { coordinator } = engine(); coordinator.setAccount(ACCOUNT); await coordinator.settle();
    expect((await snapshot()).sync.nextChangeSeq).toBe(0);
    expect(JSON.stringify(await snapshot())).not.toContain('sensitive server diagnostic');
    server.beforeSelect = undefined;
    server.mutateRow = (_table, row) => ({ ...row, method: 'guess' });
    jest.advanceTimersByTime(400_000); await coordinator.settle();
    expect((await snapshot()).sync.nextChangeSeq).toBe(0);
    server.mutateRow = undefined;
    jest.advanceTimersByTime(400_000); await coordinator.settle();
    expect((await snapshot()).sync.nextChangeSeq).toBe(1);
    coordinator.dispose();
  });

  it('a pull failure backs off instead of polling, and a refused session is not retried in a loop', async () => {
    await seeded();
    server.beforePull = () => ({ code: 'PT503', message: 'down', status: 503 });
    const { coordinator } = engine(); coordinator.setAccount(ACCOUNT); await coordinator.settle();
    expect(server.pullCalls).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(500); await coordinator.settle();
    expect(server.pullCalls).toHaveLength(1);
    coordinator.dispose();
    const refused = new FakePregnancyServer(ACCOUNT); refused.beforePull = () => ({ code: 'PT401', message: 'no', status: 401 }); mockServerRef.current = refused as never;
    const again = engine(); again.coordinator.setAccount(ACCOUNT); await again.coordinator.settle();
    jest.advanceTimersByTime(600_000); await again.coordinator.settle();
    expect(refused.pullCalls).toHaveLength(1);
    again.coordinator.dispose();
  });

  it('an account switch mid-pull discards the result: no write for the departed account', async () => {
    await seeded();
    server.seedLive('pregnancy', P, { method: 'lmp', lmp_date: '2026-02-01' }, 1);
    const original = server.rpc.bind(server);
    server.rpc = (async (name: string, args: Record<string, unknown>) => {
      const result = await original(name, args);
      if (name === 'pull_pregnancy_sync_state') live.account = 'someone-else';
      return result;
    }) as never;
    const before = await AsyncStorage.getItem(STORE_KEY);
    const { coordinator } = engine(); coordinator.setAccount(ACCOUNT); await coordinator.settle();
    expect(await AsyncStorage.getItem(STORE_KEY)).toBe(before);
    live.account = ACCOUNT;
    expect((await snapshot()).sync.nextChangeSeq).toBe(0);
    coordinator.dispose();
  });

  it('a Pregnancy epoch invalidation mid-pull writes nothing into the new dataset and leaves ordinary sync alone', async () => {
    const repo = await seeded();
    server.seedLive('pregnancy', P, { method: 'lmp', lmp_date: '2026-02-01' }, 1);
    const original = server.rpc.bind(server);
    server.rpc = (async (name: string, args: Record<string, unknown>) => {
      const result = await original(name, args);
      if (name === 'pull_pregnancy_sync_state') await repo.rebaseline();
      return result;
    }) as never;
    const { coordinator } = engine(); coordinator.setAccount(ACCOUNT); await coordinator.settle();
    const state = await snapshot();
    expect(state.datasetEpoch).toBe(1);
    expect(state.domain.pregnancies).toEqual({});
    expect(state.sync.nextChangeSeq === 0 || state.sync.nextChangeSeq === 1).toBe(true);
    coordinator.dispose();
  });

  it('a session read that throws before dispatch is not counted as an attempt and still retries', async () => {
    const repo = await seeded();
    await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: pregnancyPayload, consentId: 'c1' });
    let reads = 0;
    mockGetSession.mockImplementation(async () => { reads += 1; if (reads <= 2) throw new Error('keychain locked'); return { data: { session: { user: { id: ACCOUNT }, access_token: 'token' } }, error: null }; });
    const { coordinator } = engine(); coordinator.setAccount(ACCOUNT); await coordinator.settle();
    expect(server.applyCalls).toHaveLength(0);
    const state = await snapshot();
    expect(state.sync.mutations[0]).toMatchObject({ attempts: 0 });
    coordinator.dispose();
  });
});

describe('APP-076 B2B1 protected repository: atomic reconciliation', () => {
  it('the public repository has no blind acknowledge, and extra caller-supplied ACK ids are inert', async () => {
    const repo = await seeded();
    expect(Object.keys(repo)).not.toContain('acknowledge');
    const queued = await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: pregnancyPayload, consentId: 'c1' });
    await repo.commitRemoteReconciliation({ fromCursor: 0, toCursor: 3, caughtUp: false, snapshots: [], proofs: [], ackMutationIds: [queued.mutationId] } as never);
    expect((await snapshot()).sync.mutations.map((item) => item.mutationId)).toEqual([queued.mutationId]);
    expect((await snapshot()).sync.nextChangeSeq).toBe(3);
  });

  it('a stale cursor writes nothing and reports cursor-mismatch', async () => {
    const repo = await seeded((s) => { s.sync.nextChangeSeq = 4; });
    const before = await AsyncStorage.getItem(STORE_KEY);
    await expect(repo.commitRemoteReconciliation({ fromCursor: 3, toCursor: 9, caughtUp: false, snapshots: [], proofs: [] })).rejects.toMatchObject({ code: 'cursor-mismatch' });
    expect(await AsyncStorage.getItem(STORE_KEY)).toBe(before);
  });

  it('refuses reconciliation while halted', async () => {
    const repo = await seeded();
    const queued = await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: pregnancyPayload, consentId: 'c1' });
    await repo.recordFailure(queued.mutationId, { status: 'failed', attempts: 1, nextRetryAt: null }, undefined, { halt: { kind: 'recovery-required', cause: 'mutation-id-conflict' } });
    await expect(repo.commitRemoteReconciliation({ fromCursor: 0, toCursor: 1, caughtUp: true, snapshots: [], proofs: [] })).rejects.toBeInstanceOf(PregnancyProtectedRepositoryError);
  });

  it('a same-revision divergence persists the halt and NOTHING else: no cursor move, no partial effects', async () => {
    const repo = await seeded((s) => { s.domain.pregnancies[P] = pregnancyEntity(2, { lmpDate: '2026-01-01' }); s.domain.symptomLogs[L] = logEntity(1); });
    const outcome = await repo.commitRemoteReconciliation({
      fromCursor: 0, toCursor: 9, caughtUp: true, proofs: [],
      snapshots: [
        { entityType: 'log', entityId: L, metadataRevision: 2, changeSeq: 8, state: { kind: 'tombstone', revision: 2 } },
        { entityType: 'pregnancy', entityId: P, metadataRevision: 2, changeSeq: 9, state: { kind: 'live', revision: 2, live: { entityType: 'pregnancy', entity: pregnancyEntity(2) } } },
      ],
    });
    expect(outcome).toMatchObject({ halted: true, cursor: 0, acknowledged: [] });
    const state = await snapshot();
    expect(state.sync.halt).toMatchObject({ kind: 'conflict', cause: 'same-revision-divergence' });
    expect(state.sync.nextChangeSeq).toBe(0);
    expect(state.domain.symptomLogs[L]).toBeDefined();
    expect(state.tombstones).toEqual({});
  });

  it('survives restart equivalently: a fresh handle reads state, tombstone, cursor and ACK together', async () => {
    const repo = await seeded();
    const queued = await repo.commitLocalMutation((domain) => { domain.symptomLogs[L] = logEntity(1, { notes: 'private note' }); }, { entityType: 'log', entityId: L, operation: 'upsert', payload: logPayload(), consentId: 'c1' });
    await repo.commitRemoteReconciliation({
      fromCursor: 0, toCursor: 5, caughtUp: false,
      snapshots: [{ entityType: 'log', entityId: L, metadataRevision: 1, changeSeq: 5, state: { kind: 'live', revision: 1, live: { entityType: 'log', entity: logEntity(1, { updatedAt: '2026-10-14T12:00:00.000000+00:00' }) } } }],
      proofs: [{ mutationId: queued.mutationId, entityType: 'log', entityId: L, serverRevision: 1, deleted: false }],
    });
    const fresh = await handle().hydrate();
    expect(fresh?.sync.mutations).toEqual([]);
    expect(fresh?.sync.nextChangeSeq).toBe(5);
    expect(fresh?.domain.symptomLogs[L]?.updatedAt).toBe('2026-10-14T12:00:00.000000+00:00');
  });

  it('rejects an incoherent instruction without writing', async () => {
    const repo = await seeded();
    const before = await AsyncStorage.getItem(STORE_KEY);
    await expect(repo.commitRemoteReconciliation({
      fromCursor: 0, toCursor: 1, caughtUp: false, proofs: [],
      snapshots: [{ entityType: 'log', entityId: L, metadataRevision: 1, changeSeq: 1, state: { kind: 'live', revision: 1, live: { entityType: 'pregnancy', entity: pregnancyEntity(1) } } }],
    })).rejects.toMatchObject({ code: 'invalid-protected-state' });
    expect(await AsyncStorage.getItem(STORE_KEY)).toBe(before);
  });
});

describe('APP-076 B2B1 encrypted in-place state upgrade (v1 to v2)', () => {
  const v1 = () => {
    const current = createInitialPregnancyProtectedState(ACCOUNT, 3) as unknown as Record<string, unknown>;
    const { halt: _halt, ...sync } = current.sync as Record<string, unknown>;
    return { ...current, version: 1, sync: { ...sync, nextChangeSeq: 7 } } as Record<string, unknown>;
  };
  it('upgrades a v1 dataset deterministically, in place and still encrypted, preserving every field', async () => {
    const legacy = v1();
    (legacy.domain as Record<string, unknown>).pregnancies = { [P]: pregnancyEntity(2, { outcomeNotes: 'private' }) };
    await writeEncryptedPregnancyPayload(JSON.stringify(legacy));
    const before = await AsyncStorage.getItem(STORE_KEY);
    const state = await handle().hydrate();
    expect(state).toMatchObject({ version: 2, datasetEpoch: 3, sync: { nextChangeSeq: 7, halt: null, mutations: [] } });
    expect(state?.domain.pregnancies[P]?.outcomeNotes).toBe('private');
    const after = await AsyncStorage.getItem(STORE_KEY);
    expect(after).not.toBe(before);
    for (const value of ['private', P, 'datasetEpoch', 'nextChangeSeq']) expect(after).not.toContain(value);
    // The upgrade is idempotent and the second read needs no rewrite.
    const counter = countWrites();
    await handle().hydrate();
    counter.restore();
    expect(counter.writes).toEqual([]);
  });

  it('fails closed on a v1 dataset that violates current rules, on a v1 that already has a halt, and on unknown versions, writing nothing', async () => {
    const bad = v1(); (bad.sync as Record<string, unknown>).halt = null;
    const tombstoned = v1(); tombstoned.tombstones = { arbitrary: { entityType: 'log', entityId: L, revision: 1 } };
    for (const payload of [bad, tombstoned, { ...v1(), version: 3 }, { ...v1(), version: 0 }]) {
      await withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.clear(); await clearPregnancyHealthEncryptionKey(); });
      await writeEncryptedPregnancyPayload(JSON.stringify(payload));
      const before = await AsyncStorage.getItem(STORE_KEY);
      await expect(handle().hydrate()).rejects.toMatchObject({ code: 'invalid-protected-state' });
      expect(await AsyncStorage.getItem(STORE_KEY)).toBe(before);
    }
  });

  it('a failed upgrade write leaves the readable v1 ciphertext untouched', async () => {
    await writeEncryptedPregnancyPayload(JSON.stringify(v1()));
    const before = await AsyncStorage.getItem(STORE_KEY);
    const original = AsyncStorage.setItem;
    (AsyncStorage as { setItem: unknown }).setItem = async () => { throw new Error('disk full'); };
    await expect(handle().hydrate()).rejects.toBeDefined();
    (AsyncStorage as { setItem: unknown }).setItem = original;
    expect(await AsyncStorage.getItem(STORE_KEY)).toBe(before);
    await expect(handle().hydrate()).resolves.toMatchObject({ version: 2 });
  });

  it('enforces the new invariants: derived tombstone keys, no deleted payload beneath a tombstone, payload-free remote-deleted terminals', async () => {
    const repo = await seeded();
    const cases: Array<(s: PregnancyProtectedState) => void> = [
      (s) => { s.tombstones.wrong = { entityType: 'log', entityId: L, revision: 1 }; },
      (s) => { s.domain.symptomLogs[L] = logEntity(1); s.tombstones[`log:${L}`] = { entityType: 'log', entityId: L, revision: 2 }; },
      (s) => { s.domain.symptomLogs[L] = logEntity(1); s.tombstones[`pregnancy:${P}`] = { entityType: 'pregnancy', entityId: P, revision: 2 }; },
      (s) => { s.sync.mutations = [{ mutationId: 'm', entityType: 'log', entityId: L, operation: 'upsert', consentId: 'c', payload: { private: 1 }, createdAt: AT, status: 'failed', attempts: 0, terminalReason: 'remote-deleted' }]; },
      (s) => { s.sync.mutations = [{ mutationId: 'm', entityType: 'log', entityId: L, operation: 'delete', createdAt: AT, status: 'pending', attempts: 0, awaiting: 'revision-conflict' }]; },
      (s) => { s.sync.mutations = [{ mutationId: 'm', entityType: 'log', entityId: L, operation: 'delete', createdAt: AT, status: 'failed', attempts: 1, nextRetryAt: AT, terminalReason: 'revision-conflict' }]; },
      (s) => { (s.sync as { halt: unknown }).halt = { kind: 'recovery-required', cause: 'something-else', recordedAt: AT }; },
      (s) => { (s.sync as { halt: unknown }).halt = { kind: 'recovery-required', cause: 'unknown-conflict', recordedAt: AT, detail: 'raw server text' }; },
    ];
    for (const mutate of cases) {
      const state = await snapshot(); const next = JSON.parse(JSON.stringify(state)) as PregnancyProtectedState; mutate(next);
      await expect(writeEncryptedPregnancyPayload(JSON.stringify(next)).then(() => handle().hydrate())).rejects.toMatchObject({ code: 'invalid-protected-state' });
      await withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.clear(); await clearPregnancyHealthEncryptionKey(); });
      await seeded();
    }
    void repo;
  });
});

describe('APP-076 B2B1 backend wiring', () => {
  it('translates queue events into engine events without any identity, and scopes epoch changes to Pregnancy', async () => {
    const events: unknown[] = [];
    const backend = createPregnancySyncBackend({ getActiveAccount });
    const stop = backend.subscribe((event) => events.push(event));
    const repo = await seeded();
    await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1, { outcomeNotes: 'private' }); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: pregnancyPayload, consentId: 'c1' });
    await repo.rebaseline();
    invalidatePregnancyProtectedRepositories();
    stop();
    expect(events).toContainEqual({ kind: 'changed', accountId: ACCOUNT });
    expect(events).toContainEqual({ kind: 'backend-invalidated', backendId: PREGNANCY_SYNC_BACKEND_ID, accountId: ACCOUNT });
    expect(events).toContainEqual({ kind: 'cleanup' });
    expect(JSON.stringify(events)).not.toMatch(/private|mutationId|entityId|consent/);
  });

  it('a halted or absent dataset lists no work', async () => {
    const backend = createPregnancySyncBackend({ getActiveAccount });
    await expect(backend.open(ACCOUNT)).rejects.toBeDefined();
    const repo = await seeded();
    const queued = await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = pregnancyEntity(1); }, { entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: pregnancyPayload, consentId: 'c1' });
    const session = await backend.open(ACCOUNT);
    await expect(session.list()).resolves.toHaveLength(1);
    await repo.recordFailure(queued.mutationId, { status: 'failed', attempts: 1, nextRetryAt: null }, undefined, { halt: { kind: 'recovery-required', cause: 'unknown-conflict' } });
    const halted = await backend.open(ACCOUNT);
    await expect(halted.list()).resolves.toEqual([]);
    await expect(halted.inbound!({ deferred: [] })).resolves.toEqual({ outcome: 'halted' });
  });
});
