import { familyIngredient, unlinkedIngredient } from '@/core/food/ingredients';
import { deriveOfferOpportunities } from '@/features/food/offerAwarePlanning';
import { deriveShoppingList } from '@/features/food/shoppingListDerivation';
import type { GlobalOffer, GlobalStandardPrice, Recipe } from '@/types/food';
import { planWeek } from '@/utils/food/mealPlanning';
import { findBestGlobalPrice } from '@/utils/food/priceLookup';

const reference = new Date('2026-09-24T10:00:00Z');
const offer = (overrides: Partial<GlobalOffer> = {}): GlobalOffer => ({
  id: 'offer', standardPriceId: 'standard', productId: 'product', productName: 'Catalogue egg',
  ingredientFamilyId: 'egg', store: 'Netto', offerPrice: 10, referencePrice: 15,
  validFrom: '2026-09-24', validTo: '2026-09-24', published: true, licenceCleared: true,
  memberCondition: null, ...overrides,
});
const standard = (overrides: Partial<GlobalStandardPrice> = {}): GlobalStandardPrice => ({
  id: 'standard', productId: 'product', productName: 'Catalogue egg', ingredientFamilyId: 'egg',
  store: 'Netto', price: 15, ...overrides,
});
const recipe = (ingredients: Recipe['ingredients']): Recipe => ({ id: 'recipe', name: 'Synthetic', mealType: 'dinner', ingredients });
const requirements = (...ingredients: Recipe['ingredients']) => deriveShoppingList([
  { day: 0, mealType: 'dinner', recipe: recipe(ingredients) },
]);

describe('APP-053 explicit family catalogue lookup', () => {
  it('matches the same family despite different labels and rejects the same label with a different family', () => {
    expect(findBestGlobalPrice(familyIngredient('egg', 'Completely different label', 2, 'piece'), [offer()], [], ['Netto'], reference))
      .toMatchObject({ source: 'offer', freshness: 'current', price: 10 });
    expect(findBestGlobalPrice(familyIngredient('milk', 'Catalogue egg', 1, 'ml'), [offer()], [], ['Netto'], reference))
      .toEqual({ source: 'unavailable', freshness: 'unknown' });
  });

  it('does not family-match an unmapped product or infer identity for unlinked and legacy ingredients', () => {
    expect(findBestGlobalPrice(familyIngredient('egg', 'Catalogue egg', 2, 'piece'), [offer({ ingredientFamilyId: null })], [], ['Netto'], reference))
      .toEqual({ source: 'unavailable', freshness: 'unknown' });
    expect(findBestGlobalPrice(unlinkedIngredient('Catalogue egg', 2, 'piece'), [offer()], [], ['Netto'], reference))
      .toEqual({ source: 'unavailable', freshness: 'unknown' });
    expect(findBestGlobalPrice({ kind: 'legacy', name: 'Catalogue egg', amount: '2 stk' }, [offer()], [], ['Netto'], reference))
      .toEqual({ source: 'unavailable', freshness: 'unknown' });
    expect(findBestGlobalPrice(unlinkedIngredient('Catalogue egg', 2, 'piece'), [], [standard()], ['Netto'], reference))
      .toMatchObject({ source: 'standard', freshness: 'unknown', price: 15 });
  });

  it('uses only selected stores and never assumes a member condition for automatic pricing', () => {
    const conditional = offer({ id: 'member', offerPrice: 1, memberCondition: 'Club card' });
    expect(findBestGlobalPrice(familyIngredient('egg', 'Egg', 2, 'piece'), [conditional], [standard()], ['Netto'], reference))
      .toMatchObject({ source: 'standard', freshness: 'unknown', price: 15 });
    expect(findBestGlobalPrice(familyIngredient('egg', 'Egg', 2, 'piece'), [offer()], [standard()], ['Other'], reference))
      .toEqual({ source: 'unavailable', freshness: 'unknown' });
    const plan = planWeek([recipe([familyIngredient('egg', 'Egg', 2, 'piece')])], [conditional], [], ['Netto'], [], 0, {}, reference);
    expect(plan.estimate).toMatchObject({ status: 'unavailable', knownSubtotal: null, missing: 1 });
  });
});

describe('APP-053 potential opportunity projection', () => {
  it('uses APP-048 current boundaries and excludes stale, upcoming and non-positive comparisons', () => {
    const req = requirements(familyIngredient('egg', 'Egg', 12, 'piece'));
    expect(deriveOfferOpportunities(req, [offer()], ['Netto'], reference)).toHaveLength(1);
    expect(deriveOfferOpportunities(req, [offer({ validTo: '2026-09-23' })], ['Netto'], reference)).toEqual([]);
    expect(deriveOfferOpportunities(req, [offer({ validFrom: '2026-09-25', validTo: '2026-09-30' })], ['Netto'], reference)).toEqual([]);
    expect(deriveOfferOpportunities(req, [offer({ offerPrice: 15 }), offer({ id: 'negative', offerPrice: 16 })], ['Netto'], reference)).toEqual([]);
  });

  it('shows a conditional opportunity explicitly while keeping it ineligible for automatic pricing', () => {
    const result = deriveOfferOpportunities(requirements(familyIngredient('egg', 'Egg', 12, 'piece')),
      [offer({ memberCondition: 'Club card' })], ['Netto'], reference);
    expect(result).toEqual([expect.objectContaining({ memberCondition: 'Club card', automaticEligible: false,
      potentialDifference: 5, referenceFreshness: 'unknown' })]);
  });

  it('does not multiply by quantity, duplicate a family, aggregate money, or use labels as identity', () => {
    const result = deriveOfferOpportunities(requirements(
      familyIngredient('egg', 'Eggs', 1, 'piece'),
      familyIngredient('egg', 'Æg', 500, 'g'),
      familyIngredient('milk', 'Catalogue egg', 1000, 'ml'),
      unlinkedIngredient('Catalogue egg', 10, 'piece'),
      { kind: 'legacy', name: 'Catalogue egg', amount: 'mange' },
    ), [offer()], ['Netto'], reference);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ familyId: 'egg', potentialDifference: 5 });
    expect(result[0]).not.toHaveProperty('quantity');
    expect(result[0]).not.toHaveProperty('total');
  });

  it('is deterministic across retailer candidates and selected-store scope', () => {
    const req = requirements(familyIngredient('egg', 'Egg', 1, 'piece'));
    const candidates = [offer({ id: 'b', store: 'Føtex', offerPrice: 8 }), offer({ id: 'a', store: 'Netto', offerPrice: 9 })];
    expect(deriveOfferOpportunities(req, candidates, ['Netto'], reference)[0].store).toBe('Netto');
    expect(deriveOfferOpportunities(req, candidates, ['Netto', 'Føtex'], reference)[0].store).toBe('Føtex');
  });
});
