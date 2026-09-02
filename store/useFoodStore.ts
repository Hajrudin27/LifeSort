import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { getSeedRecipesForLanguage } from '@/data/seedRecipes';
import { supabase } from '@/lib/supabase';
import i18n from '@/localization/i18n';
import { GlobalOffer, GlobalStandardPrice, GroceryOffer, GroceryPurchase, MealType, PantryItem, Recipe, RecipeIngredient, SavedPlanSlot, ShoppingListItem, StandardPrice } from '@/types/food';

function newId() {
  return `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

function logIfError(label: string) {
  return ({ error }: { error: any }) => {
    if (error) console.log(`Food sync error (${label}):`, error.message ?? error);
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
    ingredients: RecipeIngredient[];
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
function recipeToRow(userId: string, r: Recipe) {
  return {
    id: r.id,
    user_id: userId,
    name: r.name,
    meal_type: r.mealType,
    ingredients: r.ingredients,
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
        const newEntry: StandardPrice = { id: newId(), ...input };
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
        const newPurchase: GroceryPurchase = { id: newId(), amount, date: date ?? new Date().toISOString() };
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
        const newItem: PantryItem = { id: newId(), addedAt: new Date().toISOString(), ...input };
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
        const newItem: ShoppingListItem = { id: newId(), label, checked: false };
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
        const newOffer: GroceryOffer = { id: newId(), source: 'manual', ...input };
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
        const newRecipe: Recipe = { id: newId(), tags: [], ...input };
        set((state) => ({ recipes: [...state.recipes, newRecipe] }));
        getUserId().then((userId) => {
          if (userId) supabase.from('food_recipes').upsert(recipeToRow(userId, newRecipe)).then(logIfError('addRecipe'));
        });
      },
      updateRecipe: (id, updates) => {
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
        set((state) => {
          const seedList = getSeedRecipesForLanguage(language);
          const seedMap = new Map(seedList.map((r) => [r.id, r]));
          return {
            recipes: state.recipes.map((r) => (r.id.startsWith('seed-') && seedMap.has(r.id) ? seedMap.get(r.id)! : r)),
          };
        }),

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
          supabase.from('global_standard_prices').select('id, product_name, store, price'),
          supabase.from('global_offers').select('id, offer_price, valid_from, valid_to, standard_price:global_standard_prices(product_name, store)'),
        ]);

        if (budgetResult.error) console.log('Food fetch error (budget):', budgetResult.error.message);
        if (purchasesResult.error) console.log('Food fetch error (purchases):', purchasesResult.error.message);
        if (pantryResult.error) console.log('Food fetch error (pantry):', pantryResult.error.message);
        if (shoppingResult.error) console.log('Food fetch error (shopping):', shoppingResult.error.message);
        if (offersResult.error) console.log('Food fetch error (offers):', offersResult.error.message);
        if (recipesResult.error) console.log('Food fetch error (recipes):', recipesResult.error.message);
        if (pricesResult.error) console.log('Food fetch error (prices):', pricesResult.error.message);
        if (plansResult.error) console.log('Food fetch error (plans):', plansResult.error.message);
        if (storesResult.error) console.log('Food fetch error (stores):', storesResult.error.message);
        if (globalPricesResult.error) console.log('Food fetch error (global prices):', globalPricesResult.error.message);
        if (globalOffersResult.error) console.log('Food fetch error (global offers):', globalOffersResult.error.message);

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
            const fetched: GroceryOffer[] = offersResult.data
              .filter((row) => !existingIds.has(row.id))
              .map((row) => ({
                id: row.id,
                productName: row.product_name,
                price: Number(row.price),
                store: row.store,
                weekKey: row.week_key,
                source: (row.source as 'manual' | 'ai_import') ?? 'manual',
              }));
            next.offers = [...state.offers, ...fetched];
          }

          if (!recipesResult.error && recipesResult.data) {
            const existingIds = new Set(state.recipes.map((r) => r.id));
            const fetched: Recipe[] = recipesResult.data
              .filter((row) => !existingIds.has(row.id))
              .map((row) => ({
                id: row.id,
                name: row.name,
                mealType: row.meal_type as MealType,
                ingredients: row.ingredients ?? [],
                minutes: row.minutes ?? undefined,
                instructions: row.instructions ?? undefined,
                calories: row.calories ?? undefined,
                protein: row.protein ?? undefined,
                carbs: row.carbs ?? undefined,
                fat: row.fat ?? undefined,
                tags: row.tags ?? [],
              }));
            next.recipes = [...state.recipes, ...fetched];
          }

          if (!pricesResult.error && pricesResult.data) {
            const existingIds = new Set(state.standardPrices.map((s) => s.id));
            const fetched: StandardPrice[] = pricesResult.data
              .filter((row) => !existingIds.has(row.id))
              .map((row) => ({ id: row.id, productName: row.product_name, store: row.store, price: Number(row.price) }));
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
            next.globalStandardPrices = globalPricesResult.data.map((row: any) => ({
              id: row.id,
              productName: row.product_name,
              store: row.store,
              price: Number(row.price),
            }));
          }

          if (!globalOffersResult.error && globalOffersResult.data) {
            next.globalOffers = (globalOffersResult.data as any[])
              .filter((row) => row.standard_price)
              .map((row) => ({
                id: row.id,
                productName: row.standard_price.product_name,
                store: row.standard_price.store,
                offerPrice: Number(row.offer_price),
                validFrom: row.valid_from,
                validTo: row.valid_to,
              }));
          }

          return next;
        });
      },
    }),
    {
      name: 'lifesort-food-v2',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.recipes.length === 0) {
          state.recipes = getSeedRecipesForLanguage(i18n.language);
        }
      },
    }
  )
);

i18n.on('languageChanged', (lng) => {
  useFoodStore.getState().reseedRecipesForLanguage(lng);
});