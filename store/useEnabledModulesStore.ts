import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  canToggleModule,
  mergeQueuedModuleEnablement,
  type ModuleEnablement,
  parseModuleEnablementRows,
} from '@/core/modules/moduleEnablement';
import type { ModuleId } from '@/core/modules/moduleRegistry';
import { createOutbox } from '@/core/sync/outbox';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';

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

/**
 * Valget lægges i den holdbare kø (APP-031) frem for at blive skrevet direkte.
 * Forskellen er hvad der sker, når nettet ikke er der: en direkte skrivning var
 * væk, en kø-post bliver liggende og sendt af koordinatoren (APP-037), når
 * telefonen er fremme og online igen. Serveren genkender den samme mutation,
 * hvis svaret gik tabt undervejs (APP-032).
 */
async function queueModuleChoice(accountId: string, moduleId: ModuleId, enabled: boolean) {
  await createOutbox(accountId).enqueue({
    dataDomain: 'core.module-choice',
    entityType: 'module-choice',
    entityId: moduleId,
    operation: 'upsert',
    payload: { enabled },
  });
}

/**
 * Et moduls kæde af endnu ikke afklarede skrivninger. Kun i hukommelsen, og kun
 * til rollback og beskyttelse mod overlappende hentninger.
 *
 * `stableChoice` er det seneste valg, vi ved er nået i køen — eller værdien fra
 * før kæden begyndte. Det er dét, der gør forskellen på at rulle tilbage til
 * noget holdbart og at rulle tilbage til en anden optimistisk gætværdi, der
 * heller ikke nåede nogen steder.
 */
type ModuleWriteChain = {
  /** Kontoen kæden hører til. Et svar fra en anden konto rører ikke noget. */
  readonly accountId: string;
  /** Den skrivning, hvis værdi står på skærmen lige nu. */
  latest: number;
  stableChoice: boolean | undefined;
  stableSequence: number;
  /** Never rewound by rollback; fetches must remember even refused writes. */
  activitySequence: number;
  pendingWrites: number;
};

const writeChains = new Map<ModuleId, ModuleWriteChain>();
let writeSequence = 0;
let writeEpoch = 0;

/** Fjerner et valg helt, så modulet falder tilbage til standardværdien. */
function withoutChoice(enablement: ModuleEnablement, moduleId: ModuleId): ModuleEnablement {
  const { [moduleId]: _removed, ...rest } = enablement;
  return rest;
}

export const useEnabledModulesStore = create<EnabledModulesState>()(
  persist(
    (set, get) => {
      const apply = (moduleId: ModuleId, choice: boolean | undefined) =>
        set((state) => ({
          enablement: choice === undefined
            ? withoutChoice(state.enablement, moduleId)
            : { ...state.enablement, [moduleId]: choice },
        }));

      /**
       * Kæden, hvis den stadig hører til den konto og den oprydningsrunde,
       * skrivningen startede i. Ellers ingenting: et svar fra før et log ud —
       * eller fra en anden bruger — må ikke kunne skrive i den her store.
       */
      const chainFor = (moduleId: ModuleId, accountId: string, epoch: number) => {
        if (epoch !== writeEpoch || useAuthStore.getState().session?.user.id !== accountId) return null;
        const chain = writeChains.get(moduleId);
        return chain && chain.accountId === accountId ? chain : null;
      };

      /** Køen har valget. Fra nu af er det dét, der rulles tilbage til. */
      const onQueued = (moduleId: ModuleId, accountId: string, epoch: number, sequence: number, enabled: boolean) => {
        const chain = chainFor(moduleId, accountId, epoch);
        if (!chain) return;
        chain.pendingWrites -= 1;
        // En ældre kvittering må ikke overskrive en nyere.
        if (sequence <= chain.stableSequence) return;
        chain.stableChoice = enabled;
        chain.stableSequence = sequence;
        // Står der en ældre værdi på skærmen, fordi en nyere skrivning imens er
        // rullet tilbage, følger skærmen det, køen faktisk har.
        if (sequence > chain.latest) {
          chain.latest = sequence;
          apply(moduleId, enabled);
        }
      };

      /**
       * Kunne valget ikke lægges i køen, findes det ingen steder andre kan se:
       * intet at sende, intet at prøve igen, og næste hentning ville alligevel
       * overskrive det. Så hellere sige det med det samme ved at sætte kontakten
       * tilbage, end at lade den lyve om at valget gælder.
       */
      const onRefused = (moduleId: ModuleId, accountId: string, epoch: number, sequence: number) => {
        const chain = chainFor(moduleId, accountId, epoch);
        if (!chain) return;
        chain.pendingWrites -= 1;
        // Er der kommet en nyere skrivning, er det dens værdi der står på
        // skærmen, og den her fejl handler ikke om den.
        if (chain.latest !== sequence) return;
        chain.latest = chain.stableSequence;
        apply(moduleId, chain.stableChoice);
      };

      return {
        enablement: {},
        hasHydrated: false,

        setModuleEnabled: (moduleId, enabled) => {
          // Skallen og kontoen kan ikke fravælges — hverken herfra eller fra
          // serveren. Se moduleEnablement.canToggleModule.
          if (!canToggleModule(moduleId)) return;

          // Kontoen læses HER, synkront, og følger med svaret. Ellers kunne et
          // sent svar komme til at handle om den næste bruger.
          const accountId = useAuthStore.getState().session?.user.id;

          // Ingen konto: valget er rent lokalt. Der er intet at lægge i kø, og
          // dermed heller intet at rulle tilbage.
          if (!accountId) {
            apply(moduleId, enabled);
            return;
          }

          const epoch = writeEpoch;
          const sequence = ++writeSequence;
          const current = chainFor(moduleId, accountId, epoch);
          writeChains.set(moduleId, current
            ? { ...current, latest: sequence, activitySequence: sequence, pendingWrites: current.pendingWrites + 1 }
            // Første skrivning i en kæde: den værdi, der står nu, er den sidste
            // vi ved var holdbar.
            : { accountId, latest: sequence, stableChoice: get().enablement[moduleId], stableSequence: 0,
              activitySequence: sequence, pendingWrites: 1 });

          // Kontakten venter aldrig på disken eller nettet.
          apply(moduleId, enabled);

          void queueModuleChoice(accountId, moduleId, enabled).then(
            () => onQueued(moduleId, accountId, epoch, sequence, enabled),
            () => onRefused(moduleId, accountId, epoch, sequence),
          );
        },

        fetchFromSupabase: async () => {
          const accountId = useAuthStore.getState().session?.user.id;
          const epoch = writeEpoch;
          const startingSequence = writeSequence;
          if (!accountId) return;
          const active = () => writeEpoch === epoch && useAuthStore.getState().session?.user.id === accountId;
          const protectedIds = new Set<string>();
          for (const [moduleId, chain] of writeChains) {
            if (chain.accountId === accountId && chain.pendingWrites > 0) protectedIds.add(moduleId);
          }
          const outbox = createOutbox(accountId);
          const captureQueued = async () => {
            for (const entry of await outbox.list()) {
              if (entry.dataDomain === 'core.module-choice' && entry.entityType === 'module-choice') {
                protectedIds.add(entry.entityId);
              }
            }
          };
          // Capture before any remote read: acknowledgement during that read
          // must not erase evidence that its response can predate local intent.
          try { await captureQueued(); } catch { return; }
          if (!active()) return;

          const { data: userData } = await supabase.auth.getUser();
          const userId = userData.user?.id;
          if (!active() || userId !== accountId) return;

          const { data, error } = await supabase
            .from('user_modules')
            .select('module_id, enabled')
            .eq('user_id', userId);

          // Ingen forbindelse eller ingen rækker endnu: behold det lokale valg.
          // At falde tilbage til tomt ville slå alt til igen på en enhed, hvor
          // brugeren netop har valgt noget fra.
          if (!active() || error || !data) return;

          // Et valg der stadig ligger i køen, har serveren ikke fået at vide
          // endnu. Det må ikke blive rullet tilbage af sit eget gamle svar.
          try { await captureQueued(); } catch {
            // Kan køen ikke læses, rører vi ikke det lokale valg.
            return;
          }
          if (!active()) return;

          // Includes writes begun during either outbox await, even if they have
          // already synced or rolled back. No await separates this from set().
          for (const [moduleId, chain] of writeChains) {
            if (chain.accountId === accountId && chain.activitySequence > startingSequence) protectedIds.add(moduleId);
          }
          const enablement = mergeQueuedModuleEnablement(
            parseModuleEnablementRows(data), get().enablement, [...protectedIds],
          );
          // With no overlap, accept the remote baseline for a later rollback.
          // Retain activity sequences: another, older fetch may still need them.
          for (const [moduleId, chain] of writeChains) {
            if (!protectedIds.has(moduleId)) chain.stableChoice = enablement[moduleId];
          }
          set({ enablement });
        },

        // APP-021: sporene ryddes FØR valgene, så et svar der er undervejs,
        // ikke kan skrive en gammel konto tilbage i en tom store.
        clearLocal: () => {
          writeEpoch += 1;
          writeChains.clear();
          set({ enablement: {} });
        },
      };
    },
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
