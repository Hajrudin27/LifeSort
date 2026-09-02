import { SEED_RECIPES_DA } from '@/data/seedRecipes.da';
import { SEED_RECIPES_EN } from '@/data/seedRecipes.en';
import { Recipe } from '@/types/food';

export function getSeedRecipesForLanguage(language: string): Recipe[] {
  return language === 'da' ? SEED_RECIPES_DA : SEED_RECIPES_EN;
}