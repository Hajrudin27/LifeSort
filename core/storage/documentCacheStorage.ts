import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  randomUUID,
} from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { StateStorage } from 'zustand/middleware';

const KEYCHAIN_KEY = 'lifesort-document-cache-key';
const METADATA_ENVELOPE_MARKER = '__lifesort_encrypted_document_metadata__';
const ENVELOPE_VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const FILE_MAGIC = new TextEncoder().encode('LSATTACH');
const FILE_HEADER_LENGTH = FILE_MAGIC.length + 3;
const FILE_EXTENSION = 'lsenc';
const TEMP_DIR_NAME = 'lifesort-decrypted-attachments';
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const ATTACHMENTS_DIR = `${FileSystem.documentDirectory}attachments/`;
export const DECRYPTED_ATTACHMENTS_DIR = `${FileSystem.cacheDirectory}${TEMP_DIR_NAME}/`;

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

type EncryptedMetadataEnvelope = {
  marker: typeof METADATA_ENVELOPE_MARKER;
  version: typeof ENVELOPE_VERSION;
  algorithm: 'AES-256-GCM';
  ivLength: typeof IV_LENGTH;
  tagLength: typeof TAG_LENGTH;
  ciphertext: string;
  pendingLegacyPlaintextCleanup?: string;
};

type DocumentCacheFailureCode =
  | 'secure-store-unavailable'
  | 'key-missing'
  | 'key-read-failed'
  | 'key-invalid'
  | 'key-creation-failed'
  | 'key-creation-invalidated'
  | 'cleanup-in-progress'
  | 'envelope-malformed'
  | 'envelope-unsupported-version'
  | 'ciphertext-authentication-failed'
  | 'legacy-plaintext-malformed'
  | 'migration-failed'
  | 'legacy-plaintext-cleanup-failed'
  | 'write-blocked-after-protected-failure'
  | 'write-invalidated-by-key-deletion'
  | 'file-too-large'
  | 'file-format-unsupported';

export class DocumentCacheProtectedDataError extends Error {
  constructor(
    readonly code: DocumentCacheFailureCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DocumentCacheProtectedDataError';
  }
}

let keyCreationPromise: Promise<AESEncryptionKey> | null = null;
let keyEpoch = 0;
let cleanupDepth = 0;
const blockedStorageNames = new Set<string>();
const activeWrites = new Set<Promise<void>>();

type LegacyFileMigration = {
  sourceUri: string;
  encryptedUri: string;
};

type LegacyPlaintextCleanupRecord = LegacyFileMigration;

type PreparedPayloadMigration = {
  value: string;
  cleanupRecords: LegacyPlaintextCleanupRecord[];
  rollback: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseStoredJson(value: string): Record<string, unknown> {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) {
    throw new DocumentCacheProtectedDataError(
      'legacy-plaintext-malformed',
      'Existing document metadata storage is neither encrypted nor a valid legacy Zustand payload.',
    );
  }
  return parsed;
}

function parseEnvelope(parsed: Record<string, unknown>): EncryptedMetadataEnvelope {
  if (parsed.version !== ENVELOPE_VERSION) {
    throw new DocumentCacheProtectedDataError(
      'envelope-unsupported-version',
      'Encrypted document metadata uses an unsupported payload version.',
    );
  }
  if (parsed.algorithm !== 'AES-256-GCM') {
    throw new DocumentCacheProtectedDataError('envelope-malformed', 'Encrypted document metadata algorithm is invalid.');
  }
  if (parsed.ivLength !== IV_LENGTH || parsed.tagLength !== TAG_LENGTH) {
    throw new DocumentCacheProtectedDataError('envelope-malformed', 'Encrypted document metadata lengths are invalid.');
  }
  if (typeof parsed.ciphertext !== 'string' || parsed.ciphertext.length === 0) {
    throw new DocumentCacheProtectedDataError('envelope-malformed', 'Encrypted document metadata ciphertext is missing.');
  }
  if (
    parsed.pendingLegacyPlaintextCleanup !== undefined &&
    (typeof parsed.pendingLegacyPlaintextCleanup !== 'string' || parsed.pendingLegacyPlaintextCleanup.length === 0)
  ) {
    throw new DocumentCacheProtectedDataError('envelope-malformed', 'Encrypted document metadata cleanup payload is invalid.');
  }
  return parsed as EncryptedMetadataEnvelope;
}

function aadForMetadata(storageName: string): Uint8Array {
  return new TextEncoder().encode(`lifesort-document-metadata:${storageName}:v1`);
}

function aadForMetadataCleanup(storageName: string): Uint8Array {
  return new TextEncoder().encode(`lifesort-document-metadata-cleanup:${storageName}:v1`);
}

function fileAad(): Uint8Array {
  return new TextEncoder().encode('lifesort-document-cache-file:v1');
}

function assertNoCleanupInProgress(): void {
  if (cleanupDepth > 0) {
    throw new DocumentCacheProtectedDataError(
      'cleanup-in-progress',
      'Document cache cleanup is in progress.',
    );
  }
}

function assertKeyEpoch(epoch: number): void {
  if (keyEpoch !== epoch) {
    throw new DocumentCacheProtectedDataError(
      'write-invalidated-by-key-deletion',
      'Document cache write was invalidated by encryption-key deletion.',
    );
  }
}

function assertKeyCreationEpoch(epoch: number): void {
  if (keyEpoch !== epoch) {
    throw new DocumentCacheProtectedDataError(
      'key-creation-invalidated',
      'Document cache key creation was invalidated by key deletion.',
    );
  }
}

function isCleanupLifecycleFailure(error: unknown): boolean {
  return (
    error instanceof DocumentCacheProtectedDataError &&
    ['cleanup-in-progress', 'key-creation-invalidated', 'write-invalidated-by-key-deletion'].includes(error.code)
  );
}

function beginDocumentCacheCleanupWindow(): void {
  keyEpoch += 1;
  cleanupDepth += 1;
  blockedStorageNames.clear();
}

function finishDocumentCacheCleanupWindow(): void {
  cleanupDepth = Math.max(0, cleanupDepth - 1);
  if (cleanupDepth === 0) blockedStorageNames.clear();
}

async function waitForActiveWrites(): Promise<void> {
  while (activeWrites.size > 0) {
    await Promise.allSettled([...activeWrites]);
  }
}

export async function withDocumentCacheCleanup<T>(cleanup: () => Promise<T>): Promise<T> {
  beginDocumentCacheCleanupWindow();
  try {
    return await cleanup();
  } finally {
    await waitForActiveWrites();
    finishDocumentCacheCleanupWindow();
  }
}

async function getOrCreateKey(operationEpoch = keyEpoch): Promise<AESEncryptionKey> {
  assertNoCleanupInProgress();
  if (Platform.OS === 'web') {
    throw new DocumentCacheProtectedDataError(
      'secure-store-unavailable',
      'Encrypted document cache requires native SecureStore.',
    );
  }

  if (keyCreationPromise) return keyCreationPromise;

  const epoch = operationEpoch;
  const promise = (async () => {
    let stored: string | null;
    try {
      stored = await SecureStore.getItemAsync(KEYCHAIN_KEY, SECURE_STORE_OPTIONS);
    } catch (error) {
      throw new DocumentCacheProtectedDataError('key-read-failed', 'Document cache encryption key could not be read.', error);
    }
    assertKeyCreationEpoch(epoch);

    if (stored) {
      try {
        const key = await AESEncryptionKey.import(stored, 'base64');
        assertKeyCreationEpoch(epoch);
        return key;
      } catch (error) {
        if (error instanceof DocumentCacheProtectedDataError) throw error;
        throw new DocumentCacheProtectedDataError('key-invalid', 'Stored document cache encryption key is invalid.', error);
      }
    }

    let key: AESEncryptionKey;
    let encoded: string;
    try {
      key = await AESEncryptionKey.generate();
      encoded = await key.encoded('base64');
    } catch (error) {
      throw new DocumentCacheProtectedDataError('key-creation-failed', 'Document cache encryption key could not be created.', error);
    }
    assertKeyCreationEpoch(epoch);

    try {
      await SecureStore.setItemAsync(KEYCHAIN_KEY, encoded, SECURE_STORE_OPTIONS);
    } catch (error) {
      throw new DocumentCacheProtectedDataError('key-creation-failed', 'Document cache encryption key could not be stored.', error);
    }
    if (keyEpoch !== epoch) {
      await SecureStore.deleteItemAsync(KEYCHAIN_KEY, SECURE_STORE_OPTIONS).catch(() => undefined);
      assertKeyCreationEpoch(epoch);
    }

    return key;
  })();

  keyCreationPromise = promise;
  try {
    return await promise;
  } finally {
    if (keyCreationPromise === promise) keyCreationPromise = null;
  }
}

async function getExistingKey(operationEpoch = keyEpoch): Promise<AESEncryptionKey> {
  assertNoCleanupInProgress();
  if (Platform.OS === 'web') {
    throw new DocumentCacheProtectedDataError(
      'secure-store-unavailable',
      'Encrypted document cache requires native SecureStore.',
    );
  }
  let stored: string | null;
  try {
    stored = await SecureStore.getItemAsync(KEYCHAIN_KEY, SECURE_STORE_OPTIONS);
  } catch (error) {
    throw new DocumentCacheProtectedDataError('key-read-failed', 'Document cache encryption key could not be read.', error);
  }
  assertKeyEpoch(operationEpoch);
  if (!stored) {
    throw new DocumentCacheProtectedDataError('key-missing', 'Encrypted document cache exists but its key is missing.');
  }
  try {
    const key = await AESEncryptionKey.import(stored, 'base64');
    assertKeyEpoch(operationEpoch);
    return key;
  } catch (error) {
    if (error instanceof DocumentCacheProtectedDataError) throw error;
    throw new DocumentCacheProtectedDataError('key-invalid', 'Stored document cache encryption key is invalid.', error);
  }
}

export async function encryptDocumentMetadataPayload(
  storageName: string,
  plaintext: string,
  operationEpoch = keyEpoch,
): Promise<string> {
  return encryptDocumentMetadataEnvelope(storageName, plaintext, [], operationEpoch);
}

async function encryptDocumentMetadataEnvelope(
  storageName: string,
  plaintext: string,
  pendingCleanupRecords: readonly LegacyPlaintextCleanupRecord[],
  operationEpoch = keyEpoch,
): Promise<string> {
  assertNoCleanupInProgress();
  assertKeyEpoch(operationEpoch);
  const key = await getOrCreateKey(operationEpoch);
  assertKeyEpoch(operationEpoch);
  const sealed = await aesEncryptAsync(new TextEncoder().encode(plaintext), key, {
    additionalData: aadForMetadata(storageName),
    nonce: { length: IV_LENGTH },
    tagLength: TAG_LENGTH,
  });

  const envelope: EncryptedMetadataEnvelope = {
    marker: METADATA_ENVELOPE_MARKER,
    version: ENVELOPE_VERSION,
    algorithm: 'AES-256-GCM',
    ivLength: IV_LENGTH,
    tagLength: TAG_LENGTH,
    ciphertext: await sealed.combined('base64'),
  };

  if (pendingCleanupRecords.length > 0) {
    const cleanupSealed = await aesEncryptAsync(
      new TextEncoder().encode(JSON.stringify(pendingCleanupRecords)),
      key,
      {
        additionalData: aadForMetadataCleanup(storageName),
        nonce: { length: IV_LENGTH },
        tagLength: TAG_LENGTH,
      },
    );
    envelope.pendingLegacyPlaintextCleanup = await cleanupSealed.combined('base64');
  }

  assertKeyEpoch(operationEpoch);
  return JSON.stringify(envelope);
}

type DecryptedMetadataEnvelope = {
  plaintext: string;
  pendingCleanupRecords: LegacyPlaintextCleanupRecord[];
};

function parseLegacyPlaintextCleanupRecords(value: string): LegacyPlaintextCleanupRecord[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) {
    throw new DocumentCacheProtectedDataError('envelope-malformed', 'Encrypted document metadata cleanup payload is malformed.');
  }

  return parsed.map((record) => {
    if (!isRecord(record) || typeof record.sourceUri !== 'string' || typeof record.encryptedUri !== 'string') {
      throw new DocumentCacheProtectedDataError('envelope-malformed', 'Encrypted document metadata cleanup record is malformed.');
    }
    if (!isLegacyPlaintextAttachmentCacheUri(record.sourceUri) || !isEncryptedAttachmentCacheUri(record.encryptedUri)) {
      throw new DocumentCacheProtectedDataError('envelope-malformed', 'Encrypted document metadata cleanup record has invalid cache paths.');
    }
    return { sourceUri: record.sourceUri, encryptedUri: record.encryptedUri };
  });
}

async function decryptDocumentMetadataEnvelope(
  storageName: string,
  stored: string,
  operationEpoch = keyEpoch,
): Promise<DecryptedMetadataEnvelope> {
  assertNoCleanupInProgress();
  assertKeyEpoch(operationEpoch);
  const parsed = parseStoredJson(stored);
  if (parsed.marker !== METADATA_ENVELOPE_MARKER) {
    throw new DocumentCacheProtectedDataError(
      'legacy-plaintext-malformed',
      'Existing document metadata storage is not an encrypted payload.',
    );
  }
  const envelope = parseEnvelope(parsed);
  const key = await getExistingKey(operationEpoch);

  try {
    const sealed = AESSealedData.fromCombined(envelope.ciphertext, {
      ivLength: envelope.ivLength,
      tagLength: envelope.tagLength,
    });
    const plaintextBytes = await aesDecryptAsync(sealed, key, { additionalData: aadForMetadata(storageName) });
    assertKeyEpoch(operationEpoch);

    let pendingCleanupRecords: LegacyPlaintextCleanupRecord[] = [];
    if (envelope.pendingLegacyPlaintextCleanup) {
      const cleanupSealed = AESSealedData.fromCombined(envelope.pendingLegacyPlaintextCleanup, {
        ivLength: envelope.ivLength,
        tagLength: envelope.tagLength,
      });
      const cleanupBytes = await aesDecryptAsync(cleanupSealed, key, {
        additionalData: aadForMetadataCleanup(storageName),
      });
      pendingCleanupRecords = parseLegacyPlaintextCleanupRecords(new TextDecoder().decode(cleanupBytes));
      assertKeyEpoch(operationEpoch);
    }

    return {
      plaintext: new TextDecoder().decode(plaintextBytes),
      pendingCleanupRecords,
    };
  } catch (error) {
    if (isCleanupLifecycleFailure(error)) throw error;
    if (error instanceof DocumentCacheProtectedDataError && error.code === 'envelope-malformed') throw error;
    throw new DocumentCacheProtectedDataError(
      'ciphertext-authentication-failed',
      'Encrypted document metadata could not be authenticated or decrypted.',
      error,
    );
  }
}

export async function decryptDocumentMetadataPayload(
  storageName: string,
  stored: string,
  operationEpoch = keyEpoch,
): Promise<string> {
  return (await decryptDocumentMetadataEnvelope(storageName, stored, operationEpoch)).plaintext;
}

function encryptedFileHeader(): Uint8Array {
  const header = new Uint8Array(FILE_HEADER_LENGTH);
  header.set(FILE_MAGIC, 0);
  header[FILE_MAGIC.length] = ENVELOPE_VERSION;
  header[FILE_MAGIC.length + 1] = IV_LENGTH;
  header[FILE_MAGIC.length + 2] = TAG_LENGTH;
  return header;
}

function concatBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  const output = new Uint8Array(first.length + second.length);
  output.set(first, 0);
  output.set(second, first.length);
  return output;
}

function parseEncryptedFile(bytes: Uint8Array): Uint8Array {
  if (bytes.length <= FILE_HEADER_LENGTH) {
    throw new DocumentCacheProtectedDataError('file-format-unsupported', 'Encrypted attachment cache file is too short.');
  }
  for (let i = 0; i < FILE_MAGIC.length; i += 1) {
    if (bytes[i] !== FILE_MAGIC[i]) {
      throw new DocumentCacheProtectedDataError('file-format-unsupported', 'Attachment cache file is not an encrypted LifeSort file.');
    }
  }
  if (bytes[FILE_MAGIC.length] !== ENVELOPE_VERSION) {
    throw new DocumentCacheProtectedDataError('envelope-unsupported-version', 'Encrypted attachment cache file uses an unsupported version.');
  }
  if (bytes[FILE_MAGIC.length + 1] !== IV_LENGTH || bytes[FILE_MAGIC.length + 2] !== TAG_LENGTH) {
    throw new DocumentCacheProtectedDataError('envelope-malformed', 'Encrypted attachment cache file metadata is invalid.');
  }
  return bytes.slice(FILE_HEADER_LENGTH);
}

function assertSizeIsSupported(uri: string, size?: number): void {
  if (typeof size === 'number' && size > MAX_ATTACHMENT_BYTES) {
    throw new DocumentCacheProtectedDataError(
      'file-too-large',
      'Attachment is too large for the APP-029 whole-buffer AES-GCM cache limit.',
    );
  }
}

async function ensureDirectory(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
}

async function readFileBytes(uri: string): Promise<Uint8Array> {
  const info = await FileSystem.getInfoAsync(uri);
  assertSizeIsSupported(uri, info.exists ? info.size : undefined);
  const bytes = await new File(uri).bytes();
  assertSizeIsSupported(uri, bytes.byteLength);
  return bytes;
}

async function writeFileBytes(uri: string, bytes: Uint8Array): Promise<void> {
  const file = new File(uri);
  file.create({ overwrite: true, intermediates: true });
  await Promise.resolve(file.write(bytes));
}

function safeTempExtension(name: string): string {
  const fallback = 'dat';
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1) return fallback;
  const ext = name.slice(lastDot + 1).toLowerCase();
  return /^[A-Za-z0-9]{1,8}$/.test(ext) ? ext : fallback;
}

function nextEncryptedAttachmentUri(): string {
  return `${ATTACHMENTS_DIR}${randomUUID()}.${FILE_EXTENSION}`;
}

function nextTemporaryAttachmentUri(name: string): string {
  return `${DECRYPTED_ATTACHMENTS_DIR}${randomUUID()}.${safeTempExtension(name)}`;
}

export function isEncryptedAttachmentCacheUri(uri: string): boolean {
  return uri.startsWith(ATTACHMENTS_DIR) && uri.endsWith(`.${FILE_EXTENSION}`);
}

export function isTemporaryDecryptedAttachmentUri(uri: string): boolean {
  return uri.startsWith(DECRYPTED_ATTACHMENTS_DIR);
}

function isLegacyPlaintextAttachmentCacheUri(uri: string): boolean {
  return uri.startsWith(ATTACHMENTS_DIR) && !isEncryptedAttachmentCacheUri(uri);
}

async function encryptAttachmentBytesToUri(sourceUri: string, destinationUri: string, operationEpoch = keyEpoch): Promise<void> {
  assertNoCleanupInProgress();
  assertKeyEpoch(operationEpoch);
  const key = await getOrCreateKey(operationEpoch);
  const plaintext = await readFileBytes(sourceUri);
  assertKeyEpoch(operationEpoch);
  const sealed = await aesEncryptAsync(plaintext, key, {
    additionalData: fileAad(),
    nonce: { length: IV_LENGTH },
    tagLength: TAG_LENGTH,
  });
  const combined = (await sealed.combined('bytes')) as Uint8Array;
  const encrypted = concatBytes(encryptedFileHeader(), combined);
  await ensureDirectory(ATTACHMENTS_DIR);
  await writeFileBytes(destinationUri, encrypted);
  if (keyEpoch !== operationEpoch) {
    await bestEffortDeleteFileIfExists(destinationUri);
    throw new DocumentCacheProtectedDataError(
      'write-invalidated-by-key-deletion',
      'Document cache file write was invalidated by encryption-key deletion.',
    );
  }
}

async function decryptAttachmentBytes(uri: string, operationEpoch = keyEpoch): Promise<Uint8Array> {
  assertNoCleanupInProgress();
  assertKeyEpoch(operationEpoch);
  const encrypted = await readFileBytes(uri);
  const combined = parseEncryptedFile(encrypted);
  const key = await getExistingKey(operationEpoch);

  try {
    const sealed = AESSealedData.fromCombined(combined, {
      ivLength: IV_LENGTH,
      tagLength: TAG_LENGTH,
    });
    const plaintext = (await aesDecryptAsync(sealed, key, { additionalData: fileAad() })) as Uint8Array;
    assertKeyEpoch(operationEpoch);
    return plaintext;
  } catch (error) {
    if (isCleanupLifecycleFailure(error)) throw error;
    throw new DocumentCacheProtectedDataError(
      'ciphertext-authentication-failed',
      'Encrypted attachment cache file could not be authenticated or decrypted.',
      error,
    );
  }
}

async function bestEffortDeleteFileIfExists(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

async function requiredDeleteLegacyPlaintextSource(record: LegacyPlaintextCleanupRecord): Promise<void> {
  const encryptedInfo = await FileSystem.getInfoAsync(record.encryptedUri);
  if (!encryptedInfo.exists) {
    throw new DocumentCacheProtectedDataError(
      'legacy-plaintext-cleanup-failed',
      'Legacy plaintext cleanup cannot proceed because the encrypted replacement is missing.',
    );
  }

  try {
    await FileSystem.deleteAsync(record.sourceUri, { idempotent: true });
    const sourceInfo = await FileSystem.getInfoAsync(record.sourceUri);
    if (sourceInfo.exists) {
      throw new Error('legacy plaintext still exists after delete');
    }
  } catch (error) {
    throw new DocumentCacheProtectedDataError(
      'legacy-plaintext-cleanup-failed',
      'Legacy plaintext attachment cache file could not be removed after encrypted migration.',
      error,
    );
  }
}

async function finalizeLegacyPlaintextCleanup(records: readonly LegacyPlaintextCleanupRecord[]): Promise<void> {
  for (const record of records) {
    await requiredDeleteLegacyPlaintextSource(record);
  }
}

async function trackWrite<T>(write: Promise<T>): Promise<T> {
  const tracked = write.then(() => undefined, () => undefined);
  activeWrites.add(tracked);
  try {
    return await write;
  } finally {
    activeWrites.delete(tracked);
  }
}

export async function persistEncryptedAttachmentFile(sourceUri: string): Promise<string> {
  const epoch = keyEpoch;
  const destinationUri = nextEncryptedAttachmentUri();
  await trackWrite(encryptAttachmentBytesToUri(sourceUri, destinationUri, epoch));
  return destinationUri;
}

export async function createTemporaryPlaintextAttachmentFile(encryptedUri: string, originalName: string): Promise<string> {
  const epoch = keyEpoch;
  const destinationUri = nextTemporaryAttachmentUri(originalName);
  await trackWrite(
    (async () => {
      const plaintext = await decryptAttachmentBytes(encryptedUri, epoch);
      await ensureDirectory(DECRYPTED_ATTACHMENTS_DIR);
      await writeFileBytes(destinationUri, plaintext);
      if (keyEpoch !== epoch) {
        await bestEffortDeleteFileIfExists(destinationUri);
        throw new DocumentCacheProtectedDataError(
          'write-invalidated-by-key-deletion',
          'Temporary document cache file was invalidated by encryption-key deletion.',
        );
      }
    })(),
  );
  return destinationUri;
}

export async function resolveLocalAttachmentUri(uri: string, originalName: string): Promise<string | null> {
  if (!uri) return null;
  if (!isEncryptedAttachmentCacheUri(uri)) return uri;
  return createTemporaryPlaintextAttachmentFile(uri, originalName);
}

export async function deleteCachedAttachmentFile(uri: string): Promise<void> {
  if (!uri || uri.startsWith('http')) return;
  if (uri.startsWith(ATTACHMENTS_DIR) || uri.startsWith(DECRYPTED_ATTACHMENTS_DIR)) {
    await bestEffortDeleteFileIfExists(uri);
  }
}

export async function clearPersistentAttachmentCache(): Promise<void> {
  await bestEffortDeleteFileIfExists(ATTACHMENTS_DIR);
}

export async function clearTemporaryAttachmentCache(): Promise<void> {
  await bestEffortDeleteFileIfExists(DECRYPTED_ATTACHMENTS_DIR);
}

export async function clearDocumentCacheEncryptionKey(): Promise<void> {
  if (Platform.OS === 'web') return;
  const ownsCleanupWindow = cleanupDepth === 0;
  if (ownsCleanupWindow) beginDocumentCacheCleanupWindow();
  try {
    await keyCreationPromise?.catch(() => undefined);
    await SecureStore.deleteItemAsync(KEYCHAIN_KEY, SECURE_STORE_OPTIONS);
  } finally {
    if (ownsCleanupWindow) finishDocumentCacheCleanupWindow();
  }
}

function visitAttachmentLists(payload: Record<string, unknown>, visit: (attachment: Record<string, unknown>) => void): void {
  if (!isRecord(payload.state)) return;
  const state = payload.state;

  if (Array.isArray(state.expenses)) {
    for (const expense of state.expenses) {
      if (isRecord(expense) && Array.isArray(expense.attachments)) {
        for (const attachment of expense.attachments) if (isRecord(attachment)) visit(attachment);
      }
    }
  }

  if (Array.isArray(state.warranties)) {
    for (const warranty of state.warranties) {
      if (isRecord(warranty) && Array.isArray(warranty.attachments)) {
        for (const attachment of warranty.attachments) if (isRecord(attachment)) visit(attachment);
      }
    }
  }

  if (Array.isArray(state.trips)) {
    for (const trip of state.trips) {
      if (isRecord(trip) && Array.isArray(trip.documents)) {
        for (const attachment of trip.documents) if (isRecord(attachment)) visit(attachment);
      }
    }
  }
}

function looksLikeKnownDocumentMetadataPayload(storageName: string, parsed: Record<string, unknown>): boolean {
  if (!isRecord(parsed.state)) return false;
  const state = parsed.state;
  if (storageName === 'lifesort-expenses') {
    return Array.isArray(state.expenses) && isRecord(state.seriesStoppedAt) && isRecord(state.categoryBudgets);
  }
  if (storageName === 'lifesort-warranties') {
    return Array.isArray(state.warranties);
  }
  if (storageName === 'lifesort-trips') {
    return Array.isArray(state.trips) && Array.isArray(state.expenses) && Array.isArray(state.packingItems);
  }
  return false;
}

async function prepareLegacyPayloadMigration(storageName: string, value: string): Promise<PreparedPayloadMigration> {
  const parsed = parseStoredJson(value);
  if (!looksLikeKnownDocumentMetadataPayload(storageName, parsed)) {
    throw new DocumentCacheProtectedDataError(
      'legacy-plaintext-malformed',
      'Existing document metadata storage is not a known legacy attachment payload.',
    );
  }

  const migrations: LegacyFileMigration[] = [];
  visitAttachmentLists(parsed, (attachment) => {
    const uri = attachment.uri;
    if (typeof uri === 'string' && isLegacyPlaintextAttachmentCacheUri(uri)) {
      const encryptedUri = nextEncryptedAttachmentUri();
      migrations.push({ sourceUri: uri, encryptedUri });
      attachment.uri = encryptedUri;
    }
  });

  for (const migration of migrations) {
    await encryptAttachmentBytesToUri(migration.sourceUri, migration.encryptedUri);
  }

  const migratedValue = JSON.stringify(parsed);
  return {
    value: migratedValue,
    cleanupRecords: migrations,
    rollback: async () => {
      for (const migration of migrations) await bestEffortDeleteFileIfExists(migration.encryptedUri);
    },
  };
}

async function performEncryptedDocumentMetadataWrite(
  name: string,
  value: string,
  operationEpoch: number,
  pendingCleanupRecords: readonly LegacyPlaintextCleanupRecord[] = [],
): Promise<string> {
  assertNoCleanupInProgress();
  assertKeyEpoch(operationEpoch);
  const encrypted = await encryptDocumentMetadataEnvelope(name, value, pendingCleanupRecords, operationEpoch);
  assertKeyEpoch(operationEpoch);
  await AsyncStorage.setItem(name, encrypted);
  if (keyEpoch !== operationEpoch) {
    await removeIfCurrentValue(name, encrypted);
    throw new DocumentCacheProtectedDataError(
      'write-invalidated-by-key-deletion',
      'Document metadata write was invalidated by encryption-key deletion.',
    );
  }
  return encrypted;
}

async function writeEncryptedDocumentMetadataPayload(name: string, value: string, operationEpoch = keyEpoch): Promise<string> {
  assertNoCleanupInProgress();
  return trackWrite(performEncryptedDocumentMetadataWrite(name, value, operationEpoch));
}

async function removePendingCleanupRecordsFromCurrentEnvelope(
  name: string,
  value: string,
  expectedStoredValue: string,
  operationEpoch: number,
): Promise<void> {
  assertNoCleanupInProgress();
  assertKeyEpoch(operationEpoch);
  const current = await AsyncStorage.getItem(name);
  assertKeyEpoch(operationEpoch);
  if (current !== expectedStoredValue) return;
  await performEncryptedDocumentMetadataWrite(name, value, operationEpoch);
}

async function bestEffortRemovePendingCleanupRecordsFromCurrentEnvelope(
  name: string,
  value: string,
  expectedStoredValue: string,
  operationEpoch: number,
): Promise<void> {
  try {
    await removePendingCleanupRecordsFromCurrentEnvelope(name, value, expectedStoredValue, operationEpoch);
  } catch (error) {
    if (isCleanupLifecycleFailure(error)) throw error;
  }
}

async function retryPendingLegacyPlaintextCleanup(
  name: string,
  plaintext: string,
  pendingCleanupRecords: readonly LegacyPlaintextCleanupRecord[],
  stored: string,
  operationEpoch: number,
): Promise<void> {
  if (pendingCleanupRecords.length === 0) return;
  await finalizeLegacyPlaintextCleanup(pendingCleanupRecords);
  await bestEffortRemovePendingCleanupRecordsFromCurrentEnvelope(name, plaintext, stored, operationEpoch);
}

async function performLegacyPayloadMigration(name: string, stored: string, operationEpoch: number): Promise<string> {
  let prepared: PreparedPayloadMigration | null = null;
  try {
    prepared = await prepareLegacyPayloadMigration(name, stored);
    const encryptedStoredValue = await performEncryptedDocumentMetadataWrite(
      name,
      prepared.value,
      operationEpoch,
      prepared.cleanupRecords,
    );
    await finalizeLegacyPlaintextCleanup(prepared.cleanupRecords);
    await bestEffortRemovePendingCleanupRecordsFromCurrentEnvelope(name, prepared.value, encryptedStoredValue, operationEpoch);
    blockedStorageNames.delete(name);
    return prepared.value;
  } catch (error) {
    if (prepared && !(error instanceof DocumentCacheProtectedDataError && error.code === 'legacy-plaintext-cleanup-failed')) {
      await prepared.rollback();
    }
    if (isCleanupLifecycleFailure(error)) throw error;
    blockedStorageNames.add(name);
    if (error instanceof DocumentCacheProtectedDataError && error.code === 'legacy-plaintext-cleanup-failed') {
      throw error;
    }
    throw new DocumentCacheProtectedDataError(
      'migration-failed',
      'Existing plaintext document metadata could not be migrated to encrypted storage.',
      error,
    );
  }
}

async function readDocumentMetadataPayload(name: string): Promise<string | null> {
  assertNoCleanupInProgress();
  const epoch = keyEpoch;
  const stored = await AsyncStorage.getItem(name);
  assertKeyEpoch(epoch);
  if (stored === null) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = parseStoredJson(stored);
  } catch (error) {
    blockedStorageNames.add(name);
    throw error;
  }

  if (parsed.marker === METADATA_ENVELOPE_MARKER) {
    try {
      const { plaintext, pendingCleanupRecords } = await decryptDocumentMetadataEnvelope(name, stored, epoch);
      await trackWrite(retryPendingLegacyPlaintextCleanup(name, plaintext, pendingCleanupRecords, stored, epoch));
      blockedStorageNames.delete(name);
      return plaintext;
    } catch (error) {
      if (!isCleanupLifecycleFailure(error)) blockedStorageNames.add(name);
      throw error;
    }
  }

  return trackWrite(performLegacyPayloadMigration(name, stored, epoch));
}

async function removeIfCurrentValue(name: string, expectedValue: string): Promise<void> {
  const current = await AsyncStorage.getItem(name);
  if (current === expectedValue) await AsyncStorage.removeItem(name);
}

export const documentMetadataEncryptedStorage: StateStorage<Promise<void>> = {
  getItem: readDocumentMetadataPayload,
  setItem: async (name, value) => {
    if (cleanupDepth > 0) return;
    assertNoCleanupInProgress();
    if (blockedStorageNames.has(name)) {
      throw new DocumentCacheProtectedDataError(
        'write-blocked-after-protected-failure',
        'Document metadata writes are blocked after protected-data hydration failed.',
      );
    }
    await writeEncryptedDocumentMetadataPayload(name, value);
  },
  removeItem: async (name) => {
    blockedStorageNames.delete(name);
    await AsyncStorage.removeItem(name);
  },
};
