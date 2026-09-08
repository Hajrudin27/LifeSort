import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Om det månedlige tilbageblik må vise sig selv (APP-016).
 *
 * Fravalget gælder kun invitationen på forsiden. Siden bliver i Indstillinger,
 * så et fravalg ikke også er en aflåsning — brugeren skal kunne kigge, når hun
 * selv har lyst, uden at slå noget til igen.
 *
 * Kun lokalt, som resten af Home-indstillingerne.
 */
interface ReviewState {
  /** Vis invitationen på forsiden. Standard: ja. */
  showOnHome: boolean;
  hasHydrated: boolean;
  setShowOnHome: (show: boolean) => void;
}

export const useReviewStore = create<ReviewState>()(
  persist(
    (set) => ({
      showOnHome: true,
      hasHydrated: false,
      setShowOnHome: (show) => set({ showOnHome: show }),
    }),
    {
      name: 'lifesort-monthly-review',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ showOnHome: state.showOnHome }),
      onRehydrateStorage: () => () => {
        useReviewStore.setState({ hasHydrated: true });
      },
    },
  ),
);
