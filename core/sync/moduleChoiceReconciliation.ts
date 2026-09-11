/** APP-033/034: server-confirmed module choices, including retained tombstones. */
export interface ConfirmedModuleChoice {
  readonly entityId: string;
  readonly enabled: boolean;
  /** Canonical positive bigint decimal string: no JSON/JS number precision loss. */
  readonly revision: string;
  /** Preserve the server's serialized timestamp, including sub-millisecond precision. */
  readonly updatedAt: string;
  /** Explicit null for active state; never infer deletion from an absent row. */
  readonly deletedAt: string | null;
}

export class ModuleChoiceSnapshotError extends Error {
  constructor(readonly reason: 'invalid' | 'invariant' | 'pending') {
    super(`Module choice snapshot rejected: ${reason}.`);
  }
}

const MAX_REVISION = '9223372036854775807';
function compareRevision(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function validate(entity: ConfirmedModuleChoice): void {
  if (!entity || typeof entity.entityId !== 'string' || !entity.entityId.trim() ||
      ['core-shell', 'account'].includes(entity.entityId) || typeof entity.enabled !== 'boolean' ||
      typeof entity.revision !== 'string' || !/^[1-9][0-9]*$/.test(entity.revision) ||
      compareRevision(entity.revision, MAX_REVISION) > 0 ||
      typeof entity.updatedAt !== 'string' || !Number.isFinite(Date.parse(entity.updatedAt)) ||
      (entity.deletedAt !== null && (typeof entity.deletedAt !== 'string' ||
        !Number.isFinite(Date.parse(entity.deletedAt))))) {
    throw new ModuleChoiceSnapshotError('invalid');
  }
}

/** Reject malformed/versionless responses; never manufacture committed metadata. */
export function parseModuleChoiceSnapshots(rows: unknown): readonly ConfirmedModuleChoice[] {
  if (!Array.isArray(rows)) throw new ModuleChoiceSnapshotError('invalid');
  return rows.map((row: unknown) => {
    if (!row || typeof row !== 'object') throw new ModuleChoiceSnapshotError('invalid');
    const value = row as Record<string, unknown>;
    const entity = { entityId: value.module_id, enabled: value.enabled,
      revision: value.revision, updatedAt: value.updated_at, deletedAt: value.deleted_at } as ConfirmedModuleChoice;
    validate(entity);
    return Object.freeze(entity);
  });
}

/**
 * Reconcile confirmed versions by stable ID. Missing rows convey no deletion.
 * The caller must keep optimistic/pending values separate. Known pending IDs
 * refuse the whole fetch; deciding their outcome belongs to APP-035.
 */
export function reconcileModuleChoiceSnapshots(
  local: readonly ConfirmedModuleChoice[],
  remote: readonly ConfirmedModuleChoice[],
  pendingEntityIds: readonly string[],
): readonly ConfirmedModuleChoice[] {
  const byId = new Map<string, ConfirmedModuleChoice>();
  const versions = new Map<string, Map<string, ConfirmedModuleChoice>>();
  const pending = new Set(pendingEntityIds);
  for (const entity of [...local, ...remote]) {
    validate(entity);
    if (pending.has(entity.entityId)) throw new ModuleChoiceSnapshotError('pending');
    // Check all equal versions, even if a newer row appeared earlier in this
    // response. Inconsistent duplicates must not be accepted based on row order.
    const seen = versions.get(entity.entityId) ?? new Map<string, ConfirmedModuleChoice>();
    const sameVersion = seen.get(entity.revision);
    if (sameVersion && (entity.enabled !== sameVersion.enabled || entity.updatedAt !== sameVersion.updatedAt ||
        entity.deletedAt !== sameVersion.deletedAt)) {
      throw new ModuleChoiceSnapshotError('invariant');
    }
    seen.set(entity.revision, entity);
    versions.set(entity.entityId, seen);
    const current = byId.get(entity.entityId);
    const order = current ? compareRevision(entity.revision, current.revision) : 1;
    if (order > 0) byId.set(entity.entityId, Object.freeze({ ...entity }));
  }
  return Object.freeze([...byId.values()].sort((a, b) =>
    a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
}
