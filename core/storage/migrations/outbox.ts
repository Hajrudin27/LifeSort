import { validateOutboxEnvelope } from '@/core/sync/outboxValidation';
import type { LocalMigrationDefinition } from './harness';

/** APP-031 through APP-037 use exactly this v1 envelope; there is no known v0. */
export const outboxMigration: LocalMigrationDefinition = {
  storeId: 'async-storage:lifesort-outbox',
  storageKey: 'lifesort-outbox',
  currentVersion: 1,
  detectVersion: (v) => {
    if (typeof v !== 'object' || v === null || !('version' in v)) return null;
    return typeof v.version === 'number' ? v.version : NaN;
  },
  steps: {},
  validateCurrent: validateOutboxEnvelope,
};
