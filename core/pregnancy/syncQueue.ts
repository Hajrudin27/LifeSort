import { createPregnancyProtectedRepository, pregnancyMutationIsAutomaticallyEligible, subscribePregnancyQueue, type PregnancyQueuedMutation, type PregnancyTerminalReason } from '@/core/pregnancy/protectedRepository';
import { planFailedAttempt } from '@/core/sync/retryPolicy';

export type PregnancySyncWorkPlan = { readonly due: readonly PregnancyQueuedMutation[]; readonly nextRetryAtMs: number | null };

function chainKey(mutation: PregnancyQueuedMutation): string {
  return `${mutation.entityType}\u0000${mutation.entityId}`;
}

/**
 * Pregnancy queue ordering differs deliberately from the Profile-A planner:
 * terminal consent-bound upserts are retained evidence, not chain heads. This
 * leaves a later payload-free delete sendable after consent withdrawal/refusal.
 */
export function planPregnancySyncWork(
  mutations: readonly PregnancyQueuedMutation[], nowMs: number, limit: number,
): PregnancySyncWorkPlan {
  const chains = new Map<string, PregnancyQueuedMutation[]>();
  for (const mutation of mutations) {
    const key = chainKey(mutation); const chain = chains.get(key) ?? [];
    chain.push(mutation); chains.set(key, chain);
  }
  const due: PregnancyQueuedMutation[] = [];
  let nextRetryAtMs: number | null = null;
  for (const chain of chains.values()) {
    // Historical terminal upserts do not order or authorize later work.
    const head = chain.find((mutation) => mutation.terminalReason === undefined);
    if (!head || !pregnancyMutationIsAutomaticallyEligible(head)) continue;
    if (head.status === 'pending') { due.push(head); continue; }
    if (head.nextRetryAt === undefined) continue;
    const retryAtMs = Date.parse(head.nextRetryAt);
    if (!Number.isFinite(retryAtMs)) continue;
    if (retryAtMs <= nowMs) due.push(head);
    else nextRetryAtMs = nextRetryAtMs === null ? retryAtMs : Math.min(nextRetryAtMs, retryAtMs);
  }
  return { due: due.slice(0, Math.max(limit, 0)), nextRetryAtMs };
}

export type PregnancyFailureReason =
  | 'consent-required' | 'revision-conflict' | 'mutation-id-conflict'
  | 'validation' | 'authorization' | 'rate-limited' | 'unavailable' | 'unknown-conflict';

export type PregnancyFailureRecord = { readonly recorded: boolean; readonly recoveryRequired: boolean };

/** Durable, encrypted-only consequence of a completed Pregnancy send attempt. */
export async function recordPregnancySyncFailure(
  repository: ReturnType<typeof createPregnancyProtectedRepository>,
  mutation: PregnancyQueuedMutation,
  reason: PregnancyFailureReason,
  attempted: boolean,
  nowMs: number,
  random?: () => number,
): Promise<PregnancyFailureRecord> {
  if (!repository.isActive()) return { recorded: false, recoveryRequired: false };
  const retryCode = reason === 'rate-limited' ? 'unavailable' : reason === 'unavailable' ? 'unavailable' : 'validation';
  const planned = attempted
    ? planFailedAttempt(mutation.attempts, retryCode, nowMs, random)
    : { status: 'failed' as const, attempts: mutation.attempts, nextRetryAt: null };
  const terminalReason: PregnancyTerminalReason | undefined = reason === 'consent-required' ? 'consent-required' : undefined;
  // Both `unavailable` and rate-limit use the established APP-037 schedule.
  const transient = reason === 'unavailable' || reason === 'rate-limited';
  const patch = transient ? planned : { status: 'failed' as const, attempts: planned.attempts, nextRetryAt: null };
  const recorded = await repository.recordFailure(mutation.mutationId, patch, terminalReason);
  return { recorded, recoveryRequired: reason === 'mutation-id-conflict' || reason === 'unknown-conflict' };
}

/** Opens an epoch-pinned encrypted queue handle for future B2B engine wiring. */
export async function openPregnancySyncQueue(options: { accountId: string; getActiveAccount: () => string | null }) {
  const discovery = createPregnancyProtectedRepository(options);
  const state = await discovery.hydrate();
  if (state === null) throw new Error('Pregnancy protected dataset is unavailable.');
  const repository = createPregnancyProtectedRepository({ ...options, datasetEpoch: state.datasetEpoch });
  await repository.hydrate();
  return {
    accountId: options.accountId,
    datasetEpoch: state.datasetEpoch,
    isActive: () => repository.isActive(),
    subscribe: subscribePregnancyQueue,
    list: () => repository.list(),
    plan: planPregnancySyncWork,
    recordFailure: (mutation: PregnancyQueuedMutation, reason: PregnancyFailureReason, attempted: boolean, nowMs: number, random?: () => number) =>
      recordPregnancySyncFailure(repository, mutation, reason, attempted, nowMs, random),
  };
}

/** Retained for tests and future B2B only; no production coordinator registers it in B2A. */
export const pregnancyFailureIsTransient = (reason: PregnancyFailureReason) =>
  reason === 'rate-limited' || reason === 'unavailable';
