import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { supabase } from "@/lib/supabase";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  fetchFromSupabase: () => Promise<void>;
}

async function syncThemeToSupabase(mode: ThemeMode) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;

  await supabase.from("settings").upsert({ id: userId, theme_mode: mode });
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: "system",

      setMode: (mode) => {
        set({ mode });
        syncThemeToSupabase(mode);
      },

      fetchFromSupabase: async () => {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id;
        if (!userId) return;

        const { data, error } = await supabase
          .from("settings")
          .select("theme_mode")
          .eq("id", userId)
          .single();

        if (error || !data || !data.theme_mode) return;

        set({ mode: data.theme_mode as ThemeMode });
      },
    }),
    {
      name: "lifesort-theme",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);