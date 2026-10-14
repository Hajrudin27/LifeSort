import type { PregnancyEntityType } from '@/core/pregnancy/protectedRepository';
import { PREGNANCY_SYNC_RPCS, type PregnancyChange } from '@/core/pregnancy/syncContract';
import { supabase } from '@/lib/supabase';

/** One bounded ledger page. The server clamps to this; so does the client. */
export const PREGNANCY_PULL_PAGE_LIMIT = 100;

export type PregnancyPullFailureReason = 'authorization' | 'unavailable' | 'rate-limited' | 'invalid-response' | 'validation';
export type PregnancyPullResult =
  | { readonly ok: true; readonly changes: readonly PregnancyChange[]; readonly nextChangeSeq: number }
  | { readonly ok: false; readonly reason: PregnancyPullFailureReason; readonly attempted: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isPregnancyUuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function safeInteger(value: unknown, minimum: number): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum; }
function kind(value: unknown): value is PregnancyEntityType { return value === 'pregnancy' || value === 'log' || value === 'appointment' || value === 'settings'; }

/**
 * Strict validation of a ledger page. A page that cannot be explained row by row is
 * rejected whole: the cursor must never move because of a row nobody validated.
 * Rows must ascend strictly from `after`, and `nextChangeSeq` must be exactly where
 * the processed rows end (or `after` for an empty page), never a jump beyond them.
 */
export function parsePregnancyPullPage(response: unknown, accountId: string, after: number): PregnancyPullResult | null {
  const invalid = null;
  if (!record(response) || !Array.isArray(response.changes) || !safeInteger(response.nextChangeSeq, 0)) return invalid;
  if (Object.keys(response).some((key) => key !== 'changes' && key !== 'nextChangeSeq')) return invalid;
  if (response.changes.length > PREGNANCY_PULL_PAGE_LIMIT) return invalid;
  const changes: PregnancyChange[] = [];
  let previous = after;
  for (const row of response.changes as unknown[]) {
    if (!record(row) || Object.keys(row).some((key) => !['changeSeq', 'entityType', 'entityId', 'revision', 'deleted'].includes(key))) return invalid;
    if (!safeInteger(row.changeSeq, 1) || row.changeSeq <= previous) return invalid;
    if (!kind(row.entityType) || !safeInteger(row.revision, 1) || typeof row.deleted !== 'boolean' || typeof row.entityId !== 'string') return invalid;
    if (row.entityType === 'settings') {
      // Settings are one upsert-only row keyed by the account itself.
      if (row.entityId !== accountId || row.deleted) return invalid;
    } else if (!isPregnancyUuid(row.entityId)) return invalid;
    previous = row.changeSeq;
    changes.push({ changeSeq: row.changeSeq, entityType: row.entityType, entityId: row.entityId, revision: row.revision, deleted: row.deleted });
  }
  if (response.nextChangeSeq !== previous) return invalid;
  return { ok: true, changes, nextChangeSeq: response.nextChangeSeq };
}

function classify(error: unknown, statusCode: unknown): PregnancyPullFailureReason {
  const source = record(error) ? error : {};
  const code = typeof source.code === 'string' ? source.code : '';
  const status = typeof statusCode === 'number' ? statusCode : 0;
  if (code === 'PT400' || status === 400) return 'validation';
  if (code === 'PT401' || ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(code) || status === 401 || status === 403) return 'authorization';
  if (status === 429) return 'rate-limited';
  return 'unavailable';
}

/** Reads one bounded page of metadata-only ledger rows. It never touches protected state. */
export async function pullPregnancyChanges(accountId: string, afterChangeSeq: number, isActive: () => boolean): Promise<PregnancyPullResult> {
  if (!isActive() || !safeInteger(afterChangeSeq, 0)) return { ok: false, reason: 'authorization', attempted: false };
  let session: { user: { id: string }; access_token: string } | null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return { ok: false, reason: 'authorization', attempted: false };
    session = data.session;
  } catch { return { ok: false, reason: 'unavailable', attempted: false }; }
  if (!isActive() || !session || session.user.id !== accountId) return { ok: false, reason: 'authorization', attempted: false };
  try {
    const { data, error, status } = await supabase.rpc(PREGNANCY_SYNC_RPCS.pull, { p_after_change_seq: afterChangeSeq, p_limit: PREGNANCY_PULL_PAGE_LIMIT })
      .setHeader('Authorization', `Bearer ${session.access_token}`).retry(false);
    // The raw error, payload and status are discarded: only a safe classification leaves.
    if (!isActive()) return { ok: false, reason: 'authorization', attempted: true };
    if (error) return { ok: false, reason: classify(error, status), attempted: true };
    const page = parsePregnancyPullPage(data, accountId, afterChangeSeq);
    return page ?? { ok: false, reason: 'invalid-response', attempted: true };
  } catch {
    return { ok: false, reason: 'unavailable', attempted: true };
  }
}
