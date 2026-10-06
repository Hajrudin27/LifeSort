import { legacyMajorUnitsToMinorUnits } from '@/core/money/legacyMajorUnits';
import { isSupportedMoney } from '@/core/money/supportedMoney';
import type { LocalMigrationDefinition } from './harness';

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const STATE_V0 = ['trips', 'expenses', 'packingItems', 'participants', 'myUserId'];
const STATE_V1 = [
  ...STATE_V0,
  'financialProjections',
  'financialProjectionFreshAt',
  'financialProjectionStatus',
  'pendingExpenseDrafts',
];
const STATE_V2 = [...STATE_V1, 'appliedPackingTemplates'];
const TRIP_EXPENSE_CATEGORIES = new Set([
  'flight', 'accommodation', 'transport', 'food', 'activities', 'shopping', 'other',
]);
const DRAFT_STATES = new Set(['pending', 'ambiguous', 'confirmed']);

function envelope(value: unknown, version: number, stateKeys: readonly string[]): Json | null {
  if (!record(value) || value.version !== version || !record(value.state)) return null;
  if (!Object.keys(value).every((key) => key === 'state' || key === 'version')) return null;
  return Object.keys(value.state).every((key) => stateKeys.includes(key)) ? value.state : null;
}

function legacyNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeLegacyMoney(value: unknown) {
  try {
    const amount = legacyMajorUnitsToMinorUnits(value);
    return isSupportedMoney(amount) ? amount : undefined;
  } catch {
    return undefined;
  }
}

function knownV0(value: unknown): boolean {
  const state = envelope(value, 0, STATE_V0);
  return !!state
    && Array.isArray(state.trips)
    && Array.isArray(state.expenses)
    && Array.isArray(state.packingItems)
    && (state.participants === undefined || Array.isArray(state.participants))
    && (state.myUserId === undefined || state.myUserId === null || typeof state.myUserId === 'string')
    && state.trips.every((trip) => record(trip)
      && (trip.budget === undefined || trip.budget === null || legacyNumber(trip.budget)))
    && state.expenses.every((expense) => record(expense) && legacyNumber(expense.amount));
}

function knownCurrentState(state: Json): boolean {
  return Array.isArray(state.trips)
    && Array.isArray(state.expenses)
    && Array.isArray(state.packingItems)
    && Array.isArray(state.participants)
    && Array.isArray(state.financialProjections)
    && record(state.financialProjectionFreshAt)
    && record(state.financialProjectionStatus)
    && (state.pendingExpenseDrafts === undefined || (record(state.pendingExpenseDrafts)
      && Object.entries(state.pendingExpenseDrafts).every(([expenseId, draft]) => record(draft)
        && draft.expenseId === expenseId
        && typeof draft.expenseId === 'string' && draft.expenseId.length > 0
        && typeof draft.accountId === 'string' && draft.accountId.length > 0
        && typeof draft.tripId === 'string' && draft.tripId.length > 0
        && typeof draft.name === 'string' && draft.name.trim().length > 0
        && isSupportedMoney(draft.amount)
        && TRIP_EXPENSE_CATEGORIES.has(draft.category as string)
        && typeof draft.transactionDate === 'string'
        && DRAFT_STATES.has(draft.status as string))))
    && state.trips.every((trip) => record(trip)
      && (trip.budget === null || isSupportedMoney(trip.budget))
      && (trip.legacyBudgetMajor === undefined || legacyNumber(trip.legacyBudgetMajor)))
    && state.expenses.every((expense) => record(expense)
      && legacyNumber(expense.amount)
      && expense.resolutionStatus === 'requires-transaction-date'
      && !Object.prototype.hasOwnProperty.call(expense, 'transactionDate')
      && (expense.amountMinor === undefined || isSupportedMoney(expense.amountMinor)));
}

function knownV1(value: unknown): boolean {
  const state = envelope(value, 1, STATE_V1);
  return !!state && knownCurrentState(state);
}

function validAppliedTemplates(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const keys = new Set<string>();
  for (const application of value) {
    if (!record(application)
      || typeof application.tripId !== 'string' || application.tripId.length === 0
      || typeof application.templateId !== 'string' || application.templateId.trim().length === 0
      || typeof application.templateVersion !== 'number'
      || !Number.isInteger(application.templateVersion) || application.templateVersion <= 0
      || (application.appliedBy !== undefined && typeof application.appliedBy !== 'string')
      || (application.appliedAt !== undefined && typeof application.appliedAt !== 'string')) return false;
    const key = `${application.tripId}\u0000${application.templateId}\u0000${application.templateVersion}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

function knownV2(value: unknown): boolean {
  const state = envelope(value, 2, STATE_V2);
  return !!state && knownCurrentState(state) && validAppliedTemplates(state.appliedPackingTemplates);
}

function migrateTrip(trip: Json): Json {
  if (trip.budget === undefined || trip.budget === null) return { ...trip, budget: null };
  const budget = safeLegacyMoney(trip.budget);
  return budget === undefined
    ? { ...trip, budget: null, legacyBudgetMajor: trip.budget }
    : { ...trip, budget };
}

function migrateExpense(expense: Json): Json {
  const amountMinor = safeLegacyMoney(expense.amount);
  return {
    ...expense,
    ...(amountMinor === undefined ? {} : { amountMinor }),
    resolutionStatus: 'requires-transaction-date',
  };
}

/**
 * APP-059: encrypted Travel v0 → v1.
 *
 * Budgets become exact MinorUnits when safe. Every old expense remains a legacy
 * historical record: its original major-unit value and metadata are copied, a
 * safe converted amount is supplementary, and no transaction date is created.
 */
export const travelMoneyMigration: LocalMigrationDefinition = {
  storeId: 'async-storage:lifesort-trips',
  storageKey: 'lifesort-trips',
  currentVersion: 2,
  detectVersion: (value) => record(value) && typeof value.version === 'number' ? value.version : null,
  steps: {
    0: (value) => {
      if (!knownV0(value)) throw new Error('unknown-legacy-shape');
      const current = value as Json;
      const state = current.state as Json;
      return {
        ...current,
        state: {
          ...state,
          participants: state.participants ?? [],
          myUserId: state.myUserId ?? null,
          trips: (state.trips as Json[]).map(migrateTrip),
          expenses: (state.expenses as Json[]).map(migrateExpense),
          financialProjections: [],
          financialProjectionFreshAt: {},
          financialProjectionStatus: {},
          pendingExpenseDrafts: {},
        },
        version: 1,
      };
    },
    1: (value) => {
      if (!knownV1(value)) throw new Error('unknown-v1-shape');
      const current = value as Json;
      return {
        ...current,
        state: {
          ...(current.state as Json),
          appliedPackingTemplates: [],
        },
        version: 2,
      };
    },
  },
  validateCurrent: knownV2,
};
