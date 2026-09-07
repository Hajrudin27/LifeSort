import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  canToggleModule,
  type ModuleEnablement,
  parseModuleEnablementRows,
} from '@/core/modules/moduleEnablement';
import type { ModuleId } from '@/core/modules/moduleRegistry';
import { supabase } from '@/lib/supabase';
import { reportSyncFailure, reportSyncSuccess } from '@/store/useSyncStatusStore';

/**
 * Brugerens valg af moduler (APP-010).
 *
 * Store'en rører aldrig et domænes data. At slå et modul fra skriver én række —
 * intet andet. Det er hele pointen: valget er et filter på hvad der vises, ikke
 * en sletning.
 *
 * Valget er brugerspecifikt og ryddes derfor ved log ud (modsat kill switches,
 * der gælder alle og bliver).
 */
interface EnabledModulesState {
  enablement: ModuleEnablement;
  hasHydrated: boolean;
  setModuleEnabled: (moduleId: ModuleId, enabled: boolean) => void;
  fetchFromSupabase: () => Promise<void>;
  clearLocal: () => void;
}

async function syncToSupabase(moduleId: ModuleId, enabled: boolean) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;

  const { error } = await supabase
    .from('user_modules')
    .upsert({ user_id: userId, module_id: moduleId, enabled, updated_at: new Date().toISOString() });

  // Fejler synkroniseringen, står valget stadig lokalt. Brugeren skal kunne se
  // at det ikke er nået frem, frem for at opdage det på en anden enhed.
  if (error) reportSyncFailure('modules', 'setModuleEnabled', error);
  else reportSyncSuccess('modules');
}

export const useEnabledModulesStore = create<EnabledModulesState>()(
  persist(
    (set) => ({
      enablement: {},
      hasHydrated: false,

      setModuleEnabled: (moduleId, enabled) => {
        // Skallen og kontoen kan ikke fravælges — hverken herfra eller fra
        // serveren. Se moduleEnablement.canToggleModule.
        if (!canToggleModule(moduleId)) return;

        set((state) => ({ enablement: { ...state.enablement, [moduleId]: enabled } }));
        syncToSupabase(moduleId, enabled);
      },

      fetchFromSupabase: async () => {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id;
        if (!userId) return;

        const { data, error } = await supabase
          .from('user_modules')
          .select('module_id, enabled')
          .eq('user_id', userId);

        // Ingen forbindelse eller ingen rækker endnu: behold det lokale valg.
        // At falde tilbage til tomt ville slå alt til igen på en enhed, hvor
        // brugeren netop har valgt noget fra.
        if (error || !data) return;

        set({ enablement: parseModuleEnablementRows(data) });
      },

      clearLocal: () => set({ enablement: {} }),
    }),
    {
      name: 'lifesort-enabled-modules',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ enablement: state.enablement }),
      onRehydrateStorage: () => () => {
        useEnabledModulesStore.setState({ hasHydrated: true });
      },
    },
  ),
);
