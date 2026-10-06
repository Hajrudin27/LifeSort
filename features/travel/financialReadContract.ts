import { subtractMinorUnits, type MinorUnits } from '@/core/money/minorUnits';
import { settledFinancialSpending, type FinancialTransaction } from '@/features/economy/financialReadModel';
import type { Trip, TripExpense, TripExpenseCategory, TripFinancialProjection } from '@/types/trip';
import { parseCalendarDate } from '@/utils/shared/localDate';

/** Stable Economy identity is owner + expense id; trip/category are relationships. */
export function tripProjectionEntry(projection: TripFinancialProjection): FinancialTransaction {
  if (parseCalendarDate(projection.transactionDate) === null) throw new Error('travel_transaction_date_invalid');
  return {
    source: {
      kind: 'manual',
      representation: 'transaction',
      id: JSON.stringify([projection.expenseOwnerId, projection.expenseId]),
    },
    semantic: projection.semantic,
    amount: projection.amount,
    currency: 'DKK',
    date: projection.transactionDate,
    status: projection.status,
  };
}

/** Unresolved legacy records cannot enter this function and therefore never count. */
export function settledTripSpend(
  projections: readonly TripFinancialProjection[],
  category?: TripExpenseCategory,
): MinorUnits {
  return settledFinancialSpending(
    projections
      .filter((projection) => category === undefined || projection.category === category)
      .map(tripProjectionEntry),
  );
}

export function remainingTripBudget(budget: MinorUnits, spent: MinorUnits): MinorUnits {
  return subtractMinorUnits(budget, spent);
}

/**
 * How far the cached projection behind a set of trips may be trusted (APP-059 review #1).
 *
 *  - `fresh`: every trip's snapshot was revalidated by the server during THIS app
 *    session. Only then is a total current and authoritative.
 *  - `stale`: every trip has a saved snapshot, but at least one has not been
 *    revalidated — it was read back from disk, or its refresh failed. It may be
 *    shown, but only labelled as not current.
 *  - `unavailable`: some trip has no snapshot at all, so even a stale total would
 *    silently leave its spend out.
 *
 * `freshAt` records that a snapshot exists; `status` is 'fresh' only in memory.
 */
export type TripSpendFreshness = 'fresh' | 'stale' | 'unavailable';

export function tripSpendFreshness(
  tripIds: Iterable<string>,
  freshAt: Readonly<Record<string, string>>,
  status: Readonly<Record<string, 'fresh' | 'stale'>>,
): TripSpendFreshness {
  let stale = false;
  for (const tripId of tripIds) {
    if (freshAt[tripId] === undefined) return 'unavailable';
    if (status[tripId] !== 'fresh') stale = true;
  }
  return stale ? 'stale' : 'fresh';
}

/**
 * Whether the cached projection may be shown to the signed-in account at all.
 *
 * The cache belongs to the account whose Travel dataset this is (`myUserId`). A session
 * can switch accounts without the normal local cleanup — another account's
 * password-recovery link calls `setSession` in place. Until the new account's own trip
 * fetch replaces the cache, it is the previous account's, and nobody else is shown it.
 */
export function projectionVisibleTo(
  datasetAccountId: string | null | undefined,
  viewerAccountId: string | null | undefined,
): boolean {
  return !!viewerAccountId && datasetAccountId === viewerAccountId;
}

/**
 * A legacy row the server has already resolved into its canonical Economy expense,
 * shown by the server's own record in the projection. It is kept only until Economy
 * durably owns its attachments. Its money already counts through the canonical expense,
 * so it is saved, not unresolved.
 */
export function legacyResolutionPending(
  expenseId: string,
  projections: readonly TripFinancialProjection[],
  accountId: string | null | undefined,
): boolean {
  return !!accountId && projections.some((projection) => projection.expenseId === expenseId
    && projection.legacyTripExpenseId === expenseId && projection.expenseOwnerId === accountId);
}

/**
 * Who may turn a legacy Travel expense into a canonical Economy expense (APP-059
 * review #1). It fails closed. The server refuses every other author anyway
 * (`legacy_author_mismatch`); this rule keeps the client from offering or sending
 * a resolution it cannot show to be the user's own.
 *
 *  - No signed-in user: nobody.
 *  - A known author (the server's `trip_expenses.user_id`): only that author.
 *  - No known author: only on a trip the user owns. For an owned trip the client
 *    reads only the user's own rows, so an unattributed row there is the user's own
 *    (device-only) history. On someone else's trip, or one whose owner is unknown,
 *    it could be anybody's.
 */
export function canResolveLegacyTripExpense(
  expense: Pick<TripExpense, 'authorId'>,
  trip: Pick<Trip, 'ownerId'> | undefined,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  if (expense.authorId !== undefined) return expense.authorId === userId;
  return trip?.ownerId === userId;
}
