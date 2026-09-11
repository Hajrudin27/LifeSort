import { useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { observeSyncStatus } from '@/store/useSyncStatusStore';

/** Account changes only refresh local presentation; they never send mutations. */
export function useSyncStatusLifecycle() {
  useEffect(() => observeSyncStatus(
    () => useAuthStore.getState().session?.user.id ?? null,
    (listener) => useAuthStore.subscribe(listener),
  ), []);
}
