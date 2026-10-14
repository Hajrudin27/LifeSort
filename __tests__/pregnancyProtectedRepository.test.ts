import AsyncStorage from '@react-native-async-storage/async-storage';

const mockSecure = new Map<string, string>();
let mockFailSecureRead = false;
let mockFailSecureWrite = false;
let mockGenerated = 0;

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn((key: string) => {
    if (mockFailSecureRead) return Promise.reject(new Error('unavailable'));
    return Promise.resolve(mockSecure.get(key) ?? null);
  }),
  setItemAsync: jest.fn((key: string, value: string) => {
    if (mockFailSecureWrite) return Promise.reject(new Error('unavailable'));
    mockSecure.set(key, value); return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => { mockSecure.delete(key); return Promise.resolve(); }),
}));

jest.mock('expo-crypto', () => {
  const crypto = require('crypto');
  class AESEncryptionKey {
    constructor(private readonly mockRaw: Buffer) {}
    static async generate() { mockGenerated += 1; return new AESEncryptionKey(crypto.randomBytes(32)); }
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

import { clearPregnancyHealthEncryptionKey, readEncryptedPregnancyPayload, withPregnancyHealthEncryptedStorageCleanup, writeEncryptedPregnancyPayload } from '@/core/storage/pregnancyHealthEncryptedStorage';
import { createInitialPregnancyProtectedState, createPregnancyProtectedRepository, pregnancyMutationIsAutomaticallyEligible, PregnancyProtectedRepositoryError } from '@/core/pregnancy/protectedRepository';
import { PREGNANCY_HEALTH_STORAGE } from '@/core/storage/pregnancyHealthStorageContract';

const ACCOUNT = 'account-a';
const key = PREGNANCY_HEALTH_STORAGE.asyncStorageKey;
const mutation = { entityType: 'pregnancy' as const, entityId: 'pregnancy-1', operation: 'upsert' as const, payload: { method: 'lmp', notes: 'private pregnancy note' }, consentId: 'consent-a' };
const pregnancy = { id: 'pregnancy-1', method: 'lmp' as const, lmpDate: '2026-10-01', createdAt: '2026-10-01T00:00:00.000Z', revision: 1, updatedAt: '2026-10-01T00:00:00.000Z' };

beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks(); mockSecure.clear(); mockFailSecureRead = false; mockFailSecureWrite = false; mockGenerated = 0;
  await withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.clear(); await clearPregnancyHealthEncryptionKey(); });
});

async function initialized() {
  const repo = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT });
  await repo.initialize(createInitialPregnancyProtectedState(ACCOUNT));
  return repo;
}

describe('APP-076 Phase B1 protected Pregnancy substrate', () => {
  it('encrypts a complete protected dataset and never exposes sensitive values in raw storage', async () => {
    const repo = await initialized();
    await repo.commitLocalMutation((domain) => {
      domain.pregnancies[pregnancy.id] = pregnancy;
      return domain;
    }, mutation);
    const raw = await AsyncStorage.getItem(key);
    expect(raw).toContain('__lifesort_encrypted_pregnancy_store__');
    for (const value of ['2026-10-01', 'private pregnancy note', 'lmp', 'pregnancy-1']) expect(raw).not.toContain(value);
    const crypto = require('expo-crypto');
    const encryptOptions = crypto.aesEncryptAsync.mock.calls.at(-1)[2];
    expect(new TextDecoder().decode(encryptOptions.additionalData)).toBe('lifesort-pregnancy:v1');
    expect(encryptOptions).toMatchObject({ nonce: { length: 12 }, tagLength: 16 });
    expect(require('expo-secure-store').setItemAsync).toHaveBeenCalledWith(
      PREGNANCY_HEALTH_STORAGE.secureStoreKey,
      expect.any(String),
      { keychainAccessible: 1 },
    );
    expect((await repo.hydrate())?.domain.pregnancies[pregnancy.id]).toEqual(pregnancy);
  });

  it('uses fresh ciphertext for equivalent protected writes', async () => {
    const payload = JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT));
    await writeEncryptedPregnancyPayload(payload); const first = await AsyncStorage.getItem(key);
    await writeEncryptedPregnancyPayload(payload); const second = await AsyncStorage.getItem(key);
    expect(first).not.toBe(second); await expect(readEncryptedPregnancyPayload()).resolves.toBe(payload);
  });

  it.each([
    ['plaintext', JSON.stringify({ version: 1, state: {} }), 'unexpected-plaintext'],
    ['malformed outer', JSON.stringify({ marker: '__lifesort_encrypted_pregnancy_store__', version: 1 }), 'envelope-malformed'],
    ['future outer', JSON.stringify({ marker: '__lifesort_encrypted_pregnancy_store__', version: 2, algorithm: 'AES-256-GCM', ivLength: 12, tagLength: 16, ciphertext: 'x' }), 'envelope-unsupported-version'],
  ])('fails closed for %s', async (_label, raw, code) => {
    await AsyncStorage.setItem(key, raw);
    await expect(readEncryptedPregnancyPayload()).rejects.toMatchObject({ code });
    await expect(writeEncryptedPregnancyPayload(JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT)))).rejects.toMatchObject({ code: 'write-blocked-after-protected-failure' });
    expect(await AsyncStorage.getItem(key)).toBe(raw);
  });

  it('fails authentication for corrupted ciphertext and rejects malformed SecureStore keys', async () => {
    await writeEncryptedPregnancyPayload(JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT)));
    const outer = JSON.parse((await AsyncStorage.getItem(key))!);
    outer.ciphertext = `${outer.ciphertext.slice(0, -1)}${outer.ciphertext.endsWith('A') ? 'B' : 'A'}`;
    await AsyncStorage.setItem(key, JSON.stringify(outer));
    await expect(readEncryptedPregnancyPayload()).rejects.toMatchObject({ code: 'ciphertext-authentication-failed' });

    await withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.clear(); await clearPregnancyHealthEncryptionKey(); });
    await writeEncryptedPregnancyPayload(JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT)));
    mockSecure.set(PREGNANCY_HEALTH_STORAGE.secureStoreKey, 'malformed');
    await expect(readEncryptedPregnancyPayload()).rejects.toMatchObject({ code: 'key-invalid' });
  });

  it('fails closed when native SecureStore is unavailable', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    try {
      await expect(writeEncryptedPregnancyPayload(JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT)))).rejects.toMatchObject({ code: 'secure-store-unavailable' });
    } finally {
      if (descriptor) Object.defineProperty(Platform, 'OS', descriptor);
    }
  });

  it('does not generate a replacement key for existing ciphertext', async () => {
    await writeEncryptedPregnancyPayload(JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT)));
    await clearPregnancyHealthEncryptionKey(); const before = mockGenerated;
    await expect(writeEncryptedPregnancyPayload(JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT)))).rejects.toMatchObject({ code: 'key-missing' });
    expect(mockGenerated).toBe(before);
    await expect(writeEncryptedPregnancyPayload(JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT)))).rejects.toMatchObject({ code: 'write-blocked-after-protected-failure' });
  });

  it('fails safely for key read and creation failures', async () => {
    mockFailSecureWrite = true;
    await expect(writeEncryptedPregnancyPayload(JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT)))).rejects.toMatchObject({ code: 'key-creation-failed' });
    mockFailSecureWrite = false; await writeEncryptedPregnancyPayload(JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT)));
    mockFailSecureRead = true; await expect(readEncryptedPregnancyPayload()).rejects.toMatchObject({ code: 'key-read-failed' });
  });

  it('atomically commits canonical state and durable intent, preserving exact mutation identity through a new handle', async () => {
    const repo = await initialized();
    const set = jest.spyOn(AsyncStorage, 'setItem'); set.mockClear();
    const queued = await repo.commitLocalMutation((domain) => { domain.pregnancies[pregnancy.id] = pregnancy; return domain; }, mutation);
    expect(set).toHaveBeenCalledTimes(1);
    const restarted = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT });
    const state = await restarted.hydrate();
    expect(state?.domain.pregnancies[pregnancy.id]).toEqual(pregnancy);
    expect(state?.sync.mutations).toEqual([queued]);
    expect(queued.mutationId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('keeps the previous accepted dataset when the one commit write fails', async () => {
    const repo = await initialized();
    const before = await repo.hydrate();
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(repo.commitLocalMutation((domain) => { domain.pregnancies[pregnancy.id] = pregnancy; return domain; }, mutation)).rejects.toThrow('disk full');
    await expect(createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT }).hydrate()).resolves.toEqual(before);
  });

  it('keeps the previous accepted dataset when encryption fails before durable write', async () => {
    const repo = await initialized();
    const before = await repo.hydrate();
    require('expo-crypto').aesEncryptAsync.mockRejectedValueOnce(new Error('encryption failed'));
    await expect(repo.commitLocalMutation((domain) => { domain.pregnancies[pregnancy.id] = pregnancy; return domain; }, mutation)).rejects.toMatchObject({ code: 'ciphertext-authentication-failed' });
    await expect(createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT }).hydrate()).resolves.toEqual(before);
  });

  it('enforces account and epoch-bound handles', async () => {
    let active = ACCOUNT; const repo = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => active });
    await repo.initialize(createInitialPregnancyProtectedState(ACCOUNT, 3));
    active = 'account-b'; await expect(repo.list()).rejects.toBeInstanceOf(PregnancyProtectedRepositoryError);
    await expect(createPregnancyProtectedRepository({ accountId: 'account-b', getActiveAccount: () => 'account-b' }).hydrate()).rejects.toMatchObject({ code: 'account-mismatch' });
    const staleEpoch = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT, datasetEpoch: 2 });
    await expect(staleEpoch.list()).rejects.toMatchObject({ code: 'dataset-epoch-mismatch' });
  });

  it('changes epoch only through a protected transaction and invalidates the old handle', async () => {
    const repo = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT, datasetEpoch: 0 });
    await repo.initialize(createInitialPregnancyProtectedState(ACCOUNT, 0));
    const unpinnedHandle = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT });
    await repo.rebaseline();
    await expect(repo.list()).rejects.toMatchObject({ code: 'dataset-epoch-mismatch' });
    await expect(unpinnedHandle.list()).rejects.toMatchObject({ code: 'dataset-epoch-mismatch' });
    await expect(createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT, datasetEpoch: 1 }).hydrate()).resolves.toMatchObject({ datasetEpoch: 1 });
  });

  it('keeps consent IDs immutable, makes withdrawal terminal, and leaves deletes eligible', async () => {
    const repo = await initialized(); const queued = await repo.commitLocalMutation((domain) => { domain.pregnancies[pregnancy.id] = pregnancy; return domain; }, mutation);
    const deleted = await repo.commitLocalMutation((state) => state, { entityType: 'log', entityId: 'log-1', operation: 'delete' });
    await repo.withdrawConsent('consent-a'); const state = await repo.hydrate();
    const withdrawn = state!.sync.mutations.find((item) => item.mutationId === queued.mutationId)!;
    expect(withdrawn).toMatchObject({ consentId: 'consent-a', status: 'failed', terminalReason: 'consent-withdrawn' });
    expect(withdrawn.nextRetryAt).toBeUndefined();
    const deleteItem = state!.sync.mutations.find((item) => item.mutationId === deleted.mutationId)!;
    expect(deleteItem).toMatchObject({ operation: 'delete', status: 'pending' });
    expect(deleteItem.consentId).toBeUndefined();
    await expect(repo.updateMetadata(queued.mutationId, { status: 'pending' })).resolves.toBe(false);
    const terminal = (await repo.hydrate())!.sync.mutations.find((item) => item.mutationId === queued.mutationId)!;
    expect(terminal.terminalReason).toBe('consent-withdrawn');
    expect(pregnancyMutationIsAutomaticallyEligible(terminal)).toBe(false);
    const regranted = await repo.commitLocalMutation((state) => state, { ...mutation, consentId: 'consent-b' });
    expect(regranted.mutationId).not.toBe(queued.mutationId);
    expect((await repo.list()).find((item) => item.mutationId === queued.mutationId)?.consentId).toBe('consent-a');
  });

  it('acknowledges queue work durably and rejects malformed protected state', async () => {
    const repo = await initialized(); const queued = await repo.commitLocalMutation((domain) => { domain.pregnancies[pregnancy.id] = pregnancy; return domain; }, mutation);
    await repo.updateMetadata(queued.mutationId, { status: 'failed', attempts: 2, nextRetryAt: '2026-10-02T00:00:00.000Z' });
    expect((await createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT }).list())[0]).toMatchObject({ attempts: 2, status: 'failed', nextRetryAt: '2026-10-02T00:00:00.000Z' });
    await repo.acknowledge(queued.mutationId); expect(await createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT }).list()).toEqual([]);
    await writeEncryptedPregnancyPayload(JSON.stringify({ ...createInitialPregnancyProtectedState(ACCOUNT), datasetEpoch: -1 }));
    await expect(createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT }).hydrate()).rejects.toMatchObject({ code: 'invalid-protected-state' });
  });

  it('requires a bound canonical state and consent shape for every new UPSERT', async () => {
    const repo = await initialized();
    await expect(repo.commitLocalMutation((state) => state, mutation)).rejects.toMatchObject({ code: 'invalid-protected-state' });
    await expect(repo.commitLocalMutation((domain) => { domain.pregnancies[pregnancy.id] = pregnancy; return domain; }, { ...mutation, consentId: undefined })).rejects.toMatchObject({ code: 'invalid-protected-state' });
    await expect(repo.commitLocalMutation((state) => state, { entityType: 'log', entityId: 'log-1', operation: 'delete', consentId: 'not-allowed' } as never)).rejects.toMatchObject({ code: 'invalid-protected-state' });
  });

  it('cleanup revokes active handles and removes ciphertext, key, queue, cursor and tombstones together', async () => {
    const seed = createInitialPregnancyProtectedState(ACCOUNT);
    seed.sync.nextChangeSeq = 9; seed.tombstones.deleted = { entityType: 'log', entityId: 'log-1', revision: 2 };
    const repo = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT }); await repo.initialize(seed);
    await repo.commitLocalMutation((domain) => { domain.pregnancies[pregnancy.id] = pregnancy; return domain; }, mutation);
    await withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.removeItem(key); await clearPregnancyHealthEncryptionKey(); });
    await expect(repo.list()).rejects.toMatchObject({ code: 'dataset-epoch-mismatch' });
    expect(await AsyncStorage.getItem(key)).toBeNull(); expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(false);
  });

  it('does not publish delayed hydration or recreate ciphertext after cleanup starts', async () => {
    const repo = await initialized();
    let releaseRead!: () => void;
    let reading!: () => void;
    const enteredRead = new Promise<void>((resolve) => { reading = resolve; });
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const getItem = AsyncStorage.getItem as jest.Mock;
    const originalGet = getItem.getMockImplementation()!;
    getItem.mockImplementationOnce(async (...args: [string]) => { reading(); await readGate; return originalGet(...args); });
    const hydration = repo.hydrate();
    await enteredRead;
    const cleanup = withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.removeItem(key); await clearPregnancyHealthEncryptionKey(); });
    releaseRead();
    await expect(hydration).rejects.toBeDefined();
    await cleanup;

    await withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.clear(); await clearPregnancyHealthEncryptionKey(); });
    let releaseWrite!: () => void;
    let writing!: () => void;
    const enteredWrite = new Promise<void>((resolve) => { writing = resolve; });
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const setItem = AsyncStorage.setItem as jest.Mock;
    const originalSet = setItem.getMockImplementation()!;
    setItem.mockImplementationOnce(async (...args: [string, string]) => { writing(); await writeGate; return originalSet(...args); });
    const write = writeEncryptedPregnancyPayload(JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT)));
    await enteredWrite;
    const cleanupDuringWrite = withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.removeItem(key); await clearPregnancyHealthEncryptionKey(); });
    releaseWrite();
    await expect(write).rejects.toMatchObject({ code: 'write-invalidated-by-cleanup' });
    await cleanupDuringWrite;
    expect(await AsyncStorage.getItem(key)).toBeNull();
  });

  it('invalidates key creation that finishes after cleanup begins', async () => {
    let release!: () => void;
    let storing!: () => void;
    const entered = new Promise<void>((resolve) => { storing = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const secureStore = require('expo-secure-store');
    const original = secureStore.setItemAsync.getMockImplementation();
    secureStore.setItemAsync.mockImplementationOnce(async (...args: [string, string]) => { storing(); await gate; return original(...args); });
    const write = writeEncryptedPregnancyPayload(JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT)));
    await entered;
    const cleanup = withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.removeItem(key); await clearPregnancyHealthEncryptionKey(); });
    release();
    await expect(write).rejects.toMatchObject({ code: 'key-creation-invalidated' });
    await cleanup;
    expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(false);
  });
});

// --- Independent hostile-review additions (APP-076 B1) -----------------------------------------------------------
// Each case below killed a mutant that the suite above let survive, or pins a fix made during that review.
const add = (value: any) => { const domain = value.domain ?? value; domain.pregnancies[pregnancy.id] = pregnancy; return value; };
const initial = (epoch = 0): any => createInitialPregnancyProtectedState(ACCOUNT, epoch);
const seedRaw = (state: unknown) => writeEncryptedPregnancyPayload(JSON.stringify(state));
function gate(target: jest.Mock) {
  let entered!: () => void; let release!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; }); const gatePromise = new Promise<void>((resolve) => { release = resolve; });
  const original = target.getMockImplementation()!;
  target.mockImplementationOnce(async (...args: unknown[]) => { entered(); await gatePromise; return original(...args); });
  return { entered: enteredPromise, release };
}

describe('APP-076 B1 hostile review: serialization, atomicity and publication', () => {
  it('has no public generic transact escape hatch and serializes concurrent local commits', async () => {
    const a = await initialized(); const b = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT });
    expect((a as Record<string, unknown>).transact).toBeUndefined();
    const commit = (repo: typeof a, id: string) => repo.commitLocalMutation((domain) => {
      domain.pregnancies[id] = { ...pregnancy, id };
      return domain;
    }, { ...mutation, entityId: id });
    await Promise.all([commit(a, 'p-1'), commit(b, 'p-2'), commit(a, 'p-3'), commit(b, 'p-4')]);
    expect((await a.hydrate())!.sync.mutations).toHaveLength(4);
  });

  it('never reports a commit before the durable write completes', async () => {
    const repo = await initialized(); const held = gate(AsyncStorage.setItem as jest.Mock);
    let settled = false; const commit = repo.commitLocalMutation(add, mutation); commit.then(() => { settled = true; }, () => { settled = true; });
    await held.entered; await new Promise((resolve) => setTimeout(resolve, 5)); expect(settled).toBe(false);
    held.release(); await commit; expect(settled).toBe(true);
  });

  it('returns exactly what was persisted, not a caller-owned state mutated during the write', async () => {
    const repo = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT }); const state = initial(); const held = gate(AsyncStorage.setItem as jest.Mock);
    const pending = repo.initialize(state); await held.entered; state.sync.nextChangeSeq = 99; held.release();
    expect((await pending).sync.nextChangeSeq).toBe(0); expect((await repo.hydrate())!.sync.nextChangeSeq).toBe(0);
  });

  it('hands out snapshots: editing a returned mutation or listed payload never reaches storage', async () => {
    const repo = await initialized(); const queued = await repo.commitLocalMutation(add, mutation);
    (queued.payload as any).method = 'tampered'; (await repo.list())[0].payload!.method = 'tampered-again';
    expect((await repo.list())[0].payload).toEqual(mutation.payload);
  });

  it('does not let a caller-supplied terminal or retry field create a pre-failed mutation', async () => {
    const repo = await initialized();
    const queued = await repo.commitLocalMutation(add, { ...mutation, terminalReason: 'consent-withdrawn', nextRetryAt: '2026-10-02T00:00:00.000Z', status: 'failed', attempts: 7 } as never);
    expect(queued).toMatchObject({ status: 'pending', attempts: 0 }); expect(queued.terminalReason).toBeUndefined(); expect(queued.nextRetryAt).toBeUndefined();
  });

  it('gives local callbacks only a domain draft, preserving every protected metadata field and queued mutation', async () => {
    const seed = initial(); seed.sync.nextChangeSeq = 7; seed.sync.consent.activeConsentIdsByPurpose.health = 'consent-old'; seed.tombstones.old = { entityType: 'log', entityId: 'old', revision: 1 };
    seed.sync.mutations = [{ mutationId: 'old-mutation', ...mutation, createdAt: '2026-10-02T00:00:00.000Z', status: 'pending', attempts: 0 }];
    const repo = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT }); await repo.initialize(seed);
    await repo.commitLocalMutation((domain) => {
      // @ts-expect-error Local mutation callbacks are intentionally domain-only.
      void domain.sync;
      // @ts-expect-error Local mutation callbacks cannot reach account metadata.
      void domain.accountId;
      // @ts-expect-error Local mutation callbacks cannot reach epoch metadata.
      void domain.datasetEpoch;
      // @ts-expect-error Local mutation callbacks cannot reach tombstones.
      void domain.tombstones;
      expect((domain as Record<string, unknown>).sync).toBeUndefined();
      expect((domain as Record<string, unknown>).accountId).toBeUndefined();
      expect((domain as Record<string, unknown>).datasetEpoch).toBeUndefined();
      expect((domain as Record<string, unknown>).tombstones).toBeUndefined();
      domain.pregnancies[pregnancy.id] = pregnancy;
      return domain;
    }, mutation);
    const persisted = await repo.hydrate();
    expect(persisted).toMatchObject({ accountId: ACCOUNT, datasetEpoch: 0, sync: { nextChangeSeq: 7, consent: { activeConsentIdsByPurpose: { health: 'consent-old' } } }, tombstones: { old: { entityId: 'old' } } });
    expect(persisted!.sync.mutations.map((item) => item.mutationId)).toEqual(['old-mutation', expect.any(String)]);
  });

  it('severs callback-held domain references after validation and before persistence', async () => {
    const repo = await initialized();
    let retained!: { pregnancies: Record<string, typeof pregnancy> };
    await repo.commitLocalMutation((domain) => {
      retained = domain as typeof retained;
      domain.pregnancies[pregnancy.id] = pregnancy;
      return domain;
    }, mutation);
    delete retained.pregnancies[pregnancy.id];
    retained.pregnancies['after-return'] = { ...pregnancy, id: 'after-return' };
    const persisted = await repo.hydrate();
    expect(persisted!.domain.pregnancies).toEqual({ [pregnancy.id]: pregnancy });
    expect(persisted!.sync.mutations).toHaveLength(1);
  });

  it('queues a rebaseline behind an encrypting commit: the commit lands, then the epoch advances with an empty queue', async () => {
    const repo = await initialized(); const held = gate(require('expo-crypto').aesEncryptAsync);
    const commit = repo.commitLocalMutation(add, mutation); await held.entered;
    const rebased = repo.rebaseline(); held.release();
    await expect(commit).resolves.toBeDefined(); expect((await rebased).datasetEpoch).toBe(1);
    const persisted = await createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT, datasetEpoch: 1 }).hydrate();
    expect(persisted!.sync.mutations).toEqual([]); expect(persisted!.domain.pregnancies).toEqual({});
    await expect(repo.list()).rejects.toMatchObject({ code: 'dataset-epoch-mismatch' });
  });

  it('does not tell the caller a commit succeeded when the account switched while it was encrypting', async () => {
    let active = ACCOUNT; const repo = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => active });
    await repo.initialize(initial()); const held = gate(require('expo-crypto').aesEncryptAsync);
    const commit = repo.commitLocalMutation(add, mutation); await held.entered; active = 'account-b'; held.release();
    await expect(commit).rejects.toMatchObject({ code: 'account-mismatch' });
  });

  it('rejects the caller, removes the ciphertext and kills the handle when cleanup starts just after setItem resolves', async () => {
    const repo = await initialized(); const setItem = AsyncStorage.setItem as jest.Mock; const original = setItem.getMockImplementation()!;
    let cleanup!: Promise<void>;
    setItem.mockImplementationOnce(async (...args: unknown[]) => {
      const result = await original(...args);
      cleanup = withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.removeItem(key); await clearPregnancyHealthEncryptionKey(); });
      return result;
    });
    await expect(repo.commitLocalMutation(add, mutation)).rejects.toBeDefined(); await cleanup;
    expect(await AsyncStorage.getItem(key)).toBeNull(); expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(false);
    await expect(repo.list()).rejects.toMatchObject({ code: 'dataset-epoch-mismatch' });
  });

  it('never overwrites a valid dataset when two handles initialize concurrently', async () => {
    const a = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT }); const b = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT });
    const second = initial(); second.sync.nextChangeSeq = 7;
    const results = await Promise.allSettled([a.initialize(initial()), b.initialize(second)]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']); expect((await a.hydrate())!.sync.nextChangeSeq).toBe(0);
  });
});

describe('APP-076 B1 hostile review: key and ciphertext lifecycle', () => {
  it('with the key gone, every repository operation fails closed without a replacement key or any write', async () => {
    const repo = await initialized(); await repo.commitLocalMutation(add, mutation);
    const before = await AsyncStorage.getItem(key); mockSecure.delete(PREGNANCY_HEALTH_STORAGE.secureStoreKey); const generated = mockGenerated;
    const handle = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT });
    const operations = [() => handle.hydrate(), () => handle.list(), () => handle.initialize(initial()), () => handle.rebaseline(), () => handle.commitLocalMutation(add, mutation),
      () => handle.withdrawConsent('c'), () => handle.acknowledge('x'), () => handle.updateMetadata('x', {})];
    for (const operation of operations) await expect(operation()).rejects.toMatchObject({ code: 'key-missing' });
    expect(await AsyncStorage.getItem(key)).toBe(before); expect(mockGenerated).toBe(generated); expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(false);
  });

  it.each([
    ['corrupt ciphertext', (outer: any) => JSON.stringify({ ...outer, ciphertext: `${outer.ciphertext.slice(0, -1)}${outer.ciphertext.endsWith('A') ? 'B' : 'A'}` }), 'ciphertext-authentication-failed'],
    ['plaintext JSON', () => JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT)), 'unexpected-plaintext'],
  ])('a direct write cannot replace %s even when no earlier read failed', async (_label, tamper, code) => {
    await writeEncryptedPregnancyPayload(JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT)));
    const damaged = tamper(JSON.parse((await AsyncStorage.getItem(key))!)); await AsyncStorage.setItem(key, damaged);
    await expect(writeEncryptedPregnancyPayload(JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT)))).rejects.toMatchObject({ code });
    expect(await AsyncStorage.getItem(key)).toBe(damaged);
  });

  it.each([
    ['empty ciphertext', { ciphertext: '' }], ['wrong algorithm', { algorithm: 'AES-128-CBC' }], ['wrong iv length', { ivLength: 16 }], ['wrong tag length', { tagLength: 12 }],
  ])('rejects an outer envelope with %s before touching the key', async (_label, patch) => {
    const outer = { marker: '__lifesort_encrypted_pregnancy_store__', version: 1, algorithm: 'AES-256-GCM', ivLength: 12, tagLength: 16, ciphertext: 'AAAA', ...patch };
    await AsyncStorage.setItem(key, JSON.stringify(outer));
    await expect(readEncryptedPregnancyPayload()).rejects.toMatchObject({ code: 'envelope-malformed' });
    expect(mockGenerated).toBe(0); expect(require('expo-secure-store').getItemAsync).not.toHaveBeenCalled();
  });

  it('an in-flight write is rejected and its ciphertext removed when only the key is deleted', async () => {
    const held = gate(AsyncStorage.setItem as jest.Mock);
    const write = writeEncryptedPregnancyPayload(JSON.stringify(createInitialPregnancyProtectedState(ACCOUNT))); await held.entered;
    const deletion = clearPregnancyHealthEncryptionKey(); held.release();
    await expect(write).rejects.toMatchObject({ code: expect.stringMatching(/^write-invalidated-by-/) }); await deletion;
    expect(await AsyncStorage.getItem(key)).toBeNull(); expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(false);
  });
});

describe('APP-076 B1 hostile review: queue, consent and withdrawal', () => {
  it('does not accept a settings delete: settings are one upsert-only row per account', async () => {
    const repo = await initialized();
    await expect(repo.commitLocalMutation((state) => state, { entityType: 'settings', entityId: 'settings', operation: 'delete' })).rejects.toMatchObject({ code: 'invalid-protected-state' });
    const settings = { recoveryDisplayDays: 42, privacyMode: false, revision: 1, updatedAt: '2026-10-01T00:00:00.000Z' };
    await expect(repo.commitLocalMutation((domain) => { domain.settings = settings; return domain; }, { entityType: 'settings', entityId: 'settings', operation: 'upsert', payload: { recoveryDisplayDays: 42 }, consentId: 'consent-a' })).resolves.toMatchObject({ entityType: 'settings' });
    expect((await repo.list()).filter((item) => item.operation === 'delete')).toEqual([]);
  });

  it('records the withdrawn consent id and never lets it bind a new upsert', async () => {
    const repo = await initialized(); await repo.withdrawConsent('consent-w');
    expect((await repo.hydrate())!.sync.consent.withdrawnConsentIds).toEqual({ 'consent-w': true });
    await expect(repo.commitLocalMutation(add, { ...mutation, consentId: 'consent-w' })).rejects.toMatchObject({ code: 'invalid-protected-state' });
    expect(await repo.list()).toEqual([]);
  });

  it('fails the whole dataset closed if an upsert under a withdrawn consent is not terminal', async () => {
    const state = add(initial()); state.sync.consent.withdrawnConsentIds['consent-a'] = true;
    state.sync.mutations = [{ mutationId: 'm1', ...mutation, createdAt: '2026-10-02T00:00:00.000Z', status: 'pending', attempts: 0 }];
    await seedRaw(state);
    await expect(createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT }).hydrate()).rejects.toMatchObject({ code: 'invalid-protected-state' });
  });

  it('fails the dataset closed for a terminal mutation that is pending, scheduled, or a delete', async () => {
    for (const patch of [{ status: 'pending' }, { nextRetryAt: '2026-10-02T00:00:00.000Z' }]) {
      await withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.clear(); await clearPregnancyHealthEncryptionKey(); });
      const state = add(initial()); state.sync.consent.withdrawnConsentIds['consent-a'] = true;
      state.sync.mutations = [{ mutationId: 'm1', ...mutation, createdAt: '2026-10-02T00:00:00.000Z', status: 'failed', attempts: 1, terminalReason: 'consent-withdrawn', ...patch }];
      await seedRaw(state);
      await expect(createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT }).hydrate()).rejects.toMatchObject({ code: 'invalid-protected-state' });
    }
  });

  it('cannot rebind mutation identity, entity, payload, consent or terminal state through a metadata update, even at runtime', async () => {
    const repo = await initialized(); const queued = await repo.commitLocalMutation(add, mutation);
    await repo.updateMetadata(queued.mutationId, { consentId: 'x', payload: { a: 1 }, entityId: 'other', mutationId: 'zzz', terminalReason: 'consent-withdrawn', status: 'failed', attempts: 3 } as never);
    const [item] = await repo.list();
    expect(item).toMatchObject({ mutationId: queued.mutationId, consentId: 'consent-a', entityId: 'pregnancy-1', status: 'failed', attempts: 3 });
    expect(item.payload).toEqual(mutation.payload); expect(item.terminalReason).toBeUndefined();
  });

  it.each([0, 1])('wins withdrawal over a racing metadata update (order %s): terminal, no retry time, never eligible', async (order) => {
    const repo = await initialized(); const queued = await repo.commitLocalMutation(add, mutation);
    const withdraw = () => repo.withdrawConsent('consent-a');
    const update = () => repo.updateMetadata(queued.mutationId, { status: 'failed', attempts: 1, nextRetryAt: '2026-10-02T00:00:00.000Z' });
    await Promise.all(order === 0 ? [withdraw(), update()] : [update(), withdraw()]);
    const [item] = await repo.list();
    expect(item).toMatchObject({ terminalReason: 'consent-withdrawn', status: 'failed', consentId: 'consent-a' }); expect(item.nextRetryAt).toBeUndefined();
    expect(pregnancyMutationIsAutomaticallyEligible(item)).toBe(false);
  });

  it('draws every mutation id from the cryptographic UUID source', async () => {
    const repo = await initialized(); const queued = await repo.commitLocalMutation(add, mutation);
    expect(require('expo-crypto').randomUUID).toHaveBeenCalled(); expect(queued.mutationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe('APP-076 B1 hostile review: the decrypted state is validated as a whole', () => {
  const valid = (): any => {
    const state = initial(); state.domain.pregnancies.p1 = { ...pregnancy, id: 'p1' };
    state.domain.symptomLogs.l1 = { id: 'l1', pregnancyId: 'p1', date: '2026-10-02', symptoms: ['nausea'], revision: 1, updatedAt: '2026-10-02T00:00:00.000Z' };
    state.domain.appointments.a1 = { id: 'a1', pregnancyId: 'p1', startsAt: '2026-11-01T10:00:00.000Z', timeZone: 'Europe/Copenhagen', title: 'Scan', completed: false, reminderEnabled: false, revision: 1, updatedAt: '2026-10-02T00:00:00.000Z' };
    state.domain.settings = { recoveryDisplayDays: 42, privacyMode: false, revision: 1, updatedAt: '2026-10-02T00:00:00.000Z' };
    state.sync.mutations = [{ mutationId: 'm1', entityType: 'pregnancy', entityId: 'p1', operation: 'upsert', payload: { x: 1 }, consentId: 'c1', createdAt: '2026-10-02T00:00:00.000Z', status: 'pending', attempts: 0 }];
    state.tombstones.t1 = { entityType: 'log', entityId: 'l9', revision: 2 };
    return state;
  };
  const first = (state: any) => state.sync.mutations[0];
  const cases: Array<[string, (state: any) => void]> = [
    ['version 2', (s) => { s.version = 2; }], ['missing version', (s) => { delete s.version; }], ['blank accountId', (s) => { s.accountId = '  '; }], ['numeric accountId', (s) => { s.accountId = 5; }],
    ['negative epoch', (s) => { s.datasetEpoch = -1; }], ['fractional epoch', (s) => { s.datasetEpoch = 1.5; }], ['string epoch', (s) => { s.datasetEpoch = '1'; }], ['unsafe epoch', (s) => { s.datasetEpoch = 2 ** 53; }],
    ['array pregnancies', (s) => { s.domain.pregnancies = []; }], ['bad pregnancy method', (s) => { s.domain.pregnancies.p1.method = 'x'; }], ['pregnancy revision 0', (s) => { s.domain.pregnancies.p1.revision = 0; }],
    ['pregnancy key/id mismatch', (s) => { s.domain.pregnancies.other = s.domain.pregnancies.p1; }], ['bad pregnancy outcome', (s) => { s.domain.pregnancies.p1.outcome = 'x'; }], ['bad pregnancy updatedAt', (s) => { s.domain.pregnancies.p1.updatedAt = 'nope'; }],
    ['unknown symptom', (s) => { s.domain.symptomLogs.l1.symptoms = ['bogus']; }], ['string weight', (s) => { s.domain.symptomLogs.l1.weightKg = '70'; }], ['log without pregnancyId', (s) => { delete s.domain.symptomLogs.l1.pregnancyId; }],
    ['appointment without timeZone', (s) => { delete s.domain.appointments.a1.timeZone; }], ['bad appointment startsAt', (s) => { s.domain.appointments.a1.startsAt = 'nope'; }], ['string appointment flag', (s) => { s.domain.appointments.a1.completed = 'no'; }],
    ['negative recovery days', (s) => { s.domain.settings.recoveryDisplayDays = -1; }], ['string privacyMode', (s) => { s.domain.settings.privacyMode = 'yes'; }], ['undefined settings', (s) => { delete s.domain.settings; }],
    ['negative cursor', (s) => { s.sync.nextChangeSeq = -1; }], ['fractional cursor', (s) => { s.sync.nextChangeSeq = 1.5; }], ['mutations not an array', (s) => { s.sync.mutations = {}; }],
    ['mutation without id', (s) => { delete first(s).mutationId; }], ['negative attempts', (s) => { first(s).attempts = -1; }], ['unknown operation', (s) => { first(s).operation = 'patch'; }], ['upsert without consent', (s) => { delete first(s).consentId; }],
    ['delete carrying consent', (s) => { first(s).operation = 'delete'; delete first(s).payload; }], ['delete carrying payload', (s) => { first(s).operation = 'delete'; delete first(s).consentId; }],
    ['bad nextRetryAt', (s) => { first(s).nextRetryAt = 'x'; }], ['bad status', (s) => { first(s).status = 'done'; }], ['unknown terminal reason', (s) => { first(s).terminalReason = 'other'; }], ['array payload', (s) => { first(s).payload = []; }],
    ['unknown entityType', (s) => { first(s).entityType = 'consent'; }], ['negative baseRevision', (s) => { first(s).baseRevision = -1; }], ['bad createdAt', (s) => { first(s).createdAt = 'x'; }], ['duplicate mutation id', (s) => { s.sync.mutations.push({ ...first(s) }); }],
    ['settings delete', (s) => { first(s).entityType = 'settings'; first(s).operation = 'delete'; delete first(s).consentId; delete first(s).payload; }],
    ['blank active consent', (s) => { s.sync.consent.activeConsentIdsByPurpose.p = ''; }], ['withdrawn flag false', (s) => { s.sync.consent.withdrawnConsentIds.c = false; }], ['missing consent', (s) => { delete s.sync.consent; }],
    ['settings tombstone', (s) => { s.tombstones.t1.entityType = 'settings'; }], ['tombstone revision 0', (s) => { s.tombstones.t1.revision = 0; }], ['negative tombstone changeSeq', (s) => { s.tombstones.t1.changeSeq = -1; }], ['tombstone without entityId', (s) => { delete s.tombstones.t1.entityId; }], ['tombstone carrying a health payload field', (s) => { s.tombstones.t1.notes = 'private'; }], ['array tombstones', (s) => { s.tombstones = []; }],
  ];
  it('control: the fixture itself is a valid dataset', async () => {
    await seedRaw(valid()); await expect(createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT }).hydrate()).resolves.toMatchObject({ accountId: ACCOUNT });
  });
  it.each(cases)('rejects %s as a whole dataset (no row is silently dropped)', async (_label, mutate) => {
    const state = valid(); mutate(state); await seedRaw(state);
    await expect(createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT }).hydrate()).rejects.toMatchObject({ code: 'invalid-protected-state' });
  });
});

describe('APP-076 B1 hostile review: restart truth and reads racing cleanup', () => {
  it('round-trips state, queue metadata, cursor, tombstones and consent state through a fresh handle (persisted bytes only)', async () => {
    const seed = initial();
    seed.sync.nextChangeSeq = 9; seed.tombstones['log:l9'] = { entityType: 'log', entityId: 'l9', revision: 2, changeSeq: 8 };
    seed.sync.consent.activeConsentIdsByPurpose.pregnancy_health = 'consent-b';
    const repo = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT }); await repo.initialize(seed);
    const queued = await repo.commitLocalMutation((domain) => {
      domain.pregnancies[pregnancy.id] = pregnancy; return domain;
    }, { ...mutation, baseRevision: 3 });
    await repo.updateMetadata(queued.mutationId, { status: 'failed', attempts: 2, nextRetryAt: '2026-10-02T00:00:00.000Z' });
    await repo.withdrawConsent('consent-z');
    const restarted = await createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT, datasetEpoch: 0 }).hydrate();
    expect(restarted).toMatchObject({
      accountId: ACCOUNT, datasetEpoch: 0, domain: { pregnancies: { [pregnancy.id]: pregnancy } },
      sync: { nextChangeSeq: 9, consent: { activeConsentIdsByPurpose: { pregnancy_health: 'consent-b' }, withdrawnConsentIds: { 'consent-z': true } } },
      tombstones: { 'log:l9': { entityType: 'log', entityId: 'l9', revision: 2, changeSeq: 8 } },
    });
    expect(restarted!.sync.mutations).toEqual([{ ...queued, status: 'failed', attempts: 2, nextRetryAt: '2026-10-02T00:00:00.000Z' }]);
    expect(restarted!.sync.mutations[0]).toMatchObject({ baseRevision: 3, consentId: 'consent-a', payload: mutation.payload });
  });

  it('does not publish a hydration whose SecureStore key read is pending when cleanup begins', async () => {
    const repo = await initialized(); const held = gate(require('expo-secure-store').getItemAsync as jest.Mock);
    const hydration = repo.hydrate(); await held.entered;
    const cleanup = withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.removeItem(key); await clearPregnancyHealthEncryptionKey(); });
    held.release();
    await expect(hydration).rejects.toBeDefined(); await cleanup;
    expect(await AsyncStorage.getItem(key)).toBeNull(); expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(false);
  });
});
