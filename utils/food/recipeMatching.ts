import { GroceryOffer, RecipeIngredient } from '@/types/food';

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export function findMatchingOffers(ingredientName: string, offers: GroceryOffer[]): GroceryOffer[] {
  const norm = normalize(ingredientName);
  if (norm.length === 0) return [];
  return offers.filter((o) => {
    const productNorm = normalize(o.productName);
    return productNorm.includes(norm) || norm.includes(productNorm);
  });
}

export function cheapestOffer(offers: GroceryOffer[]): GroceryOffer | null {
  if (offers.length === 0) return null;
  return [...offers].sort((a, b) => a.price - b.price)[0];
}

export interface IngredientMatch {
  ingredientName: string;
  ingredient: RecipeIngredient;
  offer: GroceryOffer | null;
}

// Offers are still matched on the ingredient's display name, as before APP-047.
// Family-aware offer matching belongs to APP-053 and must not be bridged here.
export function matchRecipeIngredients(ingredients: RecipeIngredient[], weekOffers: GroceryOffer[]): IngredientMatch[] {
  return ingredients.map((ing) => ({
    ingredientName: ing.name,
    ingredient: ing,
    offer: cheapestOffer(findMatchingOffers(ing.name, weekOffers)),
  }));
}

export function groupMatchesByStore(matches: IngredientMatch[]): { store: string; ingredients: string[] }[] {
  const byStore = new Map<string, string[]>();
  for (const m of matches) {
    if (!m.offer) continue;
    const list = byStore.get(m.offer.store) ?? [];
    list.push(m.ingredientName);
    byStore.set(m.offer.store, list);
  }
  return Array.from(byStore.entries()).map(([store, ingredients]) => ({ store, ingredients }));
}