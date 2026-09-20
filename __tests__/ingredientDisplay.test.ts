import { familyIngredient, unlinkedIngredient, type IngredientUnit } from '@/core/food/ingredients';
import { formatIngredientAmount } from '@/utils/food/ingredientFormat';
import { matchRecipeIngredients } from '@/utils/food/recipeMatching';
import type { GroceryOffer } from '@/types/food';

/** APP-047 downstream: structured amounts render per locale; legacy text is shown as written. */

const da = (unit: IngredientUnit) => ({ g: 'g', ml: 'ml', piece: 'stk' })[unit];
const en = (unit: IngredientUnit) => ({ g: 'g', ml: 'ml', piece: 'pcs' })[unit];

describe('APP-047 ingredient amounts on screen', () => {
  it('renders a structured quantity with the locale separator and the unit label', () => {
    expect(formatIngredientAmount(familyIngredient('egg', 'Æg', 3, 'piece'), 'da-DK', da)).toBe('3 stk');
    expect(formatIngredientAmount(unlinkedIngredient('Synthetic stock', 1.5, 'piece'), 'da-DK', da)).toBe('1,5 stk');
    expect(formatIngredientAmount(unlinkedIngredient('Synthetic stock', 1.5, 'piece'), 'en-US', en)).toBe('1.5 pcs');
    expect(formatIngredientAmount(unlinkedIngredient('Synthetic flour', 1000, 'g'), 'da-DK', da)).toBe('1000 g');
    expect(formatIngredientAmount(unlinkedIngredient('Synthetic milk', 0.25, 'ml'), 'en-US', en)).toBe('0.25 ml');
  });

  it('shows a legacy amount exactly as written, including an empty one', () => {
    for (const amount of ['3 stk', '1,5 spsk', 'efter smag', '']) {
      expect(formatIngredientAmount({ kind: 'legacy', name: 'Synthetic', amount }, 'en-US', en)).toBe(amount);
    }
  });
});

describe('APP-047 quantity display across the whole contract range', () => {
  /** The contract is any finite number above zero, so display must cope with all of it. */
  const amount = (quantity: number, locale = 'en-US') =>
    formatIngredientAmount(unlinkedIngredient('Synthetic', quantity, 'g'), locale, en).replace(' g', '');

  it.each([
    ['an ordinary integer', 200, '200'],
    ['an ordinary decimal', 1.5, '1.5'],
    // The recipe form would refuse these as typed text; the contract accepts the numbers.
    ['a third decimal', 1.005, '1.005'],
    ['a small non-exponent decimal', 0.125, '0.125'],
    ['a small decimal JavaScript writes with an exponent', 0.0000001, '0.0000001'],
    ['the smallest fixed-rendered magnitude', 1e-20, '0.00000000000000000001'],
    ['just below it', 5e-21, '5e-21'],
    ['the largest fixed-rendered magnitude', 1e20, '100000000000000000000'],
    ['just above it', 1e21, '1e+21'],
    ['the smallest positive number', Number.MIN_VALUE, '5e-324'],
    ['the largest finite number', Number.MAX_VALUE, '1.7976931348623157e+308'],
  ])('renders %s', (_name, quantity, expected) => {
    expect(amount(quantity)).toBe(expected);
  });

  it('never renders a valid quantity as zero, and never states another magnitude', () => {
    const quantities = [
      Number.MIN_VALUE, 1e-300, 5e-324 * 2, 1e-30, 5e-21, 1e-20, 0.000001, 0.001, 1, 1.005, 200, 1e20, 1e21, 1e300,
      Number.MAX_VALUE, 0.1 + 0.2, 1 / 3,
    ];
    for (const quantity of quantities) {
      const text = amount(quantity);
      expect([quantity, text]).not.toEqual([quantity, '0']);
      // The text reads back as the very number that was stored: no rounding to
      // zero, no inflation, no deflation.
      expect([quantity, Number(text)]).toEqual([quantity, quantity]);
      expect(Number(text)).toBeGreaterThan(0);
    }
  });

  it('keeps extreme magnitudes short and localizes both branches', () => {
    expect(amount(1.5, 'da-DK')).toBe('1,5');
    expect(amount(Number.MAX_VALUE, 'da-DK')).toBe('1,7976931348623157e+308');
    expect(amount(Number.MIN_VALUE, 'da-DK')).toBe('5e-324');
    // Scientific text instead of a 309-digit run of zeros.
    expect(amount(Number.MAX_VALUE).length).toBeLessThan(40);
  });
});

describe('APP-047 offer matching keeps its pre-APP-047 behaviour', () => {
  const offer: GroceryOffer = { id: 'o1', productName: 'Æg 10 stk', price: 30, store: 'Netto', weekKey: '2026-W38', source: 'manual' };

  it('matches every ingredient kind by display name and carries the ingredient itself', () => {
    const family = familyIngredient('egg', 'Æg', 3, 'piece');
    const legacy = { kind: 'legacy' as const, name: 'Æg', amount: '2 stk' };
    const unmatched = unlinkedIngredient('Synthetic stock', 1, 'ml');
    expect(matchRecipeIngredients([family, legacy, unmatched], [offer])).toEqual([
      { ingredientName: 'Æg', ingredient: family, offer },
      { ingredientName: 'Æg', ingredient: legacy, offer },
      { ingredientName: 'Synthetic stock', ingredient: unmatched, offer: null },
    ]);
  });
});
