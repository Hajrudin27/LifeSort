import type { GlobalOffer, GlobalStandardPrice, GroceryOffer, StandardPrice } from '@/types/food';
import { isIngredientFamilyId, type IngredientFamilyId } from '@/core/food/ingredients';
import { nonempty, record, validGlobalPriceEntry, validOfferEntry, validPersonalOffer, validPrice, validPriceEntry } from './priceEvidence';

export const GLOBAL_PRICE_SELECT = 'id, product_id, store, price, product:products(id, name, ingredient_family_id)';
export const GLOBAL_OFFER_SELECT = 'id, standard_price_id, offer_price, valid_from, valid_to, published, licence_cleared, member_condition, standard_price:global_standard_prices(id, product_id, store, price, product:products(id, name, ingredient_family_id))';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function productScope(value: unknown): { productId: string; productName: string; ingredientFamilyId: IngredientFamilyId | null; store: string } | null {
  if (!record(value) || !uuid(value.id) || !uuid(value.product_id) || !nonempty(value.store) || !record(value.product)
    || value.product.id !== value.product_id || !nonempty(value.product.name)) return null;
  const family = value.product.ingredient_family_id;
  if (family !== null && !isIngredientFamilyId(family)) return null;
  return { productId: value.product_id, productName: value.product.name, ingredientFamilyId: family, store: value.store };
}
export function decodeGlobalPrice(row: unknown): GlobalStandardPrice | null {
  const scope = productScope(row);
  if (!scope || !record(row) || !uuid(row.id) || !validPrice(row.price)) return null;
  const price = { id: row.id, ...scope, price: row.price };
  return validGlobalPriceEntry(price) ? price : null;
}
export function decodeGlobalOffer(row: unknown): GlobalOffer | null {
  if (!record(row) || !uuid(row.id) || !uuid(row.standard_price_id) || !record(row.standard_price)
    || row.standard_price.id !== row.standard_price_id || row.published !== true || row.licence_cleared !== true
    || (row.member_condition !== null && !nonempty(row.member_condition)) || !validPrice(row.standard_price.price)) return null;
  const scope = productScope(row.standard_price);
  if (!scope) return null;
  const offer: GlobalOffer = { id: row.id, standardPriceId: row.standard_price_id, ...scope,
    offerPrice: row.offer_price as number, referencePrice: row.standard_price.price,
    validFrom: row.valid_from as string, validTo: row.valid_to as string, published: true, licenceCleared: true,
    memberCondition: row.member_condition as string | null };
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
