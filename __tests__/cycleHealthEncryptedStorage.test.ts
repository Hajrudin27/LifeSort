import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

const mockSecureStore = new Map<string, string>();
let mockFailSecureStoreWrite = false;
let mockFailAsyncStorageWrite = false;
let mockFailNextKeyGeneration = false;
let mockGeneratedKeyCount = 0;
let mockSecureStoreSetBlocker: Promise<void> | null = null;
let mockSecureStoreSetStarted: (() => void) | null = null;
let mockAsyncStorageSetBlocker: Promise<void> | null = null;
let mockAsyncStorageSetStarted: ((key: string, value: string) => void) | null = null;

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore.get(key) ?? null)),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStoreSetStarted?.();
    if (mockSecureStoreSetBlocker) await mockSecureStoreSetBlocker;
    if (mockFailSecureStoreWrite) throw new Error('secure store unavailable');
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureStore.delete(key);
    return Promise.resolve();
  }),
}));

jest.mock('expo-crypto', () => {
  const { randomBytes, randomUUID, createCipheriv, createDecipheriv } = require('crypto');

  class AESEncryptionKey {
    private readonly mockKey: Buffer;

    private constructor(keyBytes: Buffer) {
      this.mockKey = keyBytes;
    }

    static async generate() {
      if (mockFailNextKeyGeneration) {
        mockFailNextKeyGeneration = false;
        throw new Error('key generation failed');
      }
      mockGeneratedKeyCount += 1;
      return new AESEncryptionKey(randomBytes(32));
    }

    static import(value: string) {
      return Promise.resolve(new AESEncryptionKey(Buffer.from(value, 'base64')));
    }

    encoded() {
      return Promise.resolve(this.mockKey.toString('base64'));
    }

    bytes() {
      return Promise.resolve(new Uint8Array(this.mockKey));
    }
  }

  class AESSealedData {
    readonly ivLength: number;
    readonly tagLength: number;
    private readonly mockCombinedBytes: Buffer;

    private constructor(
      combinedBytes: Buffer,
      ivLength: number,
      tagLength: number,
    ) {
      this.mockCombinedBytes = combinedBytes;
      this.ivLength = ivLength;
      this.tagLength = tagLength;
    }

    static fromCombined(value: string, config: { ivLength: number; tagLength: number }) {
      return new AESSealedData(Buffer.from(value, 'base64'), config.ivLength, config.tagLength);
    }

    combined() {
      return Promise.resolve(this.mockCombinedBytes.toString('base64'));
    }

    bytes() {
      return this.mockCombinedBytes;
    }
  }

  return {
    randomUUID: jest.fn(() => randomUUID()),
    AESEncryptionKey,
    AESSealedData,
    aesEncryptAsync: jest.fn(
      async (
        plaintext: Uint8Array,
        key: AESEncryptionKey,
        options: { additionalData?: Uint8Array; nonce?: { length: number }; tagLength?: number },
      ) => {
        const rawKey = Buffer.from(await key.bytes());
        const iv = randomBytes(options.nonce?.length ?? 12);
        const cipher = createCipheriv('aes-256-gcm', rawKey, iv, { authTagLength: options.tagLength ?? 16 });
        if (options.additionalData) cipher.setAAD(Buffer.from(options.additionalData));
        const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
        const tag = cipher.getAuthTag();
        return AESSealedData.fromCombined(Buffer.concat([iv, ciphertext, tag]).toString('base64'), {
          ivLength: iv.length,
          tagLength: tag.length,
        });
      },
    ),
    aesDecryptAsync: jest.fn(
      async (sealed: AESSealedData, key: AESEncryptionKey, options: { additionalData?: Uint8Array }) => {
        const combined = sealed.bytes();
        const iv = combined.subarray(0, sealed.ivLength);
        const tag = combined.subarray(combined.length - sealed.tagLength);
        const ciphertext = combined.subarray(sealed.ivLength, combined.length - sealed.tagLength);
        const decipher = createDecipheriv('aes-256-gcm', Buffer.from(await key.bytes()), iv, {
          authTagLength: sealed.tagLength,
        });
        if (options.additionalData) decipher.setAAD(Buffer.from(options.additionalData));
        decipher.setAuthTag(tag);
        return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
      },
    ),
  };
});

jest.mock('@/utils/auth/pinAuth', () => ({
  clearLocalPin: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/utils/shared/attachmentStorage', () => ({
  clearAttachmentCache: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/core/storage/documentCacheStorage', () => ({
  clearDocumentCacheEncryptionKey: jest.fn(() => Promise.resolve()),
  withDocumentCacheCleanup: jest.fn((cleanup: () => Promise<unknown>) => cleanup()),
}));

jest.mock('@/utils/shared/attachmentSync', () => ({
  clearSignedUrlCache: jest.fn(),
}));

jest.mock('@/core/auth/emailVerification', () => ({
  clearResendThrottle: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/core/auth/reauth', () => ({
  clearVerification: jest.fn(),
}));

import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import { clearLocalUserData } from '@/core/auth/clearLocalUserData';
import {
  clearCycleHealthEncryptionKey,
  cycleHealthEncryptedStorage,
  decryptCycleStorePayload,
  encryptCycleStorePayload,
  withCycleHealthEncryptedStorageCleanup,
} from '@/core/storage/cycleHealthEncryptedStorage';

const storageKey = 'lifesort-cycle';
const plaintextPayload = JSON.stringify({
  state: {
    cycles: [{ id: 'cycle-1', startDate: '2026-08-01', endDate: '2026-08-05' }],
    symptomLogs: [{ id: 'log-1', date: '2026-08-02', symptoms: ['cramps'], flow: 'medium', notes: 'sensitive note' }],
    avgCycleLength: 29,
    lutealPhaseLength: 13,
    reminderEnabled: true,
    reminderDaysBefore: 2,
    healthConditions: [{ id: 'pcos', nameEn: 'PCOS' }],
    symptomGlossary: [{ id: 'cramps', nameEn: 'Cramps' }],
  },
  version: 0,
});

function expectProtectedDataFailure(value: unknown, code: string) {
  return expect(value).rejects.toMatchObject({
    name: 'CycleHealthProtectedDataError',
    code,
  });
}

function defer() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('APP-028 cycle health encrypted storage', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockSecureStore.clear();
    mockFailSecureStoreWrite = false;
    mockFailAsyncStorageWrite = false;
    mockFailNextKeyGeneration = false;
    mockGeneratedKeyCount = 0;
    mockSecureStoreSetBlocker = null;
    mockSecureStoreSetStarted = null;
    mockAsyncStorageSetBlocker = null;
    mockAsyncStorageSetStarted = null;
    await AsyncStorage.clear();
    await clearCycleHealthEncryptionKey();

    (Notifications.cancelAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      mockAsyncStorageSetStarted?.(key, value);
      if (mockAsyncStorageSetBlocker && key === storageKey) await mockAsyncStorageSetBlocker;
      if (mockFailAsyncStorageWrite) throw new Error('disk write failed');
      await AsyncStorage.multiSet([[key, value]]);
    });
  });

  it('encrypts the persisted Zustand payload instead of storing readable health JSON', async () => {
    await cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload);

    const raw = await AsyncStorage.getItem(storageKey);
    expect(raw).toContain('__lifesort_encrypted_cycle_store__');
    expect(raw).not.toContain('2026-08-01');
    expect(raw).not.toContain('sensitive note');
    expect(raw).not.toContain('cramps');
  });

  it('round-trips through AES-GCM storage', async () => {
    await cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload);
    await expect(cycleHealthEncryptedStorage.getItem(storageKey)).resolves.toBe(plaintextPayload);
  });

  it('returns normal absence only when the AsyncStorage key does not exist', async () => {
    await expect(cycleHealthEncryptedStorage.getItem(storageKey)).resolves.toBeNull();
  });

  it('uses different nonces for equivalent writes', async () => {
    const first = await encryptCycleStorePayload(plaintextPayload);
    const second = await encryptCycleStorePayload(plaintextPayload);

    expect(first).not.toBe(second);
    await expect(decryptCycleStorePayload(first)).resolves.toBe(plaintextPayload);
    await expect(decryptCycleStorePayload(second)).resolves.toBe(plaintextPayload);
  });

  it('fails safely for corrupted ciphertext', async () => {
    await cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload);
    const raw = await AsyncStorage.getItem(storageKey);
    const envelope = JSON.parse(raw!);
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`;

    await AsyncStorage.setItem(storageKey, JSON.stringify(envelope));

    await expectProtectedDataFailure(cycleHealthEncryptedStorage.getItem(storageKey), 'ciphertext-authentication-failed');
  });

  it('fails explicitly for malformed encrypted envelopes', async () => {
    const envelope = JSON.parse(await encryptCycleStorePayload(plaintextPayload));
    envelope.ciphertext = '';
    await AsyncStorage.setItem(storageKey, JSON.stringify(envelope));

    await expectProtectedDataFailure(cycleHealthEncryptedStorage.getItem(storageKey), 'envelope-malformed');
  });

  it('fails safely when the encryption key is missing', async () => {
    await cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload);
    await clearCycleHealthEncryptionKey();

    await expectProtectedDataFailure(cycleHealthEncryptedStorage.getItem(storageKey), 'key-missing');
  });

  it('fails safely for unsupported encrypted payload versions', async () => {
    const raw = JSON.parse(await encryptCycleStorePayload(plaintextPayload));
    raw.version = 999;
    await AsyncStorage.setItem(storageKey, JSON.stringify(raw));

    await expectProtectedDataFailure(cycleHealthEncryptedStorage.getItem(storageKey), 'envelope-unsupported-version');
  });

  it('rejects malformed random plaintext instead of migrating it as legacy cycle state', async () => {
    await AsyncStorage.setItem(storageKey, JSON.stringify({ state: { some: 'other store' }, version: 0 }));

    await expectProtectedDataFailure(cycleHealthEncryptedStorage.getItem(storageKey), 'legacy-plaintext-malformed');
  });

  it('blocks default writes after failed protected-data hydration so ciphertext is not overwritten', async () => {
    await cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload);
    const rawEncryptedPayload = await AsyncStorage.getItem(storageKey);
    await clearCycleHealthEncryptionKey();

    await expectProtectedDataFailure(cycleHealthEncryptedStorage.getItem(storageKey), 'key-missing');
    await expectProtectedDataFailure(
      cycleHealthEncryptedStorage.setItem(storageKey, JSON.stringify({ state: { cycles: [] }, version: 0 })),
      'write-blocked-after-protected-failure',
    );

    await expect(AsyncStorage.getItem(storageKey)).resolves.toBe(rawEncryptedPayload);
  });

  it('migrates existing plaintext cycle state to encrypted storage', async () => {
    await AsyncStorage.setItem(storageKey, plaintextPayload);

    await expect(cycleHealthEncryptedStorage.getItem(storageKey)).resolves.toBe(plaintextPayload);

    const raw = await AsyncStorage.getItem(storageKey);
    expect(raw).toContain('__lifesort_encrypted_cycle_store__');
    expect(raw).not.toContain('2026-08-01');
    expect(raw).not.toContain('sensitive note');
  });

  it('keeps migration idempotent after the plaintext payload is protected', async () => {
    await AsyncStorage.setItem(storageKey, plaintextPayload);
    await expect(cycleHealthEncryptedStorage.getItem(storageKey)).resolves.toBe(plaintextPayload);
    const encryptedOnce = await AsyncStorage.getItem(storageKey);

    await expect(cycleHealthEncryptedStorage.getItem(storageKey)).resolves.toBe(plaintextPayload);

    expect(await AsyncStorage.getItem(storageKey)).toBe(encryptedOnce);
  });

  it('does not return plaintext or delete it when key storage fails during migration', async () => {
    await AsyncStorage.setItem(storageKey, plaintextPayload);
    mockFailSecureStoreWrite = true;

    await expectProtectedDataFailure(cycleHealthEncryptedStorage.getItem(storageKey), 'migration-failed');
    await expect(AsyncStorage.getItem(storageKey)).resolves.toBe(plaintextPayload);
  });

  it('does not return plaintext or delete it when encrypted disk write fails during migration', async () => {
    await AsyncStorage.setItem(storageKey, plaintextPayload);
    mockFailAsyncStorageWrite = true;

    await expectProtectedDataFailure(cycleHealthEncryptedStorage.getItem(storageKey), 'migration-failed');
    await expect(AsyncStorage.getItem(storageKey)).resolves.toBe(plaintextPayload);
  });

  it('uses the same first-use key for concurrent encryption calls', async () => {
    const [first, second] = await Promise.all([
      encryptCycleStorePayload(plaintextPayload),
      encryptCycleStorePayload(plaintextPayload),
    ]);

    expect(mockGeneratedKeyCount).toBe(1);
    await expect(decryptCycleStorePayload(first)).resolves.toBe(plaintextPayload);
    await expect(decryptCycleStorePayload(second)).resolves.toBe(plaintextPayload);
  });

  it('keeps concurrent first writes decryptable with the persisted key', async () => {
    await Promise.all([
      cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload),
      cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload),
    ]);

    expect(mockGeneratedKeyCount).toBe(1);
    await expect(cycleHealthEncryptedStorage.getItem(storageKey)).resolves.toBe(plaintextPayload);
  });

  it('allows a failed first key creation to be retried safely', async () => {
    mockFailNextKeyGeneration = true;

    await expectProtectedDataFailure(cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload), 'key-creation-failed');
    await expect(cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload)).resolves.toBeUndefined();

    expect(mockGeneratedKeyCount).toBe(1);
    await expect(cycleHealthEncryptedStorage.getItem(storageKey)).resolves.toBe(plaintextPayload);
  });

  it('does not let logout key deletion be undone by an in-flight first key creation', async () => {
    const setStarted = defer();
    const setBlocker = defer();
    mockSecureStoreSetStarted = setStarted.resolve;
    mockSecureStoreSetBlocker = setBlocker.promise;

    const write = cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload);
    await setStarted.promise;

    const clearKey = clearCycleHealthEncryptionKey();
    setBlocker.resolve();

    await expectProtectedDataFailure(write, 'key-creation-invalidated');
    await clearKey;

    expect(mockSecureStore.has('lifesort-cycle-health-key')).toBe(false);
    await expect(AsyncStorage.getItem(storageKey)).resolves.toBeNull();
  });

  it('drops reset-triggered cycle writes during logout cleanup without rejecting their ignored Promise', async () => {
    await cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload);
    let resetWrite: Promise<unknown> | undefined;

    await clearLocalUserData([
      {
        key: storageKey,
        reset: () => {
          resetWrite = Promise.resolve(cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload));
          resetWrite.catch(() => undefined);
        },
      },
    ]);

    expect(resetWrite).toBeDefined();
    await expect(resetWrite).resolves.toBeUndefined();
    expect(mockSecureStore.has('lifesort-cycle-health-key')).toBe(false);
    await expect(AsyncStorage.getItem(storageKey)).resolves.toBeNull();
  });

  it('invalidates a pre-cleanup in-flight write and waits until it cannot leave ciphertext behind', async () => {
    await cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload);
    const writeStarted = defer();
    const writeBlocker = defer();
    const multiRemoveStarted = defer();
    mockAsyncStorageSetBlocker = writeBlocker.promise;
    mockAsyncStorageSetStarted = (key) => {
      if (key === storageKey) writeStarted.resolve();
    };
    const originalMultiRemove = (AsyncStorage.multiRemove as jest.Mock).getMockImplementation();
    (AsyncStorage.multiRemove as jest.Mock).mockImplementationOnce(async (keys: readonly string[]) => {
      multiRemoveStarted.resolve();
      return originalMultiRemove?.(keys);
    });

    const write = Promise.resolve(cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload));
    await writeStarted.promise;

    const cleanup = clearLocalUserData([]);
    await multiRemoveStarted.promise;
    writeBlocker.resolve();

    await cleanup;
    await expectProtectedDataFailure(write, 'write-invalidated-by-key-deletion');
    expect(mockSecureStore.has('lifesort-cycle-health-key')).toBe(false);
    await expect(AsyncStorage.getItem(storageKey)).resolves.toBeNull();
  });

  it('drops writes attempted after cleanup begins without touching storage or creating a key', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockClear();
    (SecureStore.setItemAsync as jest.Mock).mockClear();

    await withCycleHealthEncryptedStorageCleanup(async () => {
      await expect(cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload)).resolves.toBeUndefined();
      expect(mockGeneratedKeyCount).toBe(0);
      expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
      expect(mockSecureStore.has('lifesort-cycle-health-key')).toBe(false);
      await expect(AsyncStorage.getItem(storageKey)).resolves.toBeNull();
    });
  });

  it('rejects key creation attempted during cleanup without recreating a SecureStore key', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockClear();
    (SecureStore.setItemAsync as jest.Mock).mockClear();

    await withCycleHealthEncryptedStorageCleanup(async () => {
      await expectProtectedDataFailure(encryptCycleStorePayload(plaintextPayload), 'cleanup-in-progress');
      expect(mockGeneratedKeyCount).toBe(0);
      expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
      expect(mockSecureStore.has('lifesort-cycle-health-key')).toBe(false);
    });
  });

  it('prevents a legacy plaintext migration from restoring data after cleanup starts', async () => {
    await AsyncStorage.setItem(storageKey, plaintextPayload);
    const migrationWriteStarted = defer();
    const migrationWriteBlocker = defer();
    mockAsyncStorageSetBlocker = migrationWriteBlocker.promise;
    mockAsyncStorageSetStarted = (key) => {
      if (key === storageKey) migrationWriteStarted.resolve();
    };

    const migration = Promise.resolve(cycleHealthEncryptedStorage.getItem(storageKey));
    await migrationWriteStarted.promise;

    const cleanup = withCycleHealthEncryptedStorageCleanup(async () => {
      await AsyncStorage.multiRemove([storageKey]);
      await clearCycleHealthEncryptionKey();
    });
    migrationWriteBlocker.resolve();

    await cleanup;
    await expectProtectedDataFailure(migration, 'write-invalidated-by-key-deletion');
    expect(mockSecureStore.has('lifesort-cycle-health-key')).toBe(false);
    await expect(AsyncStorage.getItem(storageKey)).resolves.toBeNull();
  });

  it('allows normal persistence again with a fresh key after cleanup completes', async () => {
    await withCycleHealthEncryptedStorageCleanup(async () => {
      await clearCycleHealthEncryptionKey();
    });

    await expect(cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload)).resolves.toBeUndefined();
    expect(mockSecureStore.has('lifesort-cycle-health-key')).toBe(true);
    await expect(cycleHealthEncryptedStorage.getItem(storageKey)).resolves.toBe(plaintextPayload);
  });

  it('releases the cleanup lifecycle when logout continues past a non-fatal notification failure', async () => {
    let resetWrite: Promise<unknown> | undefined;
    (Notifications.cancelAllScheduledNotificationsAsync as jest.Mock).mockRejectedValueOnce(
      new Error('notification cleanup failed'),
    );

    await clearLocalUserData([
      {
        key: storageKey,
        reset: () => {
          resetWrite = Promise.resolve(cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload));
          resetWrite.catch(() => undefined);
        },
      },
    ]);

    expect(resetWrite).toBeDefined();
    await expect(resetWrite).resolves.toBeUndefined();
    await expect(cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload)).resolves.toBeUndefined();
    await expect(cycleHealthEncryptedStorage.getItem(storageKey)).resolves.toBe(plaintextPayload);
  });

  it('keeps reference Profile D content functional inside the encrypted mixed payload', async () => {
    await cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload);

    const jsonStorage = createJSONStorage(() => cycleHealthEncryptedStorage);
    await expect(jsonStorage?.getItem(storageKey)).resolves.toMatchObject({
      state: {
        healthConditions: [{ id: 'pcos', nameEn: 'PCOS' }],
        symptomGlossary: [{ id: 'cramps', nameEn: 'Cramps' }],
      },
      version: 0,
    });
  });

  it('removes the SecureStore key used to decrypt cycle health data', async () => {
    await cycleHealthEncryptedStorage.setItem(storageKey, plaintextPayload);
    expect(mockSecureStore.has('lifesort-cycle-health-key')).toBe(true);

    await clearCycleHealthEncryptionKey();

    expect(mockSecureStore.has('lifesort-cycle-health-key')).toBe(false);
  });
});
