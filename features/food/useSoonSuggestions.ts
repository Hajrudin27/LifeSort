import type { PantryItem } from '@/core/food/pantry';
import type { Recipe } from '@/types/food';
import { daysBetweenIso, parseCalendarDate } from '@/utils/shared/localDate';

export const USE_SOON_DAYS = 3;

export type DatedPantryItem = {
  item: PantryItem;
  expiryDate: string;
  daysUntilExpiry: number;
};

export type UseSoonSuggestion = {
  recipe: Recipe;
  matchedUseSoonItems: DatedPantryItem[];
  otherPantryMatchedIngredients: { ingredientName: string; pantryItems: PantryItem[] }[];
  earliestExpiryDate: string;
  daysUntilEarliestExpiry: number;
  notConfirmedIngredientCount: number;
};

export type UseSoonReadModel = {
  useSoonItems: DatedPantryItem[];
  pastExpiryItems: DatedPantryItem[];
  suggestions: UseSoonSuggestion[];
};

const normalizeName = (name: string) => name.trim().toLowerCase();
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const compareDatedItems = (a: DatedPantryItem, b: DatedPantryItem) =>
  compareText(a.expiryDate, b.expiryDate) || compareText(a.item.name, b.item.name) || compareText(a.item.id, b.item.id);

/** Only registered expiry dates and exact display names contribute evidence. */
export function useSoonSuggestions({ pantryItems, recipes, referenceDate }: {
  pantryItems: readonly PantryItem[];
  recipes: readonly Recipe[];
  referenceDate: string;
}): UseSoonReadModel {
  if (!parseCalendarDate(referenceDate)) throw new Error('Invalid referenceDate');

  const useSoonItems: DatedPantryItem[] = [];
  const pastExpiryItems: DatedPantryItem[] = [];
  const otherPantryByName = new Map<string, PantryItem[]>();
  const addOtherPantryItem = (item: PantryItem) => {
    const key = normalizeName(item.name);
    if (!key) return;
    const matches = otherPantryByName.get(key) ?? [];
    matches.push(item);
    otherPantryByName.set(key, matches);
  };
  for (const item of pantryItems) {
    if (!item.expiryDate) {
      addOtherPantryItem(item);
      continue;
    }
    if (!parseCalendarDate(item.expiryDate)) continue;
    const daysUntilExpiry = daysBetweenIso(referenceDate, item.expiryDate);
    const dated = { item, expiryDate: item.expiryDate, daysUntilExpiry };
    if (daysUntilExpiry < 0) pastExpiryItems.push(dated);
    else if (daysUntilExpiry <= USE_SOON_DAYS) useSoonItems.push(dated);
    else addOtherPantryItem(item);
  }
  useSoonItems.sort(compareDatedItems);
  pastExpiryItems.sort(compareDatedItems);

  const byName = new Map<string, DatedPantryItem[]>();
  for (const dated of useSoonItems) {
    const key = normalizeName(dated.item.name);
    if (!key) continue;
    const matches = byName.get(key) ?? [];
    matches.push(dated);
    byName.set(key, matches);
  }

  const seenRecipes = new Set<string>();
  const suggestions: UseSoonSuggestion[] = [];
  for (const recipe of recipes) {
    if (seenRecipes.has(recipe.id)) continue;
    seenRecipes.add(recipe.id);
    const matched = new Map<string, DatedPantryItem>();
    const otherPantryMatchedIngredients: UseSoonSuggestion['otherPantryMatchedIngredients'] = [];
    let notConfirmedIngredientCount = 0;
    for (const ingredient of recipe.ingredients) {
      const key = normalizeName(ingredient.name);
      const items = byName.get(key);
      if (!items?.length) {
        const otherItems = otherPantryByName.get(key);
        if (otherItems?.length) otherPantryMatchedIngredients.push({ ingredientName: ingredient.name, pantryItems: otherItems });
        else notConfirmedIngredientCount++;
        continue;
      }
      for (const dated of items) matched.set(dated.item.id, dated);
    }
    if (!matched.size) continue;
    const matchedUseSoonItems = [...matched.values()].sort(compareDatedItems);
    suggestions.push({
      recipe,
      matchedUseSoonItems,
      otherPantryMatchedIngredients,
      earliestExpiryDate: matchedUseSoonItems[0].expiryDate,
      daysUntilEarliestExpiry: matchedUseSoonItems[0].daysUntilExpiry,
      notConfirmedIngredientCount,
    });
  }
  suggestions.sort((a, b) =>
    compareText(a.earliestExpiryDate, b.earliestExpiryDate) ||
    b.matchedUseSoonItems.length - a.matchedUseSoonItems.length ||
    compareText(a.recipe.name, b.recipe.name) || compareText(a.recipe.id, b.recipe.id));

  return { useSoonItems, pastExpiryItems, suggestions };
}
