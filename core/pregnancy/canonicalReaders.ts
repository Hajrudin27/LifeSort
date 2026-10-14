import {
  mapPregnancyCanonicalRow, pregnancyEntityKey, PREGNANCY_CANONICAL_COLUMNS, PREGNANCY_CANONICAL_TABLES, type RemoteEntityState,
} from '@/core/pregnancy/canonicalMappers';
import type { PregnancyEntityType } from '@/core/pregnancy/protectedRepository';
import { PREGNANCY_PULL_PAGE_LIMIT, type PregnancyPullFailureReason } from '@/core/pregnancy/syncPull';
import { supabase } from '@/lib/supabase';

/** The owner rows a ledger page requires, batched by entity type. Settings need no id. */
export type PregnancyCanonicalRequest = {
  readonly pregnancy: readonly string[];
  readonly log: readonly string[];
  readonly appointment: readonly string[];
  readonly settings: boolean;
};
export type PregnancyCanonicalReadResult =
  | { readonly ok: true; readonly states: ReadonlyMap<string, RemoteEntityState> }
  | { readonly ok: false; readonly reason: PregnancyPullFailureReason; readonly attempted: boolean };

/** The minimal chainable read surface used here; rows are untrusted until mapped. */
type ReadBuilder = {
  select(columns: string): ReadBuilder;
  eq(column: string, value: string): ReadBuilder;
  in(column: string, values: readonly string[]): ReadBuilder;
  setHeader(name: string, value: string): ReadBuilder;
  retry(enabled: boolean): PromiseLike<{ data: unknown; error: unknown; status: number }>;
};

function status(error: unknown, statusCode: unknown): PregnancyPullFailureReason {
  const source = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const code = typeof source.code === 'string' ? source.code : '';
  const http = typeof statusCode === 'number' ? statusCode : 0;
  if (['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(code) || http === 401 || http === 403) return 'authorization';
  if (http === 429) return 'rate-limited';
  return 'unavailable';
}

/**
 * Reads only the rows a ledger page announced: explicit columns, the owner filter,
 * ids batched per entity type. The account, session and Pregnancy epoch are checked
 * before dispatch and again after every await, and a result that was read for a
 * session that is no longer live is discarded. Raw errors are never surfaced.
 */
export async function readPregnancyCanonicalStates(
  accountId: string, request: PregnancyCanonicalRequest, isActive: () => boolean,
): Promise<PregnancyCanonicalReadResult> {
  if (!isActive()) return { ok: false, reason: 'authorization', attempted: false };
  let session: { user: { id: string }; access_token: string } | null;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return { ok: false, reason: 'authorization', attempted: false };
    session = data.session;
  } catch { return { ok: false, reason: 'unavailable', attempted: false }; }
  if (!isActive() || !session || session.user.id !== accountId) return { ok: false, reason: 'authorization', attempted: false };
  const authorization = `Bearer ${session.access_token}`;
  const states = new Map<string, RemoteEntityState>();
  try {
    const kinds: Array<Exclude<PregnancyEntityType, 'settings'>> = ['pregnancy', 'log', 'appointment'];
    for (const entityType of kinds) {
      const wanted = [...new Set(request[entityType])];
      for (let index = 0; index < wanted.length; index += PREGNANCY_PULL_PAGE_LIMIT) {
        const ids = wanted.slice(index, index + PREGNANCY_PULL_PAGE_LIMIT);
        // The column list is a runtime string, so the typed select parser is bypassed on purpose:
        // every row is validated field by field by the mapper instead.
        const table = supabase.from(PREGNANCY_CANONICAL_TABLES[entityType]) as unknown as ReadBuilder;
        const { data, error, status: http } = await table.select(PREGNANCY_CANONICAL_COLUMNS[entityType]).eq('user_id', accountId).in('id', ids)
          .setHeader('Authorization', authorization).retry(false);
        if (!isActive()) return { ok: false, reason: 'authorization', attempted: true };
        if (error) return { ok: false, reason: status(error, http), attempted: true };
        if (!Array.isArray(data)) return { ok: false, reason: 'invalid-response', attempted: true };
        for (const row of data as unknown[]) {
          const id = typeof row === 'object' && row !== null ? (row as Record<string, unknown>).id : undefined;
          const key = typeof id === 'string' ? pregnancyEntityKey(entityType, id) : '';
          if (typeof id !== 'string' || !ids.includes(id) || states.has(key)) return { ok: false, reason: 'invalid-response', attempted: true };
          const state = mapPregnancyCanonicalRow(entityType, row, accountId, id);
          if (!state) return { ok: false, reason: 'invalid-response', attempted: true };
          states.set(key, state);
        }
      }
    }
    if (request.settings) {
      const table = supabase.from(PREGNANCY_CANONICAL_TABLES.settings) as unknown as ReadBuilder;
      const { data, error, status: http } = await table.select(PREGNANCY_CANONICAL_COLUMNS.settings).eq('user_id', accountId)
        .setHeader('Authorization', authorization).retry(false);
      if (!isActive()) return { ok: false, reason: 'authorization', attempted: true };
      if (error) return { ok: false, reason: status(error, http), attempted: true };
      if (!Array.isArray(data) || data.length > 1) return { ok: false, reason: 'invalid-response', attempted: true };
      for (const row of data as unknown[]) {
        const state = mapPregnancyCanonicalRow('settings', row, accountId, accountId);
        if (!state) return { ok: false, reason: 'invalid-response', attempted: true };
        states.set(pregnancyEntityKey('settings', accountId), state);
      }
    }
    return { ok: true, states };
  } catch {
    return { ok: false, reason: 'unavailable', attempted: true };
  }
}
