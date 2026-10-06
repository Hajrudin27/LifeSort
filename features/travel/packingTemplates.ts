import { newEntityId } from '@/core/ids';
import type { AppliedPackingTemplate, PackingCategory, PackingItem } from '@/types/trip';

export interface PackingTemplateIdentity {
  readonly id: string;
  readonly version: number;
}

export interface PackingTemplateItemDefinition {
  readonly id: string;
  readonly labelKey: string;
  readonly category: PackingCategory;
}

export interface PackingTemplateDefinition {
  readonly id: string;
  readonly version: number;
  readonly titleKey: string;
  readonly selectable: boolean;
  readonly items: readonly PackingTemplateItemDefinition[];
}

export interface ResolvedPackingTemplate {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly items: readonly {
    readonly templateItemId: string;
    readonly label: string;
    readonly category: PackingCategory;
  }[];
}

function template(
  definition: Omit<PackingTemplateDefinition, 'items'> & {
    items: readonly PackingTemplateItemDefinition[];
  },
): PackingTemplateDefinition {
  return Object.freeze({
    ...definition,
    items: Object.freeze(definition.items.map((item) => Object.freeze({ ...item }))),
  });
}

/**
 * Immutable, globally readable reference content. Historical versions stay addressable,
 * but only entries marked selectable are offered for a new copy.
 */
export const PACKING_TEMPLATE_CATALOG: readonly PackingTemplateDefinition[] = Object.freeze([
  template({
    id: 'travel-essentials',
    version: 1,
    titleKey: 'travelEssentials',
    selectable: false,
    items: [
      { id: 'passport', labelKey: 'passport', category: 'essentials' },
      { id: 'wallet', labelKey: 'wallet', category: 'essentials' },
      { id: 'charger', labelKey: 'charger', category: 'electronics' },
      { id: 'toothbrush', labelKey: 'toothbrush', category: 'toiletries' },
      { id: 'medication', labelKey: 'medication', category: 'toiletries' },
    ],
  }),
  template({
    id: 'travel-essentials',
    version: 2,
    titleKey: 'travelEssentials',
    selectable: true,
    items: [
      { id: 'passport', labelKey: 'passport', category: 'essentials' },
      { id: 'wallet', labelKey: 'wallet', category: 'essentials' },
      { id: 'charger', labelKey: 'charger', category: 'electronics' },
      { id: 'travel-adapter', labelKey: 'travelAdapter', category: 'electronics' },
      { id: 'toothbrush', labelKey: 'toothbrush', category: 'toiletries' },
      { id: 'medication', labelKey: 'medication', category: 'toiletries' },
    ],
  }),
  template({
    id: 'weekend-basics',
    version: 1,
    titleKey: 'weekendBasics',
    selectable: true,
    items: [
      { id: 'tops', labelKey: 'tops', category: 'clothing' },
      { id: 'underwear', labelKey: 'underwear', category: 'clothing' },
      { id: 'socks', labelKey: 'socks', category: 'clothing' },
      { id: 'charger', labelKey: 'charger', category: 'electronics' },
      { id: 'toothbrush', labelKey: 'toothbrush', category: 'toiletries' },
    ],
  }),
]);

export const SELECTABLE_PACKING_TEMPLATES: readonly PackingTemplateDefinition[] =
  Object.freeze(PACKING_TEMPLATE_CATALOG.filter((entry) => entry.selectable));

export function packingTemplateKey(templateDefinition: Pick<PackingTemplateDefinition, 'id' | 'version'>): string {
  return `${templateDefinition.id}@${templateDefinition.version}`;
}

export function getPackingTemplate(id: string, version: number): PackingTemplateDefinition | null {
  return PACKING_TEMPLATE_CATALOG.find((entry) => entry.id === id && entry.version === version) ?? null;
}

export function getPackingTemplateByKey(key: string): PackingTemplateDefinition | null {
  return PACKING_TEMPLATE_CATALOG.find((entry) => packingTemplateKey(entry) === key) ?? null;
}

export function isPackingTemplateApplied(
  tripId: string,
  templateIdentity: PackingTemplateIdentity,
  applications: readonly AppliedPackingTemplate[],
): boolean {
  return applications.some((application) => application.tripId === tripId
    && application.templateId === templateIdentity.id
    && application.templateVersion === templateIdentity.version);
}

export function availablePackingTemplatesForTrip(
  tripId: string,
  applications: readonly AppliedPackingTemplate[],
  templates: readonly PackingTemplateDefinition[] = SELECTABLE_PACKING_TEMPLATES,
): PackingTemplateDefinition[] {
  return templates.filter((entry) => !isPackingTemplateApplied(tripId, entry, applications));
}

export function resolvePackingTemplate(
  definition: PackingTemplateDefinition,
  translate: (key: string) => string,
): ResolvedPackingTemplate {
  return {
    id: definition.id,
    version: definition.version,
    title: translate(`travel.packingTemplates.titles.${definition.titleKey}`),
    items: definition.items.map((item) => ({
      templateItemId: item.id,
      label: translate(`travel.packingTemplates.items.${item.labelKey}`),
      category: item.category,
    })),
  };
}

function normalizedLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

/**
 * Copies suggestions into ordinary packing rows. The source identity/version is
 * deliberately absent from the result: after this boundary the user's list is independent.
 */
export function copyPackingTemplate(input: {
  tripId: string;
  template: ResolvedPackingTemplate;
  existingItems: readonly PackingItem[];
  authorId?: string;
  makeId?: () => string;
}): PackingItem[] {
  const existingLabels = new Set(
    input.existingItems
      .filter((item) => item.tripId === input.tripId)
      .map((item) => normalizedLabel(item.label)),
  );
  const makeId = input.makeId ?? newEntityId;
  const copies: PackingItem[] = [];

  for (const suggestion of input.template.items) {
    const label = suggestion.label.trim().replace(/\s+/g, ' ');
    const key = normalizedLabel(label);
    if (key.length === 0 || existingLabels.has(key)) continue;
    existingLabels.add(key);
    copies.push({
      id: makeId(),
      tripId: input.tripId,
      ...(input.authorId ? { authorId: input.authorId } : {}),
      label,
      checked: false,
      isDefault: false,
      category: suggestion.category,
    });
  }

  return copies;
}
