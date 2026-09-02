import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface AppLockState {
  lockEnabled: boolean; // brugerens valg — kun lokalt, ikke synkroniseret
  hasHydrated: boolean; // om vi har nået at læse lockEnabled fra disk endnu
  isLocked: boolean;    // øjeblikkelig tilstand — låst lige nu, eller ej
  setLockEnabled: (enabled: boolean) => void;
  lock: () => void;
  unlock: () => void;
}

export const useAppLockStore = create<AppLockState>()(
  persist(
    (set) => ({
      lockEnabled: false, // fra som standard
      hasHydrated: false,
      isLocked: false,
      setLockEnabled: (enabled) => set({ lockEnabled: enabled }),
      lock: () => set({ isLocked: true }),
      unlock: () => set({ isLocked: false }),
    }),
    {
      name: 'lifesort-app-lock',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ lockEnabled: state.lockEnabled }), // isLocked skal ALDRIG persisteres
      onRehydrateStorage: () => (state) => {
        useAppLockStore.setState({ hasHydrated: true });
      },
    }
  )
);