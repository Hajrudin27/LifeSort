import { legacyMajorUnitsToMinorUnits } from '@/core/money/legacyMajorUnits';
import { isSupportedMoney } from '@/core/money/supportedMoney';
import type { LocalMigrationDefinition } from './harness';

/**
 * APP-040: Economy money v0 (major-unit JS numbers) → v1 (DKK MinorUnits).
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
const amountFor = (version: 0 | 1) => (version === 0 ? legacyAmount : isSupportedMoney);

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

function upgrade(v: unknown, known: (value: unknown, version: 0 | 1) => boolean, convert: (state: Json) => Json) {
  if (!known(v, 0)) throw new Error('unknown-legacy-shape');
  const current = v as Json;
  return { ...current, state: convert(current.state as Json), version: 1 };
}

const EXPENSE_STATE = ['expenses', 'seriesStoppedAt', 'categoryBudgets'];
const EXPENSE_MONEY = ['amount'];
function knownExpenses(v: unknown, version: 0 | 1): boolean {
  const state = envelope(v, EXPENSE_STATE);
  return !!state && (v as Json).version === version && record(state.seriesStoppedAt) &&
    entries(state.expenses, EXPENSE_MONEY, amountFor(version)) && amounts(state.categoryBudgets, amountFor(version));
}

/** Inner Zustand payload of the encrypted `lifesort-expenses` store (see documentCacheStorage). */
export const expensesMoneyMigration: LocalMigrationDefinition = {
  storeId: 'async-storage:lifesort-expenses',
  storageKey: 'lifesort-expenses',
  currentVersion: 1,
  detectVersion,
  steps: {
    0: (v) => upgrade(v, knownExpenses, (state) => ({
      ...state,
      expenses: (state.expenses as Json[]).map((expense) => convertFields(expense, EXPENSE_MONEY)),
      categoryBudgets: convertRecord(state.categoryBudgets as Json),
    })),
  },
  validateCurrent: (v) => knownExpenses(v, 1),
};

function knownIncome(v: unknown, version: 0 | 1): boolean {
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
function knownSavings(v: unknown, version: 0 | 1): boolean {
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
