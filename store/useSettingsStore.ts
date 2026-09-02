import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { supabase } from '@/lib/supabase';

export type Language = 'da' | 'en';

interface SettingsState {
  language: Language | null;   // null = brugeren har ikke valgt endnu
  hasHydrated: boolean;        // om vi har nået at læse fra disk endnu
  setLanguage: (lang: Language) => void;
  fetchFromSupabase: () => Promise<void>;
}

async function syncLanguageToSupabase(language: Language) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;

  // upsert: opretter rækken første gang, opdaterer den efterfølgende gange
  await supabase.from('settings').upsert({ id: userId, language });
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: null,
      hasHydrated: false,

      setLanguage: (lang) => {
        set({ language: lang });
        syncLanguageToSupabase(lang);
      },

      fetchFromSupabase: async () => {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id;
        if (!userId) return;

        const { data, error } = await supabase
          .from('settings')
          .select('language')
          .eq('id', userId)
          .single();

        // Ingen fejl-håndtering nødvendig her udover at stoppe stille —
        // en frisk bruger har endnu ingen række, og det er helt normalt.
        if (error || !data || !data.language) return;

        set({ language: data.language as Language });
      },
    }),
    {
      name: 'lifesort-settings',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        state?.setLanguage;
        useSettingsStore.setState({ hasHydrated: true });
      },
    }
  )
);