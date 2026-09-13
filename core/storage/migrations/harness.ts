/** Local-only contract. Definitions receive data, never storage or runtime services. */
export type MigrationFailureCode =
  | 'read-failed' | 'invalid-json' | 'unknown-legacy-shape' | 'unsupported-version'
  | 'unsupported-newer-version' | 'missing-migration-step' | 'transform-failed'
  | 'validation-failed' | 'serialization-failed' | 'write-failed';

export class LocalMigrationError extends Error {
  constructor(readonly storeId: string, readonly code: MigrationFailureCode) {
    super(`Local migration: ${storeId}: ${code}`);
    this.name = 'LocalMigrationError';
  }
}

export interface LocalMigrationDefinition {
  readonly storeId: string;
  readonly storageKey: string;
  readonly currentVersion: number;
  /** Return null only for an unidentified unversioned shape. */
  readonly detectVersion: (value: unknown) => number | null;
  /** Indexed by source version; each step must return source + 1. */
  readonly steps: Readonly<Record<number, (value: unknown) => unknown>>;
  readonly validateCurrent: (value: unknown) => boolean;
  readonly serialize?: (value: unknown) => string;
}

export interface MigrationStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type MigrationResult = { raw: string | null; migrated: boolean };

/** One read, all transforms in memory, validation, serialization, at most one write.
 * Callers serialize this operation against ordinary writes to the same key.
 * No deletion or compensating overwrite: a rejected native write may have an
 * ambiguous outcome, so the adapter must preserve its prior committed value.
 */
export async function migrateLocalStore(
  definition: LocalMigrationDefinition,
  storage: MigrationStorage,
): Promise<MigrationResult> {
  const fail = (code: MigrationFailureCode): never => { throw new LocalMigrationError(definition.storeId, code); };
  let raw: string | null;
  try { raw = await storage.getItem(definition.storageKey); } catch { return fail('read-failed'); }
  if (raw === null) return { raw, migrated: false };
  let candidate: unknown;
  try { candidate = JSON.parse(raw); } catch { return fail('invalid-json'); }
  let version: number | null;
  try { version = definition.detectVersion(candidate); } catch { return fail('unsupported-version'); }
  if (version === null) return fail('unknown-legacy-shape');
  if (!Number.isSafeInteger(version) || version < 0) return fail('unsupported-version');
  if (version > definition.currentVersion) return fail('unsupported-newer-version');
  const originalVersion = version;
  while (version < definition.currentVersion) {
    const step = definition.steps[version];
    if (!step) return fail('missing-migration-step');
    try { candidate = step(candidate); } catch { return fail('transform-failed'); }
    let nextVersion;
    try { nextVersion = definition.detectVersion(candidate); } catch { return fail('validation-failed'); }
    if (nextVersion !== version + 1) return fail('validation-failed');
    version += 1;
  }
  try {
    if (!definition.validateCurrent(candidate)) return fail('validation-failed');
  } catch { return fail('validation-failed'); }
  if (originalVersion === definition.currentVersion) return { raw, migrated: false };
  let serialized: string;
  try {
    serialized = (definition.serialize ?? JSON.stringify)(candidate);
    // A serializer must not drop fields, return undefined, or change the schema.
    if (typeof serialized !== 'string' || JSON.stringify(JSON.parse(serialized)) !== JSON.stringify(candidate)) {
      return fail('serialization-failed');
    }
  } catch { return fail('serialization-failed'); }
  try { await storage.setItem(definition.storageKey, serialized); } catch { return fail('write-failed'); }
  return { raw: serialized, migrated: true };
}
