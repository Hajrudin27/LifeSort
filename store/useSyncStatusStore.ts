import { create } from 'zustand';

import { createManualSyncStatus } from '@/core/sync/manualSyncStatus';
import { CLEAR_SYNC_STATUS, type SyncStatusProjection } from '@/core/sync/syncStatus';

let controller: ReturnType<typeof createManualSyncStatus> | null = null;

interface SyncStatusState {
  projection: SyncStatusProjection;
  retry: (accountId: string, mutationId: string) => Promise<void>;
  clearLocal: () => void;
}

/** APP-036: ephemeral, account-bound UI only; never rehydrate legacy sync-status. */
export const useSyncStatusStore = create<SyncStatusState>(() => ({
  projection: CLEAR_SYNC_STATUS,
  retry: async (accountId, mutationId) => { await controller?.retry(accountId, mutationId); },
  clearLocal: () => {
    controller?.reset();
    useSyncStatusStore.setState({ projection: CLEAR_SYNC_STATUS });
  },
}));

/** Auth lifecycle injected by the shell to avoid an auth/reset/store import cycle. */
export function observeSyncStatus(
  getAccount: () => string | null,
  subscribeAccount: (listener: () => void) => () => void,
): () => void {
  controller?.dispose();
  const observer = createManualSyncStatus(getAccount, (projection) => useSyncStatusStore.setState({ projection }));
  controller = observer;
  const unsubscribe = subscribeAccount(() => observer.setAccount(getAccount()));
  observer.setAccount(getAccount());
  return () => {
    unsubscribe();
    observer.dispose();
    if (controller === observer) controller = null;
  };
}

// Legacy direct-write callers have no durable mutation or captured account epoch.
// Retain their return/control-flow contract, but never publish unscoped completion
// reports as durable sync truth. Domain adoption is incremental (ADR-0031).
export function reportSyncFailure(_module: string, _operation: string, _error: unknown): void {}
export function reportSyncSuccess(_module: string): void {}
export function trackSync(
  _module: string, _operation: string, result: { error?: unknown } | null | undefined,
): boolean {
  return !result?.error;
}
