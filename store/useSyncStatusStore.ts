import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Holder styr på om lokale ændringer er nået frem til Supabase.
 *
 * Appen er offline-first: den lokale zustand-state (persisteret i AsyncStorage)
 * er det brugeren ser og arbejder i, og Supabase er backup-/synk-laget ovenpå.
 * En fejlet synkronisering betyder derfor "ikke sikkerhedskopieret endnu", ikke
 * "dine data er væk" — og skal IKKE afbryde brugeren med en toast hver gang de
 * er offline. Den bliver i stedet samlet op her og vist roligt ét sted
 * (Indstillinger), så brugeren kan se om noget mangler at komme op.
 */

// Frit tekstnavn frem for en union, så en ny store kan rapportere uden at
// skulle føjes til en type her.
export type SyncModule = string;

export type SyncFailure = {
  module: SyncModule;
  operation: string;
  message: string;
  at: string; // ISO
};

interface SyncStatusState {
  lastSuccessAt: string | null;
  /** Nyeste fejl pr. modul. Et vellykket kald for samme modul rydder dets fejl. */
  failures: Record<SyncModule, SyncFailure>;
  reportSuccess: (module: SyncModule) => void;
  reportFailure: (module: SyncModule, operation: string, error: unknown) => void;
  clearFailures: () => void;
}

function toMessage(error: unknown): string {
  if (!error) return 'Ukendt fejl';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  // Supabase-fejl (PostgrestError m.fl.) har et message-felt uden at være Error.
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : 'Ukendt fejl';
}

export const useSyncStatusStore = create<SyncStatusState>()(
  persist(
    (set) => ({
      lastSuccessAt: null,
      failures: {},

      reportSuccess: (module) =>
        set((state) => {
          if (!state.failures[module]) {
            return { lastSuccessAt: new Date().toISOString() };
          }
          const { [module]: _cleared, ...rest } = state.failures;
          return { lastSuccessAt: new Date().toISOString(), failures: rest };
        }),

      reportFailure: (module, operation, error) => {
        const message = toMessage(error);
        if (__DEV__) {
          // Under udvikling vil vi stadig se fejlen i konsollen med det samme.
          console.warn(`[sync] ${module}/${operation}: ${message}`);
        }
        set((state) => ({
          failures: {
            ...state.failures,
            [module]: { module, operation, message, at: new Date().toISOString() },
          },
        }));
      },

      clearFailures: () => set({ failures: {} }),
    }),
    {
      name: 'sync-status',
      storage: createJSONStorage(() => AsyncStorage),
      // Fejl er forbigående og hører til den aktuelle session — kun tidspunktet
      // for sidste vellykkede synk er værd at huske på tværs af opstarter.
      partialize: (state) => ({ lastSuccessAt: state.lastSuccessAt }),
    },
  ),
);

// --- Rapportering fra stores ------------------------------------------------
// Ligger her frem for i utils/, så vi ikke laver en utils -> store-afhængighed.

export function reportSyncFailure(module: SyncModule, operation: string, error: unknown) {
  useSyncStatusStore.getState().reportFailure(module, operation, error);
}

export function reportSyncSuccess(module: SyncModule) {
  useSyncStatusStore.getState().reportSuccess(module);
}

/**
 * Til Supabase-svar af formen { error }. Rapporterer fejl eller succes og
 * returnerer true, hvis kaldet gik igennem — så kaldstedet kan skrive
 * `if (!trackSync(...)) return;` i stedet for at sluge fejlen tavst.
 */
export function trackSync(
  module: SyncModule,
  operation: string,
  result: { error?: unknown } | null | undefined,
): boolean {
  const error = result?.error;
  if (error) {
    reportSyncFailure(module, operation, error);
    return false;
  }
  reportSyncSuccess(module);
  return true;
}
