/**
 * Narrow APP-059 boundary from the canonical Economy store to Travel's derived
 * financial projection. Kept as a single registered owner instead of a generic
 * event bus: Economy can only invalidate by canonical expense id, then request a
 * server-confirmed refresh of the exact affected trips after its write succeeds.
 */
export interface TravelProjectionInvalidation {
  /** Account whose Economy mutation made this projection stale. */
  readonly accountId: string | null;
  readonly tripIds: readonly string[];
  /** Token installed when the projection became stale; a later mutation supersedes it. */
  readonly requestTokens: Readonly<Record<string, number>>;
}

interface Handler {
  invalidateExpense(expenseId: string, accountId: string | null): TravelProjectionInvalidation;
  refreshAfterCommit(invalidation: TravelProjectionInvalidation): Promise<void>;
}

let handler: Handler | null = null;

export function registerEconomyMutationInvalidation(next: Handler): void {
  handler = next;
}

export function invalidateTravelProjectionForExpense(
  expenseId: string,
  accountId: string | null,
): TravelProjectionInvalidation {
  return handler?.invalidateExpense(expenseId, accountId) ?? { accountId, tripIds: [], requestTokens: {} };
}

export async function refreshTravelProjectionAfterEconomyCommit(
  invalidation: TravelProjectionInvalidation,
): Promise<void> {
  await handler?.refreshAfterCommit(invalidation);
}

export function combineTravelProjectionInvalidations(
  invalidations: readonly TravelProjectionInvalidation[],
): TravelProjectionInvalidation {
  return {
    accountId: invalidations.find(({ accountId }) => accountId !== null)?.accountId ?? null,
    tripIds: [...new Set(invalidations.flatMap(({ tripIds }) => tripIds))],
    requestTokens: Object.assign({}, ...invalidations.map(({ requestTokens }) => requestTokens)),
  };
}
