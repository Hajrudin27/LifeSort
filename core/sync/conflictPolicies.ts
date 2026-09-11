import type { DataDomainId } from '@/core/storage/dataProfileRegistry';
import type { TodoItem } from '@/types/life';
import type { SavingsContribution } from '@/types/savingsGoal';
import type { Attachment } from '@/types/attachment';

export type ConflictPolicyId = 'setting-rebase' | 'append-only' | 'task-fields' | 'document-manual';
export interface Preferences {
  readonly language: 'da' | 'en' | null;
  readonly mode: 'light' | 'dark' | 'system';
}
/** An explicit projection, never a file, cache URI, signed URL or storage path. */
export type DocumentIdentity = Readonly<Pick<Attachment, 'id' | 'name' | 'kind'>> & {
  /** Trusted immutable content version supplied by a future adapter; null means unknown. */
  readonly contentIdentity: string | null;
};
export interface ConflictEntities {
  preferences: Preferences;
  'savings-contribution': Readonly<SavingsContribution>;
  todo: Readonly<TodoItem>;
  attachment: DocumentIdentity;
}
type EntityType = keyof ConflictEntities;
type DomainByEntity = {
  preferences: 'core.preferences';
  'savings-contribution': 'economy.savings';
  todo: 'tasks.todos';
  attachment: 'warranties.attachments';
};
type PolicyByEntity = {
  preferences: 'setting-rebase';
  'savings-contribution': 'append-only';
  todo: 'task-fields';
  attachment: 'document-manual';
};
type PolicyRegistration = { readonly [E in EntityType]: {
  readonly dataDomain: DomainByEntity[E] & DataDomainId;
  readonly entityType: E;
  readonly policy: PolicyByEntity[E];
} }[EntityType];

/** Mixed domains are reviewed by entity kind, never classified wholesale. */
export const CONFLICT_POLICIES = Object.freeze([
  Object.freeze({ dataDomain: 'core.preferences', entityType: 'preferences', policy: 'setting-rebase' }),
  Object.freeze({ dataDomain: 'economy.savings', entityType: 'savings-contribution', policy: 'append-only' }),
  Object.freeze({ dataDomain: 'tasks.todos', entityType: 'todo', policy: 'task-fields' }),
  Object.freeze({ dataDomain: 'warranties.attachments', entityType: 'attachment', policy: 'document-manual' }),
] as const satisfies readonly PolicyRegistration[]);

export function getConflictPolicy(dataDomain: DataDomainId | string, entityType: string): ConflictPolicyId | null {
  return CONFLICT_POLICIES.find((entry) => entry.dataDomain === dataDomain && entry.entityType === entityType)?.policy ?? null;
}

export interface ConfirmedConflictEntity<T> {
  readonly entityId: string;
  readonly revision: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly value: T;
}
export type PendingConflictIntent<T> = {
  /** APP-031 safe integers accepted without changing its persisted format. */
  readonly baseRevision?: number | string;
} & ({ readonly operation: 'upsert'; readonly value: T;
  /** Explicit writes, including writes back to the base value, if known. */
  readonly changedFields?: readonly (keyof T)[];
} | { readonly operation: 'delete' });

export interface ConflictVersions<T> {
  readonly entityId: string;
  readonly base: ConfirmedConflictEntity<T> | null;
  readonly local: PendingConflictIntent<T> | null;
  readonly remote: ConfirmedConflictEntity<T> | null;
  /** Known intervening writes, including change-and-revert (ABA). Not inferred from revision. */
  readonly remoteChangedFields?: readonly (keyof T)[];
}
export type ConflictInput = { [E in EntityType]: ConflictVersions<ConflictEntities[E]> & {
  readonly dataDomain: DomainByEntity[E]; readonly entityType: E;
} }[EntityType];
export type ConflictFailure =
  | { readonly kind: 'unresolved'; readonly reason: 'unclassified' | 'invalid-input' | 'missing-base' |
    'missing-remote' | 'stale-remote' | 'concurrent-create' | 'pending-delete' | 'field-conflict' |
    'document-conflict' | 'unknown-content' }
  | { readonly kind: 'invariant-error'; readonly reason: 'equal-revision-contradiction' |
    'base-revision-mismatch' | 'restore-forbidden' | 'append-content-conflict' };
export type ConflictResult<T> = ConflictFailure
  | { readonly kind: 'accept-remote'; readonly remote: ConfirmedConflictEntity<T> }
  | { readonly kind: 'rebase-local' | 'merged'; readonly value: T; readonly baseRevision: string | null };

const compare = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
function revision(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === 'string' && /^[1-9][0-9]*$/.test(text) &&
    compare(text, '9223372036854775807') <= 0 ? text : null;
}
const invalid = (): ConflictFailure => ({ kind: 'unresolved', reason: 'invalid-input' });
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
type FieldRules<T> = { readonly [K in keyof T]-?: (value: unknown) => boolean };
const string = (v: unknown) => typeof v === 'string';
const optionalString = (v: unknown) => v === undefined || string(v);
const nonempty = (v: unknown) => string(v) && (v as string).trim().length > 0;
const boolean = (v: unknown) => typeof v === 'boolean';
const preferenceFields: FieldRules<Preferences> = {
  language: (v) => v === null || v === 'en' || v === 'da',
  mode: (v) => v === 'light' || v === 'dark' || v === 'system',
};
// Exhaustive mapped rules make added model fields require an explicit review.
const todoFields: FieldRules<Readonly<TodoItem>> = {
  id: nonempty, title: string, description: optionalString,
  importance: (v) => v === 'low' || v === 'medium' || v === 'high',
  dueDate: optionalString, completed: boolean, createdAt: string,
};
const contributionFields: FieldRules<Readonly<SavingsContribution>> = {
  id: nonempty, goalId: nonempty, amount: (v) => typeof v === 'number' && Number.isFinite(v), date: string,
};
const documentFields: FieldRules<DocumentIdentity> = {
  id: nonempty, name: string, kind: (v) => v === 'image' || v === 'document',
  contentIdentity: (v) => v === null || nonempty(v),
};

/** Declared scalar fields only. Reject extra fields/accessors before reading values. */
function validValue<T>(value: T, rules: FieldRules<T>, entityId: string): boolean {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' ||
    !Object.prototype.hasOwnProperty.call(rules, key) || !('value' in descriptors[key]))) return false;
  return (Object.keys(rules) as (keyof T)[]).every((key) => rules[key](value[key])) &&
    (!Object.prototype.hasOwnProperty.call(rules, 'id') || (value as { id?: unknown }).id === entityId);
}
function equal<T>(a: T, b: T, fields: readonly (keyof T)[]): boolean {
  return fields.every((key) => a[key] === b[key]);
}

function resolveEntity<T>(input: ConflictVersions<T>, policy: ConflictPolicyId, rules: FieldRules<T>): ConflictResult<T> {
  const { base, local, remote, entityId } = input;
  const fields = Object.keys(rules) as (keyof T)[];
  const validFields = (keys: readonly (keyof T)[] | undefined) => keys === undefined ||
    (Array.isArray(keys) && keys.every((key) => fields.includes(key)));
  const validSnapshot = (v: ConfirmedConflictEntity<T> | null) => v === null ||
    (v && v.entityId === entityId && typeof v.revision === 'string' && revision(v.revision) !== null &&
      timestamp(v.updatedAt) && (v.deletedAt === null || timestamp(v.deletedAt)) && validValue(v.value, rules, entityId));
  if (!nonempty(entityId) || !validSnapshot(base) || !validSnapshot(remote) ||
    !validFields(input.remoteChangedFields) || (local !== null && (!local ||
      (local.operation !== 'delete' && local.operation !== 'upsert') ||
      (local.operation === 'upsert' && (!validValue(local.value, rules, entityId) || !validFields(local.changedFields)))))) return invalid();

  if (base && remote && base.revision === remote.revision &&
    (!equal(base.value, remote.value, fields) || base.updatedAt !== remote.updatedAt || base.deletedAt !== remote.deletedAt)) {
    return { kind: 'invariant-error', reason: 'equal-revision-contradiction' };
  }
  if (base && remote && base.revision === remote.revision && input.remoteChangedFields?.length) return invalid();
  if (base && remote && compare(remote.revision, base.revision) < 0) return { kind: 'unresolved', reason: 'stale-remote' };
  if (base?.deletedAt != null && remote?.deletedAt === null) return { kind: 'invariant-error', reason: 'restore-forbidden' };
  // A confirmed deletion cannot legitimize changing immutable append content.
  if (policy === 'append-only' && base && remote && !equal(base.value, remote.value, fields)) {
    return { kind: 'invariant-error', reason: 'append-content-conflict' };
  }
  // Confirmed deletion is authoritative, even if stale intent has no usable base.
  if (remote?.deletedAt != null) return { kind: 'accept-remote', remote };
  if (base && !remote) return { kind: 'unresolved', reason: 'missing-remote' };
  if (!local) return remote ? { kind: 'accept-remote', remote } : invalid();
  if (base) {
    if (local.baseRevision === undefined) return { kind: 'unresolved', reason: 'missing-base' };
    if (revision(local.baseRevision) !== base.revision) return { kind: 'invariant-error', reason: 'base-revision-mismatch' };
  } else if (local.baseRevision !== undefined) return { kind: 'unresolved', reason: 'missing-base' };
  // There is no reviewed pending-delete rule (including append-log removal).
  if (local.operation === 'delete') return { kind: 'unresolved', reason: 'pending-delete' };
  if (base?.deletedAt != null) return { kind: 'invariant-error', reason: 'restore-forbidden' };
  if (!remote) return { kind: 'rebase-local', value: { ...local.value }, baseRevision: null };

  if (policy === 'append-only') {
    if (!equal(local.value, remote.value, fields) || (base && !equal(base.value, remote.value, fields))) {
      return { kind: 'invariant-error', reason: 'append-content-conflict' };
    }
    return { kind: 'accept-remote', remote };
  }
  if (policy === 'document-manual') {
    if ((local.value as DocumentIdentity).contentIdentity === null ||
        (remote.value as DocumentIdentity).contentIdentity === null) return { kind: 'unresolved', reason: 'unknown-content' };
    if (equal(local.value, remote.value, fields)) return { kind: 'accept-remote', remote };
    return { kind: 'unresolved', reason: 'document-conflict' };
  }
  // Future policy kinds must implement their own branch, never inherit a merge.
  if (policy !== 'setting-rebase' && policy !== 'task-fields') return { kind: 'unresolved', reason: 'unclassified' };
  if (!base) return { kind: 'unresolved', reason: 'concurrent-create' };
  const merged = { ...remote.value };
  for (const key of fields) {
    const localChanged = local.value[key] !== base.value[key] || local.changedFields?.includes(key);
    const remoteChanged = remote.value[key] !== base.value[key] || input.remoteChangedFields?.includes(key);
    if (policy === 'task-fields' && localChanged && remoteChanged && local.value[key] !== remote.value[key]) {
      return { kind: 'unresolved', reason: 'field-conflict' };
    }
    if (localChanged) merged[key] = local.value[key];
  }
  // id/createdAt are immutable task identity metadata, not editable task fields.
  if (policy === 'task-fields' && ((local.value as TodoItem).createdAt !== (base.value as TodoItem).createdAt ||
      (remote.value as TodoItem).createdAt !== (base.value as TodoItem).createdAt)) return invalid();
  if (equal(merged, remote.value, fields)) return { kind: 'accept-remote', remote };
  return { kind: policy === 'setting-rebase' ? 'rebase-local' : 'merged', value: merged, baseRevision: remote.revision };
}

/** Pure proposals only: neither merged nor rebased values claim a new server revision. */
export function resolveConflict<I extends ConflictInput>(input: I): ConflictResult<ConflictEntities[I['entityType']]>;
export function resolveConflict(input: ConflictInput): ConflictResult<ConflictEntities[EntityType]> {
  const policy = input && getConflictPolicy(input.dataDomain, input.entityType);
  if (!policy) return { kind: 'unresolved', reason: 'unclassified' };
  switch (input.entityType) {
    case 'preferences': return resolveEntity(input, policy, preferenceFields);
    case 'savings-contribution': return resolveEntity(input, policy, contributionFields);
    case 'todo': return resolveEntity(input, policy, todoFields);
    case 'attachment': return resolveEntity(input, policy, documentFields);
    default: return { kind: 'unresolved', reason: 'unclassified' };
  }
}

type Contribution = Readonly<SavingsContribution>;
type ResolvedContribution = Exclude<ConflictResult<Contribution>, ConflictFailure>;
/** Set union of append intents and confirmed records. Tombstones stay in the result. */
export function resolveSavingsHistory(input: {
  readonly base: readonly ConfirmedConflictEntity<Contribution>[];
  readonly local: readonly (PendingConflictIntent<Contribution> & { readonly entityId: string })[];
  readonly remote: readonly ConfirmedConflictEntity<Contribution>[];
}): ConflictFailure | { readonly kind: 'merged'; readonly entries: readonly {
  readonly entityId: string; readonly resolution: ResolvedContribution;
}[] } {
  const fields = Object.keys(contributionFields) as (keyof Contribution)[];
  const sameValue = (a: Contribution, b: Contribution, id: string) =>
    validValue(a, contributionFields, id) && validValue(b, contributionFields, id) && equal(a, b, fields);
  const sameSnapshot = (a: ConfirmedConflictEntity<Contribution>, b: ConfirmedConflictEntity<Contribution>) =>
    a.revision === b.revision && a.updatedAt === b.updatedAt && a.deletedAt === b.deletedAt && sameValue(a.value, b.value, a.entityId);
  const index = <T extends { readonly entityId: string }>(items: readonly T[], same: (a: T, b: T) => boolean) => {
    const map = new Map<string, T>();
    for (const item of items) {
      const previous = map.get(item.entityId);
      if (previous && !same(previous, item)) return null;
      map.set(item.entityId, item);
    }
    return map;
  };
  const base = index(input.base, sameSnapshot), remote = index(input.remote, sameSnapshot);
  const local = index(input.local, (a, b) => a.operation === 'upsert' && b.operation === 'upsert' &&
    a.baseRevision === b.baseRevision && a.changedFields === undefined && b.changedFields === undefined &&
    sameValue(a.value, b.value, a.entityId));
  if (!base || !local || !remote) return invalid();
  const ids = [...new Set([...base.keys(), ...local.keys(), ...remote.keys()])].sort();
  const entries: { entityId: string; resolution: ResolvedContribution }[] = [];
  for (const entityId of ids) {
    const result = resolveConflict({ dataDomain: 'economy.savings', entityType: 'savings-contribution',
      entityId, base: base.get(entityId) ?? null,
      local: local.get(entityId) ?? null, remote: remote.get(entityId) ?? null });
    if (result.kind === 'unresolved' || result.kind === 'invariant-error') return result;
    entries.push({ entityId, resolution: result });
  }
  return { kind: 'merged', entries };
}
