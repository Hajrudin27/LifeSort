import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Lagring af Supabase-sessionen (access- og refresh-token) i enhedens nøglering
 * i stedet for AsyncStorage, som ligger ukrypteret i app-sandkassen og kan læses
 * på en rootet enhed eller trækkes ud af en ukrypteret enheds-backup. Et stjålet
 * refresh-token svarer til fuld adgang til kontoen.
 *
 * SecureStore findes ikke på web, hvor der falder tilbage til AsyncStorage.
 */

// iOS afviser historisk værdier over ca. 2048 bytes, og en Supabase-session er
// større end det. Vi deler derfor op i stykker. Grænsen tælles i tegn, ikke bytes,
// og er sat lavt nok til at også ikke-ASCII i brugerens navn holder sig under.
const CHUNK_SIZE = 1024;

// Markør der fortæller, at nøglen peger på delte stykker frem for en værdi.
// En Supabase-session er altid JSON og kan derfor aldrig kollidere med denne.
const CHUNK_MARKER = '__lifesort_chunked__:';

// Tokens skal kunne fornys, mens skærmen er låst, så AFTER_FIRST_UNLOCK er
// nødvendig. THIS_DEVICE_ONLY holder dem ude af iCloud-nøgleringen og af
// overførsler til en ny enhed.
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const useSecureStore = Platform.OS !== 'web';

const chunkKey = (key: string, index: number) => `${key}.${index}`;

async function readRaw(key: string): Promise<string | null> {
  if (!useSecureStore) return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS);
}

async function writeRaw(key: string, value: string): Promise<void> {
  if (!useSecureStore) return AsyncStorage.setItem(key, value);
  return SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS);
}

async function deleteRaw(key: string): Promise<void> {
  if (!useSecureStore) return AsyncStorage.removeItem(key);
  return SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS);
}

function parseChunkCount(value: string): number | null {
  if (!value.startsWith(CHUNK_MARKER)) return null;
  const count = Number.parseInt(value.slice(CHUNK_MARKER.length), 10);
  return Number.isInteger(count) && count > 0 ? count : null;
}

/**
 * Fjerner de stykker en tidligere, længere værdi efterlod. Uden det ville en
 * kortere session efterlade forældede stykker med gyldige tokens i.
 */
async function deleteChunks(key: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await deleteRaw(chunkKey(key, i));
  }
}

async function deleteExisting(key: string): Promise<void> {
  const existing = await readRaw(key);
  if (existing) {
    const count = parseChunkCount(existing);
    if (count !== null) await deleteChunks(key, count);
  }
  await deleteRaw(key);
}

/**
 * Flytter en session, der stadig ligger i AsyncStorage fra før denne ændring,
 * over i nøgleringen og fjerner den ukrypterede kopi. Uden dette ville alle
 * eksisterende brugere blive logget ud ved opdateringen.
 */
async function migrateFromAsyncStorage(key: string): Promise<string | null> {
  if (!useSecureStore) return null;

  const legacy = await AsyncStorage.getItem(key);
  if (legacy === null) return null;

  try {
    await setItem(key, legacy);
    await AsyncStorage.removeItem(key);
  } catch {
    // Lykkes flytningen ikke, beholder vi den gamle værdi frem for at logge
    // brugeren ud. Den ukrypterede kopi fjernes så ved næste forsøg.
    return legacy;
  }

  return legacy;
}

export async function getItem(key: string): Promise<string | null> {
  const stored = await readRaw(key);

  if (stored === null) {
    return migrateFromAsyncStorage(key);
  }

  const count = parseChunkCount(stored);
  if (count === null) return stored;

  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = await readRaw(chunkKey(key, i));
    // Et manglende stykke gør værdien ubrugelig — meld den som fraværende,
    // så Supabase henter en frisk session frem for at parse noget halvt.
    if (part === null) return null;
    parts.push(part);
  }

  return parts.join('');
}

export async function setItem(key: string, value: string): Promise<void> {
  await deleteExisting(key);

  if (value.length <= CHUNK_SIZE) {
    await writeRaw(key, value);
    return;
  }

  const count = Math.ceil(value.length / CHUNK_SIZE);
  for (let i = 0; i < count; i++) {
    await writeRaw(chunkKey(key, i), value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
  }
  await writeRaw(key, `${CHUNK_MARKER}${count}`);
}

export async function removeItem(key: string): Promise<void> {
  await deleteExisting(key);
  if (useSecureStore) {
    // Ryd også en evt. rest fra før migreringen.
    await AsyncStorage.removeItem(key);
  }
}

/** Storage-adapter i det format `createClient` forventer. */
export const secureSessionStorage = { getItem, setItem, removeItem };
