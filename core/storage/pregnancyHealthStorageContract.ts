/** APP-076 Phase B1's dedicated encrypted Pregnancy storage contract. */
export const PREGNANCY_HEALTH_STORAGE = {
  asyncStorageKey: 'lifesort-pregnancy', secureStoreKey: 'lifesort-pregnancy-health-key',
  aad: 'lifesort-pregnancy:v1', envelopeVersion: 1,
} as const;
export type PregnancyProtectedDataset = { accountId: string; datasetEpoch: number };
