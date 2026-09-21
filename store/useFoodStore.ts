import { GLOBAL_PRICE_SELECT, GLOBAL_OFFER_SELECT, decodeRows, decodeGlobalPrice, decodeGlobalOffer, decodePersonalPrice, decodePersonalOffer } from '@/utils/food/catalogueRead';
import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import { newEntityId } from '@/core/ids';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  decodeCompatibleRecipeIngredients,
  encodeRecipeIngredient,
  IngredientError,
  type NewRecipeIngredient,
} from '@/core/food/ingredients';
import { getSeedRecipesForLanguage, refreshSeedRecipes } from '@/data/seedRecipes';
import { supabase } from '@/lib/supabase';
import { trackSync, reportSyncFailure } from '@/store/useSyncStatusStore';
import i18n from '@/localization/i18n';
import { GlobalOffer, GlobalStandardPrice, GroceryOffer, GroceryPurchase, MealType, PantryItem, Recipe, SavedPlanSlot, ShoppingListItem, StandardPrice } from '@/types/food';

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

function logIfError(label: string) {
  return (result: { error: any }) => {
    trackSync('food', label, result);
  };
}

interface FoodState {
  monthlyBudgetByMonth: Record<string, number>;
  purchases: GroceryPurchase[];
  pantryItems: PantryItem[];
  shoppingItems: ShoppingListItem[];
  offers: GroceryOffer[];
  recipes: Recipe[];

  standardPrices: StandardPrice[];
  addStandardPrice: (input: { productName: string; store: string; price: number }) => void;
  removeStandardPrice: (id: string) => void;

  // Skrivebeskyttede, admin-styrede data — hentes, men kan ALDRIG redigeres fra appen.
  globalStandardPrices: GlobalStandardPrice[];
  globalOffers: GlobalOffer[];

  savedPlans: Record<string, SavedPlanSlot[]>;
  savePlan: (weekKey: string, slots: SavedPlanSlot[]) => void;

  setMonthlyBudget: (monthKey: string, amount: number) => void;
  addPurchase: (amount: number, date?: string) => void;
  removePurchase: (id: string) => void;

  addPantryItem: (input: { name: string; quantity?: string; expiryDate?: string }) => void;
  removePantryItem: (id: string) => void;

  addShoppingItem: (label: string) => void;
  toggleShoppingItem: (id: string) => void;
  removeShoppingItem: (id: string) => void;

  addOffer: (input: { productName: string; price: number; store: string; weekKey: string }) => void;
  removeOffer: (id: string) => void;

  reseedRecipesForLanguage: (language: string) => void;

  addRecipe: (input: {
    name: string;
    mealType: MealType;
    ingredients: NewRecipeIngredient[];
    minutes?: number;
    instructions?: string;
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  }) => void;
  updateRecipe: (id: string, updates: Partial<Omit<Recipe, 'id'>>) => void;
  removeRecipe: (id: string) => void;

  selectedStores: string[];
  toggleStoreSelection: (store: string) => void;

  fetchFromSupabase: () => Promise<void>;
}

// ---- row-mappere ----

function purchaseToRow(userId: string, p: GroceryPurchase) {
  return { id: p.id, user_id: userId, amount: p.amount, date: p.date };
}
function pantryItemToRow(userId: string, p: PantryItem) {
  return {
    id: p.id,
    user_id: userId,
    name: p.name,
    quantity: p.quantity ?? null,
    expiry_date: p.expiryDate ?? null,
    added_at: p.addedAt,
  };
}
function shoppingItemToRow(userId: string, i: ShoppingListItem) {
  return { id: i.id, user_id: userId, label: i.label, checked: i.checked };
}
function offerToRow(userId: string, o: GroceryOffer) {
  return { id: o.id, user_id: userId, product_name: o.productName, price: o.price, store: o.store, week_key: o.weekKey, source: o.source };
}
function standardPriceToRow(userId: string, s: StandardPrice) {
  return { id: s.id, user_id: userId, product_name: s.productName, store: s.store, price: s.price };
}
/**
 * APP-047: a new recipe carries only current-contract ingredients. Every one is
 * validated (throwing IngredientError) before any state or server write; a
 * `legacy` ingredient only ever comes from data written before APP-047.
 */
function newRecipeIngredients(ingredients: readonly NewRecipeIngredient[]): NewRecipeIngredient[] {
  return ingredients.map((ingredient) => {
    const encoded = encodeRecipeIngredient(ingredient);
    if (encoded.kind === 'legacy') throw new IngredientError('ingredient_invalid');
    return encoded;
  });
}

function recipeToRow(userId: string, r: Recipe) {
  return {
    id: r.id,
    user_id: userId,
    name: r.name,
    meal_type: r.mealType,
    ingredients: r.ingredients.map(encodeRecipeIngredient),
    minutes: r.minutes ?? null,
    instructions: r.instructions ?? null,
    calories: r.calories ?? null,
    protein: r.protein ?? null,
    carbs: r.carbs ?? null,
    fat: r.fat ?? null,
    tags: r.tags ?? [],
  };
}

export const useFoodStore = create<FoodState>()(
  persist(
    (set, get) => ({
      monthlyBudgetByMonth: {},
      purchases: [],
      pantryItems: [],
      shoppingItems: [],
      offers: [],
      recipes: [],

      standardPrices: [],
      globalStandardPrices: [],
      globalOffers: [],

      addStandardPrice: (input) => {
        const newEntry: StandardPrice = { id: newEntityId(), ...input };
        set((state) => ({ standardPrices: [...state.standardPrices, newEntry] }));
        getUserId().then((userId) => {
          if (userId) supabase.from('food_standard_prices').upsert(standardPriceToRow(userId, newEntry)).then(logIfError('addStandardPrice'));
        });
      },
      removeStandardPrice: (id) => {
        set((state) => ({ standardPrices: state.standardPrices.filter((s) => s.id !== id) }));
        getUserId().then((userId) => {
          if (userId) supabase.from('food_standard_prices').delete().eq('user_id', userId).eq('id', id).then(logIfError('removeStandardPrice'));
        });
      },

      setMonthlyBudget: (monthKey, amount) => {
        set((state) => ({
          monthlyBudgetByMonth: { ...state.monthlyBudgetByMonth, [monthKey]: amount },
        }));
        getUserId().then((userId) => {
          if (userId) supabase.from('food_monthly_budget').upsert({ user_id: userId, month_key: monthKey, amount }).then(logIfError('setMonthlyBudget'));
        });
      },

      savedPlans: {},
      savePlan: (weekKey, slots) => {
        set((state) => ({ savedPlans: { ...state.savedPlans, [weekKey]: slots } }));
        getUserId().then((userId) => {
          if (userId) supabase.from('food_saved_plans').upsert({ user_id: userId, week_key: weekKey, slots }).then(logIfError('savePlan'));
        });
      },

      addPurchase: (amount, date) => {
        const newPurchase: GroceryPurchase = { id: newEntityId(), amount, date: date ?? new Date().toISOString() };
        set((state) => ({ purchases: [...state.purchases, newPurchase] }));
        getUserId().then((userId) => {
          if (userId) supabase.from('food_purchases').upsert(purchaseToRow(userId, newPurchase)).then(logIfError('addPurchase'));
        });
      },
      removePurchase: (id) => {
        set((state) => ({ purchases: state.purchases.filter((p) => p.id !== id) }));
        getUserId().then((userId) => {
          if (userId) supabase.from('food_purchases').delete().eq('user_id', userId).eq('id', id).then(logIfError('removePurchase'));
        });
      },

      addPantryItem: (input) => {
        const newItem: PantryItem = { id: newEntityId(), addedAt: new Date().toISOString(), ...input };
        set((state) => ({ pantryItems: [...state.pantryItems, newItem] }));
        getUserId().then((userId) => {
          if (userId) supabase.from('food_pantry_items').upsert(pantryItemToRow(userId, newItem)).then(logIfError('addPantryItem'));
        });
      },
      removePantryItem: (id) => {
        set((state) => ({ pantryItems: state.pantryItems.filter((p) => p.id !== id) }));
        getUserId().then((userId) => {
          if (userId) supabase.from('food_pantry_items').delete().eq('user_id', userId).eq('id', id).then(logIfError('removePantryItem'));
        });
      },

      addShoppingItem: (label) => {
        const newItem: ShoppingListItem = { id: newEntityId(), label, checked: false };
        set((state) => ({ shoppingItems: [...state.shoppingItems, newItem] }));
        getUserId().then((userId) => {
          if (userId) supabase.from('food_shopping_items').upsert(shoppingItemToRow(userId, newItem)).then(logIfError('addShoppingItem'));
        });
      },
      toggleShoppingItem: (id) => {
        set((state) => ({
          shoppingItems: state.shoppingItems.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)),
        }));
        const target = get().shoppingItems.find((i) => i.id === id);
        if (target) {
          getUserId().then((userId) => {
            if (userId) supabase.from('food_shopping_items').upsert(shoppingItemToRow(userId, target)).then(logIfError('toggleShoppingItem'));
          });
        }
      },
      removeShoppingItem: (id) => {
        set((state) => ({ shoppingItems: state.shoppingItems.filter((i) => i.id !== id) }));
        getUserId().then((userId) => {
          if (userId) supabase.from('food_shopping_items').delete().eq('user_id', userId).eq('id', id).then(logIfError('removeShoppingItem'));
        });
      },

      addOffer: (input) => {
        const newOffer: GroceryOffer = { id: newEntityId(), source: 'manual', ...input };
        set((state) => ({ offers: [...state.offers, newOffer] }));
        getUserId().then((userId) => {
          if (userId) supabase.from('food_offers').upsert(offerToRow(userId, newOffer)).then(logIfError('addOffer'));
        });
      },
      removeOffer: (id) => {
        set((state) => ({ offers: state.offers.filter((o) => o.id !== id) }));
        getUserId().then((userId) => {
          if (userId) supabase.from('food_offers').delete().eq('user_id', userId).eq('id', id).then(logIfError('removeOffer'));
        });
      },

      addRecipe: (input) => {
        const newRecipe: Recipe = { id: newEntityId(), tags: [], ...input, ingredients: newRecipeIngredients(input.ingredients) };
        set((state) => ({ recipes: [...state.recipes, newRecipe] }));
        getUserId().then((userId) => {
          if (userId) supabase.from('food_recipes').upsert(recipeToRow(userId, newRecipe)).then(logIfError('addRecipe'));
        });
      },
      updateRecipe: (id, rawUpdates) => {
        // An edit may keep a recipe's legacy ingredients, but nothing invalid gets in.
        const updates = rawUpdates.ingredients
          ? { ...rawUpdates, ingredients: rawUpdates.ingredients.map(encodeRecipeIngredient) }
          : rawUpdates;
        set((state) => ({
          recipes: state.recipes.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        }));
        if (!id.startsWith('seed-')) {
          const target = get().recipes.find((r) => r.id === id);
          if (target) {
            getUserId().then((userId) => {
              if (userId) supabase.from('food_recipes').upsert(recipeToRow(userId, target)).then(logIfError('updateRecipe'));
            });
          }
        }
      },
      removeRecipe: (id) => {
        set((state) => ({ recipes: state.recipes.filter((r) => r.id !== id) }));
        if (!id.startsWith('seed-')) {
          getUserId().then((userId) => {
            if (userId) supabase.from('food_recipes').delete().eq('user_id', userId).eq('id', id).then(logIfError('removeRecipe'));
          });
        }
      },

      reseedRecipesForLanguage: (language) =>
        set((state) => ({ recipes: refreshSeedRecipes(state.recipes, getSeedRecipesForLanguage(language)) })),

      selectedStores: [],
      toggleStoreSelection: (store) => {
        const isRemoving = get().selectedStores.includes(store);
        set((state) => ({
          selectedStores: isRemoving
            ? state.selectedStores.filter((s) => s !== store)
            : [...state.selectedStores, store],
        }));
        getUserId().then((userId) => {
          if (!userId) return;
          if (isRemoving) {
            supabase.from('food_selected_stores').delete().eq('user_id', userId).eq('store', store).then(logIfError('toggleStoreSelection (remove)'));
          } else {
            supabase.from('food_selected_stores').upsert({ user_id: userId, store }).then(logIfError('toggleStoreSelection (add)'));
          }
        });
      },

      fetchFromSupabase: async () => {
        const userId = await getUserId();
        if (!userId) return;

        const [
          budgetResult,
          purchasesResult,
          pantryResult,
          shoppingResult,
          offersResult,
          recipesResult,
          pricesResult,
          plansResult,
          storesResult,
          globalPricesResult,
          globalOffersResult,
        ] = await Promise.all([
          supabase.from('food_monthly_budget').select('month_key, amount').eq('user_id', userId),
          supabase.from('food_purchases').select('id, amount, date').eq('user_id', userId),
          supabase.from('food_pantry_items').select('id, name, quantity, expiry_date, added_at').eq('user_id', userId),
          supabase.from('food_shopping_items').select('id, label, checked').eq('user_id', userId),
          supabase.from('food_offers').select('id, product_name, price, store, week_key, source').eq('user_id', userId),
          supabase.from('food_recipes').select('id, name, meal_type, ingredients, minutes, instructions, calories, protein, carbs, fat, tags').eq('user_id', userId),
          supabase.from('food_standard_prices').select('id, product_name, store, price').eq('user_id', userId),
          supabase.from('food_saved_plans').select('week_key, slots').eq('user_id', userId),
          supabase.from('food_selected_stores').select('store').eq('user_id', userId),
          // Globale, admin-styrede data — ingen user_id-filter, alle brugere ser samme data
          supabase.from('global_standard_prices').select(GLOBAL_PRICE_SELECT),
          supabase.from('global_offers').select(GLOBAL_OFFER_SELECT),
        ]);

        if (budgetResult.error) reportSyncFailure('food', 'budget', budgetResult.error);
        if (purchasesResult.error) reportSyncFailure('food', 'purchases', purchasesResult.error);
        if (pantryResult.error) reportSyncFailure('food', 'pantry', pantryResult.error);
        if (shoppingResult.error) reportSyncFailure('food', 'shopping', shoppingResult.error);
        if (offersResult.error) reportSyncFailure('food', 'offers', offersResult.error);
        if (recipesResult.error) reportSyncFailure('food', 'recipes', recipesResult.error);
        if (pricesResult.error) reportSyncFailure('food', 'prices', pricesResult.error);
        if (plansResult.error) reportSyncFailure('food', 'plans', plansResult.error);
        if (storesResult.error) reportSyncFailure('food', 'stores', storesResult.error);
        if (globalPricesResult.error) reportSyncFailure('food', 'global prices', globalPricesResult.error);
        if (globalOffersResult.error) reportSyncFailure('food', 'global offers', globalOffersResult.error);

        let skippedRecipeRows = 0;
        set((state) => {
          const next: Partial<FoodState> = {};

          if (!budgetResult.error && budgetResult.data) {
            const merged = { ...state.monthlyBudgetByMonth };
            for (const row of budgetResult.data) {
              if (!(row.month_key in merged)) merged[row.month_key] = Number(row.amount);
            }
            next.monthlyBudgetByMonth = merged;
          }

          if (!purchasesResult.error && purchasesResult.data) {
            const existingIds = new Set(state.purchases.map((p) => p.id));
            const fetched: GroceryPurchase[] = purchasesResult.data
              .filter((row) => !existingIds.has(row.id))
              .map((row) => ({ id: row.id, amount: Number(row.amount), date: row.date }));
            next.purchases = [...state.purchases, ...fetched];
          }

          if (!pantryResult.error && pantryResult.data) {
            const existingIds = new Set(state.pantryItems.map((p) => p.id));
            const fetched: PantryItem[] = pantryResult.data
              .filter((row) => !existingIds.has(row.id))
              .map((row) => ({
                id: row.id,
                name: row.name,
                quantity: row.quantity ?? undefined,
                expiryDate: row.expiry_date ?? undefined,
                addedAt: row.added_at,
              }));
            next.pantryItems = [...state.pantryItems, ...fetched];
          }

          if (!shoppingResult.error && shoppingResult.data) {
            const existingIds = new Set(state.shoppingItems.map((i) => i.id));
            const fetched: ShoppingListItem[] = shoppingResult.data
              .filter((row) => !existingIds.has(row.id))
              .map((row) => ({ id: row.id, label: row.label, checked: row.checked }));
            next.shoppingItems = [...state.shoppingItems, ...fetched];
          }

          if (!offersResult.error && offersResult.data) {
            const existingIds = new Set(state.offers.map((o) => o.id));
            const fetched = decodeRows(offersResult.data, decodePersonalOffer).filter((row) => !existingIds.has(row.id));
            next.offers = [...state.offers, ...fetched];
          }

          if (!recipesResult.error && recipesResult.data) {
            const existingIds = new Set(state.recipes.map((r) => r.id));
            const fetched: Recipe[] = [];
            for (const row of recipesResult.data) {
              if (existingIds.has(row.id)) continue;
              // APP-047: ingredients are validated, never cast. A row in neither the
              // current nor the pre-APP-047 shape is skipped, not guessed at; the
              // server copy is left untouched.
              const ingredients = decodeCompatibleRecipeIngredients(row.ingredients);
              if (!ingredients) {
                skippedRecipeRows += 1;
                continue;
              }
              fetched.push({
                id: row.id,
                name: row.name,
                mealType: row.meal_type as MealType,
                ingredients,
                minutes: row.minutes ?? undefined,
                instructions: row.instructions ?? undefined,
                calories: row.calories ?? undefined,
                protein: row.protein ?? undefined,
                carbs: row.carbs ?? undefined,
                fat: row.fat ?? undefined,
                tags: row.tags ?? [],
              });
            }
            next.recipes = [...state.recipes, ...fetched];
          }

          if (!pricesResult.error && pricesResult.data) {
            const existingIds = new Set(state.standardPrices.map((s) => s.id));
            const fetched = decodeRows(pricesResult.data, decodePersonalPrice).filter((row) => !existingIds.has(row.id));
            next.standardPrices = [...state.standardPrices, ...fetched];
          }

          if (!plansResult.error && plansResult.data) {
            const merged = { ...state.savedPlans };
            for (const row of plansResult.data) {
              if (!(row.week_key in merged)) merged[row.week_key] = row.slots ?? [];
            }
            next.savedPlans = merged;
          }

          if (!storesResult.error && storesResult.data) {
            const existingStores = new Set(state.selectedStores);
            const fetchedStores = storesResult.data.map((row) => row.store).filter((s) => !existingStores.has(s));
            next.selectedStores = [...state.selectedStores, ...fetchedStores];
          }

          // Globale data overskrives ALTID fuldt ud ved hentning (ikke merge) —
          // de er admin-styrede, ikke brugerens egne, så det er korrekt at altid
          // vise den nyeste, sande tilstand fra databasen.
          if (!globalPricesResult.error && globalPricesResult.data) {
            next.globalStandardPrices = decodeRows(globalPricesResult.data, decodeGlobalPrice);
          }

          if (!globalOffersResult.error && globalOffersResult.data) {
            next.globalOffers = decodeRows(globalOffersResult.data, decodeGlobalOffer);
          }

          return next;
        });
        // Privacy-safe: a fixed code, never the row or its ingredient text.
        if (skippedRecipeRows > 0) reportSyncFailure('food', 'recipes', new IngredientError('ingredient_invalid'));
      },
    }),
    {
      name: 'lifesort-food-v2',
      storage: createJSONStorage(() => migrationGatedStorage(AsyncStorage)),
      // APP-047 v1: typed recipe ingredients (core/storage/migrations/foodIngredients.ts).
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const seeds = getSeedRecipesForLanguage(i18n.language);
        // Persisted seed recipes are a cache of the bundled ones (profile D). A
        // refresh gives copies written before APP-047 — which the migration kept
        // as legacy ingredients — their families back, without inferring any.
        state.recipes = state.recipes.length === 0 ? seeds : refreshSeedRecipes(state.recipes, seeds);
      },
    }
  )
);

i18n.on('languageChanged', (lng) => {
  useFoodStore.getState().reseedRecipesForLanguage(lng);
});