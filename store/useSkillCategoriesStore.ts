import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface SkillCategoryItem {
  id: string;
  isBuiltIn: boolean;
}

interface SkillCategoriesState {
  categories: SkillCategoryItem[];
  addCategory: (name: string) => string;
}

const BUILT_IN: SkillCategoryItem[] = [
  { id: 'technical', isBuiltIn: true },
  { id: 'language', isBuiltIn: true },
  { id: 'soft', isBuiltIn: true },
];

export const useSkillCategoriesStore = create<SkillCategoriesState>()(
  persist(
    (set, get) => ({
      categories: BUILT_IN,
      addCategory: (name) => {
        const trimmed = name.trim();
        const existing = get().categories.find(
          (c) => !c.isBuiltIn && c.id.toLowerCase() === trimmed.toLowerCase()
        );
        if (existing) return existing.id;
        const newCategory: SkillCategoryItem = { id: trimmed, isBuiltIn: false };
        set((state) => ({ categories: [...state.categories, newCategory] }));
        return newCategory.id;
      },
    }),
    {
      name: 'lifesort-skill-categories',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);