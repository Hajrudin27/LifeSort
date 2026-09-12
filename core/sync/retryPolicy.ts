import type { OutboxMetadataUpdate } from '@/core/sync/outbox';
import type { SyncSafeErrorCode } from '@/core/sync/syncStatus';

/**
 * APP-037 — the one retry schedule shared by the automatic coordinator and the
 * manual APP-036 action. Pure arithmetic over the APP-031 durable fields; it
 * neither reads nor writes storage, and never sees payloads or raw errors.
 */

/** First failure waits between half of this and all of it. */
export const RETRY_BASE_DELAY_MS = 5_000;
/** No automatic wait ever exceeds five minutes, however many attempts failed. */
export const RETRY_MAX_DELAY_MS = 300_000;
/** Sends attempted in one cycle before the rest wait for a continuation pass. */
export const SYNC_BATCH_LIMIT = 10;
/** Never zero: the gap is what makes a drain a schedule instead of a loop. */
export const SYNC_CONTINUATION_DELAY_MS = 1_000;

/**
 * Only a confirmed transient result earns an automatic retry. Authorization,
 * validation, conflict and unknown outcomes stop the schedule and wait for the
 * user, which is also what keeps a rejected mutation from hammering the server.
 */
export function isTransientSyncFailure(code: SyncSafeErrorCode): boolean {
  return code === 'unavailable';
}

/**
 * Exponential backoff with equal jitter, for the nth *completed failed* send.
 * Half the window is fixed so a retry is never immediate; the other half is
 * random so devices that lost connectivity together do not return together.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const failures = Number.isFinite(attempt) && attempt >= 1 ? Math.floor(attempt) : 1;
  // 2 ** huge is Infinity, not NaN; Math.min then yields the cap. No overflow.
  const growth = failures >= 64 ? Infinity : 2 ** (failures - 1);
  const cap = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * growth);
  const jitter = Math.min(Math.max(random(), 0), 1);
  return Math.round(cap / 2 + (cap / 2) * jitter);
}

/**
 * The durable consequence of one send that was not acknowledged. `attempts`
 * counts completed unacknowledged sends — inspecting a mutation never raises it.
 * A permanent outcome clears nextRetryAt, which is what marks it as needing a
 * person rather than another timer.
 */
export function planFailedAttempt(
  attempts: number,
  code: SyncSafeErrorCode,
  nowMs: number,
  random?: () => number,
): OutboxMetadataUpdate & { status: 'failed'; attempts: number; nextRetryAt: string | null } {
  const counted = Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : 0;
  const next = Math.min(counted + 1, Number.MAX_SAFE_INTEGER);
  return {
    status: 'failed',
    attempts: next,
    nextRetryAt: isTransientSyncFailure(code)
      ? new Date(nowMs + retryDelayMs(next, random)).toISOString()
      : null,
  };
}
