import { SEED_RECIPES_DA } from '@/data/seedRecipes.da';
import { SEED_RECIPES_EN } from '@/data/seedRecipes.en';
import { Recipe } from '@/types/food';

export function getSeedRecipesForLanguage(language: string): Recipe[] {
  return language === 'da' ? SEED_RECIPES_DA : SEED_RECIPES_EN;
}

/**
 * Replaces every seed recipe still in `recipes` with its bundled version. A seed
 * the user removed stays removed, and the user's own recipes are untouched.
 */
export function refreshSeedRecipes(recipes: Recipe[], seeds: Recipe[]): Recipe[] {
  const seedMap = new Map(seeds.map((r) => [r.id, r]));
  return recipes.map((r) => (r.id.startsWith('seed-') ? seedMap.get(r.id) ?? r : r));
}
