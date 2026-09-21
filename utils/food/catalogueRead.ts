import type { GlobalOffer, GlobalStandardPrice, GroceryOffer, StandardPrice } from '@/types/food';
import { nonempty, record, validOfferEntry, validPersonalOffer, validPrice, validPriceEntry } from './priceEvidence';

export const GLOBAL_PRICE_SELECT = 'id, product_id, store, price, product:products(id, name)';
export const GLOBAL_OFFER_SELECT = 'id, standard_price_id, offer_price, valid_from, valid_to, standard_price:global_standard_prices(id, product_id, store, product:products(id, name))';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function productScope(value: unknown): { productName: string; store: string } | null {
  if (!record(value) || !uuid(value.id) || !uuid(value.product_id) || !nonempty(value.store) || !record(value.product)
    || value.product.id !== value.product_id || !nonempty(value.product.name)) return null;
  return { productName: value.product.name, store: value.store };
}
export function decodeGlobalPrice(row: unknown): GlobalStandardPrice | null {
  const scope = productScope(row);
  if (!scope || !record(row) || !uuid(row.id) || !validPrice(row.price)) return null;
  return { id: row.id, ...scope, price: row.price };
}
export function decodeGlobalOffer(row: unknown): GlobalOffer | null {
  if (!record(row) || !uuid(row.id) || !uuid(row.standard_price_id) || !record(row.standard_price)
    || row.standard_price.id !== row.standard_price_id) return null;
  const scope = productScope(row.standard_price);
  if (!scope) return null;
  const offer = { id: row.id, ...scope, offerPrice: row.offer_price, validFrom: row.valid_from, validTo: row.valid_to };
  return validOfferEntry(offer) ? offer : null;
}
export function decodePersonalPrice(row: unknown): StandardPrice | null {
  if (!record(row)) return null;
  const price = { id: row.id, productName: row.product_name, store: row.store, price: row.price };
  return validPriceEntry(price) ? price : null;
}
export function decodePersonalOffer(row: unknown): GroceryOffer | null {
  const price = decodePersonalPrice(row);
  if (!price || !record(row)) return null;
  const offer = { ...price, weekKey: row.week_key, source: row.source };
  return validPersonalOffer(offer) ? offer : null;
}
export function decodeRows<T>(rows: unknown[], decode: (row: unknown) => T | null): T[] {
  return rows.flatMap((row) => { const decoded = decode(row); return decoded === null ? [] : [decoded]; });
}
