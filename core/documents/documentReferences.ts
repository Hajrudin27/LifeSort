import { supabase } from '@/lib/supabase';

import { isDocumentId, normalizeDocumentName } from './documents';

/**
 * The narrow read another domain gets of the user's standalone documents (APP-057).
 *
 * A warranty may point at a receipt the user already keeps in Documents. To offer
 * that choice it needs to know which documents exist and what the user calls them —
 * and nothing more. So this is not the documents store, and not documentSync: no
 * storage path, no signed URL, no bytes, no deletion state. What comes back is an
 * id to store and a name and date to show, held in memory by whoever asked.
 *
 * Core does not know who asks. It serves any domain that needs to name one of the
 * user's documents; APP-057's warranty receipt is the first.
 */

export interface DocumentReference {
  id: string;
  /** Display text only. Never stored by the referencing domain. */
  originalName: string;
  /** Server `created_at`, ISO 8601. */
  createdAt: string;
}

// The table name is a literal at the call site on purpose: the APP-001/APP-027
// inventory tests find the tables the client touches by reading the source.
// storage_path is deliberately not selected.
const REFERENCE_COLUMNS = 'id, user_id, original_name, created_at';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Fail-closed decode: a row is either fully understood as this account's own or
 * dropped. The result is built field by field, so nothing the server sent beyond
 * these three facts can reach the caller.
 */
export function decodeDocumentReferenceRow(row: unknown, userId: string): DocumentReference | null {
  if (!isRecord(row) || !isDocumentId(userId)) return null;
  if (!isDocumentId(row.id) || row.user_id !== userId) return null;
  const originalName = normalizeDocumentName(row.original_name);
  if (originalName === null) return null;
  if (typeof row.created_at !== 'string' || Number.isNaN(Date.parse(row.created_at))) return null;
  return { id: row.id, originalName, createdAt: row.created_at };
}

async function getUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * This account's documents, newest first, as references.
 *
 * `null` is a failed read — no session, a network error, a refusal — and is kept
 * apart from `[]`, which is an account with no documents. A caller that showed a
 * failure as "you have no documents" would be telling the user something untrue.
 */
export async function fetchDocumentReferences(): Promise<DocumentReference[] | null> {
  const userId = await getUserId();
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from('documents')
      .select(REFERENCE_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !Array.isArray(data)) return null;
    return data.flatMap((row: unknown) => {
      const decoded = decodeDocumentReferenceRow(row, userId);
      return decoded === null ? [] : [decoded];
    });
  } catch {
    return null;
  }
}
