import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { StateStorage } from 'zustand/middleware';

const KEYCHAIN_KEY = 'lifesort-cycle-health-key';
const ENVELOPE_MARKER = '__lifesort_encrypted_cycle_store__';
const ENVELOPE_VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const AAD = new TextEncoder().encode('lifesort-cycle:v1');

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

type EncryptedCycleEnvelope = {
  marker: typeof ENVELOPE_MARKER;
  version: typeof ENVELOPE_VERSION;
  algorithm: 'AES-256-GCM';
  ivLength: typeof IV_LENGTH;
  tagLength: typeof TAG_LENGTH;
  ciphertext: string;
};

type ProtectedDataFailureCode =
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
  | 'write-blocked-after-protected-failure'
  | 'write-invalidated-by-key-deletion';

export class CycleHealthProtectedDataError extends Error {
  constructor(
    readonly code: ProtectedDataFailureCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CycleHealthProtectedDataError';
  }
}

let keyCreationPromise: Promise<AESEncryptionKey> | null = null;
let keyEpoch = 0;
let cleanupDepth = 0;
const blockedStorageNames = new Set<string>();
const activeWrites = new Set<Promise<void>>();

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

function parseEnvelope(parsed: Record<string, unknown>): EncryptedCycleEnvelope {
  if (parsed.version !== ENVELOPE_VERSION) {
    throw new CycleHealthProtectedDataError(
      'envelope-unsupported-version',
      'Encrypted cycle storage uses an unsupported payload version.',
    );
  }
  if (parsed.algorithm !== 'AES-256-GCM') {
    throw new CycleHealthProtectedDataError('envelope-malformed', 'Encrypted cycle storage algorithm is invalid.');
  }
  if (parsed.ivLength !== IV_LENGTH || parsed.tagLength !== TAG_LENGTH) {
    throw new CycleHealthProtectedDataError('envelope-malformed', 'Encrypted cycle storage metadata is invalid.');
  }
  if (typeof parsed.ciphertext !== 'string' || parsed.ciphertext.length === 0) {
    throw new CycleHealthProtectedDataError('envelope-malformed', 'Encrypted cycle storage ciphertext is missing.');
  }
  return parsed as EncryptedCycleEnvelope;
}

function parseStoredJson(value: string): Record<string, unknown> {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) {
    throw new CycleHealthProtectedDataError(
      'legacy-plaintext-malformed',
      'Existing cycle storage is neither encrypted nor a valid legacy Zustand payload.',
    );
  }
  return parsed;
}

function isCycleEntryLike(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && typeof value.startDate === 'string';
}

function isSymptomLogLike(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && typeof value.date === 'string' && Array.isArray(value.symptoms);
}

function looksLikeLegacyCycleZustandPayload(parsed: Record<string, unknown>): boolean {
  if (!isRecord(parsed.state)) return false;
  const state = parsed.state;
  return (
    Array.isArray(state.cycles) &&
    state.cycles.every(isCycleEntryLike) &&
    Array.isArray(state.symptomLogs) &&
    state.symptomLogs.every(isSymptomLogLike) &&
    typeof state.avgCycleLength === 'number' &&
    typeof state.lutealPhaseLength === 'number' &&
    typeof state.reminderEnabled === 'boolean' &&
    typeof state.reminderDaysBefore === 'number' &&
    Array.isArray(state.healthConditions) &&
    Array.isArray(state.symptomGlossary)
  );
}

function assertKeyEpoch(epoch: number): void {
  if (keyEpoch !== epoch) {
    throw new CycleHealthProtectedDataError(
      'write-invalidated-by-key-deletion',
      'Cycle storage write was invalidated by encryption-key deletion.',
    );
  }
}

function assertNoCleanupInProgress(): void {
  if (cleanupDepth > 0) {
    throw new CycleHealthProtectedDataError(
      'cleanup-in-progress',
      'Cycle encrypted storage cleanup is in progress.',
    );
  }
}

function assertKeyCreationEpoch(epoch: number): void {
  if (keyEpoch !== epoch) {
    throw new CycleHealthProtectedDataError(
      'key-creation-invalidated',
      'Cycle encryption key creation was invalidated by key deletion.',
    );
  }
}

function isCleanupLifecycleFailure(error: unknown): boolean {
  return (
    error instanceof CycleHealthProtectedDataError &&
    ['cleanup-in-progress', 'key-creation-invalidated', 'write-invalidated-by-key-deletion'].includes(error.code)
  );
}

function beginCycleHealthCleanupWindow(): void {
  keyEpoch += 1;
  cleanupDepth += 1;
  blockedStorageNames.clear();
}

function finishCycleHealthCleanupWindow(): void {
  cleanupDepth = Math.max(0, cleanupDepth - 1);
  if (cleanupDepth === 0) blockedStorageNames.clear();
}

async function waitForActiveWrites(): Promise<void> {
  while (activeWrites.size > 0) {
    await Promise.allSettled([...activeWrites]);
  }
}

export async function withCycleHealthEncryptedStorageCleanup<T>(cleanup: () => Promise<T>): Promise<T> {
  beginCycleHealthCleanupWindow();
  try {
    return await cleanup();
  } finally {
    await waitForActiveWrites();
    finishCycleHealthCleanupWindow();
  }
}

async function getOrCreateKey(operationEpoch = keyEpoch): Promise<AESEncryptionKey> {
  assertNoCleanupInProgress();
  if (Platform.OS === 'web') {
    throw new CycleHealthProtectedDataError(
      'secure-store-unavailable',
      'Encrypted cycle storage requires native SecureStore.',
    );
  }

  if (keyCreationPromise) {
    return keyCreationPromise;
  }

  const epoch = operationEpoch;
  const promise = (async () => {
    let stored: string | null;
    try {
      stored = await SecureStore.getItemAsync(KEYCHAIN_KEY, SECURE_STORE_OPTIONS);
    } catch (error) {
      throw new CycleHealthProtectedDataError('key-read-failed', 'Cycle encryption key could not be read.', error);
    }
    assertKeyCreationEpoch(epoch);
    if (stored) {
      try {
        const key = await AESEncryptionKey.import(stored, 'base64');
        assertKeyCreationEpoch(epoch);
        return key;
      } catch (error) {
        if (error instanceof CycleHealthProtectedDataError) throw error;
        throw new CycleHealthProtectedDataError('key-invalid', 'Stored cycle encryption key is invalid.', error);
      }
    }

    let key: AESEncryptionKey;
    let encoded: string;
    try {
      key = await AESEncryptionKey.generate();
      encoded = await key.encoded('base64');
    } catch (error) {
      throw new CycleHealthProtectedDataError('key-creation-failed', 'Cycle encryption key could not be created.', error);
    }
    assertKeyCreationEpoch(epoch);

    try {
      await SecureStore.setItemAsync(KEYCHAIN_KEY, encoded, SECURE_STORE_OPTIONS);
    } catch (error) {
      throw new CycleHealthProtectedDataError('key-creation-failed', 'Cycle encryption key could not be stored.', error);
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
    throw new CycleHealthProtectedDataError(
      'secure-store-unavailable',
      'Encrypted cycle storage requires native SecureStore.',
    );
  }
  let stored: string | null;
  try {
    stored = await SecureStore.getItemAsync(KEYCHAIN_KEY, SECURE_STORE_OPTIONS);
  } catch (error) {
    throw new CycleHealthProtectedDataError('key-read-failed', 'Cycle encryption key could not be read.', error);
  }
  assertKeyEpoch(operationEpoch);
  if (!stored) {
    throw new CycleHealthProtectedDataError('key-missing', 'Encrypted cycle storage exists but its key is missing.');
  }
  try {
    const key = await AESEncryptionKey.import(stored, 'base64');
    assertKeyEpoch(operationEpoch);
    return key;
  } catch (error) {
    if (error instanceof CycleHealthProtectedDataError) throw error;
    throw new CycleHealthProtectedDataError('key-invalid', 'Stored cycle encryption key is invalid.', error);
  }
}

export async function encryptCycleStorePayload(plaintext: string, operationEpoch = keyEpoch): Promise<string> {
  assertNoCleanupInProgress();
  assertKeyEpoch(operationEpoch);
  const key = await getOrCreateKey(operationEpoch);
  assertKeyEpoch(operationEpoch);
  const sealed = await aesEncryptAsync(new TextEncoder().encode(plaintext), key, {
    additionalData: AAD,
    nonce: { length: IV_LENGTH },
    tagLength: TAG_LENGTH,
  });

  const envelope: EncryptedCycleEnvelope = {
    marker: ENVELOPE_MARKER,
    version: ENVELOPE_VERSION,
    algorithm: 'AES-256-GCM',
    ivLength: IV_LENGTH,
    tagLength: TAG_LENGTH,
    ciphertext: await sealed.combined('base64'),
  };

  assertKeyEpoch(operationEpoch);
  return JSON.stringify(envelope);
}

export async function decryptCycleStorePayload(stored: string, operationEpoch = keyEpoch): Promise<string> {
  assertNoCleanupInProgress();
  assertKeyEpoch(operationEpoch);
  const parsed = parseStoredJson(stored);
  if (parsed.marker !== ENVELOPE_MARKER) {
    throw new CycleHealthProtectedDataError(
      'legacy-plaintext-malformed',
      'Existing cycle storage is not an encrypted payload.',
    );
  }
  const envelope = parseEnvelope(parsed);
  const key = await getExistingKey(operationEpoch);

  try {
    const sealed = AESSealedData.fromCombined(envelope.ciphertext, {
      ivLength: envelope.ivLength,
      tagLength: envelope.tagLength,
    });
    const plaintextBytes = await aesDecryptAsync(sealed, key, { additionalData: AAD });
    assertKeyEpoch(operationEpoch);
    return new TextDecoder().decode(plaintextBytes);
  } catch (error) {
    if (isCleanupLifecycleFailure(error)) throw error;
    throw new CycleHealthProtectedDataError(
      'ciphertext-authentication-failed',
      'Encrypted cycle storage could not be authenticated or decrypted.',
      error,
    );
  }
}

async function performEncryptedCycleStoreWrite(name: string, value: string, operationEpoch: number): Promise<void> {
  assertNoCleanupInProgress();
  assertKeyEpoch(operationEpoch);
  const encrypted = await encryptCycleStorePayload(value, operationEpoch);
  assertKeyEpoch(operationEpoch);
  await AsyncStorage.setItem(name, encrypted);
  if (keyEpoch !== operationEpoch) {
    await removeIfCurrentValue(name, encrypted);
    throw new CycleHealthProtectedDataError(
      'write-invalidated-by-key-deletion',
      'Cycle storage write was invalidated by encryption-key deletion.',
    );
  }
}

async function writeEncryptedCycleStorePayload(name: string, value: string, operationEpoch = keyEpoch): Promise<void> {
  assertNoCleanupInProgress();
  const write = performEncryptedCycleStoreWrite(name, value, operationEpoch);
  activeWrites.add(write);
  try {
    await write;
  } finally {
    activeWrites.delete(write);
  }
}

async function readCycleStorePayload(name: string): Promise<string | null> {
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

  if (parsed.marker === ENVELOPE_MARKER) {
    try {
      const plaintext = await decryptCycleStorePayload(stored, epoch);
      blockedStorageNames.delete(name);
      return plaintext;
    } catch (error) {
      if (!isCleanupLifecycleFailure(error)) blockedStorageNames.add(name);
      throw error;
    }
  }

  if (!looksLikeLegacyCycleZustandPayload(parsed)) {
    blockedStorageNames.add(name);
    throw new CycleHealthProtectedDataError(
      'legacy-plaintext-malformed',
      'Existing cycle storage is not a valid legacy cycle Zustand payload.',
    );
  }

  try {
    await writeEncryptedCycleStorePayload(name, stored, epoch);
    blockedStorageNames.delete(name);
    return stored;
  } catch (error) {
    if (isCleanupLifecycleFailure(error)) throw error;
    blockedStorageNames.add(name);
    throw new CycleHealthProtectedDataError(
      'migration-failed',
      'Existing plaintext cycle storage could not be migrated to encrypted storage.',
      error,
    );
  }
}

export async function clearCycleHealthEncryptionKey(): Promise<void> {
  if (Platform.OS === 'web') return;
  const ownsCleanupWindow = cleanupDepth === 0;
  if (ownsCleanupWindow) beginCycleHealthCleanupWindow();
  try {
    await keyCreationPromise?.catch(() => undefined);
    await SecureStore.deleteItemAsync(KEYCHAIN_KEY, SECURE_STORE_OPTIONS);
  } finally {
    if (ownsCleanupWindow) finishCycleHealthCleanupWindow();
  }
}

async function removeIfCurrentValue(name: string, expectedValue: string): Promise<void> {
  const current = await AsyncStorage.getItem(name);
  if (current === expectedValue) await AsyncStorage.removeItem(name);
}

export const cycleHealthEncryptedStorage: StateStorage<Promise<void>> = {
  getItem: readCycleStorePayload,
  setItem: async (name, value) => {
    if (cleanupDepth > 0) return;
    assertNoCleanupInProgress();
    if (blockedStorageNames.has(name)) {
      throw new CycleHealthProtectedDataError(
        'write-blocked-after-protected-failure',
        'Cycle storage writes are blocked after protected-data hydration failed.',
      );
    }
    await writeEncryptedCycleStorePayload(name, value);
  },
  removeItem: async (name) => {
    blockedStorageNames.delete(name);
    await AsyncStorage.removeItem(name);
  },
};
