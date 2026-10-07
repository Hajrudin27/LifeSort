import type { DataDomainId } from '@/core/storage/dataProfileRegistry';
import type { OutboxMutation } from '@/core/sync/outbox';

/**
 * APP-061 — after a sender durably records a refusal it will not retry, the owning
 * domain may reconcile against authoritative state and supersede the blocked chain.
 * Domains register here (core never imports a domain). A handler sends nothing itself.
 */
export type PermanentFailureHandler = (accountId: string, mutation: OutboxMutation) => void;

const handlers = new Map<string, PermanentFailureHandler>();

export function registerPermanentFailureHandler(dataDomain: DataDomainId, handler: PermanentFailureHandler): () => void {
  handlers.set(dataDomain, handler);
  return () => { if (handlers.get(dataDomain) === handler) handlers.delete(dataDomain); };
}

export function notifyPermanentFailure(accountId: string, mutation: OutboxMutation): void {
  try { handlers.get(mutation.dataDomain)?.(accountId, mutation); } catch { /* Never a sender fault. */ }
}
