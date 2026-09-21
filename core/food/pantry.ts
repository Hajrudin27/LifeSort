import { parseCalendarDate } from '@/utils/shared/localDate';
import { isIngredientQuantity, isIngredientUnit, type IngredientUnit } from './ingredients';

export interface PantryItem {
  id: string;
  name: string;
  quantity?: number;
  unit?: IngredientUnit;
  /** Pre-APP-050 text, preserved exactly; never produced by a new item. */
  legacyQuantityText?: string;
  purchasedDate?: string;
  openedDate?: string;
  expiryDate?: string;
  addedAt: string;
}

export type NewPantryItem = Pick<PantryItem, 'name' | 'quantity' | 'unit' | 'purchasedDate' | 'openedDate' | 'expiryDate'>;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const keysOnly = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const instant = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  parseCalendarDate(value.slice(0, 10)) !== null && Number.isFinite(Date.parse(value));
const validOptionalDate = (value: unknown) => value === undefined || parseCalendarDate(value) !== null;

/** One strict current contract for local state, backup, edits and server reads. */
export function decodePantryItem(value: unknown): PantryItem | null {
  if (!record(value) || !keysOnly(value, [
    'id', 'name', 'quantity', 'unit', 'legacyQuantityText', 'purchasedDate', 'openedDate', 'expiryDate', 'addedAt',
  ])) return null;
  if (!text(value.id) || !text(value.name) || !instant(value.addedAt)) return null;
  if (!validOptionalDate(value.purchasedDate) || !validOptionalDate(value.openedDate) || !validOptionalDate(value.expiryDate)) return null;
  const quantityPresent = value.quantity !== undefined;
  const unitPresent = value.unit !== undefined;
  if (quantityPresent !== unitPresent) return null;
  if (quantityPresent && (!isIngredientQuantity(value.quantity) || !isIngredientUnit(value.unit))) return null;
  if (value.legacyQuantityText !== undefined &&
    (typeof value.legacyQuantityText !== 'string' || quantityPresent)) return null;
  return {
    id: value.id, name: value.name, addedAt: value.addedAt,
    ...(quantityPresent ? { quantity: value.quantity as number, unit: value.unit as IngredientUnit } : {}),
    ...(value.legacyQuantityText !== undefined ? { legacyQuantityText: value.legacyQuantityText as string } : {}),
    ...(value.purchasedDate !== undefined ? { purchasedDate: value.purchasedDate as string } : {}),
    ...(value.openedDate !== undefined ? { openedDate: value.openedDate as string } : {}),
    ...(value.expiryDate !== undefined ? { expiryDate: value.expiryDate as string } : {}),
  };
}

/** Historical text is copied, never parsed, including apparent numbers/units. */
export function decodeLegacyPantryItem(value: unknown): PantryItem | null {
  if (!record(value) || !keysOnly(value, ['id', 'name', 'quantity', 'expiryDate', 'addedAt'])) return null;
  if (value.quantity !== undefined && typeof value.quantity !== 'string') return null;
  return decodePantryItem({
    id: value.id, name: value.name, addedAt: value.addedAt, expiryDate: value.expiryDate,
    ...(value.quantity !== undefined ? { legacyQuantityText: value.quantity } : {}),
  });
}

export function decodePantryItems(value: unknown, legacy = false): PantryItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: PantryItem[] = [];
  for (const item of value) {
    const decoded = legacy ? decodeLegacyPantryItem(item) : decodePantryItem(item);
    if (!decoded) return null;
    items.push(decoded);
  }
  return items;
}

/** Edits replace optional fields; only an explicit keep may retain old text. */
export function canonicalPantryEdit(
  current: PantryItem | null,
  input: NewPantryItem,
  keepLegacyQuantity = false,
  id?: string,
  addedAt?: string,
): PantryItem | null {
  if (!record(input) || !keysOnly(input, ['name', 'quantity', 'unit', 'purchasedDate', 'openedDate', 'expiryDate'])) return null;
  if (keepLegacyQuantity && (!current || current.legacyQuantityText === undefined || input.quantity !== undefined || input.unit !== undefined)) return null;
  return decodePantryItem({
    ...input,
    id: current?.id ?? id,
    addedAt: current?.addedAt ?? addedAt,
    ...(keepLegacyQuantity ? { legacyQuantityText: current?.legacyQuantityText } : {}),
  });
}

/** PostgREST's selected row is untrusted, including numeric and date values. */
export function decodePantryRow(value: unknown): PantryItem | null {
  if (!record(value) || !keysOnly(value, [
    'id', 'name', 'quantity', 'structured_quantity', 'structured_unit', 'purchased_date', 'opened_date', 'expiry_date', 'added_at',
  ])) return null;
  const noNull = (field: string) => value[field] === null ? undefined : value[field];
  if (!['quantity', 'structured_quantity', 'structured_unit', 'purchased_date', 'opened_date', 'expiry_date']
    .every((field) => field in value)) return null;
  if (typeof value.quantity !== 'string' && value.quantity !== null) return null;
  return decodePantryItem({
    id: value.id, name: value.name, addedAt: value.added_at,
    quantity: noNull('structured_quantity'), unit: noNull('structured_unit'),
    legacyQuantityText: noNull('quantity'),
    purchasedDate: noNull('purchased_date'), openedDate: noNull('opened_date'), expiryDate: noNull('expiry_date'),
  });
}
