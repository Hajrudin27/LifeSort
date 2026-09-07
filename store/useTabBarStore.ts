import { create } from 'zustand';

type TabBarState = {
  isCompact: boolean;
  setCompact: (isCompact: boolean) => void;
};

export const useTabBarStore = create<TabBarState>((set) => ({
  isCompact: false,
  setCompact: (isCompact) =>
    set((state) => (state.isCompact === isCompact ? state : { isCompact })),
}));
