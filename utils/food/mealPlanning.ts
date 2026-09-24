import { summarizePrices, usablePrice, type PriceEvidence, type PriceEstimate } from './priceEvidence';
import { GlobalOffer, GlobalStandardPrice, MealType, PantryItem, Recipe } from '@/types/food';
import { findBestGlobalPrice } from '@/utils/food/priceLookup';

const MEAL_SLOTS: MealType[] = ['breakfast', 'lunch', 'dinner'];
const MAX_REPEATS = 3;

export interface PlannedSlot {
  day: number;
  mealType: MealType;
  recipe: Recipe | null;
  locked: boolean;
}

export type ShoppingListEntry = { ingredientName: string; evidence: PriceEvidence };
export type PantryEntry = { ingredientName: string; source: 'pantry' };
type PlanEntry = ShoppingListEntry | PantryEntry;

export interface StoreTotal {
  store: string;
  estimate: PriceEstimate;
  items: ShoppingListEntry[];
}

export interface WeekPlan {
  slots: PlannedSlot[];
  shoppingList: ShoppingListEntry[];
  pantryCovered: PantryEntry[];
  storeTotals: StoreTotal[];
  estimate: PriceEstimate;
}

function slotKey(day: number, mealType: MealType): string {
  return `${day}-${mealType}`;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function ingredientKey(ingredient: Recipe['ingredients'][number]): string {
  return ingredient.kind === 'family' ? `family:${ingredient.familyId}:${ingredient.unit}` : `${ingredient.kind}:${normalize(ingredient.name)}`;
}

function isInPantry(ingredientName: string, pantryItems: PantryItem[]): boolean {
  const norm = normalize(ingredientName);
  return pantryItems.some((p) => {
    const pn = normalize(p.name);
    return pn.includes(norm) || norm.includes(pn);
  });
}

function marginalPrice(
  recipe: Recipe,
  purchased: Map<string, PlanEntry>,
  pantryItems: PantryItem[],
  globalOffers: GlobalOffer[],
  globalStandardPrices: GlobalStandardPrice[],
  selectedStores: string[],
  reference: Date
): number {
  let total = 0;
  for (const ing of recipe.ingredients) {
    const key = ingredientKey(ing);
    if (purchased.has(key)) continue;
    if (isInPantry(ing.name, pantryItems)) continue;
    const match = findBestGlobalPrice(ing, globalOffers, globalStandardPrices, selectedStores, reference);
    const price = usablePrice(match);
    if (price !== null) total += price; // Internal ranking uses a known subtotal, never a complete cost.
  }
  return total;
}

function recordIngredients(
  recipe: Recipe,
  purchased: Map<string, PlanEntry>,
  pantryItems: PantryItem[],
  globalOffers: GlobalOffer[],
  globalStandardPrices: GlobalStandardPrice[],
  selectedStores: string[],
  reference: Date
) {
  for (const ing of recipe.ingredients) {
    const key = ingredientKey(ing);
    if (purchased.has(key)) continue;

    if (isInPantry(ing.name, pantryItems)) {
      purchased.set(key, { ingredientName: ing.name, source: 'pantry' });
      continue;
    }

    const match = findBestGlobalPrice(ing, globalOffers, globalStandardPrices, selectedStores, reference);
    purchased.set(key, {
      ingredientName: ing.name,
      evidence: match,
    });
  }
}

export function groupShoppingListByStore(list: ShoppingListEntry[]): StoreTotal[] {
  const byStore = new Map<string, ShoppingListEntry[]>();
  for (const entry of list) {
    if (entry.evidence.source === 'unavailable') continue;
    const store = entry.evidence.store;
    const arr = byStore.get(store) ?? [];
    arr.push(entry);
    byStore.set(store, arr);
  }
  return Array.from(byStore.entries()).map(([store, items]) => ({
    store,
    estimate: summarizePrices(items.map((item) => item.evidence)),
    items,
  }));
}

export function planWeek(
  recipes: Recipe[],
  globalOffers: GlobalOffer[],
  globalStandardPrices: GlobalStandardPrice[],
  selectedStores: string[],
  pantryItems: PantryItem[],
  /** Remaining weekly Food allocation; null means no budget was set. */
  remainingWeeklyBudget: number | null,
  lockedSlots: Record<string, string> = {},
  reference: Date = new Date()
): WeekPlan {
  const purchased = new Map<string, PlanEntry>();
  const usageCount = new Map<string, number>();
  const slots: PlannedSlot[] = [];
  let runningTotal = 0;

  for (let day = 0; day < 7; day++) {
    for (const mealType of MEAL_SLOTS) {
      const lockedId = lockedSlots[slotKey(day, mealType)];
      if (!lockedId) continue;
      const recipe = recipes.find((r) => r.id === lockedId);
      if (!recipe) continue;

      const cost = marginalPrice(recipe, purchased, pantryItems, globalOffers, globalStandardPrices, selectedStores, reference);
      runningTotal += cost;
      usageCount.set(recipe.id, (usageCount.get(recipe.id) ?? 0) + 1);
      recordIngredients(recipe, purchased, pantryItems, globalOffers, globalStandardPrices, selectedStores, reference);
      slots.push({ day, mealType, recipe, locked: true });
    }
  }

  for (let day = 0; day < 7; day++) {
    for (const mealType of MEAL_SLOTS) {
      const key = slotKey(day, mealType);
      if (lockedSlots[key]) continue;

      const candidates = recipes.filter(
        (r) => r.mealType === mealType && (usageCount.get(r.id) ?? 0) < MAX_REPEATS
      );

      let best: { recipe: Recipe; cost: number } | null = null;
      for (const candidate of candidates) {
        const cost = marginalPrice(candidate, purchased, pantryItems, globalOffers, globalStandardPrices, selectedStores, reference);
        if (remainingWeeklyBudget !== null && runningTotal + cost > remainingWeeklyBudget) continue;
        if (!best || cost < best.cost) best = { recipe: candidate, cost };
      }

      if (best) {
        runningTotal += best.cost;
        usageCount.set(best.recipe.id, (usageCount.get(best.recipe.id) ?? 0) + 1);
        recordIngredients(best.recipe, purchased, pantryItems, globalOffers, globalStandardPrices, selectedStores, reference);
        slots.push({ day, mealType, recipe: best.recipe, locked: false });
      } else {
        slots.push({ day, mealType, recipe: null, locked: false });
      }
    }
  }

  slots.sort((a, b) => a.day - b.day || MEAL_SLOTS.indexOf(a.mealType) - MEAL_SLOTS.indexOf(b.mealType));

  return pricePlan(slots, globalOffers, globalStandardPrices, selectedStores, pantryItems, reference);
}
/** Re-evaluate evidence without changing the user's chosen plan or empty slots. */
export function pricePlan(slots: PlannedSlot[], offers: GlobalOffer[], standards: GlobalStandardPrice[], stores: string[], pantry: PantryItem[], reference: Date): WeekPlan {
  const purchased = new Map<string, PlanEntry>();
  for (const slot of slots) {
    if (slot.recipe) recordIngredients(slot.recipe, purchased, pantry, offers, standards, stores, reference);
  }
  const entries = [...purchased.values()];
  const shoppingList = entries.filter((entry): entry is ShoppingListEntry => 'evidence' in entry);
  return { slots, shoppingList, pantryCovered: entries.filter((entry): entry is PantryEntry => 'source' in entry),
    storeTotals: groupShoppingListByStore(shoppingList), estimate: summarizePrices(shoppingList.map((entry) => entry.evidence)) };
}
