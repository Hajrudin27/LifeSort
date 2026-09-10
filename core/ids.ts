import { randomUUID } from 'expo-crypto';

/**
 * Mint a cryptographic UUID v4 for a NEW persistent client entity.
 * Generate once and copy that value into parent/series/attachment references.
 * Existing IDs are opaque strings: never regenerate or validate them as UUIDs.
 * Semantic keys, server IDs and cache filenames have their own contracts.
 * Crypto errors propagate; there is deliberately no weak fallback.
 */
export function newEntityId(): string {
  return randomUUID();
}
