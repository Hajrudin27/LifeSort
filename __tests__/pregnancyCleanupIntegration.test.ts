/**
 * APP-076 Phase B1 - the REAL Pregnancy adapter and protected repository driven through clearLocalUserData.
 * (logoutCleanup.test.ts mocks the adapter; this file proves the actual cleanup window, key deletion and
 * fail-closed behaviour after a partial cleanup failure.) The Cycle and document-cache adapters stay mocked.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockSecure = new Map<string, string>();
let mockFailDeleteFor: string | null = null;
let mockGenerated = 0;

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecure.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => { mockSecure.set(key, value); return Promise.resolve(); }),
  deleteItemAsync: jest.fn((key: string) => {
    if (mockFailDeleteFor === key) return Promise.reject(new Error('keychain delete failed'));
    mockSecure.delete(key); return Promise.resolve();
  }),
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

jest.mock('@/core/documents/documentSync', () => ({ clearDocumentSignedUrlCache: jest.fn() }));
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn(() => Promise.resolve()) }));
jest.mock('@/core/storage/cycleHealthEncryptedStorage', () => ({
  clearCycleHealthEncryptionKey: jest.fn(() => Promise.resolve()),
  withCycleHealthEncryptedStorageCleanup: jest.fn((cleanup: () => Promise<unknown>) => cleanup()),
}));
jest.mock('@/core/storage/documentCacheStorage', () => ({
  clearDocumentCacheEncryptionKey: jest.fn(() => Promise.resolve()),
  clearPersistentAttachmentCache: jest.fn(() => Promise.resolve()),
  clearTemporaryAttachmentCache: jest.fn(() => Promise.resolve()),
  withDocumentCacheCleanup: jest.fn((cleanup: () => Promise<unknown>) => cleanup()),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/', getInfoAsync: jest.fn(() => Promise.resolve({ exists: true })), deleteAsync: jest.fn(() => Promise.resolve()),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()), copyAsync: jest.fn(() => Promise.resolve()),
}));

import { clearLocalUserData } from '@/core/auth/clearLocalUserData';
import { createInitialPregnancyProtectedState, createPregnancyProtectedRepository } from '@/core/pregnancy/protectedRepository';
import { clearPregnancyHealthEncryptionKey, withPregnancyHealthEncryptedStorageCleanup } from '@/core/storage/pregnancyHealthEncryptedStorage';
import { PREGNANCY_HEALTH_STORAGE } from '@/core/storage/pregnancyHealthStorageContract';

const ACCOUNT = 'account-a';
const key = PREGNANCY_HEALTH_STORAGE.asyncStorageKey;
const preg = { id: 'pregnancy-1', method: 'lmp' as const, lmpDate: '2026-10-01', createdAt: '2026-10-01T00:00:00.000Z', revision: 1, updatedAt: '2026-10-01T00:00:00.000Z' };
const upsert = { entityType: 'pregnancy' as const, entityId: 'pregnancy-1', operation: 'upsert' as const, payload: { method: 'lmp' }, consentId: 'consent-a' };
const add = (domain: any) => { domain.pregnancies[preg.id] = preg; return domain; };

beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks(); mockSecure.clear(); mockFailDeleteFor = null; mockGenerated = 0;
  await withPregnancyHealthEncryptedStorageCleanup(async () => { await AsyncStorage.clear(); await clearPregnancyHealthEncryptionKey(); });
});

async function populated() {
  const repo = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => ACCOUNT });
  await repo.initialize(createInitialPregnancyProtectedState(ACCOUNT)); await repo.commitLocalMutation(add, upsert);
  return repo;
}

describe('APP-076 B1 real Pregnancy adapter through clearLocalUserData', () => {
  it('logout removes ciphertext and key and kills the old handle', async () => {
    const repo = await populated();
    expect(await AsyncStorage.getItem(key)).not.toBeNull(); expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(true);
    await clearLocalUserData([]);
    expect(await AsyncStorage.getItem(key)).toBeNull(); expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(false);
    await expect(repo.list()).rejects.toMatchObject({ code: 'dataset-epoch-mismatch' });
    await expect(repo.commitLocalMutation(add, upsert)).rejects.toBeDefined();
    expect(await AsyncStorage.getItem(key)).toBeNull(); expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(false);
  });

  it('ciphertext removal fails but key removal succeeds: key-missing fail-closed, no new key, no overwrite', async () => {
    await populated();
    const before = await AsyncStorage.getItem(key);
    const multiRemove = AsyncStorage.multiRemove as jest.Mock; const originalRemove = multiRemove.getMockImplementation()!;
    multiRemove.mockImplementation((keys: string[]) => (keys.includes(key) ? Promise.reject(new Error('disk')) : originalRemove(keys)));
    try { await expect(clearLocalUserData([])).resolves.toBeUndefined(); } finally { multiRemove.mockImplementation(originalRemove); }
    expect(await AsyncStorage.getItem(key)).toBe(before); expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(false);
    const generated = mockGenerated;
    const next = createPregnancyProtectedRepository({ accountId: 'account-b', getActiveAccount: () => 'account-b' });
    await expect(next.hydrate()).rejects.toMatchObject({ code: 'key-missing' });
    await expect(next.initialize(createInitialPregnancyProtectedState('account-b'))).rejects.toMatchObject({ code: 'key-missing' });
    await expect(next.rebaseline()).rejects.toMatchObject({ code: 'key-missing' });
    expect(await AsyncStorage.getItem(key)).toBe(before); expect(mockGenerated).toBe(generated); expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(false);
  });

  it('a commit in flight when logout runs cannot leave ciphertext behind', async () => {
    const repo = await populated();
    const setItem = AsyncStorage.setItem as jest.Mock; const orig = setItem.getMockImplementation()!;
    let entered!: () => void; let release!: () => void; const enteredP = new Promise<void>((r) => { entered = r; }); const gateP = new Promise<void>((r) => { release = r; });
    setItem.mockImplementationOnce(async (...args: unknown[]) => { entered(); await gateP; return orig(...args); });
    const commit = repo.commitLocalMutation((domain) => { domain.pregnancies['pregnancy-2'] = { ...preg, id: 'pregnancy-2' }; return domain; }, { ...upsert, entityId: 'pregnancy-2' });
    await enteredP; const logout = clearLocalUserData([]); release();
    await expect(commit).rejects.toBeDefined(); await logout;
    expect(await AsyncStorage.getItem(key)).toBeNull(); expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(false);
  });

  it('Pregnancy key deletion failure is reported, siblings still attempted, ciphertext already removed', async () => {
    await populated(); mockFailDeleteFor = PREGNANCY_HEALTH_STORAGE.secureStoreKey;
    await expect(clearLocalUserData([])).rejects.toThrow('keychain delete failed');
    expect(await AsyncStorage.getItem(key)).toBeNull();
    const { clearCycleHealthEncryptionKey } = require('@/core/storage/cycleHealthEncryptedStorage');
    const { clearDocumentCacheEncryptionKey } = require('@/core/storage/documentCacheStorage');
    expect(clearCycleHealthEncryptionKey).toHaveBeenCalled(); expect(clearDocumentCacheEncryptionKey).toHaveBeenCalled();
  });

  it('Cycle key deletion failure does not skip the Pregnancy key', async () => {
    await populated();
    require('@/core/storage/cycleHealthEncryptedStorage').clearCycleHealthEncryptionKey.mockRejectedValueOnce(new Error('cycle key failed'));
    await expect(clearLocalUserData([])).rejects.toThrow('cycle key failed');
    expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(false); expect(await AsyncStorage.getItem(key)).toBeNull();
  });

  it('document key deletion failure does not skip the Pregnancy key', async () => {
    await populated();
    require('@/core/storage/documentCacheStorage').clearDocumentCacheEncryptionKey.mockRejectedValueOnce(new Error('doc key failed'));
    await expect(clearLocalUserData([])).rejects.toThrow('doc key failed');
    expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(false);
  });
});

describe('APP-076 B1 stale-session recreation after logout', () => {
  it('a handle for the logged-out account cannot recreate ciphertext or key once the live account has moved on', async () => {
    await populated(); await clearLocalUserData([]);
    for (const live of [null, 'account-b']) {
      const stale = createPregnancyProtectedRepository({ accountId: ACCOUNT, getActiveAccount: () => live });
      await expect(stale.initialize(createInitialPregnancyProtectedState(ACCOUNT))).rejects.toMatchObject({ code: 'account-mismatch' });
      await expect(stale.rebaseline()).rejects.toMatchObject({ code: 'account-mismatch' });
    }
    expect(await AsyncStorage.getItem(key)).toBeNull(); expect(mockSecure.has(PREGNANCY_HEALTH_STORAGE.secureStoreKey)).toBe(false);
  });

  it('refuses a handle without a live-account callback, so omission cannot bypass account binding', () => {
    expect(() => (createPregnancyProtectedRepository as any)({ accountId: ACCOUNT })).toThrow();
    expect(() => createPregnancyProtectedRepository({ accountId: ' ', getActiveAccount: () => ACCOUNT })).toThrow();
  });
});
