import { deriveShoppingList } from '@/features/food/shoppingListDerivation';
import { decodeShoppingItem } from '@/core/food/shopping';
import { decodeRemoteShoppingItems, shoppingBaseRow, shoppingDerivationRow } from '@/core/food/shoppingRemote';
import type { Recipe, ShoppingListItem } from '@/types/food';

const recipe = (id: string, ingredients: Recipe['ingredients']): Recipe => ({ id, name: id, mealType: 'dinner', ingredients });
const slot = (day: number, r: Recipe | null) => ({ day, mealType: 'dinner' as const, recipe: r });
const family = (familyId: 'potato' | 'tomato', name: string, quantity: number, unit: 'g' | 'piece' = 'g') =>
  ({ kind: 'family' as const, familyId, name, quantity, unit });

describe('APP-052 canonical shopping derivation', () => {
  it('is deterministic, ignores empty slots and merges only matching family ID and unit', () => {
    const a = recipe('a', [family('potato', 'Kartofler', 300), family('potato', 'Kartofler', 2, 'piece')]);
    const b = recipe('b', [family('potato', 'Potatoes', 200), family('tomato', 'Kartofler', 100)]);
    const slots = [slot(2, b), slot(1, null), slot(0, a)];
    const result = deriveShoppingList(slots);
    expect(result).toEqual(deriveShoppingList([...slots].reverse()));
    expect(result).toHaveLength(3);
    const grams = result.find((r) => r.identity.kind === 'family' && r.identity.familyId === 'potato' && r.identity.unit === 'g');
    expect(grams).toMatchObject({ label: 'Kartofler', amount: { kind: 'structured', quantity: 500, unit: 'g' } });
    expect(grams?.provenance.map((p) => [p.recipeId, p.day, p.ingredientIndex])).toEqual([['a', 0, 0], ['b', 2, 0]]);
    expect(result.find((r) => r.identity.kind === 'family' && r.identity.familyId === 'potato' && r.identity.unit === 'piece')?.amount).toEqual({ kind: 'structured', quantity: 2, unit: 'piece' });
    expect(result.find((r) => r.identity.kind === 'family' && r.identity.familyId === 'tomato')?.label).toBe('Kartofler');
  });

  it('aggregates repeated explicit unlinked/legacy sources but never same-name cross-recipe sources', () => {
    const a = recipe('a', [{ kind: 'unlinked', name: 'Sauce', quantity: 100, unit: 'ml' }, { kind: 'legacy', name: 'Salt', amount: '  lidt  ' }]);
    const b = recipe('b', [{ kind: 'unlinked', name: 'Sauce', quantity: 100, unit: 'ml' }, { kind: 'legacy', name: 'Salt', amount: '2 stk' }]);
    const result = deriveShoppingList([slot(0, a), slot(1, a), slot(2, b)]);
    expect(result).toHaveLength(4);
    expect(result.find((r) => r.identity.kind === 'unlinked' && r.identity.recipeId === 'a')?.amount).toEqual({ kind: 'structured', quantity: 200, unit: 'ml' });
    const legacy = result.find((r) => r.identity.kind === 'legacy' && r.identity.recipeId === 'a');
    expect(legacy?.amount).toEqual({ kind: 'legacy', text: '  lidt  ', repetitions: 2 });
    expect(legacy?.provenance).toMatchObject([{ amount: '  lidt  ', recipeId: 'a' }, { amount: '  lidt  ', recipeId: 'a' }]);
    expect(legacy?.identity).not.toHaveProperty('familyId');
  });

  it('does not inspect Pantry or mutate recipes and returns no writes/IDs', () => {
    const r = recipe('a', [family('potato', 'Potatoes', 500)]);
    const before = JSON.stringify(r);
    const result = deriveShoppingList([slot(0, r)]);
    expect(JSON.stringify(r)).toBe(before);
    expect(result[0]).not.toHaveProperty('id');
    expect(result[0]).not.toHaveProperty('checked');
    expect(result[0].amount).toEqual({ kind: 'structured', quantity: 500, unit: 'g' });
  });
});

describe('APP-052 strict shopping and remote contracts', () => {
  const requirement = deriveShoppingList([slot(0, recipe('a', [family('potato', 'Potatoes', 500)]))])[0];
  const derived: ShoppingListItem = { ...requirement, id: 'derived', kind: 'meal_plan', weekKey: '2026-W39', checked: false };
  const manual: ShoppingListItem = { id: 'manual', kind: 'manual', label: 'Potatoes', checked: true };
  const base = [shoppingBaseRow('owner', manual), shoppingBaseRow('owner', derived)].map(({ user_id, ...row }) => row);
  const child = [shoppingDerivationRow('owner', derived)].map(({ user_id, ...row }) => row);

  it('keeps manual and derived labels separate, including edited current amount and original trace', () => {
    const edited = decodeShoppingItem({ ...derived, label: 'Extra potatoes', amount: { kind: 'structured', quantity: 600, unit: 'g' } });
    expect(edited).toMatchObject({ label: 'Extra potatoes', amount: { quantity: 600 }, provenance: [{ quantity: 500 }] });
    expect(decodeRemoteShoppingItems(base, child)).toEqual([manual, derived]);
    expect(decodeRemoteShoppingItems([base[0], { ...base[1], label: 'Extra potatoes' }], [
      { ...child[0], current_quantity: 600 },
    ])).toMatchObject([manual, { label: 'Extra potatoes', amount: { quantity: 600 }, provenance: [{ quantity: 500 }] }]);
  });

  it('rejects incomplete or malformed remote results as a whole', () => {
    expect(decodeRemoteShoppingItems(base, [])).toBeNull();
    expect(decodeRemoteShoppingItems(base, [{ ...child[0], provenance: [] }])).toBeNull();
    expect(decodeRemoteShoppingItems(base, [{ ...child[0], current_quantity: 0 }])).toBeNull();
    expect(decodeRemoteShoppingItems(base, [{ ...child[0], identity_unit: 'kg' }])).toBeNull();
    expect(decodeRemoteShoppingItems(base, [...child, child[0]])).toBeNull();
    expect(decodeRemoteShoppingItems(base, [{ ...child[0], shopping_item_id: 'orphan' }])).toBeNull();
  });

  it('rejects malformed current artifacts and never guesses manual identity', () => {
    expect(decodeShoppingItem(manual)).toEqual(manual);
    expect(decodeShoppingItem({ ...manual, familyId: 'potato' })).toBeNull();
    expect(decodeShoppingItem({ ...derived, kind: 'other' })).toBeNull();
    expect(decodeShoppingItem({ ...derived, weekKey: '2026-W99' })).toBeNull();
    expect(decodeShoppingItem({ ...derived, provenance: [{ ...derived.provenance[0], recipeId: '' }] })).toBeNull();
    expect(decodeShoppingItem({ ...derived, amount: { kind: 'structured', quantity: Infinity, unit: 'g' } })).toBeNull();
  });
});
