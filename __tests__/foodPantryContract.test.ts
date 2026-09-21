import { canonicalPantryEdit, decodeLegacyPantryItem, decodePantryItem, decodePantryRow } from '@/core/food/pantry';
import { parseBackupFile } from '@/utils/shared/backupValidation';

const base = { id: 'pantry-1', name: 'Synthetic oats', addedAt: '2026-09-01T08:00:00.000Z' };
const row = {
  id: base.id, name: base.name, added_at: base.addedAt,
  quantity: null, structured_quantity: null, structured_unit: null,
  purchased_date: null, opened_date: null, expiry_date: null,
};
const backup = (version: number, items: unknown) =>
  JSON.stringify({ version, data: { food: { pantryItems: items } } });

describe('APP-050 canonical PantryItem', () => {
  it('allows no optional fields and does not derive dates from addedAt', () => {
    expect(decodePantryItem(base)).toEqual(base);
    expect(canonicalPantryEdit(null, { name: 'Synthetic oats' }, false, base.id, base.addedAt)).toEqual(base);
    expect(decodePantryItem({ ...base, purchasedDate: '2026-09-02', openedDate: '2026-09-01', expiryDate: '2026-09-03' }))
      .toEqual({ ...base, purchasedDate: '2026-09-02', openedDate: '2026-09-01', expiryDate: '2026-09-03' });
  });
  it('requires a finite positive quantity paired with an APP-047 unit', () => {
    expect(decodePantryItem({ ...base, quantity: 1.5, unit: 'ml' })).toEqual({ ...base, quantity: 1.5, unit: 'ml' });
    for (const invalid of [
      { quantity: 1 }, { unit: 'g' }, { quantity: 0, unit: 'g' },
      { quantity: -1, unit: 'piece' }, { quantity: NaN, unit: 'g' },
      { quantity: Infinity, unit: 'g' }, { quantity: 1, unit: 'kg' },
      { quantity: '500', unit: 'g' }, { quantity: null, unit: null },
    ]) expect(decodePantryItem({ ...base, ...invalid })).toBeNull();
  });
  it('rejects impossible or imprecise dates and never infers expiry or family', () => {
    for (const field of ['purchasedDate', 'openedDate', 'expiryDate']) {
      expect(decodePantryItem({ ...base, [field]: '2026-02-30' })).toBeNull();
      expect(decodePantryItem({ ...base, [field]: '2026-9-1' })).toBeNull();
      expect(decodePantryItem({ ...base, [field]: '2026-09-01T00:00:00Z' })).toBeNull();
    }
    expect(decodePantryItem({ ...base, familyId: 'oats' })).toBeNull();
    expect(canonicalPantryEdit(null, { name: 'Eggs', purchasedDate: '2026-09-01' }, false, base.id, base.addedAt))
      .toEqual({ ...base, name: 'Eggs', purchasedDate: '2026-09-01' });
  });
  it.each(['500 g', '2 dåser', 'ca. halvdelen', 'lidt', ''])('preserves legacy text %j verbatim', (quantity) => {
    expect(decodeLegacyPantryItem({ ...base, quantity })).toEqual({ ...base, legacyQuantityText: quantity });
    expect(decodePantryItem({ ...base, legacyQuantityText: quantity, quantity: 500, unit: 'g' })).toBeNull();
  });
  it('edits the same entity, clears optionals, and retains legacy only by explicit choice', () => {
    const current = { ...base, legacyQuantityText: 'ca. halvdelen', purchasedDate: '2026-09-01', expiryDate: '2026-09-30' };
    expect(canonicalPantryEdit(current, { name: 'Renamed' }, true)).toEqual({ ...base, name: 'Renamed', legacyQuantityText: 'ca. halvdelen' });
    expect(canonicalPantryEdit(current, { name: 'Renamed', quantity: 2, unit: 'piece' })).toEqual({ ...base, name: 'Renamed', quantity: 2, unit: 'piece' });
    expect(canonicalPantryEdit(current, { name: 'Renamed' })).toEqual({ ...base, name: 'Renamed' });
    expect(canonicalPantryEdit(current, { name: 'Renamed', quantity: 2 }, true)).toBeNull();
  });
  it('strictly decodes selected Supabase rows', () => {
    expect(decodePantryRow(row)).toEqual(base);
    expect(decodePantryRow({ ...row, quantity: '500 g', expiry_date: '2026-10-01' }))
      .toEqual({ ...base, legacyQuantityText: '500 g', expiryDate: '2026-10-01' });
    expect(decodePantryRow({ ...row, structured_quantity: 2, structured_unit: 'piece', opened_date: '2026-09-12' }))
      .toEqual({ ...base, quantity: 2, unit: 'piece', openedDate: '2026-09-12' });
    for (const invalid of [
      { structured_quantity: 2 }, { structured_unit: 'kg' }, { structured_quantity: 0, structured_unit: 'g' },
      { structured_quantity: '2', structured_unit: 'piece' }, { opened_date: '2026-02-30' },
      { quantity: 'old', structured_quantity: 2, structured_unit: 'g' },
    ]) expect(decodePantryRow({ ...row, ...invalid })).toBeNull();
    expect(decodePantryRow({ ...row, family_id: 'egg' })).toBeNull();
  });
});

describe('APP-050 backup format 5', () => {
  it.each([1, 2, 3, 4])('upgrades format %i pantry text without parsing or inferred dates', (version) => {
    const old = { ...base, name: 'Æg', quantity: '500 g', expiryDate: '2026-10-01' };
    const parsed = parseBackupFile(backup(version, [old]));
    expect(parsed.ok && parsed.data.food?.pantryItems).toEqual([{ ...base, name: 'Æg', legacyQuantityText: '500 g', expiryDate: '2026-10-01' }]);
  });
  it('validates v5 canonical data without normalizing it', () => {
    const current = { ...base, quantity: 2, unit: 'piece', openedDate: '2026-09-10' };
    const parsed = parseBackupFile(backup(5, [current]));
    expect(parsed.ok && parsed.data.food?.pantryItems).toEqual([current]);
    expect(parseBackupFile(backup(5, [{ ...base, quantity: '2 piece' }]))).toEqual({ ok: false, error: 'invalid_format' });
    expect(parseBackupFile(backup(5, [{ ...base, quantity: 2, unit: 'kg' }]))).toEqual({ ok: false, error: 'invalid_format' });
  });
  it('rejects the whole import for malformed pantry in any version', () => {
    for (const version of [1, 2, 3, 4, 5]) {
      expect(parseBackupFile(JSON.stringify({
        version, data: { food: { pantryItems: [{ ...base, quantity: 0, unit: 'g' }] }, todos: { todos: [] } },
      }))).toEqual({ ok: false, error: 'invalid_format' });
    }
  });
});
