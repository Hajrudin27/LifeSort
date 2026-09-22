import { isIngredientFamilyId, isIngredientQuantity, isIngredientUnit, type IngredientFamilyId, type IngredientUnit } from './ingredients';
type MealType = 'breakfast' | 'lunch' | 'dinner';

export type ShoppingContribution = {
  recipeId: string;
  day: number;
  mealType: MealType;
  ingredientIndex: number;
  ingredientName: string;
} & (
  | { kind: 'family'; familyId: IngredientFamilyId; quantity: number; unit: IngredientUnit }
  | { kind: 'unlinked'; quantity: number; unit: IngredientUnit }
  | { kind: 'legacy'; amount: string }
);

export type ShoppingIdentity =
  | { kind: 'family'; familyId: IngredientFamilyId; unit: IngredientUnit }
  | { kind: 'unlinked'; recipeId: string; ingredientIndex: number; unit: IngredientUnit }
  | { kind: 'legacy'; recipeId: string; ingredientIndex: number };

export type ShoppingAmount =
  | { kind: 'structured'; quantity: number; unit: IngredientUnit }
  | { kind: 'legacy'; text: string; repetitions: number };

export type ManualShoppingItem = { id: string; kind: 'manual'; label: string; checked: boolean };
export type MealPlanShoppingItem = {
  id: string;
  kind: 'meal_plan';
  label: string;
  checked: boolean;
  weekKey: string;
  identity: ShoppingIdentity;
  amount: ShoppingAmount;
  provenance: ShoppingContribution[];
};
export type ShoppingListItem = ManualShoppingItem | MealPlanShoppingItem;
export type ShoppingRequirement = Omit<MealPlanShoppingItem, 'id' | 'checked' | 'kind' | 'weekKey'>;

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Json, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const index = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const mealType = (value: unknown): value is MealType => value === 'breakfast' || value === 'lunch' || value === 'dinner';
export const isWeekKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(value);

export function decodeLegacyShoppingItem(value: unknown): ManualShoppingItem | null {
  if (!record(value) || !exact(value, ['id', 'label', 'checked']) || !text(value.id) || typeof value.label !== 'string' || typeof value.checked !== 'boolean') return null;
  return { id: value.id, kind: 'manual', label: value.label, checked: value.checked };
}

function decodeIdentity(value: unknown): ShoppingIdentity | null {
  if (!record(value)) return null;
  if (value.kind === 'family' && exact(value, ['kind', 'familyId', 'unit']) && isIngredientFamilyId(value.familyId) && isIngredientUnit(value.unit))
    return { kind: 'family', familyId: value.familyId, unit: value.unit };
  if (value.kind === 'unlinked' && exact(value, ['kind', 'recipeId', 'ingredientIndex', 'unit']) && text(value.recipeId) && index(value.ingredientIndex) && isIngredientUnit(value.unit))
    return { kind: 'unlinked', recipeId: value.recipeId, ingredientIndex: value.ingredientIndex, unit: value.unit };
  if (value.kind === 'legacy' && exact(value, ['kind', 'recipeId', 'ingredientIndex']) && text(value.recipeId) && index(value.ingredientIndex))
    return { kind: 'legacy', recipeId: value.recipeId, ingredientIndex: value.ingredientIndex };
  return null;
}

function decodeAmount(value: unknown): ShoppingAmount | null {
  if (!record(value)) return null;
  if (value.kind === 'structured' && exact(value, ['kind', 'quantity', 'unit']) && isIngredientQuantity(value.quantity) && isIngredientUnit(value.unit))
    return { kind: 'structured', quantity: value.quantity, unit: value.unit };
  if (value.kind === 'legacy' && exact(value, ['kind', 'text', 'repetitions']) && typeof value.text === 'string' && Number.isSafeInteger(value.repetitions) && (value.repetitions as number) > 0)
    return { kind: 'legacy', text: value.text, repetitions: value.repetitions as number };
  return null;
}

function decodeContribution(value: unknown): ShoppingContribution | null {
  if (!record(value) || !text(value.recipeId) || !index(value.day) || value.day > 6 || !mealType(value.mealType) || !index(value.ingredientIndex) || typeof value.ingredientName !== 'string') return null;
  const source = { recipeId: value.recipeId, day: value.day, mealType: value.mealType, ingredientIndex: value.ingredientIndex, ingredientName: value.ingredientName };
  if (value.kind === 'family' && exact(value, [...Object.keys(source), 'kind', 'familyId', 'quantity', 'unit']) && isIngredientFamilyId(value.familyId) && isIngredientQuantity(value.quantity) && isIngredientUnit(value.unit))
    return { ...source, kind: 'family', familyId: value.familyId, quantity: value.quantity, unit: value.unit };
  if (value.kind === 'unlinked' && exact(value, [...Object.keys(source), 'kind', 'quantity', 'unit']) && isIngredientQuantity(value.quantity) && isIngredientUnit(value.unit))
    return { ...source, kind: 'unlinked', quantity: value.quantity, unit: value.unit };
  if (value.kind === 'legacy' && exact(value, [...Object.keys(source), 'kind', 'amount']) && typeof value.amount === 'string')
    return { ...source, kind: 'legacy', amount: value.amount };
  return null;
}

/** Strict current local, backup and remote shopping artifact contract. */
export function decodeShoppingItem(value: unknown): ShoppingListItem | null {
  if (!record(value) || !text(value.id) || typeof value.label !== 'string' || typeof value.checked !== 'boolean') return null;
  if (value.kind === 'manual') return exact(value, ['id', 'kind', 'label', 'checked'])
    ? { id: value.id, kind: 'manual', label: value.label, checked: value.checked } : null;
  if (value.kind !== 'meal_plan' || !exact(value, ['id', 'kind', 'label', 'checked', 'weekKey', 'identity', 'amount', 'provenance']) || !isWeekKey(value.weekKey)) return null;
  const identity = decodeIdentity(value.identity);
  const amount = decodeAmount(value.amount);
  if (!identity || !amount || !Array.isArray(value.provenance) || !value.provenance.length) return null;
  if ((identity.kind === 'legacy') !== (amount.kind === 'legacy')) return null;
  const provenance: ShoppingContribution[] = [];
  for (const raw of value.provenance) {
    const contribution = decodeContribution(raw);
    if (!contribution || contribution.kind !== identity.kind) return null;
    if (identity.kind === 'family' && (contribution.kind !== 'family' || contribution.familyId !== identity.familyId || contribution.unit !== identity.unit)) return null;
    if (identity.kind !== 'family' && (contribution.recipeId !== identity.recipeId || contribution.ingredientIndex !== identity.ingredientIndex)) return null;
    if (identity.kind === 'unlinked' && (contribution.kind !== 'unlinked' || contribution.unit !== identity.unit)) return null;
    provenance.push(contribution);
  }
  return { id: value.id, kind: 'meal_plan', label: value.label, checked: value.checked, weekKey: value.weekKey, identity, amount, provenance };
}

export function decodeShoppingItems(value: unknown, legacy = false): ShoppingListItem[] | null {
  if (!Array.isArray(value)) return null;
  const decoded: ShoppingListItem[] = [];
  for (const item of value) {
    const next = legacy ? decodeLegacyShoppingItem(item) : decodeShoppingItem(item);
    if (!next) return null;
    decoded.push(next);
  }
  return decoded;
}
