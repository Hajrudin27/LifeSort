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

import {
  DEFAULT_RECURRENCE_FREQUENCY,
  isCoherentRecurrence,
  parseIsoDate,
  repairLegacyOccurrenceDate,
} from '@/core/economy/recurrence';
import { legacyMajorUnitsToMinorUnits } from '@/core/money/legacyMajorUnits';
import type { MinorUnits } from '@/core/money/minorUnits';
import { supportedMoney } from '@/core/money/supportedMoney';

/**
 * Backup-formatets version.
 *  1 — før APP-040: Økonomiens beløb er JS-tal i hele kroner.
 *  2 — APP-040: Økonomiens beløb er DKK MinorUnits (øre), og kun understøttede
 *      beløb (`isSupportedMoney`): dem appen kan gemme, synkronisere og vise præcist.
 *  3 — APP-042: udgifter bærer `recurrenceFrequency` og `recurrenceAnchorDay`
 *      eksplicit. Ældre filer kender kun `isRecurring`, som i alle udgivne
 *      versioner betød "hver måned" på datoens dag.
 * Nye eksporter skriver altid 3. Øvrige moduler er semantisk uændrede.
 */
export const BACKUP_VERSION = 3;

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

export type BackupParseError = 'parse_failed' | 'invalid_format' | 'unsupported_version' | 'invalid_money';

export type BackupParseResult =
  | { ok: true; version: number; data: Partial<Record<BackupStoreKey, Record<string, unknown>>> }
  | { ok: false; error: BackupParseError };

/**
 * APP-040: hvor Økonomiens beløb ligger i en backup. `lists` er arrays af
 * poster med beløbsfelter, `maps` er nøgle→beløb og `amounts` er enkeltbeløb.
 */
const ECONOMY_MONEY_FIELDS: Partial<Record<BackupStoreKey, {
  readonly lists?: Readonly<Record<string, readonly string[]>>;
  readonly maps?: readonly string[];
  readonly amounts?: readonly string[];
}>> = {
  expenses: { lists: { expenses: ['amount'] }, maps: ['categoryBudgets'] },
  income: { maps: ['incomeByMonth'] },
  savingsGoals: { lists: { goals: ['targetAmount', 'savedAmount'], history: ['amount'] }, amounts: ['extraSavings'] },
};

/**
 * Format 1 konverteres præcis én gang; format 2 skaleres aldrig igen. Begge skal
 * derefter opfylde samme invariant som formularer, stores og lokale v1-data.
 */
function canonicalAmount(value: unknown, version: number): MinorUnits {
  return supportedMoney(version === 1 ? legacyMajorUnitsToMinorUnits(value) : value);
}

/**
 * Returnerer en ny partial med kanoniske beløb, eller en fejl. Kører for hele
 * filen, før importBackup rører en eneste store, så et ugyldigt beløb aldrig
 * efterlader en halvt gendannet Økonomi. Afrunder aldrig; fejlkoden er fast.
 */
function canonicalEconomyMoney(
  storeKey: BackupStoreKey,
  partial: Record<string, unknown>,
  version: number,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: BackupParseError } {
  const fields = ECONOMY_MONEY_FIELDS[storeKey];
  if (!fields) return { ok: true, value: partial };
  const next = { ...partial };
  for (const list of Object.keys(fields.lists ?? {})) {
    const items = next[list];
    if (items !== undefined && !(items as unknown[]).every(isPlainObject)) return { ok: false, error: 'invalid_format' };
  }
  try {
    for (const [list, moneyKeys] of Object.entries(fields.lists ?? {})) {
      if (next[list] === undefined) continue;
      next[list] = (next[list] as Record<string, unknown>[]).map((item) => {
        const copy = { ...item };
        for (const key of moneyKeys) copy[key] = canonicalAmount(item[key], version);
        return copy;
      });
    }
    for (const map of fields.maps ?? []) {
      if (next[map] === undefined) continue;
      next[map] = Object.fromEntries(
        Object.entries(next[map] as Record<string, unknown>).map(([key, value]) => [key, canonicalAmount(value, version)]),
      );
    }
    for (const amount of fields.amounts ?? []) {
      if (next[amount] !== undefined) next[amount] = canonicalAmount(next[amount], version);
    }
  } catch {
    return { ok: false, error: 'invalid_money' };
  }
  return { ok: true, value: next };
}

/**
 * APP-042: gendannede udgifter skal opfylde samme gentagelses-invariant som
 * formularer, store og server — også fra en gammel fil.
 *
 * FORMAT 1-2 (historiske filer) normaliseres: frekvensen udledes af `isRecurring`
 * (true → hver måned, som appen faktisk opførte sig) og dagsankeret af datoens
 * dags-token. Er datoen den kendte gamle defekt (fx "2026-02-31", som den
 * tidligere rollForwardMonth kunne skrive), klippes selve datoen til månedens
 * sidste rigtige dag, mens den tilsigtede dag bevares som anker.
 *
 * FORMAT 3 er APP-042's kanoniske skema og normaliseres IKKE. Hver udgift skal
 * selv bære begge felter — også `null`/`null` for en engangsudgift — og en fast
 * udgifts `nextPaymentDate` skal være en rigtig kalenderdato, præcis som lokale
 * v2-bytes. Manglende felter, en ukendt frekvens, et anker uden for 1–31 eller en
 * umulig dato afvises frem for at blive repareret eller gættet.
 */
const RECURRENCE_FIELDS = ['recurrenceFrequency', 'recurrenceAnchorDay'] as const;

function canonicalExpenseRecurrence(
  partial: Record<string, unknown>,
  version: number,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: BackupParseError } {
  const expenses = partial.expenses;
  if (expenses === undefined) return { ok: true, value: partial };
  const canonical: Record<string, unknown>[] = [];
  for (const expense of expenses as Record<string, unknown>[]) {
    const isRecurring = expense.isRecurring;
    if (typeof isRecurring !== 'boolean') return { ok: false, error: 'invalid_format' };

    let next = { ...expense };
    if (version < 3) {
      if (!isRecurring) {
        next = { ...next, recurrenceFrequency: null, recurrenceAnchorDay: null };
      } else {
        const repaired = repairLegacyOccurrenceDate(expense.nextPaymentDate);
        if (!repaired) return { ok: false, error: 'invalid_format' };
        next = {
          ...next,
          nextPaymentDate: repaired.date,
          recurrenceFrequency: DEFAULT_RECURRENCE_FREQUENCY,
          recurrenceAnchorDay: repaired.anchorDay,
        };
      }
    } else {
      // Kanonisk format 3: felterne skal findes på udgiften selv, og en fast
      // udgifts dato skal være en dato kalenderen har. Intet repareres her.
      if (!RECURRENCE_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(expense, field))) {
        return { ok: false, error: 'invalid_format' };
      }
      if (isRecurring && parseIsoDate(expense.nextPaymentDate) === null) {
        return { ok: false, error: 'invalid_format' };
      }
    }

    if (!isCoherentRecurrence(isRecurring, next.recurrenceFrequency, next.recurrenceAnchorDay)) {
      return { ok: false, error: 'invalid_format' };
    }
    canonical.push(next);
  }
  return { ok: true, value: { ...partial, expenses: canonical } };
}

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

    if (Object.keys(partial).length === 0) continue;
    const canonical = canonicalEconomyMoney(storeKey, partial, version);
    if (!canonical.ok) return canonical;
    if (storeKey !== 'expenses') {
      data[storeKey] = canonical.value;
      continue;
    }
    const recurrence = canonicalExpenseRecurrence(canonical.value, version);
    if (!recurrence.ok) return recurrence;
    data[storeKey] = recurrence.value;
  }

  return { ok: true, version, data };
}
