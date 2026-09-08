import { Session } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { create } from "zustand";

import { clearResendThrottle, isEmailVerified, recordSentNow } from "@/core/auth/emailVerification";
import type { RecoveryTokens } from "@/core/auth/recoveryLink";
import { supabase } from "@/lib/supabase";
import { clearAllLocalData } from "@/utils/auth/clearAllLocalData";

interface AuthState {
  session: Session | null;
  isLoading: boolean;
  /** Har brugeren bevist, at hun kan læse adressen? Se APP-018. */
  isEmailVerified: boolean;
  /** Sender bekræftelsesmailen igen. Spærretiden håndteres af kaldstedet. */
  resendVerificationEmail: (email: string) => Promise<{ error: string | null }>;
  /** Beder om et nulstillingslink. Svarer altid det samme — se ADR-0014. */
  sendPasswordReset: (email: string) => Promise<void>;
  /** Tager imod tokens fra linket og åbner en session, der må skifte kodeord. */
  beginPasswordRecovery: (tokens: RecoveryTokens) => Promise<{ error: string | null }>;
  /** Sætter det nye kodeord på den session, linket åbnede. */
  setNewPassword: (password: string) => Promise<{ error: string | null }>;
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
  isEmailVerified: false,

  init: () => {
    // Hent en evt. eksisterende session med det samme (fx efter app-genstart)
    supabase.auth.getSession().then(({ data: { session } }) => {
      set({ session, isLoading: false, isEmailVerified: isEmailVerified(session) });
    });

    // Lyt løbende på login/logout/token-fornyelse
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, isLoading: false, isEmailVerified: isEmailVerified(session) });
    });
  },

  signUp: async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null, session: data.session };
  },

  resendVerificationEmail: async (email) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    // Tidspunktet noteres uanset udfaldet. Ellers ville en fejlende server
    // kunne bruges til at sende ubegrænset mange forsøg afsted.
    await recordSentNow();
    return { error: error?.message ?? null };
  },

  sendPasswordReset: async (email) => {
    // Udfaldet kastes bevidst væk. Kaldstedet siger det samme, uanset om
    // adressen findes — alt andet ville være kontooptælling (ADR-0014).
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: Linking.createURL('new-password'),
    });
    await recordSentNow();
  },

  beginPasswordRecovery: async ({ accessToken, refreshToken }) => {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return { error: error?.message ?? null };
  },

  setNewPassword: async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error?.message ?? null };
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
    // Spærretiden hører til den konto, der lige er logget ud af.
    await clearResendThrottle();
  },
}));