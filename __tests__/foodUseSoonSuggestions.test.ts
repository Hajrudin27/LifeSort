import { useSoonSuggestions, USE_SOON_DAYS } from '@/features/food/useSoonSuggestions';
import type { PantryItem, Recipe } from '@/types/food';

const referenceDate = '2026-09-21';
const pantry = (id: string, name: string, extra: Partial<PantryItem> = {}): PantryItem => ({
  id, name, addedAt: '2026-01-01T10:00:00.000Z', ...extra,
});
const ingredient = (name: string, familyId: 'egg' | 'egg-noodles' = 'egg') =>
  ({ kind: 'family' as const, familyId, name, quantity: 3, unit: 'piece' as const });
const recipe = (id: string, name: string, names: string[]): Recipe => ({
  id, name, mealType: 'dinner', ingredients: names.map((n) => ingredient(n)),
});
const derive = (pantryItems: PantryItem[], recipes: Recipe[] = [recipe('r', 'Dinner', ['Eggs'])]) =>
  useSoonSuggestions({ pantryItems, recipes, referenceDate });

describe('APP-051 explicit use-soon evidence', () => {
  it('uses the locked inclusive 0–3 day window and keeps past dates separate', () => {
    expect(USE_SOON_DAYS).toBe(3);
    const result = derive([
      pantry('none', 'Eggs'),
      pantry('past', 'Eggs', { expiryDate: '2026-09-20' }),
      pantry('today', 'Eggs', { expiryDate: '2026-09-21' }),
      pantry('one', 'Eggs', { expiryDate: '2026-09-22' }),
      pantry('two', 'Eggs', { expiryDate: '2026-09-23' }),
      pantry('three', 'Eggs', { expiryDate: '2026-09-24' }),
      pantry('four', 'Eggs', { expiryDate: '2026-09-25' }),
    ]);
    expect(result.useSoonItems.map(({ item, daysUntilExpiry }) => [item.id, daysUntilExpiry])).toEqual([
      ['today', 0], ['one', 1], ['two', 2], ['three', 3],
    ]);
    expect(result.pastExpiryItems.map(({ item }) => item.id)).toEqual(['past']);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].matchedUseSoonItems.map(({ item }) => item.id)).toEqual(['today', 'one', 'two', 'three']);
  });

  it('never derives expiry from purchase, opening, added time, or missing expiry', () => {
    const result = derive([pantry('x', 'Eggs', {
      purchasedDate: '2026-09-18', openedDate: '2026-09-19', addedAt: '2026-09-20T10:00:00.000Z',
    })]);
    expect(result).toEqual({ useSoonItems: [], pastExpiryItems: [], suggestions: [] });
    expect(derive([pantry('old', 'Eggs', { expiryDate: '2026-09-20' })]).suggestions).toEqual([]);
  });

  it.each([
    ['Æg', 'Æg', true], [' ÆG ', 'æg', true],
    ['Æg', 'Ægnudler', false], ['egg', 'egg noodles', false],
    ['Ægnudler', 'Æg', false], ['Æg', 'Eggs', false],
  ])('matches only trimmed case-insensitive exact names: %s / %s', (name, ingredientName, expected) => {
    const result = derive([pantry('p', name, { expiryDate: referenceDate })], [recipe('r', 'Dinner', [ingredientName])]);
    expect(result.suggestions.length > 0).toBe(expected);
  });

  it('does not bridge different names by family ID or substitutions', () => {
    const result = derive([pantry('p', 'Eggs', { expiryDate: referenceDate })], [
      { ...recipe('r', 'Dinner', []), ingredients: [ingredient('Œufs', 'egg'), ingredient('Egg noodles', 'egg-noodles')] },
    ]);
    expect(result.suggestions).toEqual([]);
  });

  it('matches unlinked and legacy recipe display names without inventing an identity', () => {
    const recipes: Recipe[] = [
      { ...recipe('unlinked', 'Unlinked', []), ingredients: [{ kind: 'unlinked', name: 'Eggs', quantity: 2, unit: 'piece' }] },
      { ...recipe('legacy', 'Legacy', []), ingredients: [{ kind: 'legacy', name: 'Eggs', amount: 'some' }] },
    ];
    expect(derive([pantry('p', 'Eggs', { expiryDate: referenceDate })], recipes).suggestions.map(({ recipe: r }) => r.id)).toEqual(['legacy', 'unlinked']);
  });

  it('compares calendar days across daylight saving changes', () => {
    const result = useSoonSuggestions({
      referenceDate: '2026-03-28', recipes: [recipe('r', 'Dinner', ['Eggs'])],
      pantryItems: [pantry('p', 'Eggs', { expiryDate: '2026-03-31' })],
    });
    expect(result.useSoonItems[0].daysUntilExpiry).toBe(3);
  });

  it('requires a use-soon match while retaining no-expiry Pantry presence separately from absent ingredients', () => {
    const r = recipe('r', 'Dinner', ['Eggs', 'Milk', 'Bread']);
    expect(derive([pantry('p', 'Eggs')], [r]).suggestions).toEqual([]);
    expect(derive([pantry('p', 'Eggs', { expiryDate: '2026-09-20' })], [r]).suggestions).toEqual([]);
    const milk = pantry('m', 'Milk', { quantity: 1, unit: 'ml' });
    const result = derive([
      pantry('p', 'Eggs', { expiryDate: referenceDate }), milk,
    ], [r]);
    expect(result.suggestions[0].matchedUseSoonItems.map(({ item }) => item.id)).toEqual(['p']);
    expect(result.suggestions[0].otherPantryMatchedIngredients).toEqual([{ ingredientName: 'Milk', pantryItems: [milk] }]);
    expect(result.suggestions[0].notConfirmedIngredientCount).toBe(1);
    expect(result.suggestions[0]).not.toHaveProperty('sufficientQuantity');
  });

  it('uses exact names for other Pantry presence too', () => {
    const result = derive([
      pantry('soon', 'Eggs', { expiryDate: referenceDate }), pantry('other', 'Milkshake'),
    ], [recipe('r', 'Dinner', ['Eggs', 'Milk'])]);
    expect(result.suggestions[0].otherPantryMatchedIngredients).toEqual([]);
    expect(result.suggestions[0].notConfirmedIngredientCount).toBe(1);
  });

  it('treats a future non-use-soon date as other Pantry presence but never as a suggestion trigger', () => {
    const future = pantry('future', 'Milk', { expiryDate: '2026-09-25' });
    const r = recipe('r', 'Dinner', ['Eggs', 'Milk']);
    expect(derive([future], [r]).suggestions).toEqual([]);
    const result = derive([pantry('soon', 'Eggs', { expiryDate: referenceDate }), future], [r]);
    expect(result.useSoonItems.map(({ item }) => item.id)).toEqual(['soon']);
    expect(result.suggestions[0].otherPantryMatchedIngredients).toEqual([{ ingredientName: 'Milk', pantryItems: [future] }]);
    expect(result.suggestions[0].notConfirmedIngredientCount).toBe(0);
  });

  it('never treats past-expiry Pantry rows as positive presence for another use-soon match', () => {
    const past = pantry('past', 'Milk', { expiryDate: '2026-09-20' });
    const r = recipe('r', 'Dinner', ['Eggs', 'Milk']);
    expect(derive([past], [r]).suggestions).toEqual([]);
    const result = derive([pantry('soon', 'Eggs', { expiryDate: referenceDate }), past], [r]);
    expect(result.pastExpiryItems.map(({ item }) => item.id)).toEqual(['past']);
    expect(result.suggestions[0].otherPantryMatchedIngredients).toEqual([]);
    expect(result.suggestions[0].notConfirmedIngredientCount).toBe(1);
  });

  it('deduplicates recipes, retains all triggering rows and never treats quantity as sufficiency', () => {
    const r = recipe('r', 'Dinner', ['Eggs', 'Milk']);
    const result = derive([
      pantry('a', 'Eggs', { expiryDate: referenceDate, quantity: 1, unit: 'piece' }),
      pantry('b', 'Eggs', { expiryDate: '2026-09-22', legacyQuantityText: 'a little' }),
      pantry('c', 'Milk', { expiryDate: '2026-09-23' }),
    ], [r, r]);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].matchedUseSoonItems.map(({ item }) => item.id)).toEqual(['a', 'b', 'c']);
    expect(result.suggestions[0].notConfirmedIngredientCount).toBe(0);
    expect(result.suggestions[0].otherPantryMatchedIngredients).toEqual([]);
    expect(result.suggestions[0]).not.toHaveProperty('sufficientQuantity');
  });

  it('sorts by earliest expiry, then matching item count, then name and id, independent of input order', () => {
    const items = [pantry('a', 'Eggs', { expiryDate: '2026-09-22' }), pantry('b', 'Milk', { expiryDate: '2026-09-22' }), pantry('c', 'Bread', { expiryDate: referenceDate })];
    const recipes = [recipe('z', 'Zulu', ['Eggs']), recipe('b', 'Alpha', ['Eggs']), recipe('a', 'Alpha', ['Eggs']), recipe('m', 'Many', ['Eggs', 'Milk']), recipe('first', 'First', ['Bread'])];
    const expected = ['first', 'm', 'a', 'b', 'z'];
    expect(derive(items, recipes).suggestions.map(({ recipe: r }) => r.id)).toEqual(expected);
    expect(derive([...items].reverse(), [...recipes].reverse()).suggestions.map(({ recipe: r }) => r.id)).toEqual(expected);
    expect(derive(items, recipes)).toEqual(derive(items, recipes));
  });

  it('is pure and does not write to its inputs or any store', () => {
    const items = [pantry('a', 'Eggs', { expiryDate: referenceDate })];
    const recipes = [recipe('r', 'Dinner', ['Eggs'])];
    const before = JSON.stringify({ items, recipes });
    derive(items, recipes);
    expect(JSON.stringify({ items, recipes })).toBe(before);
  });

  it('rejects an invalid reference date rather than interpreting a timestamp', () => {
    expect(() => useSoonSuggestions({ pantryItems: [], recipes: [], referenceDate: '2026-09-21T00:00:00Z' })).toThrow();
  });
});
