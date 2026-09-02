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

export interface ShoppingListEntry {
  ingredientName: string;
  price: number | null;
  store: string | null;
  source: 'offer' | 'standard' | 'unknown' | 'pantry';
}

export interface StoreTotal {
  store: string;
  total: number;
  items: ShoppingListEntry[];
}

export interface WeekPlan {
  slots: PlannedSlot[];
  shoppingList: ShoppingListEntry[];
  pantryCovered: ShoppingListEntry[];
  storeTotals: StoreTotal[];
  totalPrice: number;
}

function slotKey(day: number, mealType: MealType): string {
  return `${day}-${mealType}`;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
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
  purchased: Map<string, ShoppingListEntry>,
  pantryItems: PantryItem[],
  globalOffers: GlobalOffer[],
  globalStandardPrices: GlobalStandardPrice[],
  selectedStores: string[]
): number {
  let total = 0;
  for (const ing of recipe.ingredients) {
    const key = normalize(ing.name);
    if (purchased.has(key)) continue;
    if (isInPantry(ing.name, pantryItems)) continue;
    const match = findBestGlobalPrice(ing.name, globalOffers, globalStandardPrices, selectedStores);
    if (match) total += match.price;
  }
  return total;
}

function recordIngredients(
  recipe: Recipe,
  purchased: Map<string, ShoppingListEntry>,
  pantryItems: PantryItem[],
  globalOffers: GlobalOffer[],
  globalStandardPrices: GlobalStandardPrice[],
  selectedStores: string[]
) {
  for (const ing of recipe.ingredients) {
    const key = normalize(ing.name);
    if (purchased.has(key)) continue;

    if (isInPantry(ing.name, pantryItems)) {
      purchased.set(key, { ingredientName: ing.name, price: null, store: null, source: 'pantry' });
      continue;
    }

    const match = findBestGlobalPrice(ing.name, globalOffers, globalStandardPrices, selectedStores);
    purchased.set(key, {
      ingredientName: ing.name,
      price: match?.price ?? null,
      store: match?.store ?? null,
      source: match?.source ?? 'unknown',
    });
  }
}

export function groupShoppingListByStore(list: ShoppingListEntry[]): StoreTotal[] {
  const byStore = new Map<string, ShoppingListEntry[]>();
  for (const entry of list) {
    if (!entry.store) continue;
    const arr = byStore.get(entry.store) ?? [];
    arr.push(entry);
    byStore.set(entry.store, arr);
  }
  return Array.from(byStore.entries()).map(([store, items]) => ({
    store,
    total: items.reduce((sum, i) => sum + (i.price ?? 0), 0),
    items,
  }));
}

export function planWeek(
  recipes: Recipe[],
  globalOffers: GlobalOffer[],
  globalStandardPrices: GlobalStandardPrice[],
  selectedStores: string[],
  pantryItems: PantryItem[],
  weeklyBudget: number,
  lockedSlots: Record<string, string> = {}
): WeekPlan {
  const purchased = new Map<string, ShoppingListEntry>();
  const usageCount = new Map<string, number>();
  const slots: PlannedSlot[] = [];
  let runningTotal = 0;

  for (let day = 0; day < 7; day++) {
    for (const mealType of MEAL_SLOTS) {
      const lockedId = lockedSlots[slotKey(day, mealType)];
      if (!lockedId) continue;
      const recipe = recipes.find((r) => r.id === lockedId);
      if (!recipe) continue;

      const cost = marginalPrice(recipe, purchased, pantryItems, globalOffers, globalStandardPrices, selectedStores);
      runningTotal += cost;
      usageCount.set(recipe.id, (usageCount.get(recipe.id) ?? 0) + 1);
      recordIngredients(recipe, purchased, pantryItems, globalOffers, globalStandardPrices, selectedStores);
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
        const cost = marginalPrice(candidate, purchased, pantryItems, globalOffers, globalStandardPrices, selectedStores);
        if (runningTotal + cost > weeklyBudget) continue;
        if (!best || cost < best.cost) best = { recipe: candidate, cost };
      }

      if (best) {
        runningTotal += best.cost;
        usageCount.set(best.recipe.id, (usageCount.get(best.recipe.id) ?? 0) + 1);
        recordIngredients(best.recipe, purchased, pantryItems, globalOffers, globalStandardPrices, selectedStores);
        slots.push({ day, mealType, recipe: best.recipe, locked: false });
      } else {
        slots.push({ day, mealType, recipe: null, locked: false });
      }
    }
  }

  slots.sort((a, b) => a.day - b.day || MEAL_SLOTS.indexOf(a.mealType) - MEAL_SLOTS.indexOf(b.mealType));

  const allEntries = Array.from(purchased.values());
  const shoppingList = allEntries.filter((e) => e.source !== 'pantry');
  const pantryCovered = allEntries.filter((e) => e.source === 'pantry');

  return {
    slots,
    shoppingList,
    pantryCovered,
    storeTotals: groupShoppingListByStore(shoppingList),
    totalPrice: runningTotal,
  };
}