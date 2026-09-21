import type { GlobalOffer, GlobalStandardPrice } from '@/types/food';
import { offerEvidence, unavailablePrice, validOfferEntry, validPriceEntry, type PriceEvidence } from '@/utils/food/priceEvidence';

function matchByName<T extends { productName: string; store: string }>(name: string, entries: T[], stores: string[]): T[] {
  const norm = name.trim().toLowerCase();
  if (!norm) return [];
  return entries.filter((entry) => {
    const product = entry.productName.trim().toLowerCase();
    return stores.includes(entry.store) && (product.includes(norm) || norm.includes(product));
  });
}

/** Compatibility display-name matching only. Ingredient family IDs are never product IDs. */
export function findBestGlobalPrice(
  ingredientName: string, globalOffers: GlobalOffer[], globalStandardPrices: GlobalStandardPrice[],
  selectedStores: string[], reference: Date = new Date(),
): PriceEvidence {
  const campaigns = matchByName(ingredientName, globalOffers.filter(validOfferEntry), selectedStores)
    .map((offer) => offerEvidence(offer, reference));
  const current = campaigns.filter((item) => item.freshness === 'current');
  const cheapest = (items: PriceEvidence[]) => items.sort((a, b) => ('price' in a ? a.price : Infinity) - ('price' in b ? b.price : Infinity))[0];
  if (current.length) return cheapest(current);
  const standards = matchByName(ingredientName, globalStandardPrices.filter(validPriceEntry), selectedStores);
  if (standards.length) {
    const entry = standards.sort((a, b) => a.price - b.price)[0];
    return { freshness: 'unknown', source: 'standard', price: entry.price, store: entry.store };
  }
  // Retain dated evidence for explanation only; it cannot contribute to a subtotal.
  const expired = campaigns.filter((item) => item.freshness === 'stale');
  return cheapest(expired.length ? expired : campaigns) ?? unavailablePrice();
}
