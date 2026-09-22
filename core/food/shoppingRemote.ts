import { decodeShoppingItem, type MealPlanShoppingItem, type ShoppingListItem } from './shopping';

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Json, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export function shoppingBaseRow(userId: string, item: ShoppingListItem) {
  return { user_id: userId, id: item.id, label: item.label, checked: item.checked, source_kind: item.kind };
}

export function shoppingDerivationRow(userId: string, item: MealPlanShoppingItem) {
  return {
    user_id: userId, shopping_item_id: item.id, week_key: item.weekKey,
    identity_kind: item.identity.kind,
    family_id: item.identity.kind === 'family' ? item.identity.familyId : null,
    source_recipe_id: item.identity.kind === 'family' ? null : item.identity.recipeId,
    source_ingredient_index: item.identity.kind === 'family' ? null : item.identity.ingredientIndex,
    identity_unit: item.identity.kind === 'legacy' ? null : item.identity.unit,
    amount_kind: item.amount.kind,
    current_quantity: item.amount.kind === 'structured' ? item.amount.quantity : null,
    current_unit: item.amount.kind === 'structured' ? item.amount.unit : null,
    current_legacy_text: item.amount.kind === 'legacy' ? item.amount.text : null,
    repetitions: item.amount.kind === 'legacy' ? item.amount.repetitions : null,
    provenance: item.provenance,
  };
}

const BASE_KEYS = ['id', 'label', 'checked', 'source_kind'];
const DERIVATION_KEYS = ['shopping_item_id', 'week_key', 'identity_kind', 'family_id', 'source_recipe_id',
  'source_ingredient_index', 'identity_unit', 'amount_kind', 'current_quantity', 'current_unit',
  'current_legacy_text', 'repetitions', 'provenance'];

/** Decode all rows or none; a derived base without valid child cannot become manual. */
export function decodeRemoteShoppingItems(bases: unknown, derivations: unknown): ShoppingListItem[] | null {
  if (!Array.isArray(bases) || !Array.isArray(derivations)) return null;
  const byId = new Map<string, Json>();
  for (const row of derivations) {
    if (!record(row) || !exact(row, DERIVATION_KEYS) || typeof row.shopping_item_id !== 'string' || byId.has(row.shopping_item_id)) return null;
    byId.set(row.shopping_item_id, row);
  }
  const items: ShoppingListItem[] = [];
  const seen = new Set<string>();
  for (const row of bases) {
    if (!record(row) || !exact(row, BASE_KEYS) || typeof row.id !== 'string' || seen.has(row.id)) return null;
    seen.add(row.id);
    const child = byId.get(row.id);
    if (row.source_kind === 'manual') {
      if (child) return null;
      const item = decodeShoppingItem({ id: row.id, kind: 'manual', label: row.label, checked: row.checked });
      if (!item) return null;
      items.push(item);
      continue;
    }
    if (row.source_kind !== 'meal_plan' || !child) return null;
    const identity = child.identity_kind === 'family'
      ? { kind: 'family', familyId: child.family_id, unit: child.identity_unit }
      : child.identity_kind === 'unlinked'
        ? { kind: 'unlinked', recipeId: child.source_recipe_id, ingredientIndex: child.source_ingredient_index, unit: child.identity_unit }
        : { kind: child.identity_kind, recipeId: child.source_recipe_id, ingredientIndex: child.source_ingredient_index };
    const amount = child.amount_kind === 'structured'
      ? { kind: 'structured', quantity: child.current_quantity, unit: child.current_unit }
      : { kind: child.amount_kind, text: child.current_legacy_text, repetitions: child.repetitions };
    const item = decodeShoppingItem({ id: row.id, kind: 'meal_plan', label: row.label, checked: row.checked,
      weekKey: child.week_key, identity, amount, provenance: child.provenance });
    if (!item || item.kind !== 'meal_plan') return null;
    const canonical = shoppingDerivationRow('', item);
    if (DERIVATION_KEYS.some((key) => key !== 'shopping_item_id' && key !== 'provenance' && child[key] !== canonical[key as keyof typeof canonical])) return null;
    items.push(item);
    byId.delete(row.id);
  }
  return byId.size === 0 ? items : null;
}
