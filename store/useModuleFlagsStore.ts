import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { type ModuleFlagOverrides, parseModuleFlags } from '@/core/feature-flags/moduleFlags';
import { supabase } from '@/lib/supabase';

/**
 * Operatørens kill switches, hentet fra serveren (APP-006).
 *
 * Flagene er ikke brugerdata — de er de samme for alle og hører til appen, ikke
 * til kontoen. Derfor ryddes de bevidst IKKE ved log ud: et modul der er lukket
 * ned, skal blive ved med at være lukket, også for den næste der logger ind.
 *
 * Værdien persisteres, så et lukket modul også er lukket, når appen starter
 * uden forbindelse. Uden det ville en kill switch kun virke online — altså ikke
 * i præcis den situation hvor noget er galt.
 */
interface ModuleFlagsState {
  overrides: ModuleFlagOverrides;
  /** Hvornår vi sidst fik et svar. Kun til fejlsøgning — ingen udløbstid. */
  lastFetchedAt: string | null;
  fetchFromSupabase: () => Promise<void>;
}

export const useModuleFlagsStore = create<ModuleFlagsState>()(
  persist(
    (set) => ({
      overrides: {},
      lastFetchedAt: null,

      fetchFromSupabase: async () => {
        const { data, error } = await supabase.from('module_flags').select('module_id, availability');

        // Ingen forbindelse, eller en server der har det skidt: behold det sidst
        // kendte svar. At falde tilbage til "alt er åbent" ville lukke et
        // fejlramt modul op igen, præcis når det ikke kan lade sig gøre at nå
        // serveren.
        if (error || !data) return;

        set({ overrides: parseModuleFlags(data), lastFetchedAt: new Date().toISOString() });
      },
    }),
    {
      name: 'lifesort-module-flags',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
