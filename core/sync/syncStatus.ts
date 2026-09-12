import type { ConflictFailure } from '@/core/sync/conflictPolicies';
import { supportsServerMutation } from '@/core/sync/mutationSupport';
import type { OutboxMutation } from '@/core/sync/outbox';
import type { ServerMutationResult } from '@/core/sync/serverMutations';
import { getEntityChainHeads } from '@/core/sync/syncEligibility';

export type SyncSafeErrorCode = 'unavailable' | 'auth-required' | 'conflict' | 'validation' | 'unknown';
export type SyncStatus = 'clear' | 'pending' | 'retrying' | 'failed' | 'needs-attention';
export interface SyncStatusProjection {
  readonly accountId: string | null;
  readonly status: SyncStatus;
  readonly count: number;
  readonly errorCode: SyncSafeErrorCode | null;
  readonly retryMutationId: string | null;
  readonly retrying: boolean;
}
export const CLEAR_SYNC_STATUS: SyncStatusProjection = Object.freeze({
  accountId: null, status: 'clear', count: 0, errorCode: null, retryMutationId: null, retrying: false,
});

/** Classify codes only; never inspect Error.message, details, payloads or stacks. */
export function syncSafeError(result: Exclude<ServerMutationResult, { ok: true }> | ConflictFailure): SyncSafeErrorCode {
  if ('kind' in result) return 'conflict';
  switch (result.reason) {
    case 'authorization': return 'auth-required';
    case 'validation': return 'validation';
    case 'conflict': return 'conflict';
    case 'unavailable': return 'unavailable';
    default: return 'unknown';
  }
}

export function canManuallyRetry(mutation: OutboxMutation, code?: SyncSafeErrorCode): boolean {
  if (!supportsServerMutation(mutation)) return false;
  if (code !== undefined) return code === 'unavailable';
  // Without the ephemeral classification, the durable retry timestamp is the only
  // evidence the last failure was transient — APP-037 writes it only then. Its
  // absence still fails closed, so a permanent rejection stays needs-attention.
  return mutation.status === 'pending' || mutation.nextRetryAt !== undefined;
}

const priority: Record<SyncStatus, number> = { clear: 0, pending: 1, retrying: 2, failed: 3, 'needs-attention': 4 };

/** Pure projection. The account binding belongs to the durable outbox handle. */
export function projectSyncStatus(
  activeAccountId: string | null,
  snapshot: { accountId: string; mutations: readonly OutboxMutation[] },
  errors: ReadonlyMap<string, SyncSafeErrorCode> = new Map(),
  retryingId: string | null = null,
): SyncStatusProjection {
  if (!activeAccountId || activeAccountId !== snapshot.accountId) return CLEAR_SYNC_STATUS;
  let status: SyncStatus = 'clear';
  let authRequired = false;
  const retryIds: string[] = [];
  const failedRetryIds: string[] = [];
  const headIds = new Set(getEntityChainHeads(snapshot.mutations).map((entry) => entry.mutationId));
  for (const entry of snapshot.mutations) {
    const code = errors.get(entry.mutationId);
    const eligible = canManuallyRetry(entry, code);
    const state = !eligible ? 'needs-attention'
      : entry.mutationId === retryingId ? 'retrying'
      : entry.status === 'failed' || code ? 'failed' : 'pending';
    if (priority[state] > priority[status]) status = state;
    if (code === 'auth-required') authRequired = true;
    // A pending follower is still pending; ordering limits actions, not status.
    if (eligible && headIds.has(entry.mutationId)) {
      retryIds.push(entry.mutationId);
      if (state === 'failed') failedRetryIds.push(entry.mutationId);
    }
  }
  // Prefer failed heads, then pending heads, each in durable enqueue order.
  const retrying = retryingId !== null;
  return {
    accountId: activeAccountId, status, count: snapshot.mutations.length,
    errorCode: status === 'needs-attention' ? (authRequired ? 'auth-required' : 'unknown')
      : status === 'failed' ? 'unavailable' : null,
    // The global attention banner cannot explain a Retry for another entity.
    retryMutationId: status === 'needs-attention' ? null
      : retryIds.find((id) => id === retryingId) ?? failedRetryIds[0] ?? retryIds[0] ?? null,
    retrying,
  };
}
