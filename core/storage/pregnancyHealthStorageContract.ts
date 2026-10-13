/**
 * Phase A reservation for Phase B's encrypted adapter. No code reads or writes
 * these keys yet: the registry marks the surfaces as planned, not implemented.
 */
export const PREGNANCY_HEALTH_STORAGE = {
  asyncStorageKey: 'lifesort-pregnancy', secureStoreKey: 'lifesort-pregnancy-health-key',
  aad: 'lifesort-pregnancy:v1', envelopeVersion: 1, datasetEpoch: 'pregnancy-health-dataset-epoch',
} as const;
export type PregnancyProtectedDataset = { accountId: string; datasetEpoch: number };
