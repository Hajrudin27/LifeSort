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
import { BACKUP_VERSION, type BackupParseError, parseBackupFile } from '@/utils/shared/backupValidation';

// Rækkefølgen her definerer, hvad der eksporteres/importeres — tilføj en ny linje,
// når I bygger et nyt modul med sin egen store.
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

function buildBackupObject() {
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(STORE_REGISTRY) as StoreKey[]) {
    data[key] = STORE_REGISTRY[key].getState();
  }
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export async function exportBackup(): Promise<{ fileName: string }> {
  const backup = buildBackupObject();
  const fileName = `lifesort-backup-${new Date().toISOString().slice(0, 10)}.json`;
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

export async function importBackup(): Promise<ImportResult | null> {
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
  // værre end ingen gendannelse, og handlingen kan ikke fortrydes.
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
    (STORE_REGISTRY[key] as any).setState(partial);
    restoredKeys.push(key);
  }

  return { success: true, restoredKeys, skippedKeys };
}