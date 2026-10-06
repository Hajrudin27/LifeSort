import {
  availablePackingTemplatesForTrip,
  copyPackingTemplate,
  getPackingTemplate,
  isPackingTemplateApplied,
  PACKING_TEMPLATE_CATALOG,
  packingTemplateKey,
  resolvePackingTemplate,
  SELECTABLE_PACKING_TEMPLATES,
} from '@/features/travel/packingTemplates';
import type { PackingItem } from '@/types/trip';
import { BACKUP_VERSION, parseBackupFile } from '@/utils/shared/backupValidation';

const translate = (key: string) => key.split('.').at(-1) ?? key;

describe('APP-060 versioned packing template copies', () => {
  it('keeps v1 and v2 distinct and exposes only explicitly selectable releases', () => {
    const v1 = getPackingTemplate('travel-essentials', 1)!;
    const v2 = getPackingTemplate('travel-essentials', 2)!;

    expect(packingTemplateKey(v1)).toBe('travel-essentials@1');
    expect(packingTemplateKey(v2)).toBe('travel-essentials@2');
    expect(v1.items.map((item) => item.id)).not.toContain('travel-adapter');
    expect(v2.items.map((item) => item.id)).toContain('travel-adapter');
    expect(SELECTABLE_PACKING_TEMPLATES).toContain(v2);
    expect(SELECTABLE_PACKING_TEMPLATES).not.toContain(v1);

    let v1Sequence = 0;
    const v1Copy = copyPackingTemplate({
      tripId: 'trip-a', template: resolvePackingTemplate(v1, translate), existingItems: [],
      makeId: () => `v1-copy-${++v1Sequence}`,
    });
    void resolvePackingTemplate(v2, translate);
    expect(v1Copy).toHaveLength(5);
    expect(v1Copy.map((item) => item.label)).not.toContain('travelAdapter');
  });

  it('freezes the catalogue and gives an edited user copy no path back to it', () => {
    const definition = getPackingTemplate('travel-essentials', 2)!;
    const sourceBefore = JSON.stringify(PACKING_TEMPLATE_CATALOG);
    expect(Object.isFrozen(PACKING_TEMPLATE_CATALOG)).toBe(true);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.items)).toBe(true);

    const [copy] = copyPackingTemplate({
      tripId: 'trip-a',
      template: resolvePackingTemplate(definition, translate),
      existingItems: [],
      makeId: () => 'copy-1',
    });
    const edited = { ...copy, label: 'My passport', category: 'other' as const };

    expect(edited).toMatchObject({ label: 'My passport', category: 'other' });
    expect(JSON.stringify(PACKING_TEMPLATE_CATALOG)).toBe(sourceBefore);
    expect(definition.items[0]).toMatchObject({ id: 'passport', category: 'essentials' });
  });

  it('creates fresh independent ids when the same version is copied to two trips', () => {
    const resolved = resolvePackingTemplate(getPackingTemplate('weekend-basics', 1)!, translate);
    let sequence = 0;
    const makeId = () => `copy-${++sequence}`;
    const first = copyPackingTemplate({ tripId: 'trip-a', template: resolved, existingItems: [], makeId });
    const second = copyPackingTemplate({ tripId: 'trip-b', template: resolved, existingItems: [], makeId });

    expect(first.map((item) => item.tripId)).toEqual(Array(first.length).fill('trip-a'));
    expect(second.map((item) => item.tripId)).toEqual(Array(second.length).fill('trip-b'));
    expect(new Set([...first, ...second].map((item) => item.id)).size).toBe(first.length + second.length);
    expect(first[0]).not.toBe(second[0]);
    const editedFirst = first.map((item, index) => (index === 0 ? { ...item, label: 'Edited only on A' } : item));
    expect(editedFirst[0].label).toBe('Edited only on A');
    expect(second[0].label).toBe('tops');
  });

  it('is additive, preserves existing state, and prevents normalized-label duplicates', () => {
    const definition = getPackingTemplate('travel-essentials', 2)!;
    const existing: PackingItem[] = [
      { id: 'custom', tripId: 'trip-a', label: 'Custom item', checked: true, isDefault: false, category: 'other' },
      { id: 'charger', tripId: 'trip-a', label: '  CHARGER  ', checked: true, isDefault: false, category: 'other' },
      { id: 'elsewhere', tripId: 'trip-b', label: 'Passport', checked: false, isDefault: false, category: 'essentials' },
    ];
    let sequence = 0;
    const copies = copyPackingTemplate({
      tripId: 'trip-a',
      template: resolvePackingTemplate(definition, translate),
      existingItems: existing,
      makeId: () => `new-${++sequence}`,
    });

    expect(existing).toHaveLength(3);
    expect(existing[0]).toMatchObject({ label: 'Custom item', checked: true });
    expect(copies.map((item) => item.label)).not.toContain('charger');
    expect(copies.map((item) => item.label)).toContain('passport');

    const reapplied = copyPackingTemplate({
      tripId: 'trip-a',
      template: resolvePackingTemplate(definition, translate),
      existingItems: [...existing, ...copies],
    });
    expect(reapplied).toEqual([]);
  });

  it('offers templates initially, then hides only the exact applied identity for that trip', () => {
    expect(availablePackingTemplatesForTrip('trip-a', [])).toEqual(SELECTABLE_PACKING_TEMPLATES);

    const applied = [{ tripId: 'trip-a', templateId: 'travel-essentials', templateVersion: 2 }];
    expect(isPackingTemplateApplied('trip-a', { id: 'travel-essentials', version: 2 }, applied)).toBe(true);
    expect(availablePackingTemplatesForTrip('trip-a', applied).map(packingTemplateKey)).toEqual(['weekend-basics@1']);
    expect(availablePackingTemplatesForTrip('trip-b', applied)).toEqual(SELECTABLE_PACKING_TEMPLATES);
  });

  it('treats different template versions independently and never infers application from item labels', () => {
    const v1 = getPackingTemplate('travel-essentials', 1)!;
    const v2 = getPackingTemplate('travel-essentials', 2)!;
    const applied = [{ tripId: 'trip-a', templateId: v1.id, templateVersion: v1.version }];
    const manuallyCreated: PackingItem[] = v2.items.map((item) => ({
      id: `manual-${item.id}`, tripId: 'trip-b', label: item.labelKey,
      checked: false, isDefault: false, category: item.category,
    }));

    expect(availablePackingTemplatesForTrip('trip-a', applied, [v1, v2])).toEqual([v2]);
    expect(manuallyCreated).toHaveLength(v2.items.length);
    expect(availablePackingTemplatesForTrip('trip-b', [], [v2])).toEqual([v2]);
  });

  it('backs up copied rows and applied identities but ignores global template definitions', () => {
    const parsed = parseBackupFile(JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '2026-10-06T00:00:00.000Z',
      data: {
        trips: {
          packingItems: [{
            id: 'copy-1', tripId: 'trip-a', label: 'Passport', checked: false,
            isDefault: false, category: 'essentials',
          }],
          appliedPackingTemplates: [{
            tripId: 'trip-a', templateId: 'travel-essentials', templateVersion: 2,
            appliedBy: 'account-a', appliedAt: '2026-10-06T00:00:00.000Z',
          }],
          packingTemplates: PACKING_TEMPLATE_CATALOG,
        },
      },
    }));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.trips?.packingItems).toHaveLength(1);
    expect(parsed.data.trips?.appliedPackingTemplates).toEqual([{
      tripId: 'trip-a', templateId: 'travel-essentials', templateVersion: 2,
      appliedBy: 'account-a', appliedAt: '2026-10-06T00:00:00.000Z',
    }]);
    expect(parsed.data.trips).not.toHaveProperty('packingTemplates');
  });
});
