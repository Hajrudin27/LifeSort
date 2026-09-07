import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const PIN_KEY = 'lifesort-app-pin-hash';

// PIN-koden skal kun være læsbar mens enheden er låst op, og må aldrig følge med
// til en ny enhed eller en iCloud-nøglering.
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const PIN_RECORD_VERSION = 2;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 32;

// En 4-cifret PIN har kun 10.000 muligheder, så ingen KDF gør den umulig at
// gennemprøve for en angriber, der allerede har fået fat i nøgleringen. Formålet
// her er at gøre hvert gæt dyrt nok til at et offline-angreb tager tid, uden at
// oplåsningen føles langsom. Den reelle beskyttelse er hardware-lagringen og
// spærretiden i pinLockout.ts.
const PBKDF2_ITERATIONS = 100_000;

type StoredPinRecord = {
  v: number;
  salt: string;
  hash: string;
  iterations: number;
};

/**
 * Sammenligner uden at afsløre via køretiden, hvor mange bytes der matchede.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8ToBytes(pin), salt, { c: iterations, dkLen: DERIVED_KEY_BYTES });
}

function parseRecord(raw: string): StoredPinRecord | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.salt === 'string' &&
      typeof parsed.hash === 'string' &&
      typeof parsed.iterations === 'number' &&
      parsed.v === PIN_RECORD_VERSION
    ) {
      return parsed as StoredPinRecord;
    }
  } catch {
    // Ikke JSON — så er det en gammel v1-værdi, håndteret af kaldet nedenfor.
  }
  return null;
}

/**
 * Gemmer PIN-koden som en saltet PBKDF2-udledning. Selve koden forlader aldrig
 * enheden — den må hverken synkroniseres til Supabase eller indgå i en backup.
 */
export async function savePin(pin: string): Promise<void> {
  const salt = await Crypto.getRandomBytesAsync(SALT_BYTES);
  const hash = await derive(pin, salt, PBKDF2_ITERATIONS);

  const record: StoredPinRecord = {
    v: PIN_RECORD_VERSION,
    salt: bytesToHex(salt),
    hash: bytesToHex(hash),
    iterations: PBKDF2_ITERATIONS,
  };

  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(record), SECURE_STORE_OPTIONS);
}

export async function hasPin(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(PIN_KEY, SECURE_STORE_OPTIONS);
  return raw !== null;
}

/**
 * Verificerer en indtastet PIN. Kalderen — ikke denne funktion — er ansvarlig for
 * at håndhæve spærretiden ved gentagne fejl (se pinLockout.ts).
 *
 * Gamle installationer har en usaltet SHA-256 liggende. Den accepteres stadig én
 * gang, hvorefter værdien straks skrives om til det saltede format, så ingen
 * bliver låst ude af opgraderingen.
 */
export async function verifyPin(pin: string): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(PIN_KEY, SECURE_STORE_OPTIONS);
  if (raw === null) return false;

  const record = parseRecord(raw);

  if (record) {
    const candidate = await derive(pin, hexToBytes(record.salt), record.iterations);
    return timingSafeEqual(candidate, hexToBytes(record.hash));
  }

  // v1: rå, usaltet SHA-256-hex fra expo-crypto.
  const legacyHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin);
  const isValid = timingSafeEqual(utf8ToBytes(legacyHash.toLowerCase()), utf8ToBytes(raw.trim().toLowerCase()));

  if (isValid) {
    await savePin(pin);
  }

  return isValid;
}

export async function clearLocalPin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_KEY, SECURE_STORE_OPTIONS);
}
