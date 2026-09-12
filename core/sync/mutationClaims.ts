/**
 * APP-037 — one client sender per mutation.
 *
 * APP-032 makes a duplicate send harmless on the server, but two requests for
 * the same intent are still wasted radio time and a confusing status. The claim
 * is process-local and ephemeral on purpose: it must never survive a restart,
 * where it could strand a mutation nobody is actually sending. Durable
 * exclusion belongs to the outbox, not to a lock.
 */

const claims = new Set<string>();

/**
 * Account-scoped: two accounts cannot collide, and neither can block the other.
 * The separator is written as an escape rather than a literal control byte, so
 * this file stays reviewable text — git treats a source file containing NUL as
 * binary and stops showing its diff. The runtime value is unchanged.
 */
function claimKey(accountId: string, mutationId: string): string {
  return `${accountId}\u0000${mutationId}`;
}

/** True if this caller now owns the send. False means someone else already does. */
export function claimMutation(accountId: string, mutationId: string): boolean {
  const key = claimKey(accountId, mutationId);
  if (claims.has(key)) return false;
  claims.add(key);
  return true;
}

/** Always from a finally block, including when the sender threw. */
export function releaseMutation(accountId: string, mutationId: string): void {
  claims.delete(claimKey(accountId, mutationId));
}

export function isMutationClaimed(accountId: string, mutationId: string): boolean {
  return claims.has(claimKey(accountId, mutationId));
}

/** Test seam. Production releases every claim through its own finally block. */
export function releaseAllMutationClaims(): void {
  claims.clear();
}
