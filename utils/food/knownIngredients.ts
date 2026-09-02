import { Recipe } from '@/types/food';

export function getKnownIngredientNames(recipes: Recipe[]): string[] {
  const set = new Set<string>();
  for (const r of recipes) {
    for (const ing of r.ingredients) {
      const trimmed = ing.name.trim();
      if (trimmed.length > 0) set.add(trimmed);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'da'));
}