import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { EMPTY_HOME_LAYOUT, type HomeLayoutPreferences } from '@/core/modules/homeRanking';
import type { HomePrivacyPreferences } from '@/core/modules/homePrivacy';
import type { ModuleId } from '@/core/modules/moduleRegistry';

/**
 * Brugerens indretning af Home (APP-012).
 *
 * Kun lokalt. Rækkefølgen af kort på en telefon er en indstilling for den
 * skærm, man kigger på, og LifeSort er telefon-først; at synkronisere den ville
 * koste en tabel og en migration for noget, ingen har bedt om. Modulvalget
 * (APP-010) synkroniseres derimod, fordi det bestemmer hvad appen indeholder.
 *
 * At skjule et kort skjuler kortet. Modulet er der stadig, dataene er der
 * stadig, og kortet kan hentes tilbage fra bunden af Home.
 */
interface HomeLayoutState extends HomeLayoutPreferences, Pick<HomePrivacyPreferences, 'detail'> {
  /**
   * Om indstillingerne er læst fra disk endnu. Følsomme kort maskeres, indtil
   * de er — se homePrivacy.resolveCardDetail.
   */
  hasHydrated: boolean;
  setCardDetail: (moduleId: ModuleId, detail: 'full' | 'masked') => void;
  togglePinned: (moduleId: ModuleId) => void;
  toggleHidden: (moduleId: ModuleId) => void;
  restoreAllHidden: () => void;
  recordModuleOpened: (moduleId: ModuleId) => void;
}

export const useHomeLayoutStore = create<HomeLayoutState>()(
  persist(
    (set) => ({
      ...EMPTY_HOME_LAYOUT,
      detail: {},
      hasHydrated: false,

      setCardDetail: (moduleId, detail) =>
        set((state) => ({ detail: { ...state.detail, [moduleId]: detail } })),

      togglePinned: (moduleId) =>
        set((state) => ({
          pinned: state.pinned.includes(moduleId)
            ? state.pinned.filter((id) => id !== moduleId)
            : [...state.pinned, moduleId],
        })),

      toggleHidden: (moduleId) =>
        set((state) => ({
          hidden: state.hidden.includes(moduleId)
            ? state.hidden.filter((id) => id !== moduleId)
            : [...state.hidden, moduleId],
          // Et skjult kort kan ikke også være fastgjort — ellers ville det
          // stå øverst i en liste, det ikke er med i.
          pinned: state.hidden.includes(moduleId) ? state.pinned : state.pinned.filter((id) => id !== moduleId),
        })),

      restoreAllHidden: () => set({ hidden: [] }),

      recordModuleOpened: (moduleId) =>
        set((state) => ({
          lastOpenedAt: { ...state.lastOpenedAt, [moduleId]: new Date().toISOString() },
        })),
    }),
    {
      name: 'lifesort-home-layout',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        pinned: state.pinned,
        hidden: state.hidden,
        detail: state.detail,
        lastOpenedAt: state.lastOpenedAt,
      }),
      onRehydrateStorage: () => () => {
        useHomeLayoutStore.setState({ hasHydrated: true });
      },
    },
  ),
);
