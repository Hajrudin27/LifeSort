import en from '@/localization/locales/en/household.json';
import da from '@/localization/locales/da/household.json';
import { MOVING_TEMPLATE_ID } from '@/core/home/moving';
import {
  applyMovingUpgrade,
  availableMovingUpgrade,
  getMovingTemplate,
  groupMovingItems,
  instantiateMovingItems,
  latestSelectableMovingTemplate,
  MOVING_CUSTOM_SECTION_ID,
  MOVING_TEMPLATE_CATALOG,
  movingReviewStatus,
  validateMovingTemplate,
  type MovingTemplateDefinition,
} from '@/features/home/movingTemplates';
import type { MovingItem } from '@/types/household';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const v1 = getMovingTemplate(MOVING_TEMPLATE_ID, 1)!;
const translate = (key: string) => `label:${key}`;

/** Synthetic versions prove the upgrade semantics without shipping a v2 to users. */
function synthetic(version: number, ids: string[], selectable = true): MovingTemplateDefinition {
  return {
    id: MOVING_TEMPLATE_ID, version, selectable, titleKey: 'movingHome',
    metadata: { ...v1.metadata },
    sections: v1.sections,
    items: ids.map((id) => ({ id, labelKey: id, section: 'administration' as const })),
  };
}
const row = (id: string, version: number, itemId: string, checked = false): MovingItem => ({
  id, label: itemId, checked, templateRef: { templateId: MOVING_TEMPLATE_ID, templateVersion: version, templateItemId: itemId },
});

describe('APP-062 catalogue', () => {
  it('ships exactly the approved moving-home v1 content and structure', () => {
    expect(MOVING_TEMPLATE_CATALOG.map((entry) => [entry.id, entry.version, entry.selectable])).toEqual([[MOVING_TEMPLATE_ID, 1, true]]);
    expect(v1.sections.map((section) => section.id)).toEqual(['administration', 'utilities']);
    expect(v1.items.map((item) => [item.id, item.section])).toEqual([
      ['addressChange', 'administration'], ['mailForwarding', 'administration'], ['insurance', 'administration'],
      ['internet', 'utilities'], ['electricity', 'utilities'],
    ]);
  });

  it('carries the approved editorial metadata, no URL and no jurisdiction', () => {
    expect(v1.metadata).toEqual({
      source: 'lifesortEditorial', reviewedBy: 'lifesortEditorial',
      reviewedAt: '2026-10-07', reviewDueAt: '2027-10-07', jurisdiction: null,
    });
    expect(Object.keys(v1.metadata)).not.toContain('sourceUrl');
  });

  it('is valid, has stable unique ids and is deeply frozen', () => {
    for (const definition of MOVING_TEMPLATE_CATALOG) {
      expect(validateMovingTemplate(definition)).toEqual([]);
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.metadata)).toBe(true);
      expect(Object.isFrozen(definition.sections)).toBe(true);
      expect(definition.sections.every((section) => Object.isFrozen(section))).toBe(true);
      expect(Object.isFrozen(definition.items)).toBe(true);
      expect(definition.items.every((item) => Object.isFrozen(item))).toBe(true);
    }
    expect(Object.isFrozen(MOVING_TEMPLATE_CATALOG)).toBe(true);
    const keys = MOVING_TEMPLATE_CATALOG.map((entry) => `${entry.id}@${entry.version}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never needs the wall clock: review order is checked structurally', () => {
    for (const definition of MOVING_TEMPLATE_CATALOG) {
      expect(definition.metadata.reviewDueAt >= definition.metadata.reviewedAt).toBe(true);
    }
  });

  it.each(['en', 'da'] as const)('has every title, section, authority and item key in %s', (language) => {
    const strings = (language === 'en' ? en : da) as unknown as Record<string, Record<string, unknown>>;
    const moving = strings.moving as Record<string, Record<string, string>>;
    for (const definition of MOVING_TEMPLATE_CATALOG) {
      expect(moving.templates[definition.titleKey]).toEqual(expect.any(String));
      expect(moving.authority[definition.metadata.source]).toEqual(expect.any(String));
      expect(moving.authority[definition.metadata.reviewedBy]).toEqual(expect.any(String));
      for (const section of definition.sections) expect(moving.sections[section.titleKey]).toEqual(expect.any(String));
      for (const item of definition.items) expect(strings.movingDefaults[item.labelKey]).toEqual(expect.any(String));
    }
    expect(moving.sections.yourItems).toEqual(expect.any(String));
    expect(moving.templateCard.disclaimer).toEqual(expect.any(String));
  });

  it.each([
    ['a version below 1', { version: 0 }, 'version'],
    ['a fractional version', { version: 1.5 }, 'version'],
    ['an invalid id', { id: 'Moving Home' }, 'id'],
    ['an invalid reviewedAt', { metadata: { ...v1.metadata, reviewedAt: '2026-02-30' } }, 'reviewedAt'],
    ['an invalid reviewDueAt', { metadata: { ...v1.metadata, reviewDueAt: 'soon' } }, 'reviewDueAt'],
    ['a due date before the review', { metadata: { ...v1.metadata, reviewDueAt: '2026-10-06' } }, 'reviewOrder'],
    ['an unknown authority', { metadata: { ...v1.metadata, source: 'ministry' as never } }, 'authority'],
    ['a malformed jurisdiction', { metadata: { ...v1.metadata, jurisdiction: 'Denmark' } }, 'jurisdiction'],
    ['duplicate item ids', { items: [v1.items[0], v1.items[0]] }, 'items'],
    ['duplicate section ids', { sections: [v1.sections[0], v1.sections[0]] }, 'sections'],
    ['an item in an unknown section', { items: [{ ...v1.items[0], section: 'garage' as never }] }, 'itemSection'],
    ['no items', { items: [] }, 'items'],
  ])('rejects %s', (_label, change, problem) => {
    expect(validateMovingTemplate({ ...v1, ...change } as MovingTemplateDefinition)).toContain(problem);
  });

  it('offers only selectable versions and resolves exact historical versions', () => {
    const catalog = [synthetic(1, ['a'], false), synthetic(2, ['a', 'b']), synthetic(3, ['a', 'b', 'c'], false)];
    expect(latestSelectableMovingTemplate(MOVING_TEMPLATE_ID, catalog)?.version).toBe(2);
    expect(getMovingTemplate(MOVING_TEMPLATE_ID, 3, catalog)?.version).toBe(3);
    expect(getMovingTemplate(MOVING_TEMPLATE_ID, 9, catalog)).toBeNull();
    expect(latestSelectableMovingTemplate('other', catalog)).toBeNull();
  });

  it('reports review status deterministically from an injected date', () => {
    expect(movingReviewStatus(v1.metadata, '2026-10-07')).toBe('current');
    expect(movingReviewStatus(v1.metadata, '2027-10-07')).toBe('current');
    expect(movingReviewStatus(v1.metadata, '2027-10-08')).toBe('due-for-review');
  });
});

describe('APP-062 copying a template', () => {
  it('creates fresh user rows with provenance, localized labels and no legacy ids', () => {
    const rows = instantiateMovingItems(v1, translate);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((entry) => entry.id)).size).toBe(5);
    for (const entry of rows) {
      expect(entry.id).toMatch(UUID);
      expect(entry.id.startsWith('default-')).toBe(false);
      expect(entry.checked).toBe(false);
    }
    expect(rows.map((entry) => entry.label)).toEqual(v1.items.map((item) => `label:${item.labelKey}`));
    expect(rows.map((entry) => entry.templateRef)).toEqual(v1.items.map((item) => ({
      templateId: MOVING_TEMPLATE_ID, templateVersion: 1, templateItemId: item.id,
    })));
  });

  it('copies are independent of the catalogue and of each other', () => {
    const first = instantiateMovingItems(v1, translate);
    const second = instantiateMovingItems(v1, translate);
    expect(first.map((entry) => entry.id)).not.toEqual(second.map((entry) => entry.id));
    first[0].checked = true;
    expect(Object.isFrozen(v1.items[0])).toBe(true);
    expect(second[0].checked).toBe(false);
  });

  it('never duplicates a template item the user already holds', () => {
    const held = [row('x', 1, 'internet'), { id: 'custom', label: 'Internet', checked: false }];
    const rows = instantiateMovingItems(v1, translate, held);
    expect(rows.map((entry) => entry.templateRef!.templateItemId)).toEqual(['addressChange', 'mailForwarding', 'insurance', 'electricity']);
  });
});

describe('APP-062 grouping', () => {
  it('groups template rows by section, then the user rows, and omits empty groups', () => {
    const items: MovingItem[] = [
      { id: 'c1', label: 'Mine', checked: false },
      row('r1', 1, 'electricity'),
      row('r2', 1, 'addressChange'),
      { id: 'default-foo', label: 'Look-alike', checked: false },
      row('r3', 1, 'notInTheCatalogue'),
    ];
    const groups = groupMovingItems(items);
    expect(groups.map((group) => [group.id, group.items.map((entry) => entry.id)])).toEqual([
      ['administration', ['r2']], ['utilities', ['r1']], [MOVING_CUSTOM_SECTION_ID, ['c1', 'default-foo', 'r3']],
    ]);
    expect(groupMovingItems([])).toEqual([]);
    expect(groupMovingItems([row('r1', 1, 'internet')]).map((group) => group.id)).toEqual(['utilities']);
  });
});

describe('APP-062 upgrade semantics (synthetic v1 {A,B,C} to v2 {A,B,C,E})', () => {
  const catalog = [synthetic(1, ['A', 'B', 'C']), synthetic(2, ['A', 'B', 'C', 'E'])];
  const marker = { id: MOVING_TEMPLATE_ID, version: 1 };
  // The user checked A, renamed nothing, deleted C and added a custom D.
  const rows: MovingItem[] = [row('a', 1, 'A', true), row('b', 1, 'B'), { id: 'd', label: 'D', checked: false }];

  it('offers only the genuinely new E, never the deleted C', () => {
    const upgrade = availableMovingUpgrade(marker, rows, catalog)!;
    expect(upgrade.template.version).toBe(2);
    expect(upgrade.newItems.map((item) => item.id)).toEqual(['E']);
  });

  it('is a pure decision: nothing changes until the caller accepts', () => {
    const before = JSON.stringify(rows);
    availableMovingUpgrade(marker, rows, catalog);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('accepting adds only E with a fresh id and v2 provenance and leaves every other row alone', () => {
    const upgrade = availableMovingUpgrade(marker, rows, catalog)!;
    const added = applyMovingUpgrade(upgrade, translate);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      label: 'label:E', checked: false,
      templateRef: { templateId: MOVING_TEMPLATE_ID, templateVersion: 2, templateItemId: 'E' },
    });
    expect(added[0].id).toMatch(UUID);
    expect(rows.map((entry) => [entry.id, entry.label, entry.checked])).toEqual([['a', 'A', true], ['b', 'B', false], ['d', 'D', false]]);
  });

  it('offers nothing once the marker is at the latest version, and C stays deleted', () => {
    expect(availableMovingUpgrade({ id: MOVING_TEMPLATE_ID, version: 2 }, rows, catalog)).toBeNull();
  });

  it('does not offer an item the user already holds a row for', () => {
    expect(availableMovingUpgrade(marker, [...rows, row('e', 2, 'E')], catalog)).toBeNull();
  });

  it('offers nothing without a marker, for an unknown applied version or for a newer marker', () => {
    expect(availableMovingUpgrade(null, rows, catalog)).toBeNull();
    expect(availableMovingUpgrade({ id: MOVING_TEMPLATE_ID, version: 7 }, rows, catalog)).toBeNull();
    expect(availableMovingUpgrade({ id: 'other', version: 1 }, rows, catalog)).toBeNull();
  });

  it('skips a non-selectable newest version and an upgrade with no new items', () => {
    expect(availableMovingUpgrade(marker, rows, [catalog[0], synthetic(2, ['A', 'B', 'C', 'E'], false)])).toBeNull();
    expect(availableMovingUpgrade(marker, rows, [catalog[0], synthetic(2, ['A', 'B'])])).toBeNull();
  });

  it('a skipped version is covered by comparing the applied version with the latest', () => {
    const three = [...catalog, synthetic(3, ['A', 'B', 'C', 'E', 'F'])];
    expect(availableMovingUpgrade(marker, rows, three)!.newItems.map((item) => item.id)).toEqual(['E', 'F']);
  });
});
