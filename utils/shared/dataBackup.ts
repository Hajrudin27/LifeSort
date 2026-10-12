import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { useCareerStore } from '@/store/useCareerStore';
import { useCategoriesStore } from '@/store/useCategoriesStore';
import { useCVStore } from '@/store/useCVStore';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useFoodStore } from '@/store/useFoodStore';
import { useHabitsStore } from '@/store/useHabitsStore';
import { useHouseholdStore } from '@/store/useHouseholdStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useSkillCategoriesStore } from '@/store/useSkillCategoriesStore';
import { useTodoStore } from '@/store/useTodoStore';
import { useTripsStore } from '@/store/useTripsStore';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';
import {
  BACKUP_VERSION,
  type BackupParseError,
  type BackupStoreKey,
  parseBackupFile,
} from '@/utils/shared/backupValidation';
import { todayIso } from '@/utils/shared/localDate';

/**
 * APP-069 — a domain that takes part in a backup without core knowing its store.
 *
 * This is the smallest seam that lets a domain join the export and the restore without a new
 * core -> domain-store import (R6; ADR-0056). The composition layer (features/backupParticipants.ts)
 * owns the list and hands it to `exportBackup` / `importBackup`; core sees only this shape.
 *
 * It is deliberately not a service locator: no registration, no lookup, no ambient state. A caller
 * that passes no participants gets exactly the pre-existing backup. The `key` is a key of the
 * validated backup schema that no built-in store owns, so a participant can neither carry data
 * `parseBackupFile` has not validated nor overwrite an existing domain, and `restore` receives
 * that validated value.
 */
export interface BackupParticipant {
  readonly key: Exclude<BackupStoreKey, StoreKey>;
  /** The portable payload for this domain: an explicit whitelist, never a whole store state. */
  exportSnapshot: () => Record<string, unknown>;
  /** Called only with what `parseBackupFile` validated, after the whole file has passed. */
  restore: (validated: Record<string, unknown>) => void;
}

// Rækkefølgen her definerer, hvad der eksporteres/importeres — tilføj en ny linje,
// når I bygger et nyt modul med sin egen store.
// APP-072: helbredsdata (Cyklus) er med vilje IKKE med i dette klartekst-arkiv. Det er special-category
// data i en krypteret lokal store (ADR-0023); et krypteret, flytbart helbredsbackup ejes af APP-097.
const STORE_REGISTRY = {
  expenses: useExpensesStore,
  categories: useCategoriesStore,
  income: useIncomeStore,
  savingsGoals: useSavingsGoalsStore,
  warranties: useWarrantiesStore,
  trips: useTripsStore,
  food: useFoodStore,
  todos: useTodoStore,
  lifeGoals: useLifeGoalsStore,
  habits: useHabitsStore,
  household: useHouseholdStore,
  career: useCareerStore,
  skillCategories: useSkillCategoriesStore,
  cv: useCVStore,
  settings: useSettingsStore,
};

type StoreKey = keyof typeof STORE_REGISTRY;

function buildBackupObject(participants: readonly BackupParticipant[]) {
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(STORE_REGISTRY) as StoreKey[]) {
    // APP-059's participant projection is an account-scoped encrypted cache, not
    // portable user data. Never put it (or its freshness metadata) in a plaintext
    // user export; only canonical Trip state and unresolved legacy rows travel.
    if (key === 'trips') {
      const state = useTripsStore.getState();
      data[key] = {
        trips: state.trips,
        expenses: state.expenses,
        packingItems: state.packingItems,
        appliedPackingTemplates: state.appliedPackingTemplates,
        participants: state.participants,
      };
    } else if (key === 'career') {
      // APP-067: application notes are Profile B and never enter a plaintext archive. Skills
      // are not part of that payload and keep travelling.
      data[key] = { skills: useCareerStore.getState().skills };
    } else if (key === 'cv') {
      // APP-067: CV contact details are Profile B; the archive carries no CV payload.
      continue;
    } else if (key === 'lifeGoals') {
      // APP-063: the goals themselves; no runtime or sync state, no functions, no validators.
      data[key] = { goals: useLifeGoalsStore.getState().goals };
    } else if (key === 'habits') {
      // APP-064: the habits themselves; never a derived status, week fact, streak or sync metadata.
      data[key] = { habits: useHabitsStore.getState().habits };
    } else if (key === 'household') {
      const state = useHouseholdStore.getState();
      // APP-061: portable content only; account and revision state stay local.
      data[key] = {
        tasks: state.tasks,
        shoppingItems: state.shoppingItems,
        movingItems: state.movingItems,
        movingTemplate: state.movingTemplate,
      };
    } else {
      data[key] = STORE_REGISTRY[key].getState();
    }
  }
  for (const participant of participants) data[participant.key] = participant.exportSnapshot();
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export async function exportBackup(participants: readonly BackupParticipant[] = []): Promise<{ fileName: string }> {
  const backup = buildBackupObject(participants);
  const fileName = `lifesort-backup-${todayIso()}.json`;
  const fileUri = `${FileSystem.documentDirectory}${fileName}`;

  await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(backup, null, 2));

  const available = await Sharing.isAvailableAsync();
  if (available) {
    await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: fileName });
  }

  return { fileName };
}

export interface ImportResult {
  success: boolean;
  restoredKeys: string[];
  skippedKeys: string[];
  error?: BackupParseError;
}

export async function importBackup(participants: readonly BackupParticipant[] = []): Promise<ImportResult | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
  if (picked.canceled) return null;

  const asset = picked.assets[0];

  let content: string;
  try {
    content = await FileSystem.readAsStringAsync(asset.uri);
  } catch {
    return { success: false, restoredKeys: [], skippedKeys: [], error: 'parse_failed' };
  }

  // Filen valideres HELT igennem, før der skrives noget som helst. Slår bare ét
  // felt fejl, afvises hele importen — en halvt gendannet tilstand ville være
  // værre end ingen gendannelse, og handlingen kan ikke fortrydes. Det gælder
  // også Økonomiens beløb (APP-040): format 1 konverteres og format 2 valideres
  // her, så setState nedenfor kun modtager kanoniske øre.
  const parsed = parseBackupFile(content);
  if (!parsed.ok) {
    return { success: false, restoredKeys: [], skippedKeys: [], error: parsed.error };
  }

  const restoredKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const key of Object.keys(STORE_REGISTRY) as StoreKey[]) {
    const partial = parsed.data[key];
    if (partial === undefined) {
      skippedKeys.push(key);
      continue;
    }
    // setState uden `replace` merger de validerede felter ind i eksisterende
    // state, så storens actions bevares. Kun felter fra whitelisten når hertil.
    if (key === 'trips') {
      // APP-059: restored trips must not inherit the projection cache (or its
      // freshness) of the dataset they replace; the store clears it in the same write.
      useTripsStore.getState().restoreBackup(partial as never);
    } else if (key === 'lifeGoals') {
      useLifeGoalsStore.getState().restoreBackup(partial as never);
    } else if (key === 'habits') {
      useHabitsStore.getState().restoreBackup(partial as never);
    } else if (key === 'household') {
      useHouseholdStore.getState().restoreBackup(partial as never);
    } else {
      (STORE_REGISTRY[key] as any).setState(partial);
    }
    restoredKeys.push(key);
  }

  // Participants are restored last, and only from the value the parser validated for their key.
  for (const participant of participants) {
    const validated = parsed.data[participant.key];
    if (validated === undefined) {
      skippedKeys.push(participant.key);
      continue;
    }
    participant.restore(validated);
    restoredKeys.push(participant.key);
  }

  return { success: true, restoredKeys, skippedKeys };
}
