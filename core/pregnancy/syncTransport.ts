import { PREGNANCY_SYNC_RPCS } from '@/core/pregnancy/syncContract';
import type { PregnancyEntityType, PregnancyQueuedMutation } from '@/core/pregnancy/protectedRepository';
import { supabase } from '@/lib/supabase';

export type PregnancyMutationSuccess = {
  readonly ok: true;
  readonly status: 'applied' | 'replayed';
  readonly entityType: PregnancyEntityType;
  readonly entityId: string;
  readonly revision: number;
  readonly deleted: boolean;
  readonly changeSeq?: number;
};
export type PregnancyMutationFailureReason =
  | 'consent-required' | 'revision-conflict' | 'mutation-id-conflict'
  | 'validation' | 'authorization' | 'rate-limited' | 'unavailable' | 'unknown-conflict';
export type PregnancyMutationFailure = { readonly ok: false; readonly reason: PregnancyMutationFailureReason; readonly attempted: boolean };
export type PregnancyMutationResult = PregnancyMutationSuccess | PregnancyMutationFailure;

function entityType(value: unknown): value is PregnancyEntityType {
  return value === 'pregnancy' || value === 'log' || value === 'appointment' || value === 'settings';
}
function safePositiveInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function safeNonnegativeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

function classify(error: unknown, statusCode: unknown): PregnancyMutationFailureReason {
  const source = record(error) ? error : {};
  const code = typeof source.code === 'string' ? source.code : '';
  const message = typeof source.message === 'string' ? source.message : '';
  const status = typeof statusCode === 'number' ? statusCode : 0;
  if (code === 'PT428' && message === 'consent_required') return 'consent-required';
  if (code === 'PT409' && message === 'revision_conflict') return 'revision-conflict';
  if (code === 'PT409' && message === 'mutation_id_conflict') return 'mutation-id-conflict';
  if (code === 'PT409' || status === 409) return 'unknown-conflict';
  if (code === 'PT400' || code === 'PT422' || status === 400 || status === 422) return 'validation';
  if (code === 'PT401' || ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(code) || status === 401 || status === 403) return 'authorization';
  if (status === 429) return 'rate-limited';
  if (/^PT5\d\d$/.test(code) || (status >= 500 && status <= 599) || (code === '' && !status)) return 'unavailable';
  return 'validation';
}

/** Sends one already-durable encrypted intent. It never acknowledges or reconciles it. */
export async function sendPregnancyMutation(
  accountId: string,
  mutation: PregnancyQueuedMutation,
  // Mandatory, like the repository's getActiveAccount: an omitted guard must not mean "always live".
  isActive: () => boolean,
): Promise<PregnancyMutationResult> {
  if (!isActive()) return { ok: false, reason: 'authorization', attempted: false };
  let args: Record<string, unknown>;
  try {
    const payload = mutation.payload === undefined ? null : JSON.parse(JSON.stringify(mutation.payload));
    if (mutation.operation === 'upsert' && (!mutation.consentId || payload === null)) return { ok: false, reason: 'validation', attempted: false };
    if (mutation.operation === 'delete' && (mutation.consentId !== undefined || mutation.payload !== undefined)) return { ok: false, reason: 'validation', attempted: false };
    args = {
      p_mutation_id: mutation.mutationId, p_entity_type: mutation.entityType, p_entity_id: mutation.entityId,
      p_operation: mutation.operation, p_expected_revision: mutation.baseRevision ?? null, p_payload: payload,
      p_consent_id: mutation.operation === 'upsert' ? mutation.consentId : null,
    };
  } catch { return { ok: false, reason: 'validation', attempted: false }; }
  try {
    const { data, error: sessionError } = await supabase.auth.getSession();
    const session = data.session;
    if (!isActive() || sessionError || !session || session.user.id !== accountId) return { ok: false, reason: 'authorization', attempted: false };
    const { data: response, error, status } = await supabase.rpc(PREGNANCY_SYNC_RPCS.apply, args)
      .setHeader('Authorization', `Bearer ${session.access_token}`).retry(false);
    if (!isActive()) return { ok: false, reason: 'authorization', attempted: true };
    if (error) return { ok: false, reason: classify(error, status), attempted: true };
    if (!record(response) || (response.status !== 'applied' && response.status !== 'replayed') ||
        !entityType(response.entityType) || typeof response.entityId !== 'string' || !response.entityId ||
        !safePositiveInteger(response.revision) || typeof response.deleted !== 'boolean' ||
        response.entityType !== mutation.entityType || response.entityId !== mutation.entityId ||
        (response.changeSeq !== undefined && (!safeNonnegativeInteger(response.changeSeq) || response.status !== 'applied'))) {
      return { ok: false, reason: 'unknown-conflict', attempted: true };
    }
    return { ok: true, status: response.status, entityType: response.entityType, entityId: response.entityId,
      revision: response.revision, deleted: response.deleted,
      ...(response.changeSeq === undefined ? {} : { changeSeq: response.changeSeq }) };
  } catch {
    return { ok: false, reason: 'unavailable', attempted: true };
  }
}
