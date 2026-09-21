import fs from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { migrateLocalStore } from '@/core/storage/migrations/harness';
import { foodIngredientsMigration } from '@/core/storage/migrations/foodIngredients';
import { runLocalMigrations } from '@/core/storage/migrations/runtime';

/**
 * APP-047 local Food migration: v0 `{ name, amount }` ingredients → v1 typed
 * `legacy` ingredients, verbatim, with nothing inferred. Seed copies regain
 * their families only by being refreshed from the bundle when the store hydrates.
 */

jest.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain, eq: () => chain, delete: () => chain,
    upsert: () => Promise.resolve({ error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  });
  return { supabase: { from: () => chain, auth: { getUser: () => Promise.resolve({ data: { user: null } }) } } };
});

import i18n from '@/localization/i18n';
import { SEED_RECIPES_DA } from '@/data/seedRecipes.da';
import { useFoodStore } from '@/store/useFoodStore';

type Json = Record<string, any>;
const KEY = 'lifesort-food-v2';
const raw = fs.readFileSync(path.join(__dirname, 'fixtures/local-migrations/food/5c85adc-v0.json'), 'utf8');
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

function memory(initial: string | null) {
  let bytes = initial;
  return {
    getItem: jest.fn(async () => bytes),
    setItem: jest.fn(async (_key: string, value: string) => { bytes = value; }),
    bytes: () => bytes,
  };
}

describe('APP-047/050 Food v0 → v2 (5c85adc fixture)', () => {
  it('wraps every ingredient verbatim as legacy and changes nothing else', async () => {
    const before: Json = JSON.parse(raw);
    const storage = memory(raw);
    expect((await migrateLocalStore(foodIngredientsMigration, storage)).migrated).toBe(true);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const after: Json = JSON.parse(storage.bytes()!);

    expect(after.version).toBe(2);
    after.state.recipes.forEach((recipe: Json, index: number) => {
      const original = before.state.recipes[index];
      expect(recipe.ingredients).toEqual(original.ingredients.map((i: Json) => ({ kind: 'legacy', name: i.name, amount: i.amount })));
      // Every other recipe field and every key position is as it was.
      expect({ ...recipe, ingredients: null }).toEqual({ ...original, ingredients: null });
      expect(Object.keys(recipe)).toEqual(Object.keys(original));
    });
    expect(after.state.pantryItems).toEqual(before.state.pantryItems.map((item: Json) => ({
      id: item.id, name: item.name, addedAt: item.addedAt, legacyQuantityText: item.quantity,
    })));
    expect({ ...after.state, recipes: null, pantryItems: null }).toEqual({ ...before.state, recipes: null, pantryItems: null });
    expect(Object.keys(after.state)).toEqual(Object.keys(before.state));
  });

  it('infers no family and parses no amount, even for seed copies and seed-like names', async () => {
    const storage = memory(raw);
    await migrateLocalStore(foodIngredientsMigration, storage);
    const ingredients = JSON.parse(storage.bytes()!).state.recipes.flatMap((recipe: Json) => recipe.ingredients);
    expect(ingredients.every((i: Json) => i.kind === 'legacy' && !('familyId' in i) && !('quantity' in i) && !('unit' in i))).toBe(true);
    expect(ingredients.map((i: Json) => i.amount)).toEqual(expect.arrayContaining(['3 stk', '', '1 dåse', '1,5 spsk', '1.000 g', 'efter smag']));
  });

  it('keeps a row an older build cached after a newer build wrote it, validated and unchanged', async () => {
    // Device B (pre-APP-047) fetched a recipe device A (APP-047) created, and stored it verbatim.
    const cached = [
      { kind: 'family', familyId: 'egg', name: 'Æg', quantity: 3, unit: 'piece' },
      { kind: 'unlinked', name: 'Synthetic stock', quantity: 1.5, unit: 'ml' },
      { kind: 'legacy', name: 'Salt', amount: '' },
      { name: 'Peber', amount: 'efter smag' },
    ];
    const bytes = JSON.stringify({ state: { recipes: [{ id: 'r', name: 'Synthetic', mealType: 'dinner', ingredients: cached }], pantryItems: [] }, version: 0 });
    const storage = memory(bytes);
    await migrateLocalStore(foodIngredientsMigration, storage);
    expect(JSON.parse(storage.bytes()!).state.recipes[0].ingredients).toEqual([
      ...cached.slice(0, 3),
      { kind: 'legacy', name: 'Peber', amount: 'efter smag' },
    ]);
  });

  it('is a no-op for current v2 bytes', async () => {
    const storage = memory(raw);
    await migrateLocalStore(foodIngredientsMigration, storage);
    const current = storage.bytes();
    storage.setItem.mockClear();
    expect(await migrateLocalStore(foodIngredientsMigration, storage)).toEqual({ raw: current, migrated: false });
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('APP-047 Food migration fails closed and keeps the bytes', () => {
  const v0 = (recipes: unknown, extra: Json = {}) => JSON.stringify({ state: { recipes, pantryItems: [], ...extra }, version: 0 });
  const v1 = (recipes: unknown) => JSON.stringify({ state: { recipes, pantryItems: [] }, version: 1 });
  const recipe = (ingredients: unknown) => ({ id: 'r', name: 'Synthetic', mealType: 'dinner', ingredients });

  it.each([
    ['an ingredient with an extra key', v0([recipe([{ name: 'Æg', amount: '3 stk', familyId: 'egg' }])]), 'transform-failed'],
    ['a number amount', v0([recipe([{ name: 'Æg', amount: 3 }])]), 'transform-failed'],
    ['a missing amount', v0([recipe([{ name: 'Æg' }])]), 'transform-failed'],
    ['an ingredient that is a string', v0([recipe(['Æg 3 stk'])]), 'transform-failed'],
    ['ingredients that are not a list', v0([recipe(null)]), 'transform-failed'],
    ['a recipe that is not an object', v0(['seed-1']), 'transform-failed'],
    ['recipes that are not a list', v0({}), 'transform-failed'],
    ['a v0 cached row whose new shape is invalid', v0([recipe([{ kind: 'family', familyId: 'egg-large', name: 'Æg', quantity: 3, unit: 'piece' }])]), 'transform-failed'],
    ['a v0 cached row with a display unit', v0([recipe([{ kind: 'unlinked', name: 'Salt', quantity: 1, unit: 'tsk' }])]), 'transform-failed'],
    ['an unknown state key', v0([], { recipesV2: [] }), 'transform-failed'],
    ['a versionless payload', JSON.stringify({ state: { recipes: [] } }), 'unknown-legacy-shape'],
    ['a future version', JSON.stringify({ state: { recipes: [] }, version: 3 }), 'unsupported-newer-version'],
    ['v1 with the pre-APP-047 shape', v1([recipe([{ name: 'Æg', amount: '3 stk' }])]), 'transform-failed'],
    ['v1 with an unknown family', v1([recipe([{ kind: 'family', familyId: 'egg-large', name: 'Æg', quantity: 3, unit: 'piece' }])]), 'transform-failed'],
    ['v1 with a display unit', v1([recipe([{ kind: 'unlinked', name: 'Salt', quantity: 1, unit: 'tsk' }])]), 'transform-failed'],
    ['v1 with a zero quantity', v1([recipe([{ kind: 'unlinked', name: 'Salt', quantity: 0, unit: 'g' }])]), 'transform-failed'],
  ])('%s → %s, no write', async (_name, bytes, code) => {
    const storage = memory(bytes);
    await expect(migrateLocalStore(foodIngredientsMigration, storage)).rejects.toMatchObject({ code });
    expect(storage.bytes()).toBe(bytes);
    expect(storage.setItem).not.toHaveBeenCalled();
    try { await migrateLocalStore(foodIngredientsMigration, storage); } catch (error) {
      // Safe codes only: no ingredient text in the error.
      expect(String(error)).not.toMatch(/Æg|stk|Salt/);
    }
  });
});

describe('APP-047 Food hydration through the APP-038 runtime', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await i18n.changeLanguage('da');
  });

  it('upgrades at boot, then hydration refreshes seed copies from the bundle and keeps user legacy data verbatim', async () => {
    await AsyncStorage.setItem(KEY, raw);
    await runLocalMigrations();
    expect(JSON.parse((await AsyncStorage.getItem(KEY))!).version).toBe(2);

    await useFoodStore.persist.rehydrate();
    const { recipes, monthlyBudgetByMonth, savedPlans, selectedStores } = useFoodStore.getState();
    const before: Json = JSON.parse(raw).state;

    expect(recipes.map((r) => r.id)).toEqual(before.recipes.map((r: Json) => r.id));
    // Seed copies: the bundled canonical recipes, with families.
    expect(recipes[0]).toBe(SEED_RECIPES_DA.find((r) => r.id === 'seed-3'));
    expect(recipes[1]).toBe(SEED_RECIPES_DA.find((r) => r.id === 'seed-19'));
    expect(recipes[0].ingredients.every((i) => i.kind === 'family')).toBe(true);
    // User recipes: legacy, verbatim — "Æg" / "2 stk" is not turned into the egg family.
    expect(recipes[2].ingredients).toEqual(before.recipes[2].ingredients.map((i: Json) => ({ kind: 'legacy', ...i })));
    expect(recipes[3].ingredients).toEqual(before.recipes[3].ingredients.map((i: Json) => ({ kind: 'legacy', ...i })));
    // Removed seeds stay removed; the rest of the store is untouched.
    expect(recipes).toHaveLength(4);
    expect([monthlyBudgetByMonth, savedPlans, selectedStores]).toEqual([before.monthlyBudgetByMonth, before.savedPlans, before.selectedStores]);
  });

  it('persists the refreshed seeds on the next write, and those bytes validate on the next boot without a write', async () => {
    await AsyncStorage.setItem(KEY, raw);
    await useFoodStore.persist.rehydrate();
    useFoodStore.setState({ selectedStores: ['Netto', 'Rema 1000'] });
    await flush();
    const stored: Json = JSON.parse((await AsyncStorage.getItem(KEY))!);
    expect(stored.version).toBe(2);
    expect(stored.state.recipes[0].ingredients[0]).toEqual({ kind: 'family', familyId: 'egg', name: 'Æg', quantity: 3, unit: 'piece' });
    expect(foodIngredientsMigration.validateCurrent(stored)).toBe(true);

    const writes = AsyncStorage.setItem as jest.Mock;
    writes.mockClear();
    await runLocalMigrations();
    expect(writes).not.toHaveBeenCalled();
  });
});
