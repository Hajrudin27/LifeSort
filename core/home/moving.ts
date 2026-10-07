import type { MovingItem, MovingTemplateMarker, MovingTemplateRef } from '@/types/household';

/**
 * APP-062 — the dependency-neutral Moving item contract. One decoder serves the local
 * migration, the backup boundary and remote rows, so malformed provenance is rejected
 * identically everywhere and nothing infers provenance from labels or similar-looking ids.
 */
export const MOVING_TEMPLATE_ID = 'moving-home';
/** Stable semantic ids: template ids are kebab-case, item ids keep the historical camelCase keys. */
export const MOVING_SEMANTIC_ID = /^[a-z][A-Za-z0-9-]{0,63}$/;

/**
 * The five ids the pre-APP-062 seeding code created. They are the only ids that can prove
 * template provenance without a stored reference. Nothing else, including `default-foo`.
 */
export const LEGACY_MOVING_SEED_IDS: Readonly<Record<string, string>> = Object.freeze({
  'default-addressChange': 'addressChange',
  'default-internet': 'internet',
  'default-electricity': 'electricity',
  'default-mailForwarding': 'mailForwarding',
  'default-insurance': 'insurance',
});

/** Every historical envelope exposed this v1 default set automatically. */
export const LEGACY_MOVING_MARKER: MovingTemplateMarker = Object.freeze({ id: MOVING_TEMPLATE_ID, version: 1 });

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Json, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const semanticId = (value: unknown): value is string => typeof value === 'string' && MOVING_SEMANTIC_ID.test(value);
const positiveVersion = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

export function decodeMovingTemplateRef(value: unknown): MovingTemplateRef | null {
  if (!record(value) || !exact(value, ['templateId', 'templateVersion', 'templateItemId'])) return null;
  if (!semanticId(value.templateId) || !positiveVersion(value.templateVersion) || !semanticId(value.templateItemId)) return null;
  return { templateId: value.templateId, templateVersion: value.templateVersion, templateItemId: value.templateItemId };
}

export function decodeMovingTemplateMarker(value: unknown): MovingTemplateMarker | null {
  if (!record(value) || !exact(value, ['id', 'version'])) return null;
  if (!semanticId(value.id) || !positiveVersion(value.version)) return null;
  return { id: value.id, version: value.version };
}

export function legacySeedRef(id: string): MovingTemplateRef | null {
  const itemId = Object.hasOwn(LEGACY_MOVING_SEED_IDS, id) ? LEGACY_MOVING_SEED_IDS[id] : undefined;
  return itemId ? { templateId: MOVING_TEMPLATE_ID, templateVersion: 1, templateItemId: itemId } : null;
}

/**
 * `legacy` is data written before APP-062: it can carry no stored reference, so one is
 * rejected as an unknown shape and provenance is derived only for the five seed ids.
 * `current` data carries an optional, strictly validated reference and infers nothing.
 */
export function decodeMovingItem(value: unknown, mode: 'legacy' | 'current'): MovingItem | null {
  if (!record(value) || typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.label !== 'string' || typeof value.checked !== 'boolean') return null;
  const base = { id: value.id, label: value.label, checked: value.checked };
  const keys = Object.keys(value);
  if (mode === 'legacy') {
    if (!exact(value, ['id', 'label', 'checked'])) return null;
    const ref = legacySeedRef(value.id);
    return ref ? { ...base, templateRef: ref } : base;
  }
  if (!keys.every((key) => key === 'id' || key === 'label' || key === 'checked' || key === 'templateRef')) return null;
  if (!Object.hasOwn(value, 'templateRef') || value.templateRef === undefined) return base;
  const ref = decodeMovingTemplateRef(value.templateRef);
  return ref ? { ...base, templateRef: ref } : null;
}

/** All-or-nothing: one malformed row rejects the whole list, and ids must be unique. */
export function decodeMovingItems(value: unknown, mode: 'legacy' | 'current'): MovingItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: MovingItem[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const item = decodeMovingItem(entry, mode);
    if (!item || seen.has(item.id)) return null;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

/**
 * A remote row is trusted only when its provenance columns are all null or all valid.
 * Partially set or malformed provenance drops the row instead of guessing; a null
 * provenance on one of the five legacy seed ids derives it from the fixed id.
 */
export function decodeRemoteMovingRow(row: unknown): MovingItem | null {
  if (!record(row)) return null;
  const { template_id: id, template_version: version, template_item_id: itemId } = row;
  const present = [id, version, itemId].map((field) => field !== null && field !== undefined);
  if (present.some(Boolean) && !present.every(Boolean)) return null;
  const plain = { id: row.id, label: row.label, checked: row.checked };
  if (!present.every(Boolean)) return decodeMovingItem(plain, 'legacy');
  return decodeMovingItem({ ...plain, templateRef: { templateId: id, templateVersion: version, templateItemId: itemId } }, 'current');
}

/**
 * Advance, never lower, the marker to the highest version proven by valid provenance.
 * Labels and custom rows prove nothing.
 */
export function inferMovingMarker(
  current: MovingTemplateMarker | null,
  items: readonly MovingItem[],
  templateId: string = MOVING_TEMPLATE_ID,
): MovingTemplateMarker | null {
  let proven = current && current.id === templateId ? current.version : 0;
  for (const item of items) {
    const ref = item.templateRef;
    if (ref && ref.templateId === templateId && ref.templateVersion > proven) proven = ref.templateVersion;
  }
  if (proven === 0 || (current && current.id !== templateId)) return current;
  return current && current.version >= proven ? current : { id: templateId, version: proven };
}
