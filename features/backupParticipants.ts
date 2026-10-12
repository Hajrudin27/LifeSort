import { useGiftsStore } from '@/store/useGiftsStore';
import type { BackupParticipant } from '@/utils/shared/dataBackup';

/**
 * The domains that join a backup through the injected seam in utils/shared/dataBackup.ts
 * (APP-069, ADR-0056).
 *
 * Core must not import a domain store (R6, ADR-0003), so the list lives here, where things are put
 * together — the same pattern as LOCAL_STORE_RESETS in features/localStores.ts. The caller of
 * `exportBackup` / `importBackup` passes it in; nothing is registered and nothing is looked up.
 *
 * Only Gifts joins today. Every other domain keeps the existing STORE_REGISTRY path unchanged:
 * migrating them is not this story's work.
 */
export const BACKUP_PARTICIPANTS: readonly BackupParticipant[] = [
  {
    key: 'gifts',
    exportSnapshot: () => useGiftsStore.getState().exportBackup(),
    restore: (validated) => useGiftsStore.getState().restoreBackup(validated),
  },
];
