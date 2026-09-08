import { Session } from "@supabase/supabase-js";
import { create } from "zustand";

import { supabase } from "@/lib/supabase";
import { clearAllLocalData } from "@/utils/auth/clearAllLocalData";

interface AuthState {
  session: Session | null;
  isLoading: boolean;
  init: () => void;
  /**
   * Oprettelse spørger kun om det, en konto ikke kan undvære (APP-017). Navn og
   * køn er valgfrie profilfelter, der hører til i onboarding — ikke betingelser
   * for at få en konto.
   */
  signUp: (email: string, password: string) => Promise<{ error: string | null; session: Session | null }>;
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  isLoading: true,

  init: () => {
    // Hent en evt. eksisterende session med det samme (fx efter app-genstart)
    supabase.auth.getSession().then(({ data: { session } }) => {
      set({ session, isLoading: false });
    });

    // Lyt løbende på login/logout/token-fornyelse
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, isLoading: false });
    });
  },

  signUp: async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null, session: data.session };
  },

  signIn: async (email, password) => {
    // Ryd al lokal data FØR selve login-kaldet, så den nye brugers
    // data aldrig kan blandes med en tidligere, allerede-logget-ud
    // brugers lokale rester.
    await clearAllLocalData();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error?.message ?? null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    await clearAllLocalData();
  },
}));