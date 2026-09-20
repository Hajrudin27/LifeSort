import { INGREDIENT_FAMILY_IDS, isIngredientFamilyId, type IngredientFamilyId } from '@/core/food/ingredients';
import {
  INGREDIENT_SUBSTITUTIONS,
  isRegisteredSubstitute,
  isSubstituteIn,
  substitutesFor,
  substitutesIn,
  type IngredientSubstitutionRegistry,
} from '@/features/food/ingredientSubstitutions';

/**
 * APP-047: substitutions are explicit relationships between family IDs, and the
 * resolver derives nothing beyond what a registry states.
 *
 * The mechanism is exercised against a TEST registry below. It is a fixture, not
 * a claim about food: LifeSort's own registry states no relationships until
 * authoritative substitution data exists (ADR-0038).
 */

const A: IngredientFamilyId = 'egg';
const B: IngredientFamilyId = 'egg-white';
const C: IngredientFamilyId = 'skyr';
const D: IngredientFamilyId = 'oats';

/** Synthetic relationships: A → B (one way), and C ↔ D written in both directions. */
const fixture: IngredientSubstitutionRegistry = Object.freeze({
  [A]: Object.freeze([B]),
  [C]: Object.freeze([D]),
  [D]: Object.freeze([C]),
});

describe('APP-047 substitution resolution', () => {
  it('answers with exactly what the registry states, in its order', () => {
    expect(substitutesIn(fixture, A)).toEqual([B]);
    expect(substitutesIn(fixture, C)).toEqual([D]);
    expect(isSubstituteIn(fixture, A, B)).toBe(true);
    expect(isSubstituteIn(fixture, D, C)).toBe(true);
  });

  it('is deterministic: the same question gives the same answer every time', () => {
    for (const family of INGREDIENT_FAMILY_IDS) {
      expect(substitutesIn(fixture, family)).toBe(substitutesIn(fixture, family));
      expect(substitutesIn(fixture, family)).toEqual(fixture[family] ?? []);
    }
  });

  it('invents nothing for an unregistered relationship', () => {
    // Not written at all.
    expect(substitutesIn(fixture, B)).toEqual([]);
    // A → B is written; the reverse is not, so it does not hold.
    expect(isSubstituteIn(fixture, B, A)).toBe(false);
    // Similar names and substrings are not relationships.
    expect(isSubstituteIn(fixture, A, 'egg-noodles')).toBe(false);
    // Nothing substitutes itself unless a registry says so.
    expect(isSubstituteIn(fixture, A, A)).toBe(false);
  });

  it('derives no transitivity', () => {
    const chain: IngredientSubstitutionRegistry = Object.freeze({ [A]: Object.freeze([B]), [B]: Object.freeze([C]) });
    expect(substitutesIn(chain, A)).toEqual([B]);
    expect(isSubstituteIn(chain, A, C)).toBe(false);
  });

  it('answers nothing for input outside the family catalogue', () => {
    for (const value of ['Æg', 'Eggs', 'EGG', 'constructor', '__proto__', '', 'egg-large']) {
      expect(substitutesIn(fixture, value as IngredientFamilyId)).toEqual([]);
      expect(isSubstituteIn(fixture, value as IngredientFamilyId, B)).toBe(false);
    }
  });

  it('reads an empty registry without inventing anything', () => {
    for (const family of INGREDIENT_FAMILY_IDS) expect(substitutesIn(Object.freeze({}), family)).toEqual([]);
  });
});

describe("APP-047 LifeSort's own registry", () => {
  it('states no substitution relationships: APP-047 ships the mechanism, not the content', () => {
    expect(Object.keys(INGREDIENT_SUBSTITUTIONS)).toEqual([]);
    for (const family of INGREDIENT_FAMILY_IDS) {
      expect([family, substitutesFor(family)]).toEqual([family, []]);
      for (const candidate of INGREDIENT_FAMILY_IDS) {
        expect(isRegisteredSubstitute(family, candidate)).toBe(false);
      }
    }
  });

  it('is immutable, and a lookup never hands out a mutable list', () => {
    expect(Object.isFrozen(INGREDIENT_SUBSTITUTIONS)).toBe(true);
    expect(Object.isFrozen(substitutesFor('egg'))).toBe(true);
  });

  /** The shape rule real data must satisfy when it arrives. Vacuous while the registry is empty. */
  it('would relate only catalogue IDs, never a family to itself, without duplicates', () => {
    for (const registry of [INGREDIENT_SUBSTITUTIONS, fixture]) {
      for (const [family, substitutes] of Object.entries(registry) as [IngredientFamilyId, readonly IngredientFamilyId[]][]) {
        expect(isIngredientFamilyId(family)).toBe(true);
        expect(substitutes.length).toBeGreaterThan(0);
        expect(new Set(substitutes).size).toBe(substitutes.length);
        for (const substitute of substitutes) {
          expect(isIngredientFamilyId(substitute)).toBe(true);
          expect(substitute).not.toBe(family);
        }
      }
    }
  });
});
