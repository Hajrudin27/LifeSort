import {
  decodeCompatibleRecipeIngredients,
  decodePreApp047Ingredient,
  decodeRecipeIngredient,
  decodeRecipeIngredients,
  encodeRecipeIngredient,
  familyIngredient,
  INGREDIENT_FAMILY_IDS,
  INGREDIENT_UNITS,
  IngredientError,
  isIngredientFamilyId,
  isIngredientQuantity,
  isIngredientUnit,
  parseIngredientQuantityInput,
  unlinkedIngredient,
} from '@/core/food/ingredients';

/**
 * APP-047: the ingredient contract. Identity is a stable, locale-independent
 * family ID; quantity and unit are structured; pre-APP-047 data is kept
 * verbatim and never given a family. See docs/app-047-ingredient-families.md.
 */

describe('APP-047 family IDs', () => {
  it('are unique, stable-looking ASCII identifiers, not display text', () => {
    expect(new Set(INGREDIENT_FAMILY_IDS).size).toBe(INGREDIENT_FAMILY_IDS.length);
    for (const id of INGREDIENT_FAMILY_IDS) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('accept only catalogue IDs — never a localized name, a case variant or a product/price ID', () => {
    expect(isIngredientFamilyId('egg')).toBe(true);
    for (const value of ['Æg', 'Eggs', 'Egg', 'EGG', ' egg', 'egg ', 'æg', '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d', '', 'constructor', null, 7]) {
      expect([value, isIngredientFamilyId(value)]).toEqual([value, false]);
    }
  });
});

describe('APP-047 units and quantities', () => {
  it('have exactly the units the bundled recipes use, with no unit aliases', () => {
    expect([...INGREDIENT_UNITS]).toEqual(['g', 'ml', 'piece']);
    for (const unit of INGREDIENT_UNITS) expect(isIngredientUnit(unit)).toBe(true);
    // A display label or an unsupported unit never maps to a canonical one.
    for (const value of ['stk', 'pcs', 'kg', 'l', 'dl', 'G', 'gram', 'grams', ' g', '', null]) {
      expect([value, isIngredientUnit(value)]).toEqual([value, false]);
    }
  });

  it('accept any finite quantity above zero, whatever its precision', () => {
    for (const value of [1, 0.5, 0.01, 1.25, 300, 1_000_000, 1.005, 0.001, 1 / 3, Number.MIN_VALUE, Number.MAX_VALUE]) {
      expect([value, isIngredientQuantity(value)]).toEqual([value, true]);
    }
  });

  it('reject anything that is not a finite number above zero', () => {
    for (const value of [0, -0, -1, -0.5, NaN, Infinity, -Infinity, '5', '1.5', null, undefined, {}, []]) {
      expect([value, isIngredientQuantity(value)]).toEqual([value, false]);
    }
  });

  it('parses form text with one comma or dot and at most two decimals', () => {
    expect(['100', '1,5', '1.5', ' 2 ', '0,25', '007'].map(parseIngredientQuantityInput)).toEqual([100, 1.5, 1.5, 2, 0.25, 7]);
  });

  it('refuses ambiguous or invalid text instead of guessing', () => {
    // The form's own input policy, narrower than the contract on purpose:
    // "1.000" and "1,500" are thousand-grouped in one locale and decimals in the other.
    for (const text of ['', ' ', '0', '0,00', '-1', '+1', '1.000', '1,500', '1e3', '1.2.3', '1,', ',5', 'abc', '100 g', '½', '1 1']) {
      expect([text, parseIngredientQuantityInput(text)]).toEqual([text, null]);
    }
    // A quantity the form would not accept as text is still valid in the contract.
    expect(isIngredientQuantity(1.005)).toBe(true);
  });
});

describe('APP-047 recipe ingredient contract', () => {
  const family = { kind: 'family', familyId: 'egg', name: 'Æg', quantity: 3, unit: 'piece' };
  const unlinked = { kind: 'unlinked', name: 'Synthetic stock', quantity: 0.5, unit: 'ml' };
  const legacy = { kind: 'legacy', name: 'Salt', amount: '' };

  it('accepts each kind and returns a fresh object with exactly the contract fields', () => {
    for (const value of [family, unlinked, legacy]) {
      const decoded = decodeRecipeIngredient(value);
      expect(decoded).toEqual(value);
      expect(decoded).not.toBe(value);
    }
  });

  it.each([
    ['an extra key', { ...family, amount: '3 stk' }],
    ['a retailer product id', { ...family, productId: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d' }],
    ['an unknown kind', { ...family, kind: 'product' }],
    ['no kind (the pre-APP-047 shape)', { name: 'Æg', amount: '3 stk' }],
    ['an unknown family', { ...family, familyId: 'egg-large' }],
    ['a display name as family', { ...family, familyId: 'Æg' }],
    ['a blank name', { ...family, name: '  ' }],
    ['a non-string name', { ...family, name: 3 }],
    ['a display unit', { ...family, unit: 'stk' }],
    ['a quantity of zero', { ...family, quantity: 0 }],
    ['a negative quantity', { ...family, quantity: -2 }],
    ['a non-finite quantity', { ...family, quantity: Infinity }],
    ['a string quantity', { ...family, quantity: '3' }],
    ['an opaque amount on an unlinked ingredient', { kind: 'unlinked', name: 'Salt', amount: '1 tsk' }],
    ['a family on an unlinked ingredient', { ...unlinked, familyId: 'egg' }],
    ['a legacy ingredient without amount', { kind: 'legacy', name: 'Salt' }],
    ['a legacy ingredient with a number amount', { kind: 'legacy', name: 'Salt', amount: 5 }],
    ['a legacy ingredient with a family', { ...legacy, familyId: 'egg' }],
    ['null', null],
    ['an array', [family]],
  ])('rejects %s', (_name, value) => {
    expect(decodeRecipeIngredient(value)).toBeNull();
  });

  it('constructs only valid ingredients, throwing a fixed code otherwise', () => {
    expect(familyIngredient('egg', 'Eggs', 3, 'piece')).toEqual({ kind: 'family', familyId: 'egg', name: 'Eggs', quantity: 3, unit: 'piece' });
    expect(unlinkedIngredient('Synthetic stock', 1.5, 'ml')).toEqual({ kind: 'unlinked', name: 'Synthetic stock', quantity: 1.5, unit: 'ml' });
    expect(() => familyIngredient('egg', 'Eggs', 0, 'piece')).toThrow(IngredientError);
    expect(() => familyIngredient('Æg' as never, 'Æg', 3, 'piece')).toThrow(new IngredientError('ingredient_invalid'));
    expect(() => unlinkedIngredient('', 1, 'g')).toThrow(IngredientError);
    expect(() => unlinkedIngredient('Salt', 1, 'tsk' as never)).toThrow(IngredientError);
    expect(() => encodeRecipeIngredient({ ...family, quantity: NaN } as never)).toThrow(IngredientError);
  });

  it('round-trips through JSON (persistence, Supabase JSONB, backup) unchanged', () => {
    const ingredients = [familyIngredient('rice', 'Ris, tørvægt', 70, 'g'), unlinkedIngredient('Synthetic stock', 0.25, 'ml'), legacy];
    const wire = JSON.parse(JSON.stringify(ingredients.map((ingredient) => encodeRecipeIngredient(ingredient as never))));
    expect(decodeRecipeIngredients(wire)).toEqual(ingredients);
  });
});

describe('APP-047 pre-APP-047 ingredients are preserved, never interpreted', () => {
  it('keeps both strings verbatim and invents no family, even for a bundled seed name', () => {
    for (const [name, amount] of [['Æg', '3 stk'], ['Eggs', '3 pcs'], ['Salt', ''], ['Olivenolie', '1,5 spsk'], ['Synthetic flour', '1.000 g'], ['', 'efter smag']]) {
      const decoded = decodePreApp047Ingredient({ name, amount });
      expect(decoded).toEqual({ kind: 'legacy', name, amount });
      expect(decoded).not.toHaveProperty('familyId');
      expect(decoded).not.toHaveProperty('quantity');
    }
  });

  it.each([
    ['an extra key', { name: 'Æg', amount: '3 stk', note: 'x' }],
    ['a missing amount', { name: 'Æg' }],
    ['a number amount', { name: 'Æg', amount: 3 }],
    ['a null name', { name: null, amount: '3 stk' }],
    ['the current contract', { kind: 'legacy', name: 'Æg', amount: '3 stk' }],
    ['a string', 'Æg 3 stk'],
  ])('rejects %s', (_name, value) => {
    expect(decodePreApp047Ingredient(value)).toBeNull();
  });

});

describe('APP-047 data any build may have written (Supabase rows, local v0, backups 1–3)', () => {
  it('accepts each element in the current contract or the pre-APP-047 shape', () => {
    // An older build caches rows a newer build wrote, so both shapes can meet in one list.
    const row = [{ kind: 'family', familyId: 'egg', name: 'Æg', quantity: 3, unit: 'piece' }, { name: 'Salt', amount: '' }];
    expect(decodeCompatibleRecipeIngredients(row)).toEqual([row[0], { kind: 'legacy', name: 'Salt', amount: '' }]);
  });

  it('accepts a list whole or not at all, and rejects non-array JSON', () => {
    expect(decodeCompatibleRecipeIngredients([{ name: 'Salt', amount: '' }, { name: 'Æg', quantity: 3 }])).toBeNull();
    expect(decodeCompatibleRecipeIngredients([{ name: 'Salt', amount: '' }, { name: 'Salt', amount: 1 }])).toBeNull();
    expect(decodeCompatibleRecipeIngredients([{ kind: 'family', familyId: 'egg', name: 'Æg', quantity: 3, unit: 'stk' }])).toBeNull();
    for (const value of [null, undefined, '[]', {}, { 0: { name: 'Æg', amount: '3 stk' } }, 42]) {
      expect(decodeCompatibleRecipeIngredients(value)).toBeNull();
    }
    expect(decodeCompatibleRecipeIngredients([])).toEqual([]);
  });

  it('current-contract lists never accept the pre-APP-047 shape', () => {
    expect(decodeRecipeIngredients([{ name: 'Æg', amount: '3 stk' }])).toBeNull();
  });
});
