import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { PREGNANCY_HEALTH_STORAGE } from './pregnancyHealthStorageContract';

const MARKER = '__lifesort_encrypted_pregnancy_store__';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const AAD = new TextEncoder().encode(PREGNANCY_HEALTH_STORAGE.aad);
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type EncryptedPregnancyEnvelopeV1 = {
  marker: typeof MARKER;
  version: typeof PREGNANCY_HEALTH_STORAGE.envelopeVersion;
  algorithm: 'AES-256-GCM';
  ivLength: typeof IV_LENGTH;
  tagLength: typeof TAG_LENGTH;
  ciphertext: string;
};

export type PregnancyProtectedDataFailureCode =
  | 'secure-store-unavailable' | 'key-missing' | 'key-read-failed' | 'key-invalid'
  | 'key-creation-failed' | 'key-creation-invalidated' | 'cleanup-in-progress'
  | 'envelope-malformed' | 'envelope-unsupported-version' | 'ciphertext-authentication-failed'
  | 'unexpected-plaintext' | 'write-blocked-after-protected-failure'
  | 'write-invalidated-by-cleanup' | 'write-invalidated-by-key-deletion';

export class PregnancyProtectedDataError extends Error {
  constructor(readonly code: PregnancyProtectedDataFailureCode, message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'PregnancyProtectedDataError';
  }
}

let keyCreation: Promise<AESEncryptionKey> | null = null;
let lifecycleGeneration = 0;
let cleanupDepth = 0;
const blockedNames = new Set<string>();
const activeWrites = new Set<Promise<void>>();

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code: PregnancyProtectedDataFailureCode, message: string, cause?: unknown): never {
  throw new PregnancyProtectedDataError(code, message, cause);
}

function assertLive(generation: number): void {
  if (cleanupDepth > 0) fail('cleanup-in-progress', 'Pregnancy protected storage cleanup is in progress.');
  if (generation !== lifecycleGeneration) {
    fail('write-invalidated-by-cleanup', 'Pregnancy protected storage operation was invalidated by cleanup.');
  }
}

function assertKeyCreationLive(generation: number): void {
  if (generation !== lifecycleGeneration) {
    fail('key-creation-invalidated', 'Pregnancy encryption key creation was invalidated by cleanup.');
  }
  if (cleanupDepth > 0) fail('cleanup-in-progress', 'Pregnancy protected storage cleanup is in progress.');
}

function parseOuter(raw: string): EncryptedPregnancyEnvelopeV1 {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { fail('unexpected-plaintext', 'Pregnancy storage is not an encrypted payload.'); }
  if (!record(parsed) || parsed.marker !== MARKER) {
    fail('unexpected-plaintext', 'Pregnancy storage is not an encrypted payload.');
  }
  if (parsed.version !== PREGNANCY_HEALTH_STORAGE.envelopeVersion) {
    fail('envelope-unsupported-version', 'Pregnancy encrypted storage uses an unsupported payload version.');
  }
  if (parsed.algorithm !== 'AES-256-GCM' || parsed.ivLength !== IV_LENGTH || parsed.tagLength !== TAG_LENGTH ||
      typeof parsed.ciphertext !== 'string' || parsed.ciphertext.length === 0) {
    fail('envelope-malformed', 'Pregnancy encrypted storage metadata is invalid.');
  }
  return parsed as EncryptedPregnancyEnvelopeV1;
}

async function existingKey(generation: number): Promise<AESEncryptionKey> {
  assertLive(generation);
  if (Platform.OS === 'web') fail('secure-store-unavailable', 'Pregnancy encrypted storage requires native SecureStore.');
  let encoded: string | null;
  try { encoded = await SecureStore.getItemAsync(PREGNANCY_HEALTH_STORAGE.secureStoreKey, OPTIONS); }
  catch (error) { fail('key-read-failed', 'Pregnancy encryption key could not be read.', error); }
  assertLive(generation);
  if (!encoded) fail('key-missing', 'Pregnancy encrypted storage exists but its key is missing.');
  try { return await AESEncryptionKey.import(encoded, 'base64'); }
  catch (error) { fail('key-invalid', 'Pregnancy encryption key is invalid.', error); }
}

async function createKey(generation: number): Promise<AESEncryptionKey> {
  assertKeyCreationLive(generation);
  if (Platform.OS === 'web') fail('secure-store-unavailable', 'Pregnancy encrypted storage requires native SecureStore.');
  if (keyCreation) return keyCreation;
  const promise = (async () => {
    let encoded: string | null;
    try { encoded = await SecureStore.getItemAsync(PREGNANCY_HEALTH_STORAGE.secureStoreKey, OPTIONS); }
    catch (error) { fail('key-read-failed', 'Pregnancy encryption key could not be read.', error); }
    assertKeyCreationLive(generation);
    if (encoded) {
      try { return await AESEncryptionKey.import(encoded, 'base64'); }
      catch (error) { fail('key-invalid', 'Pregnancy encryption key is invalid.', error); }
    }
    let key: AESEncryptionKey;
    let serialized: string;
    try { key = await AESEncryptionKey.generate(); serialized = await key.encoded('base64'); }
    catch (error) { fail('key-creation-failed', 'Pregnancy encryption key could not be created.', error); }
    assertKeyCreationLive(generation);
    try { await SecureStore.setItemAsync(PREGNANCY_HEALTH_STORAGE.secureStoreKey, serialized, OPTIONS); }
    catch (error) { fail('key-creation-failed', 'Pregnancy encryption key could not be stored.', error); }
    if (generation !== lifecycleGeneration || cleanupDepth > 0) {
      await SecureStore.deleteItemAsync(PREGNANCY_HEALTH_STORAGE.secureStoreKey, OPTIONS).catch(() => undefined);
      fail('key-creation-invalidated', 'Pregnancy encryption key creation was invalidated by cleanup.');
    }
    return key;
  })();
  keyCreation = promise;
  try { return await promise; } finally { if (keyCreation === promise) keyCreation = null; }
}

export function pregnancyHealthStorageGeneration(): number { return lifecycleGeneration; }

export async function readEncryptedPregnancyPayload(name = PREGNANCY_HEALTH_STORAGE.asyncStorageKey): Promise<string | null> {
  const generation = lifecycleGeneration;
  assertLive(generation);
  let stored: string | null;
  try { stored = await AsyncStorage.getItem(name); }
  catch (error) { fail('envelope-malformed', 'Pregnancy encrypted storage could not be read.', error); }
  assertLive(generation);
  if (stored === null) return null;
  try {
    const outer = parseOuter(stored);
    const key = await existingKey(generation);
    const sealed = AESSealedData.fromCombined(outer.ciphertext, { ivLength: IV_LENGTH, tagLength: TAG_LENGTH });
    const bytes = await aesDecryptAsync(sealed, key, { additionalData: AAD });
    assertLive(generation);
    blockedNames.delete(name);
    return new TextDecoder().decode(bytes);
  } catch (error) {
    if (!(error instanceof PregnancyProtectedDataError) || !['cleanup-in-progress', 'write-invalidated-by-cleanup'].includes(error.code)) blockedNames.add(name);
    if (error instanceof PregnancyProtectedDataError) throw error;
    fail('ciphertext-authentication-failed', 'Pregnancy encrypted storage could not be authenticated.', error);
  }
}

export async function writeEncryptedPregnancyPayload(
  plaintext: string,
  name = PREGNANCY_HEALTH_STORAGE.asyncStorageKey,
): Promise<void> {
  const generation = lifecycleGeneration;
  assertLive(generation);
  if (blockedNames.has(name)) fail('write-blocked-after-protected-failure', 'Pregnancy writes are blocked after a protected-data failure.');
  const write = (async () => {
    let existingCiphertext: string | null;
    try { existingCiphertext = await AsyncStorage.getItem(name); }
    catch (error) { fail('envelope-malformed', 'Pregnancy encrypted storage could not be read.', error); }
    assertLive(generation);
    // An existing ciphertext must be proven readable before any normal write. This
    // prevents a lost key or corrupt ciphertext from being silently replaced.
    if (existingCiphertext !== null) await readEncryptedPregnancyPayload(name);
    const key = existingCiphertext === null ? await createKey(generation) : await existingKey(generation);
    assertLive(generation);
    let sealed: AESSealedData;
    try {
      sealed = await aesEncryptAsync(new TextEncoder().encode(plaintext), key, {
        additionalData: AAD, nonce: { length: IV_LENGTH }, tagLength: TAG_LENGTH,
      });
    } catch (error) { fail('ciphertext-authentication-failed', 'Pregnancy state could not be encrypted.', error); }
    assertLive(generation);
    const outer: EncryptedPregnancyEnvelopeV1 = {
      marker: MARKER, version: PREGNANCY_HEALTH_STORAGE.envelopeVersion, algorithm: 'AES-256-GCM',
      ivLength: IV_LENGTH, tagLength: TAG_LENGTH, ciphertext: await sealed.combined('base64'),
    };
    const stored = JSON.stringify(outer);
    assertLive(generation);
    await AsyncStorage.setItem(name, stored);
    if (generation !== lifecycleGeneration) {
      const current = await AsyncStorage.getItem(name);
      if (current === stored) await AsyncStorage.removeItem(name);
      if (cleanupDepth > 0) {
        fail('write-invalidated-by-cleanup', 'Pregnancy write was invalidated by cleanup.');
      }
      fail('write-invalidated-by-key-deletion', 'Pregnancy write was invalidated by encryption-key deletion.');
    }
  })();
  activeWrites.add(write);
  try { await write; } finally { activeWrites.delete(write); }
}

export async function clearPregnancyHealthEncryptionKey(): Promise<void> {
  lifecycleGeneration += 1;
  const owned = cleanupDepth === 0;
  if (owned) cleanupDepth += 1;
  try {
    await keyCreation?.catch(() => undefined);
    if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(PREGNANCY_HEALTH_STORAGE.secureStoreKey, OPTIONS);
  } finally { if (owned) cleanupDepth -= 1; }
}

export async function withPregnancyHealthEncryptedStorageCleanup<T>(cleanup: () => Promise<T>): Promise<T> {
  lifecycleGeneration += 1;
  cleanupDepth += 1;
  blockedNames.clear();
  try {
    await Promise.allSettled([...activeWrites]);
    return await cleanup();
  } finally { cleanupDepth -= 1; }
}
