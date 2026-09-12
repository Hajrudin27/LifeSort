import { useEffect } from 'react';

import { createAppStateForeground } from '@/core/sync/appForeground';
import { createNetInfoConnectivity } from '@/core/sync/connectivity';
import { createSyncCoordinator } from '@/core/sync/syncCoordinator';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * APP-037 — binds the automatic sender to the signed-in account for as long as
 * the shell is mounted. Orchestration lives in core; this is only the wiring,
 * and unmounting takes the connectivity and lifecycle listeners with it.
 */
export function useSyncCoordinatorLifecycle() {
  useEffect(() => {
    const getActiveAccount = () => useAuthStore.getState().session?.user.id ?? null;
    const coordinator = createSyncCoordinator({
      getActiveAccount,
      connectivity: createNetInfoConnectivity(),
      foreground: createAppStateForeground(),
    });
    const unsubscribe = useAuthStore.subscribe(() => coordinator.setAccount(getActiveAccount()));
    coordinator.setAccount(getActiveAccount());
    return () => {
      unsubscribe();
      coordinator.dispose();
    };
  }, []);
}
