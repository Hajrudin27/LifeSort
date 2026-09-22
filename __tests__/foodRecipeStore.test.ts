import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * APP-047 actual Food store flows: validated ingredient writes, the exact
 * contract at the Supabase boundary, and remote rows decoded — never cast.
 */

type Row = Record<string, unknown>;
const mockSelects: { table: string; columns: string }[] = [];
const mockWrites: { table: string; payload: unknown }[] = [];
const mockDeletes: string[] = [];
const mockRemote: Record<string, Row[]> = {};

jest.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: (columns: string) => { mockSelects.push({ table, columns }); return chain; }, eq: () => chain, delete: () => { mockDeletes.push(table); return chain; },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: mockRemote[table] ?? [], error: null }).then(resolve, reject),
      upsert: (payload: unknown) => { mockWrites.push({ table, payload }); return Promise.resolve({ error: null }); },
    });
    return chain;
  };
  return { supabase: { from, auth: { getUser: () => Promise.resolve({ data: { user: { id: 'synthetic-user' } } }) } } };
});

import { IngredientError, familyIngredient, unlinkedIngredient, type NewRecipeIngredient } from '@/core/food/ingredients';
import { useFoodStore } from '@/store/useFoodStore';
import { planWeek } from '@/utils/food/mealPlanning';

const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const recipeWrites = () => mockWrites.filter((write) => write.table === 'food_recipes').map((write) => write.payload as Row);
const userRecipes = () => useFoodStore.getState().recipes.filter((recipe) => !recipe.id.startsWith('seed-'));
const remoteRow = (id: string, ingredients: unknown): Row => ({
  id, name: `Synthetic ${id}`, meal_type: 'dinner', ingredients, minutes: null, instructions: null,
  calories: null, protein: null, carbs: null, fat: null, tags: [],
});

beforeEach(async () => {
  await useFoodStore.persist.rehydrate();
  useFoodStore.setState({ recipes: useFoodStore.getState().recipes.filter((recipe) => recipe.id.startsWith('seed-')) });
  await flush();
  mockWrites.length = 0;
  mockDeletes.length = 0;
  useFoodStore.setState({ pantryItems: [] });
  for (const key of Object.keys(mockRemote)) delete mockRemote[key];
});

describe('APP-050 pantry store boundary', () => {
  it('validates before mutation, edits the same row, clears optionals and still deletes', async () => {
    const food = useFoodStore.getState();
    const before = food.pantryItems;
    for (const input of [
      { name: 'Bad', quantity: 1 }, { name: 'Bad', unit: 'g' },
      { name: 'Bad', quantity: 0, unit: 'g' }, { name: 'Bad', quantity: Infinity, unit: 'g' },
      { name: 'Bad', quantity: 1, unit: 'kg' }, { name: 'Bad', expiryDate: '2026-02-30' },
      { name: 'Bad', legacyQuantityText: '500 g' },
    ]) expect(() => food.addPantryItem(input as never)).toThrow('pantry_invalid');
    await flush();
    expect(useFoodStore.getState().pantryItems).toBe(before);
    expect(mockWrites).toEqual([]);

    food.addPantryItem({ name: 'Synthetic milk', quantity: 1.5, unit: 'ml', purchasedDate: '2026-09-01', expiryDate: '2026-09-30' });
    const created = useFoodStore.getState().pantryItems[0];
    expect(created).toMatchObject({ name: 'Synthetic milk', quantity: 1.5, unit: 'ml', purchasedDate: '2026-09-01' });
    expect(created).not.toHaveProperty('openedDate');
    await flush();
    expect(mockWrites).toEqual([{ table: 'food_pantry_items', payload: expect.objectContaining({
      id: created.id, quantity: null, structured_quantity: 1.5, structured_unit: 'ml', purchased_date: '2026-09-01', opened_date: null,
    }) }]);

    expect(() => food.updatePantryItem(created.id, { name: 'Wrong', quantity: 2 })).toThrow('pantry_invalid');
    expect(useFoodStore.getState().pantryItems[0]).toEqual(created);
    food.updatePantryItem(created.id, { name: 'Synthetic milk, edited', openedDate: '2026-09-10' });
    const updated = useFoodStore.getState().pantryItems[0];
    expect(updated).toEqual({ id: created.id, addedAt: created.addedAt, name: 'Synthetic milk, edited', openedDate: '2026-09-10' });
    await flush();
    expect(mockWrites).toHaveLength(2);
    expect(mockWrites[1]).toEqual({ table: 'food_pantry_items', payload: expect.objectContaining({
      id: created.id, added_at: created.addedAt, structured_quantity: null, structured_unit: null,
      purchased_date: null, opened_date: '2026-09-10', expiry_date: null,
    }) });
    expect(mockDeletes).toEqual([]);
    food.removePantryItem(created.id);
    await flush();
    expect(useFoodStore.getState().pantryItems).toEqual([]);
    expect(mockDeletes).toEqual(['food_pantry_items']);
  });

  it('keeps legacy text on a named edit only when requested and never parses it', async () => {
    const old = { id: 'old-pantry', name: 'Æg', legacyQuantityText: '500 g', addedAt: '2026-09-01T08:00:00.000Z' };
    useFoodStore.setState({ pantryItems: [old] });
    useFoodStore.getState().updatePantryItem(old.id, { name: 'Eggs' }, true);
    expect(useFoodStore.getState().pantryItems[0]).toEqual({ ...old, name: 'Eggs' });
    useFoodStore.getState().updatePantryItem(old.id, { name: 'Eggs', quantity: 2, unit: 'piece' });
    expect(useFoodStore.getState().pantryItems[0]).toEqual({ id: old.id, name: 'Eggs', quantity: 2, unit: 'piece', addedAt: old.addedAt });
    await flush();
    expect(mockWrites.map((write) => (write.payload as Row).quantity)).toEqual(['500 g', null]);
  });

  it('rejects a whole malformed remote pantry result while preserving local items', async () => {
    const local = { id: 'local-pantry', name: 'Local', addedAt: '2026-09-01T08:00:00.000Z' };
    useFoodStore.setState({ pantryItems: [local] });
    const good = { id: 'good', name: 'Oats', added_at: local.addedAt, quantity: null, structured_quantity: 2,
      structured_unit: 'g', purchased_date: null, opened_date: null, expiry_date: null };
    mockRemote.food_pantry_items = [good, { ...good, id: 'bad', expiry_date: '2026-02-30' }];
    await useFoodStore.getState().fetchFromSupabase();
    expect(useFoodStore.getState().pantryItems).toEqual([local]);
    mockRemote.food_pantry_items = [good];
    await useFoodStore.getState().fetchFromSupabase();
    expect(useFoodStore.getState().pantryItems).toEqual([local, { id: 'good', name: 'Oats', addedAt: local.addedAt, quantity: 2, unit: 'g' }]);
    expect(mockSelects.find((item) => item.table === 'food_pantry_items')?.columns).toContain('structured_quantity');
  });

  it('does not consume Pantry from planning, saving, or a shopping-list action', async () => {
    const item = { id: 'p', name: 'Synthetic oats', quantity: 2, unit: 'piece' as const, addedAt: '2026-09-01T08:00:00.000Z' };
    useFoodStore.setState({ pantryItems: [item] });
    const plan = planWeek([], [], [], [], [item], null, {}, new Date('2026-09-21T10:00:00Z'));
    useFoodStore.getState().savePlan('2026-W39', plan.slots.map((slot) => ({ day: slot.day, mealType: slot.mealType, recipeId: null })));
    useFoodStore.getState().addShoppingItem('Synthetic oats');
    const shoppingId = useFoodStore.getState().shoppingItems.at(-1)!.id;
    useFoodStore.getState().toggleShoppingItem(shoppingId);
    await flush();
    expect(useFoodStore.getState().pantryItems).toEqual([item]);
    expect(mockWrites.map((write) => write.table)).toEqual(['food_saved_plans', 'food_shopping_items', 'food_shopping_items']);
  });
});

describe('APP-047 creating a recipe', () => {
  it('stores, persists and upserts structured ingredients exactly', async () => {
    const ingredients = [unlinkedIngredient('Synthetic stock', 1.5, 'ml'), familyIngredient('egg', 'Æg', 2, 'piece')];
    useFoodStore.getState().addRecipe({ name: 'Synthetic soup', mealType: 'dinner', ingredients });
    const [recipe] = userRecipes();
    expect(recipe.ingredients).toEqual(ingredients);
    await flush();
    expect(recipeWrites()).toEqual([expect.objectContaining({ id: recipe.id, ingredients })]);
    const persisted = JSON.parse((await AsyncStorage.getItem('lifesort-food-v2'))!);
    expect(persisted.version).toBe(3);
    expect(persisted.state.recipes.find((r: Row) => r.id === recipe.id).ingredients).toEqual(ingredients);
  });

  it.each([
    ['a legacy ingredient', { kind: 'legacy', name: 'Salt', amount: '1 tsk' }],
    ['a pre-APP-047 ingredient', { name: 'Salt', amount: '1 tsk' }],
    ['a zero quantity', { kind: 'unlinked', name: 'Salt', quantity: 0, unit: 'g' }],
    ['an unknown unit', { kind: 'unlinked', name: 'Salt', quantity: 1, unit: 'tsk' }],
    ['an unknown family', { kind: 'family', familyId: 'Salt', name: 'Salt', quantity: 1, unit: 'g' }],
    ['an extra key', { kind: 'unlinked', name: 'Salt', quantity: 1, unit: 'g', productId: 'sku-1' }],
  ])('rejects %s before any state or server write', async (_name, ingredient) => {
    const before = useFoodStore.getState().recipes;
    expect(() => useFoodStore.getState().addRecipe({
      name: 'Synthetic', mealType: 'dinner', ingredients: [unlinkedIngredient('Ok', 1, 'g'), ingredient as unknown as NewRecipeIngredient],
    })).toThrow(IngredientError);
    await flush();
    expect(useFoodStore.getState().recipes).toBe(before);
    expect(recipeWrites()).toEqual([]);
  });
});

describe('APP-047 updating a recipe', () => {
  it('keeps legacy ingredients through an edit and rejects invalid ones', async () => {
    mockRemote.food_recipes = [remoteRow('old', [{ name: 'Salt', amount: 'efter smag' }])];
    await useFoodStore.getState().fetchFromSupabase();
    const legacy = userRecipes()[0].ingredients;

    useFoodStore.getState().updateRecipe('old', { name: 'Renamed', ingredients: legacy });
    expect(userRecipes()[0]).toMatchObject({ name: 'Renamed', ingredients: [{ kind: 'legacy', name: 'Salt', amount: 'efter smag' }] });
    await flush();
    expect(recipeWrites()).toEqual([expect.objectContaining({ id: 'old', name: 'Renamed', ingredients: legacy })]);

    mockWrites.length = 0;
    expect(() => useFoodStore.getState().updateRecipe('old', { ingredients: [{ name: 'Salt', amount: '1' } as never] })).toThrow(IngredientError);
    await flush();
    expect(userRecipes()[0].name).toBe('Renamed');
    expect(recipeWrites()).toEqual([]);
  });
});

describe('APP-047 remote recipes', () => {
  it('decodes rows from this and earlier builds, and skips a row in neither shape without guessing', async () => {
    const current = [{ kind: 'family', familyId: 'rice', name: 'Ris, tørvægt', quantity: 70, unit: 'g' }];
    mockRemote.food_recipes = [
      remoteRow('old', [{ name: 'Æg', amount: '3 stk' }, { name: 'Salt', amount: '' }]),
      remoteRow('new', current),
      remoteRow('broken', [{ name: 'Æg', quantity: '3' }]),
      remoteRow('not-a-list', { name: 'Æg' }),
    ];
    await useFoodStore.getState().fetchFromSupabase();

    expect(userRecipes().map((recipe) => [recipe.id, recipe.ingredients])).toEqual([
      // "Æg" / "3 stk" matches a seed ingredient exactly and still gets no family.
      ['old', [{ kind: 'legacy', name: 'Æg', amount: '3 stk' }, { kind: 'legacy', name: 'Salt', amount: '' }]],
      ['new', current],
    ]);
    // Nothing is written back: the server's copy of a skipped row is untouched.
    await flush();
    expect(recipeWrites()).toEqual([]);
  });
});


describe('APP-048 real store catalogue boundary', () => {
  it('queries products through both foreign keys and only installs validated rows', async () => {
    const productId = '11111111-1111-4111-8111-111111111111';
    const priceId = '22222222-2222-4222-8222-222222222222';
    const offerId = '33333333-3333-4333-8333-333333333333';
    const price = { id: priceId, product_id: productId, product: { id: productId, name: 'Synthetic eggs' }, store: 'Netto', price: 15 };
    const offer = { id: offerId, standard_price_id: priceId, standard_price: price, offer_price: 10, valid_from: '2026-09-21', valid_to: '2026-09-27' };
    mockRemote.global_standard_prices = [price, { ...price, price: null }, { ...price, product: null }];
    mockRemote.global_offers = [offer, { ...offer, valid_to: '2026-02-30' }, { ...offer, standard_price: null }];
    mockSelects.length = 0;
    await useFoodStore.getState().fetchFromSupabase();
    expect(mockSelects).toEqual(expect.arrayContaining([
      { table: 'global_standard_prices', columns: 'id, product_id, store, price, product:products(id, name)' },
      { table: 'global_offers', columns: 'id, standard_price_id, offer_price, valid_from, valid_to, standard_price:global_standard_prices(id, product_id, store, product:products(id, name))' },
    ]));
    expect(useFoodStore.getState().globalStandardPrices).toEqual([{ id: priceId, productName: 'Synthetic eggs', store: 'Netto', price: 15 }]);
    expect(useFoodStore.getState().globalOffers).toEqual([{ id: offerId, productName: 'Synthetic eggs', store: 'Netto', offerPrice: 10, validFrom: '2026-09-21', validTo: '2026-09-27' }]);
    expect(mockWrites).toEqual([]);
  });
});

describe('APP-049 Food writes remain in Food', () => {
  it('writes each budget, purchase, saved plan and shopping action once, never to Economy', async () => {
    mockWrites.length = 0;
    const food = useFoodStore.getState();
    food.setMonthlyBudget('2026-09', 4000);
    food.addPurchase(300, '2026-09-21T10:00:00Z');
    const plan = planWeek([], [], [], [], [], 500, {}, new Date('2026-09-21T10:00:00Z'));
    expect(plan.slots).toHaveLength(21);
    expect(mockWrites).toEqual([]); // generation is pure
    food.savePlan('2026-W39', plan.slots.map((slot) => ({ day: slot.day, mealType: slot.mealType, recipeId: null })));
    food.addShoppingItem('Synthetic pasta');
    await flush();
    expect(mockWrites.map(({ table }) => table)).toEqual([
      'food_monthly_budget', 'food_purchases', 'food_saved_plans', 'food_shopping_items',
    ]);
    expect(mockWrites.find(({ table }) => table === 'food_monthly_budget')?.payload).toMatchObject({ month_key: '2026-09', amount: 4000 });
    expect(mockWrites.find(({ table }) => table === 'food_purchases')?.payload).toMatchObject({ amount: 300 });
    expect(mockWrites.some(({ table }) => table === 'expenses' || table === 'expense_category_budgets')).toBe(false);
  });
});
