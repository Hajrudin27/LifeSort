/** Phase A RPC wire contract. Phase B supplies the encrypted queue/client adapter. */
export const PREGNANCY_SYNC_RPCS = {
  apply: 'apply_pregnancy_sync_mutation',
  pull: 'pull_pregnancy_sync_state',
  grantConsent: 'grant_health_consent',
  withdrawConsent: 'withdraw_health_consent',
} as const;

export type PregnancyMutationCommand = {
  mutationId: string;
  entityType: 'pregnancy' | 'log' | 'appointment' | 'settings';
  entityId: string;
  operation: 'upsert' | 'delete';
  expectedRevision?: number;
  payload?: Record<string, unknown>;
  /** Required only for upserts; deletes must survive consent withdrawal. */
  consentId?: string;
};

/** A metadata-only cursor page. Phase B owns encrypted local reconciliation. */
export type PregnancyChange = {
  changeSeq: number;
  entityType: PregnancyMutationCommand['entityType'];
  entityId: string;
  revision: number;
  deleted: boolean;
};
