import { GlobalOffer, GlobalStandardPrice } from '@/types/food';

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export interface PriceMatch {
  price: number;
  store: string;
  source: 'offer' | 'standard';
}

function isOfferActive(offer: GlobalOffer, today: string): boolean {
  return offer.validFrom <= today && offer.validTo >= today;
}

function matchByName<T extends { productName: string; store: string }>(
  ingredientName: string,
  entries: T[],
  selectedStores: string[]
): T[] {
  const norm = normalize(ingredientName);
  if (norm.length === 0) return [];
  return entries.filter((e) => {
    if (!selectedStores.includes(e.store)) return false;
    const productNorm = normalize(e.productName);
    return productNorm.includes(norm) || norm.includes(productNorm);
  });
}

// Finder den billigste pris for en ingrediens, udelukkende inden for brugerens
// valgte butikker — tjekker først aktive tilbud, falder derefter tilbage til
// billigste standardpris. Bruges til madplan-generering og shoppingliste.
export function findBestGlobalPrice(
  ingredientName: string,
  globalOffers: GlobalOffer[],
  globalStandardPrices: GlobalStandardPrice[],
  selectedStores: string[]
): PriceMatch | null {
  if (selectedStores.length === 0) return null;

  const today = new Date().toISOString().split('T')[0];
  const activeOffers = globalOffers.filter((o) => isOfferActive(o, today));

  const offerMatches = matchByName(ingredientName, activeOffers, selectedStores).map((o) => ({
    price: o.offerPrice,
    store: o.store,
    source: 'offer' as const,
  }));

  if (offerMatches.length > 0) {
    return [...offerMatches].sort((a, b) => a.price - b.price)[0];
  }

  const standardMatches = matchByName(ingredientName, globalStandardPrices, selectedStores).map((s) => ({
    price: s.price,
    store: s.store,
    source: 'standard' as const,
  }));

  if (standardMatches.length === 0) return null;
  return [...standardMatches].sort((a, b) => a.price - b.price)[0];
}