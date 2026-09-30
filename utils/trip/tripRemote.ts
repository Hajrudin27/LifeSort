import { isDocumentId } from '@/core/documents/documents';
import { supabase } from '@/lib/supabase';

/**
 * The trip's remote operations that are more than the legacy fire-and-forget sync
 * (APP-058): the server-counted deletion preview, the server-confirmed delete, and
 * the owner-only links from a trip to standalone documents.
 *
 * Table names are written as literals at each call site on purpose — the
 * APP-001/APP-027 inventories find the tables the client touches by reading source.
 *
 * Nothing here logs. A destination, a document id or a count does not belong in a
 * log line, and every failure is reported as a typed reason.
 */

async function getUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ preview */

export type TripDeletionPreview =
  /** The caller owns the trip. Counts are the server's, across every author. */
  | { status: 'ok'; expenses: number; packingItems: number; participants: number; documents: number }
  /** An accepted participant. They may see the trip; they may not delete it. */
  | { status: 'not-owner' }
  /** The server has no such trip for this account — unsynced, removed, or not theirs. */
  | { status: 'not-found' };

export type TripDeletionPreviewResult =
  | { ok: true; preview: TripDeletionPreview }
  /** No session, no network, a refusal, or an answer that cannot be trusted. Never "zero". */
  | { ok: false };

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * Ask the server what deleting this trip would remove.
 *
 * Fail-closed: anything other than a complete, well-formed answer is a failure, and
 * a failure is never turned into zeroes — a preview that guessed "nothing" would
 * invite the user to confirm a deletion they were never shown.
 */
export async function fetchTripDeletionPreview(tripId: string): Promise<TripDeletionPreviewResult> {
  try {
    const { data, error } = await supabase.rpc('trip_deletion_preview', { p_trip_id: tripId });
    if (error || typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false };
    const answer = data as Record<string, unknown>;

    if (answer.status === 'not-owner') return { ok: true, preview: { status: 'not-owner' } };
    if (answer.status === 'not-found') return { ok: true, preview: { status: 'not-found' } };
    if (answer.status === 'ok'
      && isCount(answer.expenses) && isCount(answer.packing_items)
      && isCount(answer.participants) && isCount(answer.documents)) {
      return {
        ok: true,
        preview: {
          status: 'ok',
          expenses: answer.expenses,
          packingItems: answer.packing_items,
          participants: answer.participants,
          documents: answer.documents,
        },
      };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

/* ------------------------------------------------------------- delete */

/** The four dependency counts the server reports, and the user confirmed. */
export type TripDependencyCounts = { expenses: number; packingItems: number; participants: number; documents: number };

export type TripDeleteResult =
  | { ok: true }
  /**
   * Nothing was deleted: the trip's dependencies are no longer what the user confirmed.
   * `counts` are the server's fresh ones; the caller must show them and ask again.
   */
  | { ok: false; reason: 'changed'; counts: TripDependencyCounts }
  /** An accepted participant. They may not delete the trip. */
  | { ok: false; reason: 'not-owner' }
  | { ok: false; reason: 'not-authenticated' | 'failed' | 'not-confirmed' };

/**
 * Delete the trip — but only the trip the user was shown.
 *
 * The preview and the delete are two requests, and in between a participant (or the owner's
 * other device) can add an expense, a packing item, an invitation or a document link. A raw
 * DELETE would cascade that too. So the delete is one server call that locks the trip row,
 * recounts the same four dependencies, and deletes only if they equal the counts the user
 * confirmed; otherwise it deletes nothing and returns the fresh counts.
 *
 * The database cascades all the cleanup, and the linked standalone Documents are untouched.
 * `not-found` from the server is reported as `not-confirmed`: it may mean the trip is already
 * gone (an earlier attempt whose answer was lost, or another device), and only an
 * authoritative re-check can say so.
 */
export async function deleteTripRemote(tripId: string, confirmed: TripDependencyCounts): Promise<TripDeleteResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, reason: 'not-authenticated' };
  try {
    const { data, error } = await supabase.rpc('delete_trip_if_dependencies_match', {
      p_trip_id: tripId,
      p_expenses: confirmed.expenses,
      p_packing_items: confirmed.packingItems,
      p_participants: confirmed.participants,
      p_documents: confirmed.documents,
    });
    if (error) {
      return { ok: false, reason: String(error.message ?? '').includes('not_authenticated') ? 'not-authenticated' : 'failed' };
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, reason: 'failed' };
    const answer = data as Record<string, unknown>;

    if (answer.status === 'deleted') return { ok: true };
    if (answer.status === 'not-owner') return { ok: false, reason: 'not-owner' };
    if (answer.status === 'not-found') return { ok: false, reason: 'not-confirmed' };
    if (answer.status === 'changed'
      && isCount(answer.expenses) && isCount(answer.packing_items)
      && isCount(answer.participants) && isCount(answer.documents)) {
      return {
        ok: false,
        reason: 'changed',
        counts: {
          expenses: answer.expenses,
          packingItems: answer.packing_items,
          participants: answer.participants,
          documents: answer.documents,
        },
      };
    }
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/* -------------------------------------------------- document references */

/**
 * The ids of the standalone documents this account has linked to a trip, or null
 * when they could not be read — kept apart from `[]`, "nothing is linked".
 * Only the owner has link rows, so anyone else reads an empty list.
 */
export async function fetchTripDocumentLinks(tripId: string): Promise<string[] | null> {
  const userId = await getUserId();
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from('trip_document_references')
      .select('document_id, created_at')
      .eq('user_id', userId)
      .eq('trip_id', tripId)
      .order('created_at', { ascending: true });
    if (error || !Array.isArray(data)) return null;
    return data.flatMap((row: { document_id?: unknown }) => (isDocumentId(row.document_id) ? [row.document_id] : []));
  } catch {
    return null;
  }
}

export type TripDocumentLinkResult = 'linked' | 'already-linked' | 'failed';

/** Idempotent: linking twice is the same as linking once, so a retry is always safe. */
export async function linkTripDocument(tripId: string, documentId: string): Promise<TripDocumentLinkResult> {
  const userId = await getUserId();
  if (!userId || !isDocumentId(documentId)) return 'failed';
  try {
    const { error } = await supabase
      .from('trip_document_references')
      .insert({ user_id: userId, trip_id: tripId, document_id: documentId });
    if (!error) return 'linked';
    return (error as { code?: unknown }).code === '23505' ? 'already-linked' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Removes the link only. The document itself is not touched. */
export async function unlinkTripDocument(tripId: string, documentId: string): Promise<boolean> {
  const userId = await getUserId();
  if (!userId) return false;
  try {
    const { error } = await supabase
      .from('trip_document_references')
      .delete()
      .eq('user_id', userId)
      .eq('trip_id', tripId)
      .eq('document_id', documentId);
    return !error;
  } catch {
    return false;
  }
}
