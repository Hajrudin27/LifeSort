import { decodeCompatibleRecipeIngredients, decodeRecipeIngredients } from '@/core/food/ingredients';
import { decodePantryItems } from '@/core/food/pantry';
import type { LocalMigrationDefinition } from './harness';

/**
 * APP-047: Food v0 → v1. Recipe ingredients move from pre-APP-047
 * `{ name, amount }` strings to the typed ingredient contract.
 *
 * Every historical writer (49c4355 through 5c85adc) used Zustand's explicit
 * version 0 with the state keys below. Every ingredient those builds created —
 * seeds, the recipe form — was exactly `{ name, amount }`, both strings; the
 * step keeps each verbatim as a `legacy` ingredient. It infers no family and
 * parses no amount, not even for seed copies: the store refreshes those from
 * the bundled seeds when it hydrates.
 *
 * Those builds also cached Supabase rows verbatim, and after APP-047 ships a
 * row may hold ingredients a newer build wrote. Such an element is kept only if
 * it validates against the current contract. Every other state field, recipe
 * field, key and array position is copied as-is. Any other shape throws, so the
 * harness writes nothing and the bytes are preserved.
 *
 * APP-050 adds v1 → v2 in the same Food-store definition: old Pantry quantity
 * text is copied verbatim to legacyQuantityText. No amount, unit, date or
 * ingredient family is inferred. Malformed Pantry state fails before any write.
 */

type Json = Record<string, unknown>;
const record = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

const FOOD_STATE = [
  'monthlyBudgetByMonth', 'purchases', 'pantryItems', 'shoppingItems', 'offers', 'recipes',
  'standardPrices', 'globalStandardPrices', 'globalOffers', 'savedPlans', 'selectedStores',
];

function foodState(v: unknown, version: number): Json | null {
  if (!record(v) || v.version !== version || !record(v.state)) return null;
  if (!Object.keys(v).every((key) => key === 'state' || key === 'version')) return null;
  return Object.keys(v.state).every((key) => FOOD_STATE.includes(key)) ? v.state : null;
}

/** Validate the APP-047 recipe part of each Food-store version. */
function knownFood(v: unknown, version: number, ingredients: (value: unknown) => unknown[] | null): boolean {
  const state = foodState(v, version);
  return !!state && Array.isArray(state.recipes) &&
    state.recipes.every((recipe) => record(recipe) && ingredients(recipe.ingredients) !== null);
}

const detectVersion = (v: unknown): number | null => {
  if (!record(v) || !('version' in v)) return null;
  return typeof v.version === 'number' ? v.version : NaN;
};

export const foodIngredientsMigration: LocalMigrationDefinition = {
  storeId: 'async-storage:lifesort-food-v2',
  // "-v2" is part of the key name, not a schema version.
  storageKey: 'lifesort-food-v2',
  currentVersion: 2,
  detectVersion,
  steps: {
    0: (v) => {
      if (!knownFood(v, 0, decodeCompatibleRecipeIngredients)) throw new Error('unknown-legacy-shape');
      const current = v as Json;
      const state = current.state as Json;
      return {
        ...current,
        state: {
          ...state,
          recipes: (state.recipes as Json[]).map((recipe) => ({
            ...recipe,
            ingredients: decodeCompatibleRecipeIngredients(recipe.ingredients),
          })),
        },
        version: 1,
      };
    },
    1: (v) => {
      if (!knownFood(v, 1, decodeRecipeIngredients)) throw new Error('unknown-legacy-shape');
      const current = v as Json;
      const state = current.state as Json;
      const pantry = decodePantryItems(state.pantryItems, true);
      if (pantry === null) throw new Error('unknown-legacy-pantry-shape');
      return {
        ...current,
        state: { ...state, pantryItems: pantry },
        version: 2,
      };
    },
  },
  validateCurrent: (v) => {
    const state = foodState(v, 2);
    return knownFood(v, 2, decodeRecipeIngredients) && decodePantryItems(state?.pantryItems) !== null;
  },
};
