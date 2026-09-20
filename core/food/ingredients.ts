/**
 * APP-047: the recipe ingredient contract.
 *
 * An ingredient's IDENTITY is a stable, locale-independent family ID from the
 * catalogue below. It is never derived from display text, never a retailer
 * product, SKU or price row, and never differs between Danish and English. The
 * `name` a recipe shows is presentation in that recipe's language only.
 *
 * Quantity is a number and the unit one of a deliberately small vocabulary, so
 * "200 g" is no longer one opaque string. Ingredients written before APP-047
 * are preserved verbatim as `legacy`: nothing is inferred from their text.
 *
 * Lives in core for the same reason as `core/economy/recurrence.ts`: the local
 * migration and the backup parser are core, must validate this contract, and
 * core may not import a feature (ADR-0003). It depends on nothing else.
 */

/**
 * The family catalogue: exactly the generic ingredients the bundled recipes
 * use. Brand, pack size, fat percentage, "light" variants, cut and packing
 * medium are product attributes, not identity — so "Laksefilet" is `salmon` and
 * "Mælk 1,5%" is `milk`. A variety sold as its own product (cherry tomatoes,
 * romaine) or a processed product (minced beef, chopped tomatoes) is its own
 * family. Whether one family may replace another is a separate, explicit
 * question, see `features/food/ingredientSubstitutions.ts`.
 *
 * IDs are identifiers that happen to be readable. They are never displayed and
 * never renamed: a renamed ID would be a new family and needs a migration.
 */
export const INGREDIENT_FAMILY_IDS = [
  'almond',
  'apple',
  'avocado',
  'baking-powder',
  'banana',
  'beef',
  'bell-pepper',
  'black-bean',
  'blueberry',
  'broccoli',
  'caesar-dressing',
  'carrot',
  'cherry-tomato',
  'chia-seed',
  'chicken-breast',
  'chopped-tomatoes',
  'cinnamon',
  'coconut-milk',
  'cod',
  'corn',
  'cottage-cheese',
  'couscous',
  'cream-cheese',
  'crouton',
  'cucumber',
  'curry-powder',
  'egg',
  'egg-noodles',
  'egg-white',
  'falafel',
  'feta',
  'green-bean',
  'ground-beef',
  'ham',
  'honey',
  'hummus',
  'kidney-bean',
  'lemon',
  'lettuce',
  'milk',
  'mixed-berries',
  'mixed-salad',
  'oats',
  'olive-oil',
  'onion',
  'parmesan',
  'pasta',
  'peanut-butter',
  'pesto',
  'potato',
  'rice',
  'romaine-lettuce',
  'rye-bread',
  'salmon',
  'salsa',
  'sesame-oil',
  'sesame-seed',
  'skyr',
  'skyr-dressing',
  'soy-sauce',
  'spaghetti',
  'spice-mix',
  'spinach',
  'stir-fry-vegetables',
  'teriyaki-sauce',
  'tomato',
  'tuna',
  'walnut',
  'wholewheat-pita',
  'wholewheat-tortilla',
  'wholewheat-wrap',
] as const;

export type IngredientFamilyId = (typeof INGREDIENT_FAMILY_IDS)[number];

export function isIngredientFamilyId(value: unknown): value is IngredientFamilyId {
  return typeof value === 'string' && (INGREDIENT_FAMILY_IDS as readonly string[]).includes(value);
}

/**
 * Exactly the units the bundled recipes use: grams, millilitres and a count of
 * pieces ("stk"/"pcs"). No conversion between them exists or is implied.
 */
export const INGREDIENT_UNITS = ['g', 'ml', 'piece'] as const;

export type IngredientUnit = (typeof INGREDIENT_UNITS)[number];

export function isIngredientUnit(value: unknown): value is IngredientUnit {
  return typeof value === 'string' && (INGREDIENT_UNITS as readonly string[]).includes(value);
}

/**
 * A quantity is a finite number above zero. Nothing is said about precision:
 * how much of it a form accepts is that form's own policy, not the contract's.
 */
export function isIngredientQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** A name is display text in the recipe's language, never identity. */
function isIngredientName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** An ingredient linked to its canonical family. */
export interface FamilyRecipeIngredient {
  kind: 'family';
  familyId: IngredientFamilyId;
  name: string;
  quantity: number;
  unit: IngredientUnit;
}

/**
 * A user's own ingredient that is not linked to any family. The catalogue is
 * deliberately small, so "not linked" must be representable rather than guessed.
 */
export interface UnlinkedRecipeIngredient {
  kind: 'unlinked';
  name: string;
  quantity: number;
  unit: IngredientUnit;
}

/**
 * An ingredient written before APP-047, kept exactly as it was stored. Its
 * `amount` is uninterpreted text and it has no family: neither is inferred.
 */
export interface LegacyRecipeIngredient {
  kind: 'legacy';
  name: string;
  amount: string;
}

export type RecipeIngredient = FamilyRecipeIngredient | UnlinkedRecipeIngredient | LegacyRecipeIngredient;

/** What can be created today. `legacy` only ever comes from pre-APP-047 data. */
export type NewRecipeIngredient = FamilyRecipeIngredient | UnlinkedRecipeIngredient;

export class IngredientError extends Error {
  constructor(readonly code: 'ingredient_invalid') {
    super(code);
    this.name = 'IngredientError';
  }
}

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Json, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

const FAMILY_KEYS = ['kind', 'familyId', 'name', 'quantity', 'unit'] as const;
const UNLINKED_KEYS = ['kind', 'name', 'quantity', 'unit'] as const;
const LEGACY_KEYS = ['kind', 'name', 'amount'] as const;
const PRE_APP_047_KEYS = ['name', 'amount'] as const;

/**
 * The one validator for the current contract. Returns a fresh object carrying
 * exactly the contract's fields, or null. Extra keys, an unknown kind, family or
 * unit, a blank name or an invalid quantity are all rejected, never repaired.
 */
export function decodeRecipeIngredient(value: unknown): RecipeIngredient | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case 'family':
      if (!hasExactKeys(value, FAMILY_KEYS) || !isIngredientFamilyId(value.familyId) || !isIngredientName(value.name) ||
        !isIngredientQuantity(value.quantity) || !isIngredientUnit(value.unit)) return null;
      return { kind: 'family', familyId: value.familyId, name: value.name, quantity: value.quantity, unit: value.unit };
    case 'unlinked':
      if (!hasExactKeys(value, UNLINKED_KEYS) || !isIngredientName(value.name) ||
        !isIngredientQuantity(value.quantity) || !isIngredientUnit(value.unit)) return null;
      return { kind: 'unlinked', name: value.name, quantity: value.quantity, unit: value.unit };
    case 'legacy':
      if (!hasExactKeys(value, LEGACY_KEYS) || typeof value.name !== 'string' || typeof value.amount !== 'string') return null;
      return { kind: 'legacy', name: value.name, amount: value.amount };
    default:
      return null;
  }
}

export function isRecipeIngredient(value: unknown): value is RecipeIngredient {
  return decodeRecipeIngredient(value) !== null;
}

/**
 * The only shape any pre-APP-047 writer produced — seeds, the recipe form,
 * Supabase rows and backups: exactly `{ name, amount }`, both strings. It
 * becomes a `legacy` ingredient with both strings untouched.
 */
export function decodePreApp047Ingredient(value: unknown): LegacyRecipeIngredient | null {
  if (!isRecord(value) || !hasExactKeys(value, PRE_APP_047_KEYS)) return null;
  if (typeof value.name !== 'string' || typeof value.amount !== 'string') return null;
  return { kind: 'legacy', name: value.name, amount: value.amount };
}

/** A list is accepted whole or not at all: one invalid element rejects it. */
function decodeList<T>(value: unknown, decode: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const decoded: T[] = [];
  for (const item of value) {
    const next = decode(item);
    if (next === null) return null;
    decoded.push(next);
  }
  return decoded;
}

/** Current-contract list: local v1 state and backup format 4. */
export function decodeRecipeIngredients(value: unknown): RecipeIngredient[] | null {
  return decodeList(value, decodeRecipeIngredient);
}

/**
 * A list any build may have written: each element in the current contract
 * (validated, kept) or in the pre-APP-047 shape (kept verbatim as `legacy`).
 *
 * Used for Supabase `food_recipes.ingredients`, local v0 state and backup
 * formats 1–3. All three can mix both shapes: an older build on another device
 * writes the old shape to the server, and an older build caches rows a newer
 * build wrote — verbatim, in its own v0 state and in the backups it exports.
 */
export function decodeCompatibleRecipeIngredients(value: unknown): RecipeIngredient[] | null {
  return decodeList(value, (item) => decodeRecipeIngredient(item) ?? decodePreApp047Ingredient(item));
}

/** The persisted and wire form: exactly the contract's fields. Throws if invalid. */
export function encodeRecipeIngredient(ingredient: RecipeIngredient): RecipeIngredient {
  const encoded = decodeRecipeIngredient(ingredient);
  if (!encoded) throw new IngredientError('ingredient_invalid');
  return encoded;
}

/** The one constructor for a linked ingredient. Throws instead of storing an invalid one. */
export function familyIngredient(
  familyId: IngredientFamilyId,
  name: string,
  quantity: number,
  unit: IngredientUnit,
): FamilyRecipeIngredient {
  const ingredient = encodeRecipeIngredient({ kind: 'family', familyId, name, quantity, unit });
  if (ingredient.kind !== 'family') throw new IngredientError('ingredient_invalid');
  return ingredient;
}

/** The one constructor for a user's unlinked ingredient. Throws instead of storing an invalid one. */
export function unlinkedIngredient(name: string, quantity: number, unit: IngredientUnit): UnlinkedRecipeIngredient {
  const ingredient = encodeRecipeIngredient({ kind: 'unlinked', name, quantity, unit });
  if (ingredient.kind !== 'unlinked') throw new IngredientError('ingredient_invalid');
  return ingredient;
}

// ASCII digits; one optional separator, comma or dot; at most two decimals. A
// third digit after a separator is refused, so "1.000" or "1,500" can never be
// read as a decimal when the user meant a thousand-grouped number.
const QUANTITY_INPUT_PATTERN = /^(\d+)(?:[.,](\d{1,2}))?$/;

/**
 * Form text → quantity, or null. No signs, exponents or grouping.
 *
 * This is the recipe form's input policy, deliberately narrower than the
 * contract above: a typed string is ambiguous between locales, a stored number
 * is not. A quantity from elsewhere is not held to it.
 */
export function parseIngredientQuantityInput(text: string): number | null {
  const match = QUANTITY_INPUT_PATTERN.exec(text.trim());
  if (!match) return null;
  const value = Number(`${match[1]}.${match[2] ?? '0'}`);
  return isIngredientQuantity(value) ? value : null;
}
