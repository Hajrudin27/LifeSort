import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * APP-047 actual Food store flows: validated ingredient writes, the exact
 * contract at the Supabase boundary, and remote rows decoded — never cast.
 */

type Row = Record<string, unknown>;
const mockWrites: { table: string; payload: unknown }[] = [];
const mockRemote: Record<string, Row[]> = {};

jest.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain, eq: () => chain, delete: () => chain,
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
  for (const key of Object.keys(mockRemote)) delete mockRemote[key];
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
    expect(persisted.version).toBe(1);
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
