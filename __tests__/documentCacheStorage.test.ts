import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

const mockFiles = new Map<string, Uint8Array>();
const mockDirectories = new Set<string>(['file:///doc/', 'file:///cache/']);
let mockFailNextWriteTo: string | null = null;
let mockFailNextDeleteTo: string | null = null;
let mockWriteBlocker: Promise<void> | null = null;
let mockWriteStarted: ((uri: string) => void) | null = null;

function mockTextBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function mockBytesText(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function mockDeleteUri(uri: string): void {
  mockFiles.delete(uri);
  if (uri.endsWith('/')) {
    for (const key of [...mockFiles.keys()]) {
      if (key.startsWith(uri)) mockFiles.delete(key);
    }
    for (const key of [...mockDirectories]) {
      if (key.startsWith(uri)) mockDirectories.delete(key);
    }
  }
}

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn((uri: string) =>
    Promise.resolve(
      mockFiles.has(uri)
        ? { exists: true, isDirectory: false, size: mockFiles.get(uri)!.byteLength }
        : { exists: mockDirectories.has(uri), isDirectory: mockDirectories.has(uri), size: 0 },
    ),
  ),
  makeDirectoryAsync: jest.fn((uri: string) => {
    mockDirectories.add(uri);
    return Promise.resolve();
  }),
  deleteAsync: jest.fn((uri: string) => {
    if (mockFailNextDeleteTo && uri.includes(mockFailNextDeleteTo)) {
      mockFailNextDeleteTo = null;
      return Promise.reject(new Error('delete failed'));
    }
    mockDeleteUri(uri);
    return Promise.resolve();
  }),
}));

jest.mock('expo-file-system', () => {
  class File {
    readonly uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    bytes() {
      const bytes = mockFiles.get(this.uri);
      if (!bytes) return Promise.reject(new Error('file missing'));
      return Promise.resolve(new Uint8Array(bytes));
    }

    create() {
      const slash = this.uri.lastIndexOf('/');
      if (slash > -1) mockDirectories.add(this.uri.slice(0, slash + 1));
    }

    async write(bytes: Uint8Array) {
      mockWriteStarted?.(this.uri);
      if (mockWriteBlocker) await mockWriteBlocker;
      if (mockFailNextWriteTo && this.uri.includes(mockFailNextWriteTo)) {
        mockFailNextWriteTo = null;
        throw new Error('write failed');
      }
      mockFiles.set(this.uri, new Uint8Array(bytes));
    }
  }

  return { File };
});

jest.mock('@/utils/auth/pinAuth', () => ({
  clearLocalPin: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/core/storage/cycleHealthEncryptedStorage', () => ({
  clearCycleHealthEncryptionKey: jest.fn(() => Promise.resolve()),
  withCycleHealthEncryptedStorageCleanup: jest.fn((cleanup: () => Promise<unknown>) => cleanup()),
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

import * as SecureStore from 'expo-secure-store';

import { clearLocalUserData } from '@/core/auth/clearLocalUserData';
import {
  ATTACHMENTS_DIR,
  DECRYPTED_ATTACHMENTS_DIR,
  DocumentCacheProtectedDataError,
  clearDocumentCacheEncryptionKey,
  clearPersistentAttachmentCache,
  clearTemporaryAttachmentCache,
  decryptDocumentMetadataPayload,
  documentMetadataEncryptedStorage,
  encryptDocumentMetadataPayload,
  isEncryptedAttachmentCacheUri,
  isTemporaryDecryptedAttachmentUri,
  persistEncryptedAttachmentFile,
  resolveLocalAttachmentUri,
  withDocumentCacheCleanup,
} from '@/core/storage/documentCacheStorage';

function defer() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function expectDocumentCacheFailure(value: unknown, code: string) {
  return expect(value).rejects.toMatchObject({
    name: 'DocumentCacheProtectedDataError',
    code,
  });
}

function legacyExpensesPayload(uri = `${ATTACHMENTS_DIR}receipt.jpg`) {
  return JSON.stringify({
    state: {
      expenses: [
        {
          id: 'expense-1',
          name: 'Rent',
          amount: 100,
          category: 'home',
          nextPaymentDate: '2026-09-01',
          isRecurring: false,
          attachments: [{ id: 'attachment-1', uri, name: 'receipt.jpg', kind: 'image' }],
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      seriesStoppedAt: {},
      categoryBudgets: {},
    },
    version: 0,
  });
}

describe('APP-029 document cache storage', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockFiles.clear();
    mockDirectories.clear();
    mockDirectories.add('file:///doc/');
    mockDirectories.add('file:///cache/');
    mockFailNextWriteTo = null;
    mockFailNextDeleteTo = null;
    mockWriteBlocker = null;
    mockWriteStarted = null;
    await AsyncStorage.clear();
    await clearDocumentCacheEncryptionKey();
  });

  it('stores cached attachment bytes as encrypted files, not readable plaintext', async () => {
    mockFiles.set('file:///picker/receipt.jpg', mockTextBytes('sensitive receipt text'));

    const encryptedUri = await persistEncryptedAttachmentFile('file:///picker/receipt.jpg');

    expect(isEncryptedAttachmentCacheUri(encryptedUri)).toBe(true);
    expect(mockBytesText(mockFiles.get(encryptedUri)!)).not.toContain('sensitive receipt text');
    const plaintextUri = await resolveLocalAttachmentUri(encryptedUri, 'receipt.jpg');
    expect(plaintextUri).toContain(DECRYPTED_ATTACHMENTS_DIR);
    expect(mockBytesText(mockFiles.get(plaintextUri!)!)).toBe('sensitive receipt text');
  });

  it('uses different nonces when encrypting equivalent attachment bytes', async () => {
    mockFiles.set('file:///picker/a.pdf', mockTextBytes('same document'));

    const first = await persistEncryptedAttachmentFile('file:///picker/a.pdf');
    const second = await persistEncryptedAttachmentFile('file:///picker/a.pdf');

    expect(mockBytesText(mockFiles.get(first)!)).not.toBe(mockBytesText(mockFiles.get(second)!));
  });

  it('fails safely for corrupted encrypted attachment files', async () => {
    mockFiles.set('file:///picker/receipt.jpg', mockTextBytes('receipt'));
    const encryptedUri = await persistEncryptedAttachmentFile('file:///picker/receipt.jpg');
    const corrupted = new Uint8Array(mockFiles.get(encryptedUri)!);
    corrupted[corrupted.length - 1] ^= 1;
    mockFiles.set(encryptedUri, corrupted);

    await expectDocumentCacheFailure(resolveLocalAttachmentUri(encryptedUri, 'receipt.jpg'), 'ciphertext-authentication-failed');
  });

  it('fails safely for unsupported encrypted attachment file versions', async () => {
    mockFiles.set('file:///picker/receipt.jpg', mockTextBytes('receipt'));
    const encryptedUri = await persistEncryptedAttachmentFile('file:///picker/receipt.jpg');
    const unsupported = new Uint8Array(mockFiles.get(encryptedUri)!);
    unsupported['LSATTACH'.length] = 99;
    mockFiles.set(encryptedUri, unsupported);

    await expectDocumentCacheFailure(resolveLocalAttachmentUri(encryptedUri, 'receipt.jpg'), 'envelope-unsupported-version');
  });

  it('fails safely when encrypted attachment key material is missing', async () => {
    mockFiles.set('file:///picker/receipt.jpg', mockTextBytes('receipt'));
    const encryptedUri = await persistEncryptedAttachmentFile('file:///picker/receipt.jpg');

    await clearDocumentCacheEncryptionKey();

    await expectDocumentCacheFailure(resolveLocalAttachmentUri(encryptedUri, 'receipt.jpg'), 'key-missing');
  });

  it('does not silently fall back to plaintext when key storage fails', async () => {
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('secure store unavailable'));
    mockFiles.set('file:///picker/receipt.jpg', mockTextBytes('receipt'));

    await expectDocumentCacheFailure(persistEncryptedAttachmentFile('file:///picker/receipt.jpg'), 'key-creation-failed');
    expect([...mockFiles.keys()].filter((uri) => uri.startsWith(ATTACHMENTS_DIR))).toEqual([]);
    expect(mockBytesText(mockFiles.get('file:///picker/receipt.jpg')!)).toBe('receipt');
  });

  it('encrypts document metadata stores and keeps ordinary Profile A fields usable', async () => {
    const jsonStorage = createJSONStorage(() => documentMetadataEncryptedStorage)!;
    const payload = {
      state: {
        expenses: [{ id: 'expense-1', name: 'Rent', attachments: [{ id: 'a1', uri: 'file:///x', name: 'receipt.jpg', kind: 'image' }] }],
        seriesStoppedAt: {},
        categoryBudgets: { food: 1000 },
      },
      version: 0,
    };

    await jsonStorage.setItem('lifesort-expenses', payload);

    const raw = await AsyncStorage.getItem('lifesort-expenses');
    expect(raw).toContain('__lifesort_encrypted_document_metadata__');
    expect(raw).not.toContain('receipt.jpg');
    expect(raw).not.toContain('file:///x');
    await expect(jsonStorage.getItem('lifesort-expenses')).resolves.toMatchObject({
      state: { categoryBudgets: { food: 1000 } },
    });
  });

  it('uses a document-cache key that is separate from the cycle health key', async () => {
    await documentMetadataEncryptedStorage.setItem('lifesort-expenses', legacyExpensesPayload(''));

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'lifesort-document-cache-key',
      expect.any(String),
      expect.any(Object),
    );
    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith(
      'lifesort-cycle-health-key',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('uses different nonces for equivalent metadata payloads', async () => {
    const first = await encryptDocumentMetadataPayload('lifesort-expenses', legacyExpensesPayload(''));
    const second = await encryptDocumentMetadataPayload('lifesort-expenses', legacyExpensesPayload(''));

    expect(first).not.toBe(second);
    await expect(decryptDocumentMetadataPayload('lifesort-expenses', first)).resolves.toBe(legacyExpensesPayload(''));
    await expect(decryptDocumentMetadataPayload('lifesort-expenses', second)).resolves.toBe(legacyExpensesPayload(''));
  });

  it('fails safely for corrupted and unsupported metadata envelopes', async () => {
    const raw = JSON.parse(await encryptDocumentMetadataPayload('lifesort-expenses', legacyExpensesPayload('')));
    raw.ciphertext = `${raw.ciphertext.slice(0, -4)}AAAA`;
    await AsyncStorage.setItem('lifesort-expenses', JSON.stringify(raw));

    await expectDocumentCacheFailure(documentMetadataEncryptedStorage.getItem('lifesort-expenses'), 'ciphertext-authentication-failed');

    const unsupported = JSON.parse(await encryptDocumentMetadataPayload('lifesort-expenses', legacyExpensesPayload('')));
    unsupported.version = 999;
    await AsyncStorage.setItem('lifesort-expenses', JSON.stringify(unsupported));

    await expectDocumentCacheFailure(documentMetadataEncryptedStorage.getItem('lifesort-expenses'), 'envelope-unsupported-version');
  });

  it('migrates legacy plaintext attachment files and metadata idempotently', async () => {
    const legacyUri = `${ATTACHMENTS_DIR}receipt.jpg`;
    mockFiles.set(legacyUri, mockTextBytes('legacy receipt'));
    await AsyncStorage.setItem('lifesort-expenses', legacyExpensesPayload(legacyUri));

    const migrated = await documentMetadataEncryptedStorage.getItem('lifesort-expenses');
    const parsed = JSON.parse(migrated!);
    const migratedUri = parsed.state.expenses[0].attachments[0].uri;

    expect(isEncryptedAttachmentCacheUri(migratedUri)).toBe(true);
    expect(mockFiles.has(legacyUri)).toBe(false);
    expect(mockBytesText(mockFiles.get(migratedUri)!)).not.toContain('legacy receipt');
    const raw = await AsyncStorage.getItem('lifesort-expenses');
    expect(raw).not.toContain('receipt.jpg');
    expect(raw).not.toContain(legacyUri);

    await expect(documentMetadataEncryptedStorage.getItem('lifesort-expenses')).resolves.toBe(migrated);
  });

  it('surfaces required plaintext deletion failure without reverting encrypted metadata', async () => {
    const legacyUri = `${ATTACHMENTS_DIR}receipt.jpg`;
    mockFiles.set(legacyUri, mockTextBytes('legacy receipt'));
    await AsyncStorage.setItem('lifesort-expenses', legacyExpensesPayload(legacyUri));
    mockFailNextDeleteTo = 'receipt.jpg';

    await expectDocumentCacheFailure(documentMetadataEncryptedStorage.getItem('lifesort-expenses'), 'legacy-plaintext-cleanup-failed');

    const raw = await AsyncStorage.getItem('lifesort-expenses');
    expect(raw).toContain('__lifesort_encrypted_document_metadata__');
    expect(raw).not.toContain(legacyUri);
    expect(raw).not.toContain('receipt.jpg');
    expect(mockFiles.has(legacyUri)).toBe(true);
    expect([...mockFiles.keys()].filter((uri) => isEncryptedAttachmentCacheUri(uri))).toHaveLength(1);
  });

  it('retries a discoverable failed plaintext cleanup while keeping encrypted attachments usable', async () => {
    const legacyUri = `${ATTACHMENTS_DIR}receipt.jpg`;
    mockFiles.set(legacyUri, mockTextBytes('legacy receipt'));
    await AsyncStorage.setItem('lifesort-expenses', legacyExpensesPayload(legacyUri));
    mockFailNextDeleteTo = 'receipt.jpg';

    await expectDocumentCacheFailure(documentMetadataEncryptedStorage.getItem('lifesort-expenses'), 'legacy-plaintext-cleanup-failed');

    const retried = await documentMetadataEncryptedStorage.getItem('lifesort-expenses');
    const parsed = JSON.parse(retried!);
    const encryptedUri = parsed.state.expenses[0].attachments[0].uri;

    expect(mockFiles.has(legacyUri)).toBe(false);
    expect(mockFiles.has(encryptedUri)).toBe(true);
    const plaintextUri = await resolveLocalAttachmentUri(encryptedUri, 'receipt.jpg');
    expect(mockBytesText(mockFiles.get(plaintextUri!)!)).toBe('legacy receipt');
    const rawAfterRetry = await AsyncStorage.getItem('lifesort-expenses');
    expect(rawAfterRetry).toContain('__lifesort_encrypted_document_metadata__');
    expect(rawAfterRetry).not.toContain(legacyUri);
  });

  it('preserves plaintext legacy files when encrypted migration cannot be written', async () => {
    const legacyUri = `${ATTACHMENTS_DIR}receipt.jpg`;
    mockFiles.set(legacyUri, mockTextBytes('legacy receipt'));
    await AsyncStorage.setItem('lifesort-expenses', legacyExpensesPayload(legacyUri));
    mockFailNextWriteTo = '.lsenc';

    await expectDocumentCacheFailure(documentMetadataEncryptedStorage.getItem('lifesort-expenses'), 'migration-failed');

    expect(mockFiles.has(legacyUri)).toBe(true);
    expect([...mockFiles.keys()].filter((uri) => isEncryptedAttachmentCacheUri(uri))).toEqual([]);
    expect(await AsyncStorage.getItem('lifesort-expenses')).toBe(legacyExpensesPayload(legacyUri));
  });

  it('preserves plaintext and rolls back encrypted replacement when metadata persistence fails', async () => {
    const legacyUri = `${ATTACHMENTS_DIR}receipt.jpg`;
    mockFiles.set(legacyUri, mockTextBytes('legacy receipt'));
    await AsyncStorage.setItem('lifesort-expenses', legacyExpensesPayload(legacyUri));
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('metadata write failed'));

    await expectDocumentCacheFailure(documentMetadataEncryptedStorage.getItem('lifesort-expenses'), 'migration-failed');

    expect(mockFiles.has(legacyUri)).toBe(true);
    expect([...mockFiles.keys()].filter((uri) => isEncryptedAttachmentCacheUri(uri))).toEqual([]);
    expect(await AsyncStorage.getItem('lifesort-expenses')).toBe(legacyExpensesPayload(legacyUri));
  });

  it('leaves unrelated files untouched during legacy migration', async () => {
    const legacyUri = `${ATTACHMENTS_DIR}receipt.jpg`;
    const unrelatedUri = `${ATTACHMENTS_DIR}not-referenced.txt`;
    mockFiles.set(legacyUri, mockTextBytes('legacy receipt'));
    mockFiles.set(unrelatedUri, mockTextBytes('unrelated'));
    await AsyncStorage.setItem('lifesort-expenses', legacyExpensesPayload(legacyUri));

    await documentMetadataEncryptedStorage.getItem('lifesort-expenses');

    expect(mockBytesText(mockFiles.get(unrelatedUri)!)).toBe('unrelated');
  });

  it('cleans temporary decrypted files without removing persistent encrypted cache files', async () => {
    mockFiles.set('file:///picker/receipt.jpg', mockTextBytes('receipt'));
    const encryptedUri = await persistEncryptedAttachmentFile('file:///picker/receipt.jpg');
    const tempUri = await resolveLocalAttachmentUri(encryptedUri, 'receipt.jpg');

    expect(isTemporaryDecryptedAttachmentUri(tempUri!)).toBe(true);
    await clearTemporaryAttachmentCache();

    expect(mockFiles.has(tempUri!)).toBe(false);
    expect(mockFiles.has(encryptedUri)).toBe(true);
  });

  it('keeps best-effort temporary cleanup non-fatal when a cache delete fails', async () => {
    mockFiles.set(`${DECRYPTED_ATTACHMENTS_DIR}file.jpg`, mockTextBytes('plaintext'));
    mockFailNextDeleteTo = 'lifesort-decrypted-attachments';

    await expect(clearTemporaryAttachmentCache()).resolves.toBeUndefined();
    expect(mockFiles.has(`${DECRYPTED_ATTACHMENTS_DIR}file.jpg`)).toBe(true);
  });

  it('clears persistent and temporary attachment files during logout cleanup', async () => {
    mockFiles.set(`${ATTACHMENTS_DIR}file.lsenc`, mockTextBytes('ciphertext'));
    mockFiles.set(`${DECRYPTED_ATTACHMENTS_DIR}file.jpg`, mockTextBytes('plaintext'));

    await clearLocalUserData([]);

    expect([...mockFiles.keys()].filter((uri) => uri.startsWith(ATTACHMENTS_DIR))).toEqual([]);
    expect([...mockFiles.keys()].filter((uri) => uri.startsWith(DECRYPTED_ATTACHMENTS_DIR))).toEqual([]);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('lifesort-document-cache-key', expect.any(Object));
  });

  it('drops document metadata writes attempted during cleanup without creating key material', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockClear();
    (SecureStore.setItemAsync as jest.Mock).mockClear();

    await withDocumentCacheCleanup(async () => {
      await expect(documentMetadataEncryptedStorage.setItem('lifesort-expenses', legacyExpensesPayload(''))).resolves.toBeUndefined();
      expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    });
  });

  it('invalidates a pre-cleanup attachment write so logout cannot leave ciphertext without its key', async () => {
    mockFiles.set('file:///picker/receipt.jpg', mockTextBytes('receipt'));
    const writeStarted = defer();
    const writeBlocker = defer();
    mockWriteBlocker = writeBlocker.promise;
    mockWriteStarted = (uri) => {
      if (uri.endsWith('.lsenc')) writeStarted.resolve();
    };

    const write = persistEncryptedAttachmentFile('file:///picker/receipt.jpg');
    await writeStarted.promise;
    const cleanup = withDocumentCacheCleanup(async () => {
      await clearPersistentAttachmentCache();
      await clearDocumentCacheEncryptionKey();
    });
    writeBlocker.resolve();

    await cleanup;
    await expectDocumentCacheFailure(write, 'write-invalidated-by-key-deletion');
    expect([...mockFiles.keys()].filter((uri) => uri.startsWith(ATTACHMENTS_DIR))).toEqual([]);
  });

  it('tracks a whole legacy migration so cleanup can invalidate and wait for it', async () => {
    const legacyUri = `${ATTACHMENTS_DIR}receipt.jpg`;
    mockFiles.set(legacyUri, mockTextBytes('legacy receipt'));
    await AsyncStorage.setItem('lifesort-expenses', legacyExpensesPayload(legacyUri));
    const writeStarted = defer();
    const writeBlocker = defer();
    mockWriteBlocker = writeBlocker.promise;
    mockWriteStarted = (uri) => {
      if (uri.endsWith('.lsenc')) writeStarted.resolve();
    };

    const migration = documentMetadataEncryptedStorage.getItem('lifesort-expenses');
    await writeStarted.promise;
    let cleanupFinished = false;
    const cleanup = withDocumentCacheCleanup(async () => {
      await clearPersistentAttachmentCache();
      await clearDocumentCacheEncryptionKey();
    }).then(() => {
      cleanupFinished = true;
    });
    await Promise.resolve();
    expect(cleanupFinished).toBe(false);
    writeBlocker.resolve();

    await cleanup;
    expect(cleanupFinished).toBe(true);
    await expectDocumentCacheFailure(migration, 'write-invalidated-by-key-deletion');
    expect([...mockFiles.keys()].filter((uri) => uri.startsWith(ATTACHMENTS_DIR))).toEqual([]);
    expect(await AsyncStorage.getItem('lifesort-expenses')).toBe(legacyExpensesPayload(legacyUri));
  });

  it('allows new document cache writes with fresh key material after cleanup completes', async () => {
    await withDocumentCacheCleanup(async () => {
      await clearDocumentCacheEncryptionKey();
    });
    mockFiles.set('file:///picker/receipt.jpg', mockTextBytes('receipt'));

    const encryptedUri = await persistEncryptedAttachmentFile('file:///picker/receipt.jpg');

    await expect(resolveLocalAttachmentUri(encryptedUri, 'receipt.jpg')).resolves.toContain(DECRYPTED_ATTACHMENTS_DIR);
  });
});
