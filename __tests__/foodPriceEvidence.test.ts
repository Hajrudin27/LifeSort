import { createInstance } from 'i18next';
import { familyIngredient } from '@/core/food/ingredients';
import { findBestGlobalPrice } from '@/utils/food/priceLookup';
import { offerEvidence, personalOfferEvidence, summarizePrices, unavailablePrice, usablePrice } from '@/utils/food/priceEvidence';
import { decodeGlobalOffer, decodeGlobalPrice, decodePersonalOffer } from '@/utils/food/catalogueRead';
import { planWeek, pricePlan } from '@/utils/food/mealPlanning';
import { formatPriceEstimate, formatPriceEvidence } from '@/utils/food/pricePresentation';
import da from '@/localization/locales/da/food.json';
import en from '@/localization/locales/en/food.json';
import type { GlobalOffer, GlobalStandardPrice } from '@/types/food';

const reference = new Date('2026-09-20T22:00:00Z'); // Copenhagen 21 September
const offer = { id: 'offer', standardPriceId: 'standard', productId: 'product', productName: 'Eggs', ingredientFamilyId: 'egg' as const,
  store: 'Netto', offerPrice: 10, referencePrice: 15, validFrom: '2026-09-21', validTo: '2026-09-27',
  published: true as const, licenceCleared: true as const, memberCondition: null };
const standard = { id: 'standard', productId: 'product', productName: 'Eggs', ingredientFamilyId: 'egg' as const, store: 'Netto', price: 15 };
const egg = familyIngredient('egg', 'Eggs', 2, 'piece');
const lookup = (offers: GlobalOffer[] = [offer], standards: GlobalStandardPrice[] = [standard], stores = ['Netto'], date = reference) => findBestGlobalPrice(egg, offers, standards, stores, date);

describe('APP-048 authoritative campaign evidence', () => {
  it.each([
    ['2026-09-20T21:59:59Z', 'upcoming'],
    ['2026-09-20T22:00:00Z', 'current'],
    ['2026-09-24T12:00:00Z', 'current'],
    ['2026-09-27T21:59:59Z', 'current'],
    ['2026-09-27T22:00:00Z', 'stale'],
  ])('%s is %s, including both boundary dates', (instant, freshness) => {
    expect(offerEvidence(offer, new Date(instant))).toEqual({ freshness, source: 'offer', store: 'Netto', price: 10, validFrom: offer.validFrom, validTo: offer.validTo });
  });
  it('uses Copenhagen across DST, not a fixed UTC offset', () => {
    const winter = { ...offer, validFrom: '2026-10-26', validTo: '2026-10-26' };
    expect(offerEvidence(winter, new Date('2026-10-25T22:59:59Z')).freshness).toBe('upcoming');
    expect(offerEvidence(winter, new Date('2026-10-25T23:00:00Z')).freshness).toBe('current');
  });
  it('prefers current campaigns, then undated standards, without claiming freshness', () => {
    expect(lookup()).toMatchObject({ freshness: 'current', source: 'offer', price: 10 });
    const stale = { ...offer, validTo: '2026-09-20', validFrom: '2026-09-01' };
    expect(lookup([stale])).toEqual({ freshness: 'unknown', source: 'standard', store: 'Netto', price: 15 });
    expect(lookup([stale], [])).toMatchObject({ freshness: 'stale' });
    expect(usablePrice(lookup([stale], []))).toBeNull();
  });
  it('never borrows an unselected store or generates a fallback price', () => {
    expect(lookup([], [])).toEqual(unavailablePrice());
    expect(lookup([offer], [standard], [])).toEqual(unavailablePrice());
    expect(lookup([offer], [standard], ['Other'])).toEqual(unavailablePrice());
    expect(lookup([{ ...offer, store: 'Other', offerPrice: 1 }])).toMatchObject({ source: 'standard', price: 15 });
    expect(lookup([], [{ ...standard, price: 0 }])).toMatchObject({ price: 0, freshness: 'unknown' }); // explicit zero is not missing
  });
  it.each([NaN, Infinity, -1, null, '', '10'])('rejects malformed cached prices %s', (price) => {
    expect(lookup([], [{ ...standard, price } as never])).toEqual(unavailablePrice());
  });
  it.each(['2026-02-30', '2026-9-21', '', '2026-09-21T00:00:00Z', null])('rejects invalid campaign dates %s', (validFrom) => {
    expect(offerEvidence({ ...offer, validFrom }, reference)).toEqual(unavailablePrice());
  });
  it('rejects reversed campaigns and blank names', () => {
    expect(offerEvidence({ ...offer, validFrom: '2026-09-28' }, reference)).toEqual(unavailablePrice());
    expect(lookup([{ ...offer, productName: ' ' }], [])).toEqual(unavailablePrice());
  });
  it('does not make personal week tags or imported provenance into campaign dates', () => {
    expect(personalOfferEvidence({ ...standard, source: 'manual', weekKey: '2026-W39' })).toEqual({ freshness: 'unknown', source: 'manual', store: 'Netto', price: 15 });
    expect(personalOfferEvidence({ ...standard, source: 'ai_import' })).toMatchObject({ freshness: 'unknown', source: 'ai_import' });
    expect(personalOfferEvidence({ ...standard, source: 'invented' })).toEqual(unavailablePrice());
  });
});

const productId = '11111111-1111-4111-8111-111111111111';
const priceId = '22222222-2222-4222-8222-222222222222';
const offerId = '33333333-3333-4333-8333-333333333333';
const row = { id: priceId, product_id: productId, product: { id: productId, name: 'Eggs', ingredient_family_id: 'egg' }, store: 'Netto', price: 15, updated_at: reference.toISOString() };
const offerRow = { id: offerId, standard_price_id: priceId, standard_price: row, offer_price: 10, valid_from: offer.validFrom, valid_to: offer.validTo,
  published: true, licence_cleared: true, member_condition: null };
describe('APP-048 external row decoding', () => {
  it('follows products through the standard price relationship and ignores row timestamps', () => {
    expect(decodeGlobalPrice(row)).toEqual({ ...standard, id: priceId, productId });
    expect(decodeGlobalOffer(offerRow)).toEqual({ ...offer, id: offerId, standardPriceId: priceId, productId });
    expect(lookup([], [decodeGlobalPrice(row)!])).toEqual({ freshness: 'unknown', source: 'standard', price: 15, store: 'Netto' });
  });
  it.each([
    { product: null }, { product: [{ id: productId, name: 'Eggs' }] }, { product_id: 'egg' },
    { product: { id: priceId, name: 'Eggs' } }, { product: { id: productId, name: '' } },
    { price: null }, { price: '15' }, { price: -1 }, { store: '' }, { id: null },
  ])('fails closed on malformed relationship/price %j', (change) => {
    expect(decodeGlobalPrice({ ...row, ...change })).toBeNull();
  });
  it('refuses obsolete product_name rows and malformed offer foreign keys/dates', () => {
    expect(decodeGlobalPrice({ id: priceId, product_name: 'Eggs', price: 15, store: 'Netto' })).toBeNull();
    expect(decodeGlobalOffer({ ...offerRow, standard_price_id: productId })).toBeNull();
    expect(decodeGlobalOffer({ ...offerRow, valid_to: '2026-02-30' })).toBeNull();
    expect(decodeGlobalOffer({ ...offerRow, offer_price: '' })).toBeNull();
    expect(decodePersonalOffer({ id: 'old', product_name: 'Eggs', store: 'Netto', price: 10, week_key: '2026-W39' })).toBeNull();
  });
});

describe('APP-053 authoritative catalogue decoding', () => {
  it('keeps an explicit family and allows a deliberately unmapped product', () => {
    expect(decodeGlobalPrice(row)).toMatchObject({ ingredientFamilyId: 'egg' });
    expect(decodeGlobalPrice({ ...row, product: { ...row.product, ingredient_family_id: null } }))
      .toMatchObject({ ingredientFamilyId: null });
    expect(decodeGlobalPrice({ ...row, product: { ...row.product, ingredient_family_id: 'not-a-family' } })).toBeNull();
  });
  it('requires published, licence-cleared, nonblank conditions and the linked reference price', () => {
    expect(decodeGlobalOffer(offerRow)).not.toBeNull();
    expect(decodeGlobalOffer({ ...offerRow, published: false })).toBeNull();
    expect(decodeGlobalOffer({ ...offerRow, licence_cleared: false })).toBeNull();
    expect(decodeGlobalOffer({ ...offerRow, member_condition: '  ' })).toBeNull();
    expect(decodeGlobalOffer({ ...offerRow, member_condition: 'Member card' })).toMatchObject({ memberCondition: 'Member card' });
    expect(decodeGlobalOffer({ ...offerRow, standard_price: { ...row, price: null } })).toBeNull();
    expect(decodeGlobalOffer({ ...offerRow, standard_price: { ...row, product_id: offerId } })).toBeNull();
  });
});

describe('APP-048 aggregate propagation and planning regression', () => {
  const current = offerEvidence(offer, reference);
  const stale = offerEvidence(offer, new Date('2026-09-28T12:00:00Z'));
  const upcoming = offerEvidence(offer, new Date('2026-09-01T12:00:00Z'));
  const unknown = lookup([]);
  it('only reports entirely current evidence as current', () => {
    expect(summarizePrices([current])).toMatchObject({ status: 'current', knownSubtotal: 10 });
    expect(summarizePrices([unknown])).toMatchObject({ status: 'partial', knownSubtotal: 15, unknown: 1 });
    expect(summarizePrices([stale])).toMatchObject({ status: 'unavailable', knownSubtotal: null, stale: 1 });
    expect(summarizePrices([upcoming])).toMatchObject({ status: 'unavailable', knownSubtotal: null, upcoming: 1 });
    expect(summarizePrices([unavailablePrice()])).toMatchObject({ status: 'unavailable', knownSubtotal: null, missing: 1 });
    expect(summarizePrices([current, unknown, stale, upcoming, unavailablePrice()])).toEqual({ status: 'partial', knownSubtotal: 25, current: 1, unknown: 1, stale: 1, upcoming: 1, missing: 1 });
  });
  const recipe = { id: 'r1', name: 'Egg dish', mealType: 'dinner' as const, ingredients: [familyIngredient('egg', 'Eggs', 2, 'piece')] };
  it('propagates evidence through shopping/store/week totals, keeping repeats and locks', () => {
    const plan = planWeek([recipe], [offer], [], ['Netto'], [], 20, { '0-dinner': recipe.id }, reference);
    expect(plan.slots).toHaveLength(21);
    expect(plan.slots.filter((slot) => slot.recipe)).toHaveLength(3);
    expect(plan.slots.find((slot) => slot.day === 0 && slot.mealType === 'dinner')?.locked).toBe(true);
    expect(plan.shoppingList).toEqual([{ ingredientName: 'Eggs', evidence: current }]);
    expect(plan.estimate).toMatchObject({ status: 'current', knownSubtotal: 10 });
    expect(plan.storeTotals[0].estimate).toEqual(plan.estimate);
    const repriced = pricePlan(plan.slots, [offer], [], ['Netto'], [], new Date('2026-09-28T12:00:00Z'));
    expect(repriced.slots).toBe(plan.slots);
    expect(repriced.estimate).toMatchObject({ status: 'unavailable', knownSubtotal: null, stale: 1 });
    expect(repriced.storeTotals[0].estimate).toEqual(repriced.estimate);
    expect(pricePlan(plan.slots, [offer], [], [], [], reference).estimate).toMatchObject({ missing: 1, knownSubtotal: null });
  });
  it('preserves pantry semantics without manufacturing a price or family/product link', () => {
    const pantry = [{ id: 'p', name: 'Eggs', addedAt: reference.toISOString() }];
    const plan = planWeek([recipe], [], [], [], pantry, 20, {}, reference);
    expect(plan.shoppingList).toEqual([]);
    expect(plan.pantryCovered).toEqual([{ ingredientName: 'Eggs', source: 'pantry' }]);
    expect(plan.estimate.knownSubtotal).toBe(0);
    const structuredPantry = [{ ...pantry[0], quantity: 1, unit: 'piece' as const, expiryDate: '2026-09-22' }];
    expect(planWeek([recipe], [], [], [], structuredPantry, 20, {}, reference).pantryCovered).toEqual(plan.pantryCovered);
    expect(structuredPantry[0].quantity).toBe(1); // Planning does not consume stock or use quantity as coverage.
    const renamed = { ...recipe, ingredients: [familyIngredient('egg', 'Unmatched display name', 2, 'piece')] };
    expect(planWeek([renamed], [offer], [], ['Netto'], [], 20, {}, reference).estimate).toMatchObject({ status: 'current', current: 1, knownSubtotal: 10 });
  });
  it('limits new meals by remaining allocation while keeping missing and negative budgets distinct', () => {
    const costly = { ...offer, offerPrice: 600 };
    const withFullAllocation = planWeek([recipe], [costly], [], ['Netto'], [], 800, {}, reference);
    const afterPurchase = planWeek([recipe], [costly], [], ['Netto'], [], 500, {}, reference);
    const noBudget = planWeek([recipe], [costly], [], ['Netto'], [], null, {}, reference);
    const overBudget = planWeek([recipe], [costly], [], ['Netto'], [], -100, {}, reference);
    expect(withFullAllocation.slots.filter((slot) => slot.recipe)).toHaveLength(3);
    expect(afterPurchase.slots.every((slot) => slot.recipe === null)).toBe(true);
    expect(noBudget.slots.filter((slot) => slot.recipe)).toHaveLength(3);
    expect(overBudget.slots.every((slot) => slot.recipe === null)).toBe(true);
    const locked = planWeek([recipe], [costly], [], ['Netto'], [], -100, { '0-dinner': recipe.id }, reference);
    expect(locked.slots.filter((slot) => slot.recipe)).toHaveLength(1);
    expect(locked.estimate).toMatchObject({ status: 'current', knownSubtotal: 600 });
  });
  it.each(['da', 'en'])('presents factual source, scope, dates and aggregate uncertainty in %s', async (language) => {
    const i18n = createInstance();
    await i18n.init({ lng: language, resources: { da: { translation: { food: da } }, en: { translation: { food: en } } } });
    const text = formatPriceEvidence(current, i18n.t, language);
    expect(text).toContain('Netto');
    expect(text).toContain('2026-09-21');
    expect(text).toContain('2026-09-27');
    expect(text).toContain(language === 'da' ? 'Aktuel kampagne' : 'Current campaign');
    const undated = formatPriceEvidence(unknown, i18n.t, language);
    expect(undated).toContain(language === 'da' ? 'aktualitet er ukendt' : 'Freshness unknown');
    expect(undated).not.toContain('2026');
    expect(formatPriceEstimate(summarizePrices([current, stale, unknown, unavailablePrice()]), i18n.t, language)).toContain(language === 'da' ? 'Delsum for kendte priser' : 'Known-price subtotal');
    expect(formatPriceEvidence(unavailablePrice(), i18n.t, language)).toBe(language === 'da' ? 'Pris mangler' : 'Price unavailable');
  });
});
