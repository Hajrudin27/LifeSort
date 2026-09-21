import { migrateLocalStore } from '@/core/storage/migrations/harness';
import { foodIngredientsMigration } from '@/core/storage/migrations/foodIngredients';

const item = { id: 'p', name: 'Æg', quantity: '2 dåser', expiryDate: '2026-10-01', addedAt: '2026-09-01T08:00:00.000Z' };
const v1 = (pantryItems: unknown) => JSON.stringify({
  version: 1, state: { recipes: [], pantryItems, monthlyBudgetByMonth: { '2026-09': 4000 }, shoppingItems: [{ id: 's', label: 'Bread', checked: false }] },
});
const memory = (initial: string) => {
  let bytes = initial;
  const setItem = jest.fn(async (_key: string, value: string) => { bytes = value; });
  return { getItem: jest.fn(async () => bytes), setItem, bytes: () => bytes };
};

describe('APP-050 local Food v1 → v2', () => {
  it('preserves all other Food state and historical pantry text exactly', async () => {
    const before = JSON.parse(v1([item]));
    const storage = memory(JSON.stringify(before));
    expect((await migrateLocalStore(foodIngredientsMigration, storage)).migrated).toBe(true);
    const after = JSON.parse(storage.bytes());
    expect(after.version).toBe(2);
    expect(after.state.pantryItems).toEqual([{
      id: item.id, name: item.name, legacyQuantityText: '2 dåser', expiryDate: item.expiryDate, addedAt: item.addedAt,
    }]);
    expect({ ...after.state, pantryItems: null }).toEqual({ ...before.state, pantryItems: null });
    storage.setItem.mockClear();
    expect((await migrateLocalStore(foodIngredientsMigration, storage)).migrated).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it.each([
    [{ ...item, quantity: 2 }],
    [{ ...item, quantity: '500 g', unit: 'g' }],
    [{ ...item, expiryDate: '2026-02-30' }],
    [{ ...item, addedAt: 'not-a-time' }],
    ['not-an-item'],
    null,
  ])('fails closed on malformed v1 pantry data', async (pantryItems) => {
    const bytes = v1(pantryItems);
    const storage = memory(bytes);
    await expect(migrateLocalStore(foodIngredientsMigration, storage)).rejects.toMatchObject({ code: 'transform-failed' });
    expect(storage.bytes()).toBe(bytes);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('fails closed when the v1 Pantry array is missing', async () => {
    const bytes = JSON.stringify({ version: 1, state: { recipes: [] } });
    const storage = memory(bytes);
    await expect(migrateLocalStore(foodIngredientsMigration, storage)).rejects.toMatchObject({ code: 'transform-failed' });
    expect(storage.bytes()).toBe(bytes);
  });
  it('rejects malformed current v2 and unknown newer versions without rewriting', async () => {
    for (const [bytes, code] of [
      [JSON.stringify({ version: 2, state: { recipes: [], pantryItems: [{ ...item, quantity: '2 dåser' }] } }), 'validation-failed'],
      [JSON.stringify({ version: 3, state: { recipes: [], pantryItems: [] } }), 'unsupported-newer-version'],
    ]) {
      const storage = memory(bytes);
      await expect(migrateLocalStore(foodIngredientsMigration, storage)).rejects.toMatchObject({ code });
      expect(storage.bytes()).toBe(bytes);
    }
  });
});
