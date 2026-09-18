import {
  DEFAULT_RECURRENCE_FREQUENCY,
  isCoherentRecurrence,
  parseIsoDate,
  repairLegacyOccurrenceDate,
} from '@/core/economy/recurrence';
import { legacyMajorUnitsToMinorUnits } from '@/core/money/legacyMajorUnits';
import { isSupportedMoney } from '@/core/money/supportedMoney';
import type { LocalMigrationDefinition } from './harness';

/**
 * APP-040: Economy money v0 (major-unit JS numbers) → v1 (DKK MinorUnits).
 * APP-042: Expenses v1 → v2, adding the explicit recurrence frequency and day
 * anchor, and repairing the impossible recurring dates the pre-APP-042
 * `rollForwardMonth` could write (for example "2026-02-31").
 *
 * Every historical writer (49c4355 through c73bf68) used Zustand's explicit
 * version 0 with the state keys below; no versionless or v1-without-money shape
 * exists. Steps convert each money field exactly once with the shared strict
 * legacy converter and copy every other value, key and array position as-is.
 * v1 money must be supported persisted money (`isSupportedMoney`): a safe integer
 * that cannot round-trip the server transport or display exactly is not healthy
 * v1 state, whether it came from conversion or is already stored. Any failure
 * throws or fails validation, so the harness writes nothing.
 */

type Json = Record<string, unknown>;
const record = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const legacyAmount = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const amountFor = (version: number) => (version === 0 ? legacyAmount : isSupportedMoney);

function envelope(v: unknown, stateKeys: readonly string[]): Json | null {
  if (!record(v) || !record(v.state)) return null;
  if (!Object.keys(v).every((key) => key === 'state' || key === 'version')) return null;
  return Object.keys(v.state).every((key) => stateKeys.includes(key)) ? v.state : null;
}

const detectVersion = (v: unknown): number | null => {
  if (!record(v) || !('version' in v)) return null;
  return typeof v.version === 'number' ? v.version : NaN;
};

const amounts = (v: unknown, valid: (value: unknown) => boolean) => record(v) && Object.values(v).every(valid);
const entries = (v: unknown, fields: readonly string[], valid: (value: unknown) => boolean) =>
  Array.isArray(v) && v.every((item) => record(item) && fields.every((field) => valid(item[field])));

/** Replace listed money fields; spread keeps every other field and the key order. */
function convertFields(item: Json, fields: readonly string[]): Json {
  const converted = { ...item };
  for (const field of fields) converted[field] = legacyMajorUnitsToMinorUnits(item[field]);
  return converted;
}
function convertRecord(values: Json): Json {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, legacyMajorUnitsToMinorUnits(value)]));
}

function upgrade(
  v: unknown,
  known: (value: unknown, version: number) => boolean,
  convert: (state: Json) => Json,
  from = 0,
) {
  if (!known(v, from)) throw new Error('unknown-legacy-shape');
  const current = v as Json;
  return { ...current, state: convert(current.state as Json), version: from + 1 };
}

const EXPENSE_STATE = ['expenses', 'seriesStoppedAt', 'categoryBudgets'];
const EXPENSE_MONEY = ['amount'];
/**
 * APP-042: v2 adds `recurrenceFrequency` and `recurrenceAnchorDay`. v0 and v1 rows
 * only declare `isRecurring`, which meant monthly in every shipped build; v2 states
 * the cadence and the day the schedule is anchored to, and the triple must stay
 * coherent (one-time → null/null, recurring → a supported frequency and a 1–31 day).
 */
const recurring = (expense: Json) => expense.isRecurring;
const RECURRENCE_FIELDS = ['recurrenceFrequency', 'recurrenceAnchorDay'];
const hasOwn = (expense: Json, field: string) => Object.prototype.hasOwnProperty.call(expense, field);

/**
 * Persistence is stricter than the shared runtime rule. `isCoherentRecurrence`
 * accepts an absent field as "no recurrence", which suits object construction, but
 * canonical v2 bytes must SAY what they are: both fields exist on every expense,
 * explicitly null for a one-time cost. And a v2 recurring date is current data, so
 * it must be a real calendar date — the permissive legacy reading belongs to the
 * v1 → v2 step alone. One-time dates keep whatever the schema accepted before.
 */
function knownV2Recurrence(expense: Json): boolean {
  if (!RECURRENCE_FIELDS.every((field) => hasOwn(expense, field))) return false;
  if (!isCoherentRecurrence(recurring(expense), expense.recurrenceFrequency, expense.recurrenceAnchorDay)) return false;
  return !recurring(expense) || parseIsoDate(expense.nextPaymentDate) !== null;
}

function knownExpenses(v: unknown, version: number): boolean {
  const state = envelope(v, EXPENSE_STATE);
  if (!state || (v as Json).version !== version || !record(state.seriesStoppedAt)) return false;
  if (!entries(state.expenses, EXPENSE_MONEY, amountFor(version)) || !amounts(state.categoryBudgets, amountFor(version))) {
    return false;
  }
  // Before v2 the fields must be absent; from v2 they must be present and coherent.
  return (state.expenses as Json[]).every((expense) => version < 2
    ? typeof recurring(expense) === 'boolean' && RECURRENCE_FIELDS.every((field) => !hasOwn(expense, field))
    : knownV2Recurrence(expense));
}

/**
 * The v1 → v2 transform for one expense. A one-time cost gets null/null. A
 * recurring cost keeps the day it was written with as its anchor, and its stored
 * date is repaired when it is the known pre-APP-042 defect: `rollForwardMonth`
 * concatenated the previous day number onto a new month without checking the
 * calendar, so strings like "2026-02-31" exist on devices. The date is clamped to
 * that same month's real last day and the intended day survives as the anchor.
 * A date outside that known pattern throws, so the harness writes nothing.
 */
function withRecurrence(expense: Json): Json {
  if (!recurring(expense)) return { ...expense, recurrenceFrequency: null, recurrenceAnchorDay: null };
  const repaired = repairLegacyOccurrenceDate(expense.nextPaymentDate);
  if (!repaired) throw new Error('unknown-legacy-shape');
  return {
    ...expense,
    nextPaymentDate: repaired.date,
    recurrenceFrequency: DEFAULT_RECURRENCE_FREQUENCY,
    recurrenceAnchorDay: repaired.anchorDay,
  };
}

/** Inner Zustand payload of the encrypted `lifesort-expenses` store (see documentCacheStorage). */
export const expensesMoneyMigration: LocalMigrationDefinition = {
  storeId: 'async-storage:lifesort-expenses',
  storageKey: 'lifesort-expenses',
  currentVersion: 2,
  detectVersion,
  steps: {
    0: (v) => upgrade(v, knownExpenses, (state) => ({
      ...state,
      expenses: (state.expenses as Json[]).map((expense) => convertFields(expense, EXPENSE_MONEY)),
      categoryBudgets: convertRecord(state.categoryBudgets as Json),
    })),
    // Money, IDs, series, attachments and budgets are copied untouched; only a
    // legacy impossible recurring date is repaired (see withRecurrence).
    1: (v) => upgrade(v, knownExpenses, (state) => ({
      ...state,
      expenses: (state.expenses as Json[]).map(withRecurrence),
    }), 1),
  },
  validateCurrent: (v) => knownExpenses(v, 2),
};

function knownIncome(v: unknown, version: number): boolean {
  const state = envelope(v, ['incomeByMonth']);
  return !!state && (v as Json).version === version && amounts(state.incomeByMonth, amountFor(version));
}

export const incomeMoneyMigration: LocalMigrationDefinition = {
  storeId: 'async-storage:lifesort-income-v2',
  // "-v2" is part of the key name, not a schema version.
  storageKey: 'lifesort-income-v2',
  currentVersion: 1,
  detectVersion,
  steps: {
    // An explicitly stored zero stays a key with 0; an absent month stays absent.
    0: (v) => upgrade(v, knownIncome, (state) => ({ ...state, incomeByMonth: convertRecord(state.incomeByMonth as Json) })),
  },
  validateCurrent: (v) => knownIncome(v, 1),
};

const GOAL_MONEY = ['targetAmount', 'savedAmount'];
const HISTORY_MONEY = ['amount'];
function knownSavings(v: unknown, version: number): boolean {
  const state = envelope(v, ['goals', 'history', 'extraSavings']);
  const valid = amountFor(version);
  return !!state && (v as Json).version === version && valid(state.extraSavings) &&
    entries(state.goals, GOAL_MONEY, valid) && entries(state.history, HISTORY_MONEY, valid);
}

export const savingsGoalsMoneyMigration: LocalMigrationDefinition = {
  storeId: 'async-storage:lifesort-savings-goals',
  storageKey: 'lifesort-savings-goals',
  currentVersion: 1,
  detectVersion,
  steps: {
    // History signs are preserved: positive deposits, negative withdrawals.
    0: (v) => upgrade(v, knownSavings, (state) => ({
      ...state,
      goals: (state.goals as Json[]).map((goal) => convertFields(goal, GOAL_MONEY)),
      history: (state.history as Json[]).map((entry) => convertFields(entry, HISTORY_MONEY)),
      extraSavings: legacyMajorUnitsToMinorUnits(state.extraSavings),
    })),
  },
  validateCurrent: (v) => knownSavings(v, 1),
};
