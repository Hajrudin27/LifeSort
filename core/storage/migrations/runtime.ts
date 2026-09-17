import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStorage } from 'zustand/middleware';
import { PERSISTENCE_SURFACES, getPersistenceSurface } from '@/core/storage/dataProfileRegistry';
import { LocalMigrationError, migrateLocalStore, type LocalMigrationDefinition } from './harness';
import { incomeMoneyMigration, savingsGoalsMoneyMigration } from './economyMoney';
import { homeLayoutMigration } from './homeLayout';
import { outboxMigration } from './outbox';

/** Zustand stores whose hydration reads run their versioned definition directly. */
const ZUSTAND_VERSIONED_DEFINITIONS: readonly LocalMigrationDefinition[] = [
  homeLayoutMigration, incomeMoneyMigration, savingsGoalsMoneyMigration,
];

/** Implementations, not another inventory: inclusion and versions come from governance. */
export function definitionForSurface(id: string): LocalMigrationDefinition {
  const definition = [...ZUSTAND_VERSIONED_DEFINITIONS, outboxMigration].find((candidate) => candidate.storeId === id);
  if (definition) return definition;
  throw new LocalMigrationError(id, 'unsupported-version');
}

export async function runLocalMigrations(): Promise<void> {
  for (const surface of PERSISTENCE_SURFACES) {
    if (surface.migration?.kind !== 'versioned') continue;
    const definition = definitionForSurface(surface.id);
    if (definition.currentVersion !== surface.migration.currentVersion) {
      throw new LocalMigrationError(surface.id, 'unsupported-version');
    }
    await migrateLocalStore(definition, AsyncStorage);
  }
}

/** A failed boot stays closed. A new process can retry against the preserved bytes. */
export function createMigrationGate(run: () => Promise<void>) {
  let pending: Promise<void> | undefined;
  return () => pending ??= Promise.resolve().then(run);
}
export const ensureLocalMigrations = createMigrationGate(runLocalMigrations);

const startupReads = new Set<Promise<void>>();
let startupComplete = false;
let finalizationStarted = false;
let resolveStartup!: () => void;
let rejectStartup!: (error: unknown) => void;
const startupReady = new Promise<void>((resolve, reject) => {
  resolveStartup = resolve;
  rejectStartup = reject;
});
// A failed boot remains observable even if auth/root has not subscribed yet.
void startupReady.catch(() => undefined);
let cleanupDepth = 0;
let writeEpoch = 0;
const activeWrites = new Set<Promise<void>>();

/** Preserve APP-021 ordering: delayed reset writes must not recreate swept keys. */
export async function withMigrationStorageCleanup<T>(cleanup: () => Promise<T>): Promise<T> {
  cleanupDepth += 1;
  writeEpoch += 1;
  try {
    await ensureLocalMigrations().catch(() => undefined);
    await Promise.allSettled([...activeWrites]);
    return await cleanup();
  } finally { cleanupDepth -= 1; }
}

/** Intercepts import-time Zustand hydration before JSON parsing or onRehydrate.
 * Specialized adapters still perform their own secure reads/migrations.
 */
export function migrationGatedStorage(storage: StateStorage): StateStorage<Promise<void>> {
  const reads = new Map<string, Promise<void>>();
  return {
    getItem(name) {
      const read = (async () => {
        await ensureLocalMigrations();
        // A rehydrate after the startup gate must still upgrade and validate.
        const versioned = ZUSTAND_VERSIONED_DEFINITIONS.find((definition) => definition.storageKey === name);
        if (versioned) return (await migrateLocalStore(versioned, AsyncStorage)).raw;
        let raw: string | null;
        try { raw = await storage.getItem(name); } catch {
          // Never forward native errors that may contain decrypted records.
          throw new LocalMigrationError(`async-storage:${name}`, 'read-failed');
        }
        if (raw !== null) {
          // Existing external Zustand owners all serialize v0. Guard the
          // envelope here; domain validation remains with each existing owner.
          let value;
          try { value = JSON.parse(raw); } catch {
            throw new LocalMigrationError(`async-storage:${name}`, 'invalid-json');
          }
          if (!value || typeof value !== 'object' || !('version' in value)) {
            throw new LocalMigrationError(`async-storage:${name}`, 'unknown-legacy-shape');
          }
          const supportedVersion = getPersistenceSurface(`async-storage:${name}`)?.migration?.currentVersion;
          if (supportedVersion === undefined || value.version !== supportedVersion) {
            throw new LocalMigrationError(`async-storage:${name}`,
              supportedVersion !== undefined && Number.isSafeInteger(value.version) && value.version > supportedVersion
                ? 'unsupported-newer-version' : 'unsupported-version');
          }
          if (!value.state || typeof value.state !== 'object' || Array.isArray(value.state)) {
            throw new LocalMigrationError(`async-storage:${name}`, 'validation-failed');
          }
        }
        return raw;
      })();
      const completion = read.then(() => undefined);
      reads.set(name, completion);
      if (!startupComplete) startupReads.add(completion);
      void completion.catch(() => undefined);
      // Zustand handles its own rejection; retain the outcome for the root gate.
      void read.catch(() => undefined);
      return read;
    },
    setItem(name, value) {
      if (cleanupDepth) return Promise.resolve();
      const epoch = writeEpoch;
      const write = (async () => {
        await ensureLocalMigrations();
        await reads.get(name);
        if (cleanupDepth || epoch !== writeEpoch) return;
        await storage.setItem(name, value);
      })();
      activeWrites.add(write);
      void write.finally(() => activeWrites.delete(write)).catch(() => undefined);
      return write;
    },
    async removeItem(name) {
      // Explicit cleanup remains authorized even after a failed read.
      await storage.removeItem(name);
      reads.delete(name);
    },
  };
}

/** Passive wait: eager auth must never seal application startup registration. */
export function waitForStartupStorage(): Promise<void> {
  return startupReady;
}

/** Only application startup calls this, after establishing its import-time reads.
 * Drain until the registration set is stable. Reads registered during any await
 * belong to this boot. Comparing and sealing have no intervening await, so a
 * later lazy read is unambiguously post-startup and remains individually guarded.
 */
export function finalizeStartupStorage(): Promise<void> {
  if (!finalizationStarted) {
    finalizationStarted = true;
    const drain = async () => {
      await ensureLocalMigrations();
      while (true) {
        const generation = startupReads.size;
        await Promise.all([...startupReads]);
        if (startupReads.size !== generation) continue;
        startupComplete = true;
        startupReads.clear();
        return;
      }
    };
    void drain().then(resolveStartup, rejectStartup);
  }
  return startupReady;
}
