/**
 * Phase B1 truthfulness boundary: Pregnancy state and mutation intent share one
 * encrypted repository transaction. A separate read/write queue backend cannot
 * provide the required commit property and is intentionally not exposed.
 */
export const PREGNANCY_QUEUE_REQUIREMENT = {
  dataDomain: 'pregnancy.user-health', protection: 'encrypted-required', accountBound: true,
  datasetEpochRequired: true, atomicStateAndIntentCommit: true,
} as const;
