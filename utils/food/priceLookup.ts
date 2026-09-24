import type { RecipeIngredient } from '@/core/food/ingredients';
import type { GlobalOffer, GlobalStandardPrice } from '@/types/food';
import { offerEvidence, unavailablePrice, validGlobalPriceEntry, validOfferEntry, type PriceEvidence } from '@/utils/food/priceEvidence';

function matchByName<T extends { productName: string; store: string }>(name: string, entries: T[], stores: string[]): T[] {
  const norm = name.trim().toLowerCase();
  if (!norm) return [];
  return entries.filter((entry) => {
    const product = entry.productName.trim().toLowerCase();
    return stores.includes(entry.store) && (product.includes(norm) || norm.includes(product));
  });
}

/** Explicit family lookup; display names remain only a standard-price compatibility path for non-family ingredients. */
export function findBestGlobalPrice(
  ingredient: RecipeIngredient, globalOffers: GlobalOffer[], globalStandardPrices: GlobalStandardPrice[],
  selectedStores: string[], reference: Date = new Date(),
): PriceEvidence {
  if (ingredient.kind !== 'family') {
    const standards = matchByName(ingredient.name, globalStandardPrices.filter(validGlobalPriceEntry), selectedStores);
    if (!standards.length) return unavailablePrice();
    const entry = [...standards].sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0];
    return { freshness: 'unknown', source: 'standard', price: entry.price, store: entry.store };
  }
  const offers = globalOffers.filter((entry) => validOfferEntry(entry) && entry.ingredientFamilyId === ingredient.familyId
    && selectedStores.includes(entry.store) && entry.memberCondition === null)
    .sort((a, b) => a.offerPrice - b.offerPrice || a.store.localeCompare(b.store) || a.id.localeCompare(b.id));
  const campaigns = offers.map((offer) => offerEvidence(offer, reference));
  const current = campaigns.filter((item) => item.freshness === 'current');
  const cheapest = (items: PriceEvidence[]) => items.sort((a, b) => ('price' in a ? a.price : Infinity) - ('price' in b ? b.price : Infinity))[0];
  if (current.length) return cheapest(current);
  const standards = globalStandardPrices.filter((entry) => validGlobalPriceEntry(entry)
    && entry.ingredientFamilyId === ingredient.familyId && selectedStores.includes(entry.store));
  if (standards.length) {
    const entry = [...standards].sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0];
    return { freshness: 'unknown', source: 'standard', price: entry.price, store: entry.store };
  }
  // Retain dated evidence for explanation only; it cannot contribute to a subtotal.
  const expired = campaigns.filter((item) => item.freshness === 'stale');
  return cheapest(expired.length ? expired : campaigns) ?? unavailablePrice();
}
