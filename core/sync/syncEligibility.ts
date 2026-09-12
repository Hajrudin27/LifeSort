import { supportsServerMutation } from '@/core/sync/mutationSupport';
import type { OutboxMutation } from '@/core/sync/outbox';

/**
 * APP-037 — which durable work is allowed to be sent right now.
 *
 * Pure over an APP-031 snapshot: the outbox stays the only source of truth, and
 * no second retry ledger is invented. Two rules decide everything here.
 *
 * 1. An entity's mutations are a chain. Only its oldest outstanding mutation is
 *    ever eligible, so "off, on, off" can never arrive as "off, off, on".
 * 2. A blocked chain blocks only itself. One rejected module choice must not
 *    stop every other module from syncing.
 */

export interface SyncWorkPlan {
  /** Sendable now, oldest first, capped by the batch limit. */
  readonly due: readonly OutboxMutation[];
  /** Earliest future retry among chain heads, or null if nothing is waiting. */
  readonly nextRetryAtMs: number | null;
}

/**
 * Enqueue order within a chain is the persisted array order — it survives restart.
 * The separator is an escape, never a literal control byte: a source file holding
 * NUL is binary to git, and an unreviewable diff is its own kind of bug.
 */
export function entityChainKey(mutation: OutboxMutation): string {
  return `${mutation.dataDomain}\u0000${mutation.entityType}\u0000${mutation.entityId}`;
}

/**
 * Chain heads in enqueue order. A head that cannot be sent — unsupported
 * envelope, or a failure with no scheduled retry — is deliberately left in
 * place blocking its own chain rather than skipped or discarded.
 */
export function getEntityChainHeads(mutations: readonly OutboxMutation[]): readonly OutboxMutation[] {
  const heads = new Map<string, OutboxMutation>();
  for (const mutation of mutations) {
    const key = entityChainKey(mutation);
    if (!heads.has(key)) heads.set(key, mutation);
  }
  return [...heads.values()];
}

export function planSyncWork(
  mutations: readonly OutboxMutation[],
  nowMs: number,
  limit: number,
): SyncWorkPlan {

  const due: OutboxMutation[] = [];
  let nextRetryAtMs: number | null = null;

  for (const head of getEntityChainHeads(mutations)) {
    if (!supportsServerMutation(head)) continue;
    if (head.status === 'pending') {
      due.push(head);
      continue;
    }
    // A failure the classifier called permanent has no timestamp, and must not
    // acquire one by accident. Only a user action moves that chain again.
    if (head.nextRetryAt === undefined) continue;
    const retryAtMs = Date.parse(head.nextRetryAt);
    if (!Number.isFinite(retryAtMs)) continue;
    if (retryAtMs <= nowMs) due.push(head);
    else nextRetryAtMs = nextRetryAtMs === null ? retryAtMs : Math.min(nextRetryAtMs, retryAtMs);
  }

  // The wake-up time covers every waiting chain, even the ones the cap cut off.
  return { due: due.slice(0, Math.max(limit, 0)), nextRetryAtMs };
}
