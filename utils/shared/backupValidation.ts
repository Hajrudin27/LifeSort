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
import { decodeCompatibleRecipeIngredients, decodeRecipeIngredients } from '@/core/food/ingredients';
import { decodePantryItems } from '@/core/food/pantry';
import { decodeShoppingItems } from '@/core/food/shopping';
import { legacyMajorUnitsToMinorUnits } from '@/core/money/legacyMajorUnits';
import type { MinorUnits } from '@/core/money/minorUnits';
import { supportedMoney } from '@/core/money/supportedMoney';
import { parseCalendarDate as parseHouseholdCalendarDate } from '@/utils/shared/localDate';
import { isValidIanaTimeZone } from '@/utils/shared/timeZone';

/**
 * Backup-formatets version.
 *  1 — før APP-040: Økonomiens beløb er JS-tal i hele kroner.
 *  2 — APP-040: Økonomiens beløb er DKK MinorUnits (øre), og kun understøttede
 *      beløb (`isSupportedMoney`): dem appen kan gemme, synkronisere og vise præcist.
 *  3 — APP-042: udgifter bærer `recurrenceFrequency` og `recurrenceAnchorDay`
 *      eksplicit. Ældre filer kender kun `isRecurring`, som i alle udgivne
 *      versioner betød "hver måned" på datoens dag.
 *  4 — APP-047: opskrifternes ingredienser følger ingredienskontrakten
 *      (`core/food/ingredients.ts`). Ældre filer kender kun `{ name, amount }`.
 *  5 — APP-050: Pantry bærer valgfrie strukturerede mængder og eksplicitte datoer;
 *      ældre fritekstmængder bevares ordret som legacyQuantityText.
 *  6 — APP-052: shopping items skelner manuelle og opskriftsafledte artefakter.
 *  7 — APP-059: Travel-budgetter er MinorUnits; gamle Travel-udgifter forbliver
 *      udaterede legacy-poster med en sikker, valgfri MinorUnits-konvertering.
 *  8 — APP-060: Travel-backup bærer eksplicitte Trip-skabelonmarkører; pakkelabels
 *      bruges aldrig til at udlede, om en skabelon allerede er anvendt.
 *  9 — APP-061: Home-opgaver bærer en fast IANA-tidszone eller eksplicit null
 *      for historisk enheds-lokal semantik. Syncmetadata er aldrig en del af backup.
 * Nye eksporter skriver altid 9.
 */
export const BACKUP_VERSION = 9;

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
  trips: { trips: 'array', expenses: 'array', packingItems: 'array', appliedPackingTemplates: 'array', participants: 'array' },
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

/**
 * APP-047: gendannede opskrifter skal opfylde samme ingredienskontrakt som
 * formular, store, lokale data og server.
 *
 * FORMAT 1–3 er skrevet af versioner før APP-047. Deres egne ingredienser er
 * `{ name, amount }` (to strenge), som bevares ordret som `legacy` — ingen familie
 * og ingen mængde udledes af teksten. De kan også indeholde opskrifter, de har
 * hentet fra serveren uændret efter en nyere version skrev dem; en sådan
 * ingrediens beholdes kun, hvis den opfylder den nuværende kontrakt.
 *
 * FORMAT 4 er kanonisk og normaliseres IKKE: hver ingrediens skal allerede opfylde
 * kontrakten. Alt andet afviser hele importen frem for at blive gættet.
 */
function canonicalRecipeIngredients(
  partial: Record<string, unknown>,
  version: number,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: BackupParseError } {
  const recipes = partial.recipes;
  if (recipes === undefined) return { ok: true, value: partial };
  const decode = version < 4 ? decodeCompatibleRecipeIngredients : decodeRecipeIngredients;
  const canonical: Record<string, unknown>[] = [];
  for (const recipe of recipes as unknown[]) {
    if (!isPlainObject(recipe)) return { ok: false, error: 'invalid_format' };
    const ingredients = decode(recipe.ingredients);
    if (!ingredients) return { ok: false, error: 'invalid_format' };
    canonical.push({ ...recipe, ingredients });
  }
  return { ok: true, value: { ...partial, recipes: canonical } };
}

function canonicalPantryItems(
  partial: Record<string, unknown>,
  version: number,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: BackupParseError } {
  if (partial.pantryItems === undefined) return { ok: true, value: partial };
  const items = decodePantryItems(partial.pantryItems, version < 5);
  if (!items) return { ok: false, error: 'invalid_format' };
  return { ok: true, value: { ...partial, pantryItems: items } };
}

function canonicalShoppingItems(
  partial: Record<string, unknown>, version: number,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: BackupParseError } {
  if (partial.shoppingItems === undefined) return { ok: true, value: partial };
  const items = decodeShoppingItems(partial.shoppingItems, version < 6);
  if (!items) return { ok: false, error: 'invalid_format' };
  return { ok: true, value: { ...partial, shoppingItems: items } };
}

function canonicalHouseholdTasks(
  partial: Record<string, unknown>,
  version: number,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: BackupParseError } {
  if (partial.tasks === undefined) return { ok: true, value: partial };
  const canonical: Record<string, unknown>[] = [];
  const baseKeys = ['id', 'kind', 'title', 'frequency', 'lastDone', 'assignedTo', 'rotates', 'createdAt'];
  for (const raw of partial.tasks as unknown[]) {
    if (!isPlainObject(raw)) return { ok: false, error: 'invalid_format' };
    // Pre-rotation exports omit assignedTo/rotates; earlier formats restored them as defaults.
    const task = version < 9
      ? { ...raw, assignedTo: raw.assignedTo ?? 'me', rotates: raw.rotates ?? false }
      : raw;
    const allowed = version < 9 ? baseKeys : [...baseKeys, 'timeZone'];
    if (Object.keys(task).some((key) => !allowed.includes(key))
      || typeof task.id !== 'string' || task.id.length === 0
      || !['cleaning', 'maintenance'].includes(String(task.kind))
      || typeof task.title !== 'string'
      || !['weekly', 'monthly', 'quarterly', 'yearly'].includes(String(task.frequency))
      || (task.lastDone !== undefined && parseHouseholdCalendarDate(task.lastDone) === null)
      || !['me', 'partner'].includes(String(task.assignedTo))
      || typeof task.rotates !== 'boolean'
      || typeof task.createdAt !== 'string' || !Number.isFinite(Date.parse(task.createdAt))) {
      return { ok: false, error: 'invalid_format' };
    }
    if (version >= 9 && task.timeZone !== null && !isValidIanaTimeZone(task.timeZone)) {
      return { ok: false, error: 'invalid_format' };
    }
    canonical.push(version < 9 ? { ...task, timeZone: null } : { ...task });
  }
  return { ok: true, value: { ...partial, tasks: canonical } };
}

/** APP-059 Travel backup boundary. Unsafe legacy money is preserved unresolved. */
function canonicalTravelMoney(
  partial: Record<string, unknown>, version: number,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: BackupParseError } {
  const trips = partial.trips;
  const expenses = partial.expenses;
  const appliedPackingTemplates = partial.appliedPackingTemplates;
  if (trips !== undefined && !(trips as unknown[]).every(isPlainObject)) return { ok: false, error: 'invalid_format' };
  if (expenses !== undefined && !(expenses as unknown[]).every(isPlainObject)) return { ok: false, error: 'invalid_format' };
  if (appliedPackingTemplates !== undefined) {
    const keys = new Set<string>();
    const tripIds = trips === undefined ? null : new Set((trips as Record<string, unknown>[])
      .filter((trip) => typeof trip.id === 'string')
      .map((trip) => trip.id as string));
    for (const application of appliedPackingTemplates as unknown[]) {
      if (!isPlainObject(application)
        || typeof application.tripId !== 'string' || application.tripId.length === 0
        || typeof application.templateId !== 'string' || application.templateId.trim().length === 0
        || typeof application.templateVersion !== 'number'
        || !Number.isInteger(application.templateVersion) || application.templateVersion <= 0
        || (application.appliedBy !== undefined && typeof application.appliedBy !== 'string')
        || (application.appliedAt !== undefined && typeof application.appliedAt !== 'string')
        || (tripIds !== null && !tripIds.has(application.tripId))) return { ok: false, error: 'invalid_format' };
      const key = `${application.tripId}\u0000${application.templateId}\u0000${application.templateVersion}`;
      if (keys.has(key)) return { ok: false, error: 'invalid_format' };
      keys.add(key);
    }
  }

  const nextTrips: Record<string, unknown>[] | undefined = trips === undefined ? undefined
    : (trips as Record<string, unknown>[]).map((trip) => {
      const budget = trip.budget;
      if (version >= 7) {
        if (budget !== null && !isSupportedTravelMoney(budget)) throw new Error('invalid');
        if (trip.legacyBudgetMajor !== undefined && !finiteNumber(trip.legacyBudgetMajor)) throw new Error('invalid');
        return { ...trip };
      }
      if (budget === undefined || budget === null) return { ...trip, budget: null };
      if (!finiteNumber(budget)) throw new Error('invalid');
      try { return { ...trip, budget: supportedMoney(legacyMajorUnitsToMinorUnits(budget)) }; }
      catch { return { ...trip, budget: null, legacyBudgetMajor: budget }; }
    });

  const nextExpenses: Record<string, unknown>[] | undefined = expenses === undefined ? undefined
    : (expenses as Record<string, unknown>[]).map((expense) => {
      if (!finiteNumber(expense.amount)) throw new Error('invalid');
      if (version >= 7) {
        if (expense.resolutionStatus !== 'requires-transaction-date'
          || Object.prototype.hasOwnProperty.call(expense, 'transactionDate')
          || (expense.amountMinor !== undefined && !isSupportedTravelMoney(expense.amountMinor))) throw new Error('invalid');
        return { ...expense };
      }
      const next: Record<string, unknown> = { ...expense, resolutionStatus: 'requires-transaction-date' };
      delete next.transactionDate;
      try { next.amountMinor = supportedMoney(legacyMajorUnitsToMinorUnits(expense.amount)); } catch { delete next.amountMinor; }
      return next;
    });

  return {
    ok: true,
    value: {
      ...partial,
      ...(nextTrips === undefined ? {} : { trips: nextTrips }),
      ...(nextExpenses === undefined ? {} : { expenses: nextExpenses }),
    },
  };
}

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function isSupportedTravelMoney(value: unknown): value is MinorUnits {
  try { return supportedMoney(value) === value; } catch { return false; }
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
    if (storeKey === 'trips') {
      try {
        const travel = canonicalTravelMoney(canonical.value, version);
        if (!travel.ok) return travel;
        data[storeKey] = travel.value;
      } catch {
        return { ok: false, error: 'invalid_format' };
      }
      continue;
    }
    if (storeKey === 'food') {
      const food = canonicalRecipeIngredients(canonical.value, version);
      if (!food.ok) return food;
      const pantry = canonicalPantryItems(food.value, version);
      if (!pantry.ok) return pantry;
      const shopping = canonicalShoppingItems(pantry.value, version);
      if (!shopping.ok) return shopping;
      data[storeKey] = shopping.value;
      continue;
    }
    if (storeKey === 'household') {
      const household = canonicalHouseholdTasks(canonical.value, version);
      if (!household.ok) return household;
      data[storeKey] = household.value;
      continue;
    }
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
