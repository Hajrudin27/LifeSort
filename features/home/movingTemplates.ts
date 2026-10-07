import { newEntityId } from '@/core/ids';
import { MOVING_SEMANTIC_ID, MOVING_TEMPLATE_ID } from '@/core/home/moving';
import type { MovingItem, MovingTemplateMarker } from '@/types/household';
import { parseCalendarDate } from '@/utils/shared/localDate';

/**
 * APP-062 — immutable, bundled Moving template catalogue (Profile D reference content).
 * It is neither synced nor exported. Copying a template creates ordinary user rows; a
 * later release is a new version and never rewrites a row that already exists.
 */
export type MovingSectionId = 'administration' | 'utilities';
export const MOVING_CUSTOM_SECTION_ID = 'your-items' as const;
export type MovingGroupId = MovingSectionId | typeof MOVING_CUSTOM_SECTION_ID;

/** Content authorities. An id only; the display name is localized, no URL is implied. */
export type MovingContentAuthority = 'lifesortEditorial';

export interface MovingTemplateMetadata {
  readonly source: MovingContentAuthority;
  readonly reviewedBy: MovingContentAuthority;
  /** Civil dates, YYYY-MM-DD. */
  readonly reviewedAt: string;
  readonly reviewDueAt: string;
  /** null = generic content that cites no jurisdiction-specific rule. */
  readonly jurisdiction: string | null;
}

export interface MovingTemplateSectionDefinition {
  readonly id: MovingSectionId;
  /** Key under `household.moving.sections`. */
  readonly titleKey: string;
}

export interface MovingTemplateItemDefinition {
  /** Stable across versions. Never a translated string. */
  readonly id: string;
  /** Key under `household.movingDefaults`. Resolved to text only when copied. */
  readonly labelKey: string;
  readonly section: MovingSectionId;
}

export interface MovingTemplateDefinition {
  readonly id: string;
  readonly version: number;
  readonly selectable: boolean;
  /** Key under `household.moving.templates`. */
  readonly titleKey: string;
  readonly metadata: MovingTemplateMetadata;
  readonly sections: readonly MovingTemplateSectionDefinition[];
  readonly items: readonly MovingTemplateItemDefinition[];
}

export type MovingReviewStatus = 'current' | 'due-for-review';

function template(definition: MovingTemplateDefinition): MovingTemplateDefinition {
  return Object.freeze({
    ...definition,
    metadata: Object.freeze({ ...definition.metadata }),
    sections: Object.freeze(definition.sections.map((section) => Object.freeze({ ...section }))),
    items: Object.freeze(definition.items.map((item) => Object.freeze({ ...item }))),
  });
}

/** Historical versions stay addressable; only `selectable` ones are offered. Never edit a shipped version. */
export const MOVING_TEMPLATE_CATALOG: readonly MovingTemplateDefinition[] = Object.freeze([
  template({
    id: MOVING_TEMPLATE_ID,
    version: 1,
    selectable: true,
    titleKey: 'movingHome',
    metadata: {
      source: 'lifesortEditorial',
      reviewedBy: 'lifesortEditorial',
      reviewedAt: '2026-10-07',
      reviewDueAt: '2027-10-07',
      jurisdiction: null,
    },
    sections: [
      { id: 'administration', titleKey: 'administration' },
      { id: 'utilities', titleKey: 'utilities' },
    ],
    items: [
      { id: 'addressChange', labelKey: 'addressChange', section: 'administration' },
      { id: 'mailForwarding', labelKey: 'mailForwarding', section: 'administration' },
      { id: 'insurance', labelKey: 'insurance', section: 'administration' },
      { id: 'internet', labelKey: 'internet', section: 'utilities' },
      { id: 'electricity', labelKey: 'electricity', section: 'utilities' },
    ],
  }),
]);

type Catalog = readonly MovingTemplateDefinition[];

export function getMovingTemplate(
  id: string, version: number, catalog: Catalog = MOVING_TEMPLATE_CATALOG,
): MovingTemplateDefinition | null {
  return catalog.find((entry) => entry.id === id && entry.version === version) ?? null;
}

export function latestSelectableMovingTemplate(
  id: string = MOVING_TEMPLATE_ID, catalog: Catalog = MOVING_TEMPLATE_CATALOG,
): MovingTemplateDefinition | null {
  let latest: MovingTemplateDefinition | null = null;
  for (const entry of catalog) {
    if (entry.id === id && entry.selectable && (!latest || entry.version > latest.version)) latest = entry;
  }
  return latest;
}

/** Wall-clock free: the caller passes today's civil date. */
export function movingReviewStatus(metadata: Pick<MovingTemplateMetadata, 'reviewDueAt'>, today: string): MovingReviewStatus {
  return today <= metadata.reviewDueAt ? 'current' : 'due-for-review';
}

/** Structural problems with a definition. Empty means valid. Pure so tests can feed bad ones. */
export function validateMovingTemplate(definition: MovingTemplateDefinition): string[] {
  const problems: string[] = [];
  if (!MOVING_SEMANTIC_ID.test(definition.id)) problems.push('id');
  if (!Number.isSafeInteger(definition.version) || definition.version < 1) problems.push('version');
  if (typeof definition.selectable !== 'boolean') problems.push('selectable');
  if (!definition.titleKey) problems.push('titleKey');
  const meta = definition.metadata;
  if (!meta || meta.source !== 'lifesortEditorial' || meta.reviewedBy !== 'lifesortEditorial') problems.push('authority');
  if (!meta || parseCalendarDate(meta.reviewedAt) === null) problems.push('reviewedAt');
  if (!meta || parseCalendarDate(meta.reviewDueAt) === null) problems.push('reviewDueAt');
  if (meta && parseCalendarDate(meta.reviewedAt) && parseCalendarDate(meta.reviewDueAt) && meta.reviewDueAt < meta.reviewedAt) {
    problems.push('reviewOrder');
  }
  if (!meta || !(meta.jurisdiction === null || (typeof meta.jurisdiction === 'string' && /^[A-Z]{2}$/.test(meta.jurisdiction)))) {
    problems.push('jurisdiction');
  }
  const sectionIds = definition.sections.map((section) => section.id);
  if (sectionIds.length === 0 || new Set(sectionIds).size !== sectionIds.length ||
    definition.sections.some((section) => !MOVING_SEMANTIC_ID.test(section.id) || !section.titleKey)) problems.push('sections');
  const itemIds = definition.items.map((item) => item.id);
  if (itemIds.length === 0 || new Set(itemIds).size !== itemIds.length ||
    definition.items.some((item) => !MOVING_SEMANTIC_ID.test(item.id) || !item.labelKey)) problems.push('items');
  if (definition.items.some((item) => !sectionIds.includes(item.section))) problems.push('itemSection');
  return problems;
}

/** Fresh user rows. Labels are localized now and then belong to the user, never refreshed. */
export function instantiateMovingItems(
  definition: MovingTemplateDefinition,
  translate: (labelKey: string) => string,
  existing: readonly MovingItem[] = [],
  makeId: () => string = newEntityId,
): MovingItem[] {
  const present = presentTemplateItems(existing, definition.id);
  return definition.items.filter((item) => !present.has(item.id)).map((item) => ({
    id: makeId(),
    label: translate(item.labelKey),
    checked: false,
    templateRef: { templateId: definition.id, templateVersion: definition.version, templateItemId: item.id },
  }));
}

function presentTemplateItems(items: readonly MovingItem[], templateId: string): Set<string> {
  const ids = new Set<string>();
  for (const item of items) if (item.templateRef?.templateId === templateId) ids.add(item.templateRef.templateItemId);
  return ids;
}

export interface MovingTemplateUpgrade {
  readonly template: MovingTemplateDefinition;
  /** Items of the target version that the applied version did not have. */
  readonly newItems: readonly MovingTemplateItemDefinition[];
}

/**
 * Newness comes from comparing two template VERSIONS by stable item id, never from which
 * rows currently exist: a missing old suggestion may be a deliberate deletion. An item the
 * user already holds a row for is never offered again. Nothing here changes any state.
 */
export function availableMovingUpgrade(
  marker: MovingTemplateMarker | null,
  items: readonly MovingItem[],
  catalog: Catalog = MOVING_TEMPLATE_CATALOG,
): MovingTemplateUpgrade | null {
  if (!marker) return null;
  const target = latestSelectableMovingTemplate(marker.id, catalog);
  const applied = getMovingTemplate(marker.id, marker.version, catalog);
  if (!target || !applied || target.version <= applied.version) return null;
  const appliedIds = new Set(applied.items.map((item) => item.id));
  const held = presentTemplateItems(items, marker.id);
  const newItems = target.items.filter((item) => !appliedIds.has(item.id) && !held.has(item.id));
  return newItems.length > 0 ? { template: target, newItems } : null;
}

/** Add only the new suggestions as fresh rows; the caller advances the marker afterwards. */
export function applyMovingUpgrade(
  upgrade: MovingTemplateUpgrade,
  translate: (labelKey: string) => string,
  makeId: () => string = newEntityId,
): MovingItem[] {
  return upgrade.newItems.map((item) => ({
    id: makeId(),
    label: translate(item.labelKey),
    checked: false,
    templateRef: { templateId: upgrade.template.id, templateVersion: upgrade.template.version, templateItemId: item.id },
  }));
}

export interface MovingGroup {
  readonly id: MovingGroupId;
  readonly titleKey: string;
  readonly items: readonly MovingItem[];
}

function sectionOf(item: MovingItem, catalog: Catalog): MovingSectionId | null {
  const ref = item.templateRef;
  if (!ref) return null;
  const exact = getMovingTemplate(ref.templateId, ref.templateVersion, catalog);
  const found = exact?.items.find((entry) => entry.id === ref.templateItemId) ??
    [...catalog].reverse().find((entry) => entry.id === ref.templateId &&
      entry.items.some((entry2) => entry2.id === ref.templateItemId))?.items.find((entry2) => entry2.id === ref.templateItemId);
  return found?.section ?? null;
}

/** Template sections in catalogue order, then the user's own rows. Empty groups are omitted. */
export function groupMovingItems(items: readonly MovingItem[], catalog: Catalog = MOVING_TEMPLATE_CATALOG): MovingGroup[] {
  const latest = latestSelectableMovingTemplate(MOVING_TEMPLATE_ID, catalog) ?? catalog[catalog.length - 1];
  const order: { id: MovingGroupId; titleKey: string }[] = [
    ...(latest?.sections ?? []).map((section) => ({ id: section.id, titleKey: section.titleKey })),
    { id: MOVING_CUSTOM_SECTION_ID, titleKey: 'yourItems' },
  ];
  const buckets = new Map<MovingGroupId, MovingItem[]>(order.map((entry) => [entry.id, []]));
  for (const item of items) {
    const section = sectionOf(item, catalog);
    (buckets.get(section ?? MOVING_CUSTOM_SECTION_ID) ?? buckets.get(MOVING_CUSTOM_SECTION_ID)!).push(item);
  }
  return order.map((entry) => ({ ...entry, items: buckets.get(entry.id)! })).filter((group) => group.items.length > 0);
}
