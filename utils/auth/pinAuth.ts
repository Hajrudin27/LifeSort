import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const PIN_KEY = 'lifesort-app-pin-hash';

export async function hashPin(pin: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin);
}

export async function savePinLocally(hash: string): Promise<void> {
  await SecureStore.setItemAsync(PIN_KEY, hash);
}

export async function getLocalPinHash(): Promise<string | null> {
  return SecureStore.getItemAsync(PIN_KEY);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const inputHash = await hashPin(pin);
  const storedHash = await getLocalPinHash();
  return storedHash !== null && storedHash === inputHash;
}

export async function clearLocalPin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_KEY);
}