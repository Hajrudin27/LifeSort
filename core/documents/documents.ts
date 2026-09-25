import { newEntityId } from '@/core/ids';

/**
 * The standalone document contract (APP-055).
 *
 * A document here is not an attachment. `types/attachment.ts` describes a file
 * that belongs to a warranty or an expense and is carried inside that record;
 * this describes a file the user keeps for its own sake, with its own identity,
 * its own row and its own private bucket. Keeping the two apart is the point of
 * the story: giving standalone files a fake parent would have made the parent
 * the authority over something it does not own.
 *
 * Pure contract only — no Supabase, no filesystem, no store. The remote half is
 * core/documents/documentSync.ts.
 */

export interface DocumentRecord {
  id: string;
  /** `<userId>/<documentId>`. Derived, never chosen, and never contains the filename. */
  storagePath: string;
  /** What the user recognises the file by. Display text, never part of a path. */
  originalName: string;
  /** Server `created_at`, ISO 8601. The client never decides this. */
  createdAt: string;
}

/**
 * The server bucket limit is authoritative; this is the same ceiling stated
 * locally so an oversized file is refused before its bytes are ever read into
 * memory and pushed over the network. It matches the 25 MiB attachment bucket
 * limit set in 20260906190000 on purpose — APP-055 is not a new upload scale.
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** Display text, not a key. Bounded to match the database CHECK. */
export const MAX_DOCUMENT_NAME_LENGTH = 255;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A fresh opaque identity. Crypto UUID per ADR-0025 — never a name or a clock. */
export function newDocumentId(): string {
  return newEntityId();
}

/**
 * The object's location, derived from two opaque UUIDs and nothing else.
 *
 * The filename is deliberately absent. A name comes from the user, or on Android
 * from another app entirely, and an object name is the thing the Storage policy
 * reads ownership out of: a name containing `/` or `..` could place the object
 * outside the uploader's own prefix. Both inputs are checked as UUIDs instead of
 * being escaped, because a value that is not a UUID here is a bug, not input.
 */
export function documentStoragePath(userId: string, documentId: string): string | null {
  if (!isUuid(userId) || !isUuid(documentId)) return null;
  return `${userId}/${documentId}`;
}

/**
 * The filename as metadata. Control characters are removed rather than rejected
 * so an otherwise usable file is not refused over an invisible character, but an
 * empty or oversized result is a refusal: an unnamed document cannot be found
 * again by the person who saved it.
 */
export function normalizeDocumentName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (cleaned === '' || cleaned.length > MAX_DOCUMENT_NAME_LENGTH) return null;
  return cleaned;
}

/** Known before the bytes are read, when the picker reports a size. */
export function isDocumentSizeAccepted(size: unknown): boolean {
  if (typeof size !== 'number') return true; // unknown is not a refusal; the server still decides
  return Number.isFinite(size) && size > 0 && size <= MAX_DOCUMENT_BYTES;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
}

/**
 * The read boundary. Fail-closed: a row is either completely understood or
 * dropped, and a dropped row leaves nothing behind to guess from.
 *
 * The path is not trusted as written — it is recomputed from the row's own
 * `user_id` and `id` and compared. A row whose path does not derive from its own
 * identity would otherwise let a stored value decide which object gets signed.
 */
export function decodeDocumentRow(row: unknown, userId: string): DocumentRecord | null {
  if (!isRecord(row) || !isUuid(userId)) return null;
  if (!isUuid(row.id) || !isUuid(row.user_id) || row.user_id !== userId) return null;

  const expectedPath = documentStoragePath(row.user_id, row.id);
  if (expectedPath === null || row.storage_path !== expectedPath) return null;

  const originalName = normalizeDocumentName(row.original_name);
  if (originalName === null) return null;
  if (!isIsoTimestamp(row.created_at)) return null;

  return { id: row.id, storagePath: expectedPath, originalName, createdAt: row.created_at };
}

export function decodeDocumentRows(rows: readonly unknown[], userId: string): DocumentRecord[] {
  return rows.flatMap((row) => {
    const decoded = decodeDocumentRow(row, userId);
    return decoded === null ? [] : [decoded];
  });
}

/** Newest first. Deterministic, so two devices list the same order. */
export function sortDocuments(documents: readonly DocumentRecord[]): DocumentRecord[] {
  return [...documents].sort((a, b) => {
    const byDate = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
  });
}
