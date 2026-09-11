import { supportsServerMutation } from '@/core/sync/mutationSupport';
import type { OutboxMutation } from '@/core/sync/outbox';
import { supabase } from '@/lib/supabase';

export type ServerMutationResult =
  | { ok: true; status: 'applied' | 'replayed' }
  | { ok: false; reason: 'authorization' | 'validation' | 'conflict' | 'unavailable' };

/**
 * Explicit single send of an already persisted APP-031 entry. The caller supplies
 * the outbox's account binding; the server authorizes using the bearer session.
 * No enqueue, acknowledge, scan, retry, status UX or production store wiring.
 */
export async function sendServerMutation(
  accountId: string,
  mutation: OutboxMutation,
  isActive: () => boolean = () => true,
): Promise<ServerMutationResult> {
  // Snapshot before the first await. Do not forward scheduling metadata or allow
  // baseRevision to be silently interpreted as an implemented precondition.
  if (!supportsServerMutation(mutation)) return { ok: false, reason: 'validation' };
  if (!isActive()) return { ok: false, reason: 'authorization' };
  let args;
  try {
    args = {
      p_mutation_id: mutation.mutationId,
      p_data_domain: mutation.dataDomain,
      p_entity_type: mutation.entityType,
      p_entity_id: mutation.entityId,
      p_operation: mutation.operation,
      p_payload: mutation.payload === undefined ? null : JSON.parse(JSON.stringify(mutation.payload)),
    };
  } catch {
    return { ok: false, reason: 'validation' };
  }

  try {
    const { data, error: sessionError } = await supabase.auth.getSession();
    const session = data.session;
    if (!isActive() || sessionError || !session || session.user.id !== accountId) {
      return { ok: false, reason: 'authorization' };
    }
    // Pin the request to this account's token: a concurrent account switch must
    // not send the old account's outbox entry using the new account's session.
    const { data: status, error, status: statusCode } = await supabase.rpc('apply_sync_mutation', args)
      .setHeader('Authorization', `Bearer ${session.access_token}`)
      .retry(false);
    if (error) {
      const reason = error.code === 'PT409' || statusCode === 409 ? 'conflict'
        : ['PT400', 'PT422'].includes(error.code) ? 'validation'
        : ['PT401', '42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(error.code) ||
          statusCode === 401 || statusCode === 403 ? 'authorization'
        : statusCode === 400 || statusCode === 422 ? 'validation'
        : /^PT5\d\d$/.test(error.code) || (statusCode >= 500 && statusCode <= 599) ||
          statusCode === 429 || (error.code === '' && !statusCode) ? 'unavailable' : 'validation';
      return { ok: false, reason };
    }
    return status === 'applied' || status === 'replayed'
      ? { ok: true, status }
      : { ok: false, reason: 'unavailable' };
  } catch {
    // Transport/auth errors can carry headers or server details. Never expose them.
    return { ok: false, reason: 'unavailable' };
  }
}
