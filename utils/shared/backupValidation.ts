/**
 * Validering af backup-filer før de skrives ind i app'ens stores.
 *
 * En backup-fil er ikke betroet input: brugeren vælger den selv fra filsystemet,
 * og den kan være redigeret, beskadiget eller komme fra en helt anden app. Uden
 * validering blev rå JSON tidligere sendt direkte i `setState`, hvilket både
 * kunne sætte forkerte typer (og dermed få appen til at crashe ved næste render,
 * uden vej tilbage) og — via en `__proto__`-nøgle og zustands `Object.assign` —
 * ændre prototypen på state-objektet.
 */

export const BACKUP_VERSION = 1;

type FieldType = 'array' | 'record' | 'object' | 'number' | 'string' | 'boolean' | 'nullableString';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const CHECKS: Record<FieldType, (value: unknown) => boolean> = {
  array: (value) => Array.isArray(value),
  record: isPlainObject,
  object: isPlainObject,
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  string: (value) => typeof value === 'string',
  boolean: (value) => typeof value === 'boolean',
  nullableString: (value) => value === null || typeof value === 'string',
};

/**
 * Hvilke felter der må gendannes, og hvilken type de skal have. Alt andet i filen
 * ignoreres — det er en whitelist, ikke en blacklist.
 *
 * To felter er bevidst udeladt, selvom de ligger i eksporten:
 *  - `settings.hasHydrated` styrer om appen overhovedet må rendere. Kom den til at
 *    stå false, ville appen låse fast på en tom skærm.
 *  - `trips.myUserId` afgør hvem "mig" er i turenes deltagerlogik. Den skal komme
 *    fra den aktuelle session, aldrig fra en fil.
 */
export const BACKUP_FIELD_SCHEMA = {
  expenses: { expenses: 'array', seriesStoppedAt: 'record', categoryBudgets: 'record' },
  categories: { categories: 'array' },
  income: { incomeByMonth: 'record' },
  savingsGoals: { goals: 'array', history: 'array', extraSavings: 'number' },
  warranties: { warranties: 'array' },
  trips: { trips: 'array', expenses: 'array', packingItems: 'array', participants: 'array' },
  food: {
    monthlyBudgetByMonth: 'record',
    purchases: 'array',
    pantryItems: 'array',
    shoppingItems: 'array',
    offers: 'array',
    recipes: 'array',
    standardPrices: 'array',
    globalStandardPrices: 'array',
    globalOffers: 'array',
    savedPlans: 'record',
    selectedStores: 'array',
  },
  todos: { todos: 'array' },
  lifeGoals: { goals: 'array' },
  habits: { habits: 'array' },
  household: { tasks: 'array', shoppingItems: 'array', movingItems: 'array' },
  career: { applications: 'array', skills: 'array' },
  skillCategories: { categories: 'array' },
  cv: { personalInfo: 'object', education: 'array', experience: 'array', languages: 'array', versions: 'array' },
  settings: { language: 'nullableString' },
} as const satisfies Record<string, Record<string, FieldType>>;

export type BackupStoreKey = keyof typeof BACKUP_FIELD_SCHEMA;

export type BackupParseError = 'parse_failed' | 'invalid_format' | 'unsupported_version';

export type BackupParseResult =
  | { ok: true; version: number; data: Partial<Record<BackupStoreKey, Record<string, unknown>>> }
  | { ok: false; error: BackupParseError };

// `__proto__` er den nøgle der kan ændre et objekts prototype gennem Object.assign.
// De to øvrige kan ikke det, men har ingen plads i data og fjernes for en sikkerheds skyld.
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function parseBackupFile(content: string): BackupParseResult {
  let parsed: unknown;
  try {
    // Reviveren fjerner farlige nøgler allerede under parsningen, så de aldrig
    // når at eksistere som egenskaber på et objekt.
    parsed = JSON.parse(content, (key, value) => (DANGEROUS_KEYS.has(key) ? undefined : value));
  } catch {
    return { ok: false, error: 'parse_failed' };
  }

  if (!isPlainObject(parsed) || !isPlainObject(parsed.data)) {
    return { ok: false, error: 'invalid_format' };
  }

  const { version } = parsed;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'invalid_format' };
  }
  // En fil fra en nyere udgave af appen kan indeholde felter, denne version ikke
  // forstår. Den afvises frem for at blive gendannet halvt.
  if (version > BACKUP_VERSION) {
    return { ok: false, error: 'unsupported_version' };
  }

  const data: Partial<Record<BackupStoreKey, Record<string, unknown>>> = {};

  for (const storeKey of Object.keys(BACKUP_FIELD_SCHEMA) as BackupStoreKey[]) {
    const rawStore = parsed.data[storeKey];
    if (rawStore === undefined) continue;
    if (!isPlainObject(rawStore)) return { ok: false, error: 'invalid_format' };

    const fields: Record<string, FieldType> = BACKUP_FIELD_SCHEMA[storeKey];
    const partial: Record<string, unknown> = {};

    for (const [field, type] of Object.entries(fields)) {
      const value = rawStore[field];
      // Et felt der mangler, kommer fra en ældre backup — det springes over, så
      // storens nuværende værdi bevares.
      if (value === undefined) continue;
      if (!CHECKS[type](value)) return { ok: false, error: 'invalid_format' };
      partial[field] = value;
    }

    if (Object.keys(partial).length > 0) data[storeKey] = partial;
  }

  return { ok: true, version, data };
}
