type Row = Record<string, unknown>;
const mockWrites: { table: string; payload: Row }[] = [];
const mockDeletes: string[] = [];
const mockRemote: Record<string, Row[]> = {};
jest.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain, eq: () => chain,
      delete: () => { mockDeletes.push(table); return chain; },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: mockRemote[table] ?? [], error: null }).then(resolve, reject),
      upsert: (payload: Row) => { mockWrites.push({ table, payload }); return Promise.resolve({ error: null }); },
    });
    return chain;
  };
  return { supabase: { from, auth: { getUser: () => Promise.resolve({ data: { user: { id: 'synthetic-user' } } }) } } };
});

import { deriveShoppingList } from '@/features/food/shoppingListDerivation';
import { shoppingBaseRow, shoppingDerivationRow } from '@/core/food/shoppingRemote';
import { useFoodStore } from '@/store/useFoodStore';
import type { Recipe } from '@/types/food';

const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const recipe: Recipe = { id: 'recipe', name: 'Dinner', mealType: 'dinner', ingredients: [
  { kind: 'family', familyId: 'potato', name: 'Potatoes', quantity: 500, unit: 'g' },
] };
const requirement = deriveShoppingList([{ day: 0, mealType: 'dinner', recipe }])[0];

beforeEach(async () => {
  await useFoodStore.persist.rehydrate();
  useFoodStore.setState({ shoppingItems: [], pantryItems: [], recipes: [recipe], savedPlans: {} });
  mockWrites.length = 0;
  mockDeletes.length = 0;
  for (const key of Object.keys(mockRemote)) delete mockRemote[key];
});

describe('APP-052 shopping artifact store', () => {
  it('materializes only on explicit action; edits/checks preserve source trace and other domains', async () => {
    const beforeRecipe = structuredClone(useFoodStore.getState().recipes);
    const beforePantry = structuredClone(useFoodStore.getState().pantryItems);
    expect(useFoodStore.getState().shoppingItems).toEqual([]);
    useFoodStore.getState().addShoppingItem('Potatoes');
    useFoodStore.getState().materializeShoppingList('2026-W39', [requirement]);
    const [manual, derived] = useFoodStore.getState().shoppingItems;
    expect(manual).toMatchObject({ kind: 'manual', label: 'Potatoes' });
    expect(derived).toMatchObject({ kind: 'meal_plan', label: 'Potatoes', amount: { quantity: 500 } });
    expect(derived.id).not.toBe(manual.id);
    const trace = structuredClone(derived.kind === 'meal_plan' ? derived.provenance : []);
    useFoodStore.getState().editShoppingItem(derived.id, { label: 'Extra potatoes', amount: { kind: 'structured', quantity: 600, unit: 'g' } });
    useFoodStore.getState().toggleShoppingItem(derived.id);
    expect(useFoodStore.getState().shoppingItems[1]).toMatchObject({ label: 'Extra potatoes', checked: true, amount: { quantity: 600 }, provenance: trace });
    expect(useFoodStore.getState().recipes).toEqual(beforeRecipe);
    expect(useFoodStore.getState().pantryItems).toEqual(beforePantry);
    await flush();
    expect(mockWrites.filter(({ table }) => table === 'food_shopping_items')).toHaveLength(4);
    expect(mockWrites.filter(({ table }) => table === 'food_shopping_item_derivations')).toHaveLength(3);
    expect(mockWrites.at(-1)?.payload.provenance).toEqual(trace);
  });

  it('replaces only the selected week and preserves manual and other-week items', async () => {
    const food = useFoodStore.getState();
    food.addShoppingItem('Potatoes');
    food.materializeShoppingList('2026-W39', [requirement]);
    food.materializeShoppingList('2026-W40', [requirement]);
    const [manual, oldWeek, otherWeek] = useFoodStore.getState().shoppingItems;
    const changed = { ...requirement, label: 'New plan potatoes' };
    food.materializeShoppingList('2026-W39', [changed]);
    const items = useFoodStore.getState().shoppingItems;
    expect(items).toHaveLength(3);
    expect(items).toContainEqual(manual);
    expect(items).toContainEqual(otherWeek);
    expect(items.some((item) => item.id === oldWeek.id)).toBe(false);
    expect(items.find((item) => item.kind === 'meal_plan' && item.weekKey === '2026-W39')).toMatchObject({ label: 'New plan potatoes', checked: false });
    await flush();
    expect(mockDeletes).toContain('food_shopping_items');
  });

  it('validates before mutation and refuses malformed remote shopping batches', async () => {
    const food = useFoodStore.getState();
    food.addShoppingItem('Keep');
    const original = useFoodStore.getState().shoppingItems;
    expect(() => food.materializeShoppingList('2026-W39', [{ ...requirement, amount: { kind: 'structured', quantity: 0, unit: 'g' } }])).toThrow('shopping_invalid');
    expect(useFoodStore.getState().shoppingItems).toBe(original);
    mockRemote.food_shopping_items = [{ id: 'remote', label: 'Remote', checked: false, source_kind: 'meal_plan' }];
    await food.fetchFromSupabase();
    expect(useFoodStore.getState().shoppingItems).toEqual(original);
    const remote = { ...requirement, id: 'remote', kind: 'meal_plan' as const, weekKey: '2026-W39', checked: false, label: 'Remote' };
    mockRemote.food_shopping_item_derivations = [{ ...shoppingDerivationRow('synthetic-user', remote) }];
    delete mockRemote.food_shopping_item_derivations[0].user_id;
    await food.fetchFromSupabase();
    expect(useFoodStore.getState().shoppingItems).toContainEqual(remote);
    expect(mockRemote.food_shopping_items[0]).toEqual((({ user_id, ...row }) => row)(shoppingBaseRow('synthetic-user', remote)));
  });
});
