import { isIngredientFamilyId, type IngredientFamilyId } from '@/core/food/ingredients';

/**
 * APP-047: substitution support between ingredient families.
 *
 * A registry states, for a family, which families may replace it. Entries are
 * directed: where both directions hold, both are written. The resolver below is
 * pure and answers only what a registry states — no symmetry, transitivity, name
 * similarity, retailer products, AI or nutritional reasoning is derived, and an
 * unregistered family has no substitutes.
 *
 * LifeSort's own registry is deliberately EMPTY. Which ingredient may stand in
 * for which is product content: neither the master specification nor APP-047
 * defines any relationship, and inventing culinary or dietary claims in code is
 * not this story's job. APP-047 ships the mechanism; the registry stays empty
 * until authoritative substitution data exists (see ADR-0038).
 */
export type IngredientSubstitutionRegistry = Readonly<Partial<Record<IngredientFamilyId, readonly IngredientFamilyId[]>>>;

const NONE: readonly IngredientFamilyId[] = Object.freeze([]);

/** LifeSort's registered substitutions: none yet. */
export const INGREDIENT_SUBSTITUTIONS: IngredientSubstitutionRegistry = Object.freeze({});

/** What a registry states for a family, in its own order. Anything unregistered has none. */
export function substitutesIn(
  registry: IngredientSubstitutionRegistry,
  familyId: IngredientFamilyId,
): readonly IngredientFamilyId[] {
  if (!isIngredientFamilyId(familyId) || !Object.prototype.hasOwnProperty.call(registry, familyId)) return NONE;
  return registry[familyId] ?? NONE;
}

/** Whether a registry states `candidate` as a substitute for `familyId`. */
export function isSubstituteIn(
  registry: IngredientSubstitutionRegistry,
  familyId: IngredientFamilyId,
  candidate: IngredientFamilyId,
): boolean {
  return substitutesIn(registry, familyId).includes(candidate);
}

/** The substitutes LifeSort states for a family today: none. */
export function substitutesFor(familyId: IngredientFamilyId): readonly IngredientFamilyId[] {
  return substitutesIn(INGREDIENT_SUBSTITUTIONS, familyId);
}

/** Whether LifeSort states `candidate` as a substitute for `familyId` today: it states none. */
export function isRegisteredSubstitute(familyId: IngredientFamilyId, candidate: IngredientFamilyId): boolean {
  return isSubstituteIn(INGREDIENT_SUBSTITUTIONS, familyId, candidate);
}
