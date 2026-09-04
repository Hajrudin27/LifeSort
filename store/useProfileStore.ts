import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { supabase } from "@/lib/supabase";
import { Gender, UserProfile } from "@/types/profile";
import { hashPin, savePinLocally } from "@/utils/auth/pinAuth";

interface ProfileState {
  profile: UserProfile;
  hasOnboarded: boolean;
  isSyncing: boolean;
  profileFetchAttempted: boolean;
  setName: (name: string) => void;
  setAge: (age: number) => void;
  setGender: (gender: Gender) => void;
  setPartnerName: (partnerName: string) => void;
  setPin: (pin: string) => Promise<void>;
  fetchFromSupabase: () => Promise<void>;
  clearLocal: () => void;
}

async function syncProfileField(
  fields: Partial<{ name: string; age: number; gender: Gender; partner_name: string; pin_hash: string }>,
) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;
  await supabase.from("profiles").update(fields).eq("id", userId);
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      profile: { gender: "unspecified" },
      hasOnboarded: false,
      isSyncing: false,
      profileFetchAttempted: false,

      setName: (name) => {
        const trimmed = name.trim() || undefined;
        set((state) => ({ profile: { ...state.profile, name: trimmed } }));
        syncProfileField({ name: trimmed ?? "" });
      },
      setAge: (age) => {
        set((state) => ({ profile: { ...state.profile, age } }));
        syncProfileField({ age });
      },
      setGender: (gender) => {
        set((state) => ({ profile: { ...state.profile, gender } }));
        syncProfileField({ gender });
      },
      setPartnerName: (partnerName) => {
        const trimmed = partnerName.trim() || undefined;
        set((state) => ({ profile: { ...state.profile, partnerName: trimmed } }));
        syncProfileField({ partner_name: trimmed ?? "" });
      },
      setPin: async (pin) => {
        const hash = await hashPin(pin);
        // Gem lokalt FØRST — appen kan altid verificere PIN-koden offline,
        // uafhængigt af om Supabase-skrivningen lykkes med det samme.
        await savePinLocally(hash);
        await syncProfileField({ pin_hash: hash });
      },

      fetchFromSupabase: async () => {
        set({ isSyncing: true });
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id;
        if (!userId) {
          set({ isSyncing: false, profileFetchAttempted: true });
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("name, age, gender, partner_name")
          .eq("id", userId)
          .single();

        if (error || !data) {
          set({ isSyncing: false, profileFetchAttempted: true });
          return;
        }

        const hasOnboarded = !!data.name && data.age !== null;
        set({
          profile: {
            name: data.name ?? undefined,
            age: data.age ?? undefined,
            gender: (data.gender as Gender) ?? "unspecified",
            partnerName: data.partner_name ?? undefined,
          },
          hasOnboarded,
          isSyncing: false,
          profileFetchAttempted: true,
        });
      },

      clearLocal: () =>
        set({
          profile: { gender: "unspecified" },
          hasOnboarded: false,
          profileFetchAttempted: false,
        }),
    }),
    {
      name: "lifesort-profile",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        profile: state.profile,
        hasOnboarded: state.hasOnboarded,
      }),
    },
  ),
);