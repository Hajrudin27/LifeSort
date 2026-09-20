import { execFileSync } from 'child_process';

import { decodeRecipeIngredient, INGREDIENT_FAMILY_IDS, type FamilyRecipeIngredient } from '@/core/food/ingredients';
import { getSeedRecipesForLanguage, refreshSeedRecipes } from '@/data/seedRecipes';
import { SEED_RECIPES_DA } from '@/data/seedRecipes.da';
import { SEED_RECIPES_EN } from '@/data/seedRecipes.en';
import type { Recipe } from '@/types/food';

/**
 * APP-047: the bundled DA and EN seed recipes use the canonical ingredient
 * contract. Equivalent ingredients share one family ID, and the visible recipe
 * content is exactly what shipped before APP-047.
 */

const family = (recipes: Recipe[]) => recipes.flatMap((recipe) => recipe.ingredients as FamilyRecipeIngredient[]);

describe('APP-047 seed recipes', () => {
  it('link every ingredient to a family with a structured quantity and unit', () => {
    for (const ingredient of [...family(SEED_RECIPES_DA), ...family(SEED_RECIPES_EN)]) {
      expect(ingredient.kind).toBe('family');
      expect(decodeRecipeIngredient(ingredient)).toEqual(ingredient);
      expect(ingredient).not.toHaveProperty('amount');
    }
  });

  it('share family ID, quantity and unit between Danish and English, ingredient by ingredient', () => {
    expect(SEED_RECIPES_EN.map((r) => r.id)).toEqual(SEED_RECIPES_DA.map((r) => r.id));
    SEED_RECIPES_DA.forEach((da, index) => {
      const en = SEED_RECIPES_EN[index];
      const identity = (recipe: Recipe) => family([recipe]).map(({ familyId, quantity, unit }) => [familyId, quantity, unit]);
      expect([da.id, identity(en)]).toEqual([da.id, identity(da)]);
    });
  });

  it('keep presentation localized while identity is shared', () => {
    const egg = (recipes: Recipe[]) => family(recipes).find((ingredient) => ingredient.familyId === 'egg')!;
    expect([egg(SEED_RECIPES_DA).name, egg(SEED_RECIPES_EN).name]).toEqual(['Æg', 'Eggs']);
  });

  it('need every catalogue family, and no family outside it', () => {
    const used = new Set(family([...SEED_RECIPES_DA, ...SEED_RECIPES_EN]).map((ingredient) => ingredient.familyId));
    expect([...used].sort()).toEqual([...INGREDIENT_FAMILY_IDS].sort());
  });

  it.each([
    ['da', 'data/seedRecipes.da.ts', SEED_RECIPES_DA, 'stk'],
    ['en', 'data/seedRecipes.en.ts', SEED_RECIPES_EN, 'pcs'],
  ] as const)('(%s) keep the exact names and amounts that shipped before APP-047', (_language, file, recipes, pieceToken) => {
    // The last pre-APP-047 build. Needs repository history, like the migration fixtures.
    const before = execFileSync('git', ['show', `5c85adc:${file}`], { encoding: 'utf8' });
    const shipped = [...before.matchAll(/\{ name: '([^']*)', amount: '([^']*)' \}/g)].map((match) => [match[1], match[2]]);
    const token = { g: 'g', ml: 'ml', piece: pieceToken } as const;
    const now = family(recipes).map((ingredient) => [ingredient.name, `${ingredient.quantity} ${token[ingredient.unit]}`]);
    expect(shipped.length).toBeGreaterThan(150);
    expect(now).toEqual(shipped);
  });
});

describe('APP-047 seed refresh', () => {
  const legacySeed: Recipe = {
    id: 'seed-3', name: 'Æg på rugbrød', mealType: 'breakfast',
    ingredients: [{ kind: 'legacy', name: 'Æg', amount: '3 stk' }],
  };
  const userRecipe: Recipe = {
    id: 'user-1', name: 'Synthetic soup', mealType: 'dinner',
    ingredients: [{ kind: 'legacy', name: 'Æg', amount: '2 stk' }],
  };

  it('replaces a persisted seed copy with the bundled one and leaves user recipes alone', () => {
    const refreshed = refreshSeedRecipes([legacySeed, userRecipe], getSeedRecipesForLanguage('da'));
    expect(refreshed[0]).toBe(SEED_RECIPES_DA.find((recipe) => recipe.id === 'seed-3'));
    expect(refreshed[0].ingredients[0]).toEqual({ kind: 'family', familyId: 'egg', name: 'Æg', quantity: 3, unit: 'piece' });
    // A user's legacy ingredient with a seed's exact name is not given a family.
    expect(refreshed[1]).toBe(userRecipe);
  });

  it('keeps a removed seed removed and an unknown seed id untouched', () => {
    const unknown: Recipe = { ...legacySeed, id: 'seed-999' };
    expect(refreshSeedRecipes([unknown], getSeedRecipesForLanguage('en'))).toEqual([unknown]);
    expect(refreshSeedRecipes([], getSeedRecipesForLanguage('en'))).toEqual([]);
  });
});
