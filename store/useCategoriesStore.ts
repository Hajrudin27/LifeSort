import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { supabase } from "@/lib/supabase";

export interface Category {
  id: string;
  isBuiltIn: boolean; // true = "subscription"/"bill"/"other", false = brugeroprettet
}

interface CategoriesState {
  categories: Category[];
  addCategory: (name: string) => string; // returnerer id'et, klar til at blive valgt med det samme
  fetchFromSupabase: () => Promise<void>;
}

const BUILT_IN: Category[] = [
  { id: "subscription", isBuiltIn: true },
  { id: "bill", isBuiltIn: true },
  { id: "other", isBuiltIn: true },
];

async function syncCategoryToSupabase(category: Category) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;

  await supabase.from("categories").insert({
    id: category.id,
    user_id: userId,
    is_built_in: category.isBuiltIn,
  });
}

export const useCategoriesStore = create<CategoriesState>()(
  persist(
    (set, get) => ({
      categories: BUILT_IN,

      addCategory: (name) => {
        const trimmed = name.trim();
        const existing = get().categories.find(
          (c) => !c.isBuiltIn && c.id.toLowerCase() === trimmed.toLowerCase(),
        );
        if (existing) return existing.id; // undgå dubletter, fx "Mad" oprettet to gange
        const newCategory: Category = { id: trimmed, isBuiltIn: false };
        set((state) => ({ categories: [...state.categories, newCategory] }));
        syncCategoryToSupabase(newCategory);
        return newCategory.id;
      },

      fetchFromSupabase: async () => {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id;
        if (!userId) return;

        const { data, error } = await supabase
          .from("categories")
          .select("id, is_built_in")
          .eq("user_id", userId)
          .eq("is_built_in", false);

        if (error || !data) return;

        set((state) => {
          const existingIds = new Set(state.categories.map((c) => c.id.toLowerCase()));
          const fetchedCategories: Category[] = data
            .filter((row) => !existingIds.has(row.id.toLowerCase()))
            .map((row) => ({ id: row.id, isBuiltIn: row.is_built_in }));

          return { categories: [...state.categories, ...fetchedCategories] };
        });
      },
    }),
    {
      name: "lifesort-categories",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
); 