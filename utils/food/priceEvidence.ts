import { budgetPeriodForInstant } from '@/core/dates/budgetPeriod';
import { parseCalendarDate } from '@/utils/shared/localDate';
import type { GlobalOffer, GlobalStandardPrice, GroceryOffer } from '@/types/food';

/** APP-048: dates belong only to campaign evidence, never to a fetch/cache. */
type Priced = { price: number; store: string };
type Campaign = Priced & { source: 'offer'; validFrom: string; validTo: string };
export type PriceEvidence =
  | (Campaign & { freshness: 'current' | 'stale' | 'upcoming' })
  | (Priced & { freshness: 'unknown'; source: 'standard' | 'manual' | 'ai_import' })
  | { freshness: 'unknown'; source: 'unavailable' };

export const unavailablePrice = (): PriceEvidence => ({ freshness: 'unknown', source: 'unavailable' });
export const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export const validPrice = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function validPriceEntry(value: unknown): value is GlobalStandardPrice {
  return record(value) && nonempty(value.id) && nonempty(value.productName) && nonempty(value.store) && validPrice(value.price);
}
export function validOfferEntry(value: unknown): value is GlobalOffer {
  return record(value) && nonempty(value.id) && nonempty(value.productName) && nonempty(value.store)
    && validPrice(value.offerPrice) && typeof value.validFrom === 'string' && typeof value.validTo === 'string'
    && !!parseCalendarDate(value.validFrom) && !!parseCalendarDate(value.validTo) && value.validFrom <= value.validTo;
}
export function offerEvidence(value: unknown, reference: Date): PriceEvidence {
  if (!validOfferEntry(value)) return unavailablePrice();
  const day = budgetPeriodForInstant(reference).dateKey;
  return { freshness: day < value.validFrom ? 'upcoming' : day > value.validTo ? 'stale' : 'current',
    source: 'offer', price: value.offerPrice, store: value.store, validFrom: value.validFrom, validTo: value.validTo };
}
export function personalOfferEvidence(value: unknown): PriceEvidence {
  if (!validPriceEntry(value) || !record(value) || (value.source !== 'manual' && value.source !== 'ai_import')) return unavailablePrice();
  // weekKey organizes user entries; it does not prove campaign validity.
  return { freshness: 'unknown', source: value.source, price: value.price, store: value.store };
}
export function validPersonalOffer(value: unknown): value is GroceryOffer {
  return record(value) && nonempty(value.weekKey) && personalOfferEvidence(value).source !== 'unavailable';
}

/** Only current campaigns and undated known prices contribute, never expired/future campaigns. */
export function usablePrice(evidence: PriceEvidence): number | null {
  return evidence.source !== 'unavailable' && (evidence.freshness === 'current' || evidence.freshness === 'unknown') ? evidence.price : null;
}
export type PriceEstimate = {
  status: 'current' | 'partial' | 'unavailable';
  knownSubtotal: number | null;
  current: number;
  unknown: number;
  stale: number;
  upcoming: number;
  missing: number;
};
export function summarizePrices(evidence: PriceEvidence[]): PriceEstimate {
  const result: PriceEstimate = { status: 'current', knownSubtotal: null, current: 0, unknown: 0, stale: 0, upcoming: 0, missing: 0 };
  for (const item of evidence) {
    if (item.source === 'unavailable') result.missing++;
    else result[item.freshness]++;
    const price = usablePrice(item);
    if (price !== null) result.knownSubtotal = (result.knownSubtotal ?? 0) + price;
  }
  // An empty shopping requirement (e.g. pantry-covered) is legitimately zero.
  if (evidence.length === 0) result.knownSubtotal = 0;
  result.status = result.current === evidence.length ? 'current' : result.knownSubtotal === null ? 'unavailable' : 'partial';
  return result;
}
