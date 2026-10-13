/** Queue persistence seam: semantics remain shared; Profile B requires an encrypted backend. */
export interface QueuePersistenceBackend<TEnvelope> {
  read(): Promise<TEnvelope | null>; write(envelope: TEnvelope): Promise<void>; clear(): Promise<void>;
  readonly protection: 'plaintext-allowed' | 'encrypted-required';
}
export const PREGNANCY_QUEUE_REQUIREMENT = {
  dataDomain: 'pregnancy.user-health', protection: 'encrypted-required', accountBound: true, datasetEpochRequired: true,
} as const;
