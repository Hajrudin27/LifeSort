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
    expect(after.version).toBe(3);
    expect(after.state.pantryItems).toEqual([{
      id: item.id, name: item.name, legacyQuantityText: '2 dåser', expiryDate: item.expiryDate, addedAt: item.addedAt,
    }]);
    expect(after.state.shoppingItems).toEqual([{ id: 's', kind: 'manual', label: 'Bread', checked: false }]);
    expect({ ...after.state, pantryItems: null, shoppingItems: null }).toEqual({ ...before.state, pantryItems: null, shoppingItems: null });
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
  it('rejects malformed historical v2 and unknown newer versions without rewriting', async () => {
    for (const [bytes, code] of [
      [JSON.stringify({ version: 2, state: { recipes: [], pantryItems: [{ ...item, quantity: '2 dåser' }], shoppingItems: [] } }), 'transform-failed'],
      [JSON.stringify({ version: 4, state: { recipes: [], pantryItems: [], shoppingItems: [] } }), 'unsupported-newer-version'],
    ]) {
      const storage = memory(bytes);
      await expect(migrateLocalStore(foodIngredientsMigration, storage)).rejects.toMatchObject({ code });
      expect(storage.bytes()).toBe(bytes);
    }
  });
});

describe('APP-052 local Food v2 → v3 shopping migration', () => {
  const v2 = (shoppingItems: unknown) => JSON.stringify({ version: 2, state: {
    recipes: [], pantryItems: [], shoppingItems, monthlyBudgetByMonth: { '2026-09': 4000 },
    selectedStores: ['Synthetic store'],
  } });

  it('converts every old item to manual, preserving id, label and checked verbatim', async () => {
    const old = [{ id: 'one', label: '  Potatoes  ', checked: true }, { id: 'two', label: '', checked: false }];
    const bytes = v2(old);
    const storage = memory(bytes);
    await migrateLocalStore(foodIngredientsMigration, storage);
    const after = JSON.parse(storage.bytes());
    expect(after.version).toBe(3);
    expect(after.state.shoppingItems).toEqual(old.map((item) => ({ ...item, kind: 'manual' })));
    expect(after.state.shoppingItems[0]).not.toHaveProperty('familyId');
    expect(after.state.shoppingItems[0]).not.toHaveProperty('amount');
    expect(after.state.shoppingItems[0]).not.toHaveProperty('provenance');
    expect(after.state.monthlyBudgetByMonth).toEqual({ '2026-09': 4000 });
    expect(after.state.selectedStores).toEqual(['Synthetic store']);
  });

  it.each([
    [{ id: 'bad', label: 'Potatoes', checked: 'yes' }],
    [{ id: 'bad', label: 'Potatoes', checked: false, familyId: 'potato' }],
    [{ id: '', label: 'Potatoes', checked: false }],
    null,
  ])('rejects malformed v2 shopping input without writing', async (shoppingItems) => {
    const bytes = v2(shoppingItems);
    const storage = memory(bytes);
    await expect(migrateLocalStore(foodIngredientsMigration, storage)).rejects.toMatchObject({ code: 'transform-failed' });
    expect(storage.bytes()).toBe(bytes);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('strictly rejects malformed current v3 shopping items without writing', async () => {
    const bytes = JSON.stringify({ version: 3, state: { recipes: [], pantryItems: [], shoppingItems: [
      { id: 'derived', kind: 'meal_plan', label: 'Potatoes', checked: false, weekKey: '2026-W39',
        identity: { kind: 'family', familyId: 'potato', unit: 'g' }, amount: { kind: 'structured', quantity: 0, unit: 'g' }, provenance: [] },
    ] } });
    const storage = memory(bytes);
    await expect(migrateLocalStore(foodIngredientsMigration, storage)).rejects.toMatchObject({ code: 'validation-failed' });
    expect(storage.bytes()).toBe(bytes);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
