export interface GroceryPurchase {
  id: string;
  amount: number;
  date: string;
}

export interface PantryItem {
  id: string;
  name: string;
  quantity?: string;
  expiryDate?: string;
  addedAt: string;
}

export interface ShoppingListItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface GroceryOffer {
  id: string;
  productName: string;
  price: number;
  store: string;
  weekKey: string;
  source: 'manual' | 'ai_import'; // internt felt — vises aldrig i UI, forbereder fremtidig AI-import
}

export type MealType = 'breakfast' | 'lunch' | 'dinner';

export interface RecipeIngredient {
  name: string;
  amount: string;
}

export interface Recipe {
  id: string;
  name: string;
  mealType: MealType;
  ingredients: RecipeIngredient[];
  minutes?: number;
  instructions?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  tags?: string[];
}

export interface StandardPrice {
  id: string;
  productName: string;
  store: string;
  price: number;
}

export interface SavedPlanSlot {
  day: number;
  mealType: MealType;
  recipeId: string | null;
}

export interface GlobalStandardPrice {
  id: string;
  productName: string;
  store: string;
  price: number;
}

export interface GlobalOffer {
  id: string;
  productName: string;
  store: string;
  offerPrice: number;
  validFrom: string; // ISO-dato
  validTo: string;   // ISO-dato
}