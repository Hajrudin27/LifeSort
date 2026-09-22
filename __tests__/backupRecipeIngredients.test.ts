import { BACKUP_VERSION, parseBackupFile } from '@/utils/shared/backupValidation';

/**
 * APP-047 backup format 4: recipe ingredients follow the ingredient contract.
 * Formats 1–3 carried `{ name, amount }`, kept verbatim as legacy ingredients.
 */

let mockFileContent = '';
let mockWritten = '';
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: false, assets: [{ uri: 'file:///synthetic/backup.json' }] })),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///synthetic/',
  readAsStringAsync: jest.fn(() => Promise.resolve(mockFileContent)),
  writeAsStringAsync: jest.fn((_uri: string, content: string) => { mockWritten = content; return Promise.resolve(); }),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(false)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));
import { familyIngredient, unlinkedIngredient } from '@/core/food/ingredients';
import { deriveShoppingList } from '@/features/food/shoppingListDerivation';
import { useFoodStore } from '@/store/useFoodStore';
import { exportBackup, importBackup } from '@/utils/shared/dataBackup';

const backup = (version: number, data: Record<string, unknown>) => JSON.stringify({ version, exportedAt: '2026-09-01T00:00:00.000Z', data });
const recipe = (ingredients: unknown) => ({ id: 'r1', name: 'Synthetic soup', mealType: 'dinner', ingredients, tags: [] });
const food = (ingredients: unknown) => ({ food: { recipes: [recipe(ingredients)], selectedStores: ['Netto'] } });
const recipesOf = (result: ReturnType<typeof parseBackupFile>) => (result.ok ? result.data.food?.recipes : undefined);

describe('APP-047 backup parsing', () => {
  it('exports the current format 6 while keeping the format 4 ingredient contract', () => {
    expect(BACKUP_VERSION).toBe(6);
  });

  it.each([1, 2, 3])('format %i: keeps each { name, amount } verbatim as legacy, inferring no family', (version) => {
    const result = parseBackupFile(backup(version, food([{ name: 'Æg', amount: '3 stk' }, { name: 'Salt', amount: '' }])));
    expect(recipesOf(result)).toEqual([recipe([{ kind: 'legacy', name: 'Æg', amount: '3 stk' }, { kind: 'legacy', name: 'Salt', amount: '' }])]);
    expect(result.ok && result.data.food?.selectedStores).toEqual(['Netto']);
  });

  it('format 4: accepts the current contract unchanged', () => {
    const ingredients = [familyIngredient('egg', 'Æg', 3, 'piece'), unlinkedIngredient('Synthetic stock', 1.5, 'ml'), { kind: 'legacy', name: 'Salt', amount: '' }];
    expect(recipesOf(parseBackupFile(backup(4, food(ingredients))))).toEqual([recipe(ingredients)]);
  });

  it('format 3: keeps a recipe an older build cached from a newer one, when it meets the current contract', () => {
    const cached = [familyIngredient('egg', 'Æg', 3, 'piece'), { name: 'Salt', amount: '' }];
    expect(recipesOf(parseBackupFile(backup(3, food(cached))))).toEqual([recipe([cached[0], { kind: 'legacy', name: 'Salt', amount: '' }])]);
  });

  it.each([
    ['format 3 invalid new-shape ingredient', 3, [{ kind: 'family', familyId: 'egg-large', name: 'Æg', quantity: 3, unit: 'piece' }]],
    ['format 3 number amount', 3, [{ name: 'Æg', amount: 3 }]],
    ['format 3 extra key', 3, [{ name: 'Æg', amount: '3 stk', familyId: 'egg' }]],
    // Format 4 is canonical: the old shape is not normalized there.
    ['format 4 pre-APP-047 ingredient', 4, [{ name: 'Æg', amount: '3 stk' }]],
    ['format 4 unknown family', 4, [{ kind: 'family', familyId: 'egg-large', name: 'Æg', quantity: 3, unit: 'piece' }]],
    ['format 4 display unit', 4, [{ kind: 'unlinked', name: 'Salt', quantity: 1, unit: 'tsk' }]],
    ['format 4 zero quantity', 4, [{ kind: 'unlinked', name: 'Salt', quantity: 0, unit: 'g' }]],
    ['ingredients that are not a list', 4, { name: 'Æg' }],
  ])('rejects %s', (_name, version, ingredients) => {
    expect(parseBackupFile(backup(version as number, food(ingredients)))).toEqual({ ok: false, error: 'invalid_format' });
  });

  it('rejects a recipe that is not an object, and a future format', () => {
    expect(parseBackupFile(backup(4, { food: { recipes: ['seed-1'] } }))).toEqual({ ok: false, error: 'invalid_format' });
    expect(parseBackupFile(backup(7, food([])))).toEqual({ ok: false, error: 'unsupported_version' });
  });

  it('never reports ingredient text', () => {
    expect(JSON.stringify(parseBackupFile(backup(4, food([{ name: 'Synthetic secret', amount: '3 stk' }]))))).not.toContain('Synthetic secret');
  });
});

describe('APP-047 backup restore and export through the real Food store', () => {
  beforeEach(async () => {
    await useFoodStore.persist.rehydrate();
  });

  it('restores a format 3 recipe as typed legacy data, and a format 6 re-export round-trips', async () => {
    mockFileContent = backup(3, food([{ name: 'Æg', amount: '2 stk' }]));
    expect(await importBackup()).toMatchObject({ success: true });
    expect(useFoodStore.getState().recipes).toEqual([recipe([{ kind: 'legacy', name: 'Æg', amount: '2 stk' }])]);

    const created = { id: 'r2', name: 'Synthetic new', mealType: 'lunch' as const, tags: [], ingredients: [unlinkedIngredient('Synthetic stock', 1.5, 'ml')] };
    useFoodStore.setState({ recipes: [...useFoodStore.getState().recipes, created] });
    const restored = JSON.stringify(useFoodStore.getState().recipes);
    await exportBackup();
    const exported = JSON.parse(mockWritten);
    expect(exported.version).toBe(6);

    useFoodStore.setState({ recipes: [] });
    mockFileContent = mockWritten;
    expect(await importBackup()).toMatchObject({ success: true });
    expect(JSON.stringify(useFoodStore.getState().recipes)).toBe(restored);
  });
});

describe('APP-050 Pantry backup restore', () => {
  const old = { id: 'p', name: 'Synthetic pantry', quantity: 'ca. halvdelen',
    expiryDate: '2026-10-01', addedAt: '2026-09-01T08:00:00.000Z' };

  it('imports format 4 text, exports format 6 and round-trips the canonical item', async () => {
    mockFileContent = backup(4, { food: { pantryItems: [old] } });
    expect(await importBackup()).toMatchObject({ success: true });
    const expected = [{ id: old.id, name: old.name, legacyQuantityText: old.quantity,
      expiryDate: old.expiryDate, addedAt: old.addedAt }];
    expect(useFoodStore.getState().pantryItems).toEqual(expected);
    await exportBackup();
    expect(JSON.parse(mockWritten).version).toBe(6);
    useFoodStore.setState({ pantryItems: [] });
    mockFileContent = mockWritten;
    expect(await importBackup()).toMatchObject({ success: true });
    expect(useFoodStore.getState().pantryItems).toEqual(expected);
  });

  it('rejects malformed Pantry before mutating Food or any other store', async () => {
    const before = [{ id: 'existing', name: 'Existing', addedAt: '2026-09-01T08:00:00.000Z' }];
    useFoodStore.setState({ pantryItems: before });
    mockFileContent = backup(5, { food: { pantryItems: [{ ...old, quantity: 0, unit: 'g' }] }, todos: { todos: [] } });
    expect(await importBackup()).toEqual({ success: false, restoredKeys: [], skippedKeys: [], error: 'invalid_format' });
    expect(useFoodStore.getState().pantryItems).toBe(before);
  });
});

describe('APP-052 shopping backup v6', () => {
  const old = { id: 'old-shopping', label: '  Milk  ', checked: true };
  const sourceRecipe = { id: 'shopping-recipe', name: 'Dinner', mealType: 'dinner' as const, ingredients: [familyIngredient('potato', 'Potatoes', 500, 'g')] };
  const derived = { ...deriveShoppingList([{ day: 0, mealType: 'dinner' as const, recipe: sourceRecipe }])[0],
    id: 'generated', kind: 'meal_plan' as const, weekKey: '2026-W39', checked: false,
    amount: { kind: 'structured' as const, quantity: 600, unit: 'g' as const } };

  it.each([1, 2, 3, 4, 5])('upgrades format %i manual labels without inferred fields', (version) => {
    const result = parseBackupFile(backup(version, { food: { shoppingItems: [old] } }));
    expect(result.ok && result.data.food?.shoppingItems).toEqual([{ ...old, kind: 'manual' }]);
  });

  it('accepts current manual and derived items and rejects malformed derived imports in full', () => {
    const payload = { food: { shoppingItems: [{ ...old, kind: 'manual' }, derived] } };
    expect(parseBackupFile(backup(6, payload))).toMatchObject({ ok: true, data: payload });
    for (const invalid of [
      { ...derived, provenance: [] },
      { ...derived, provenance: [{ ...derived.provenance[0], recipeId: '' }] },
      { ...derived, amount: { kind: 'structured', quantity: 0, unit: 'g' } },
      { ...derived, amount: { kind: 'structured', quantity: 500, unit: 'kg' } },
      { ...derived, kind: 'other' },
    ]) expect(parseBackupFile(backup(6, { food: { shoppingItems: [{ ...old, kind: 'manual' }, invalid] } }))).toEqual({ ok: false, error: 'invalid_format' });
  });

  it('round-trips current amount edits and original provenance', async () => {
    await useFoodStore.persist.rehydrate();
    useFoodStore.setState({ shoppingItems: [derived] });
    await exportBackup();
    expect(JSON.parse(mockWritten).version).toBe(6);
    useFoodStore.setState({ shoppingItems: [] });
    mockFileContent = mockWritten;
    expect(await importBackup()).toMatchObject({ success: true });
    expect(useFoodStore.getState().shoppingItems).toEqual([derived]);
    expect(derived.provenance[0]).toMatchObject({ recipeId: 'shopping-recipe', quantity: 500 });
  });
});
