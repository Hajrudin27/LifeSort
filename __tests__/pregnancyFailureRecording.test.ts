import AsyncStorage from '@react-native-async-storage/async-storage';

const mockSecure = new Map<string, string>();

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

import { Platform } from 'react-native';

import { createInitialPregnancyProtectedState, createPregnancyProtectedRepository } from '@/core/pregnancy/protectedRepository';
import { recordPregnancySyncFailure, type PregnancyFailureReason } from '@/core/pregnancy/syncQueue';
import { clearPregnancyHealthEncryptionKey, withPregnancyHealthEncryptedStorageCleanup } from '@/core/storage/pregnancyHealthEncryptedStorage';

const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const P = 'b0000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-10-14T12:00:00.000Z');
let active: string | null = ACCOUNT;

beforeEach(async () => {
  jest.clearAllMocks(); mockSecure.clear(); active = ACCOUNT;
  await withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.clear(); await clearPregnancyHealthEncryptionKey(); });
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
});

async function queued(attempts = 0) {
  const repo = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => active });
  await repo.initialize(createInitialPregnancyProtectedState(ACCOUNT));
  const mutation = await repo.commitLocalMutation((domain) => { domain.pregnancies[P] = { id: P, method: 'lmp', createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z', revision: 1 }; }, {
    entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: { method: 'lmp', notes: 'private note' }, consentId: 'c1',
  });
  if (attempts > 0) await repo.updateMetadata(mutation.mutationId, { status: 'failed', attempts, nextRetryAt: new Date(NOW - 1).toISOString() });
  return { repo, mutation: { ...mutation, attempts, ...(attempts > 0 ? { status: 'failed' as const } : {}) } };
}
const record = (repo: Awaited<ReturnType<typeof queued>>['repo'], mutation: Awaited<ReturnType<typeof queued>>['mutation'], reason: PregnancyFailureReason, attempted = true) =>
  recordPregnancySyncFailure(repo, mutation, reason, attempted, NOW, () => 1);
const stored = async (repo: Awaited<ReturnType<typeof queued>>['repo']) => (await repo.hydrate())!;

describe('APP-076 B2B1 durable consequences of a failed Pregnancy send', () => {
  it('revision_conflict and parent_unavailable are blocked, flagged as awaiting reconciliation, never scheduled, never terminal', async () => {
    for (const reason of ['revision-conflict', 'parent-unavailable'] as const) {
      const { repo, mutation } = await queued();
      await expect(record(repo, mutation, reason)).resolves.toEqual({ recorded: true, recoveryRequired: false, needsInbound: true });
      const item = (await stored(repo)).sync.mutations[0];
      expect(item).toMatchObject({ status: 'failed', attempts: 1, awaiting: reason });
      expect(item.nextRetryAt).toBeUndefined();
      expect(item.terminalReason).toBeUndefined();
      expect((await stored(repo)).sync.halt).toBeNull();
      await withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.clear(); await clearPregnancyHealthEncryptionKey(); });
    }
  });

  it('mutation_id_conflict and an unknown conflict persist the halt and the failure in one commit, payload-free', async () => {
    for (const reason of ['mutation-id-conflict', 'unknown-conflict'] as const) {
      const { repo, mutation } = await queued();
      const counter = { writes: 0 }; const original = AsyncStorage.setItem;
      (AsyncStorage as { setItem: unknown }).setItem = async (name: string, value: string) => { counter.writes += 1; return original(name, value); };
      await expect(record(repo, mutation, reason)).resolves.toEqual({ recorded: true, recoveryRequired: true, needsInbound: false });
      (AsyncStorage as { setItem: unknown }).setItem = original;
      expect(counter.writes).toBe(1);
      const state = await stored(repo);
      expect(state.sync.halt).toMatchObject({ kind: 'recovery-required', cause: reason });
      expect(Object.keys(state.sync.halt!).sort()).toEqual(['cause', 'kind', 'recordedAt']);
      expect(state.sync.mutations[0]).toMatchObject({ mutationId: mutation.mutationId, status: 'failed' });
      expect(state.sync.mutations[0].nextRetryAt).toBeUndefined();
      await withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.clear(); await clearPregnancyHealthEncryptionKey(); });
    }
  });

  it('a second halt never overwrites the first cause', async () => {
    const { repo, mutation } = await queued();
    await record(repo, mutation, 'mutation-id-conflict');
    const other = await repo.commitLocalMutation((domain) => { domain.pregnancies['b0000000-0000-4000-8000-000000000009'] = { id: 'b0000000-0000-4000-8000-000000000009', method: 'lmp', createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z', revision: 1 }; }, {
      entityType: 'pregnancy', entityId: 'b0000000-0000-4000-8000-000000000009', operation: 'upsert', payload: { method: 'lmp' }, consentId: 'c1',
    });
    await record(repo, other, 'unknown-conflict');
    expect((await stored(repo)).sync.halt?.cause).toBe('mutation-id-conflict');
  });

  it('a completed transient attempt backs off and counts; a request never dispatched waits one interval without counting', async () => {
    const { repo, mutation } = await queued(2);
    await record(repo, mutation, 'unavailable', true);
    const completed = (await stored(repo)).sync.mutations[0];
    expect(completed.attempts).toBe(3);
    expect(Date.parse(completed.nextRetryAt!)).toBeGreaterThan(NOW);
    await withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.clear(); await clearPregnancyHealthEncryptionKey(); });
    const second = await queued(2);
    await record(second.repo, second.mutation, 'unavailable', false);
    const undispatched = (await stored(second.repo)).sync.mutations[0];
    expect(undispatched.attempts).toBe(2);
    expect(Date.parse(undispatched.nextRetryAt!)).toBeGreaterThan(NOW);
  });

  it('validation and authorization stay blocked without a retry time; consent-required stays terminal evidence', async () => {
    for (const reason of ['validation', 'authorization'] as const) {
      const { repo, mutation } = await queued();
      await record(repo, mutation, reason);
      const item = (await stored(repo)).sync.mutations[0];
      expect(item).toMatchObject({ status: 'failed', attempts: 1 });
      expect(item.nextRetryAt).toBeUndefined(); expect(item.terminalReason).toBeUndefined(); expect(item.awaiting).toBeUndefined();
      await withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.clear(); await clearPregnancyHealthEncryptionKey(); });
    }
    const { repo, mutation } = await queued();
    await record(repo, mutation, 'consent-required');
    expect((await stored(repo)).sync.mutations[0]).toMatchObject({ terminalReason: 'consent-required', consentId: 'c1', status: 'failed' });
  });

  it('records nothing for a stale account or an already-terminal mutation', async () => {
    const { repo, mutation } = await queued();
    active = 'someone-else';
    await expect(record(repo, mutation, 'mutation-id-conflict')).resolves.toEqual({ recorded: false, recoveryRequired: false, needsInbound: false });
    active = ACCOUNT;
    expect((await stored(repo)).sync.halt).toBeNull();
    await record(repo, mutation, 'consent-required');
    await expect(record(repo, mutation, 'mutation-id-conflict')).resolves.toEqual({ recorded: false, recoveryRequired: false, needsInbound: false });
    expect((await stored(repo)).sync.halt).toBeNull();
  });
});
