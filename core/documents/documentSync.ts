import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '@/lib/supabase';

import {
  decodeDocumentRows,
  documentStoragePath,
  isDocumentSizeAccepted,
  newDocumentId,
  normalizeDocumentName,
  sortDocuments,
  type DocumentRecord,
} from './documents';

/**
 * The remote half of standalone documents (APP-055).
 *
 * The security shape is taken from utils/shared/attachmentSync.ts, which is the
 * audited one: private bucket, user-prefixed object name, metadata row carrying
 * only the path, and a short-lived signed URL minted at the moment the file is
 * opened. What is NOT taken from it is the parent-oriented data model.
 *
 * Upload is online and authenticated. There is no offline queue: queuing would
 * mean keeping document bytes in plaintext somewhere until the network returned,
 * and the generic outbox (APP-031) does not own Profile B payloads.
 */

// Written as literals at every call site on purpose: the APP-001/APP-027
// inventory tests find the tables and buckets the client touches by reading the
// source, and a constant would hide this surface from that governance.
const BUCKET = 'documents';
const SELECT_COLUMNS = 'id, user_id, storage_path, original_name, created_at';

// Same lifetime as the audited attachment reader. A signed URL bypasses login and
// RLS and cannot be withdrawn, so it is minted only when a file is actually being
// opened and is never written anywhere that survives the process.
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60;

// Renew slightly early so a URL cannot die between being handed out and used.
const SIGNED_URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Memory only. Cleared on logout; never reaches disk, state or logs. */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export type DocumentUploadFailure =
  /** No session. Nothing was touched. */
  | 'not-authenticated'
  /** Unusable filename, unreadable pick, or a file above the 25 MiB ceiling. */
  | 'invalid-file'
  /** The object never landed. No metadata, no local record. */
  | 'upload-failed'
  /**
   * The object landed but the row did not. Removing the object again is
   * attempted, not promised: the server permits that removal only while no
   * canonical row points at the object, and the attempt can itself fail. What is
   * certain is that no document was saved.
   */
  | 'metadata-failed';

export type DocumentUploadResult =
  | { ok: true; document: DocumentRecord }
  | { ok: false; reason: DocumentUploadFailure };

export type PickedDocument = {
  uri: string;
  name: string;
  size?: number;
  mimeType?: string;
};

async function getUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

const FILE_SCHEME = 'file://';

/**
 * The canonical path behind a `file://` URI, or null when there is no safe answer.
 *
 * A string prefix is not containment. `file:///app/cache/../documents/x` starts
 * with the cache directory and is not in it, and the same trick survives percent
 * encoding, double encoding and backslashes. So the URI is decoded once, refused
 * if decoding it again would change it (that is a double-encoded payload, not a
 * filename), and refused outright if any segment is a traversal — a file the
 * picker copied into our cache never has one.
 *
 * Deliberately no Node `path`/`url` module: this runs on the device.
 */
function canonicalFileUriPath(uri: string): string | null {
  if (typeof uri !== 'string' || !uri.startsWith(FILE_SCHEME)) return null;

  const raw = uri.slice(FILE_SCHEME.length).split('?')[0].split('#')[0];
  if (raw === '') return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
    // A value that still decodes to something else was encoded twice. Nothing
    // the picker produces looks like that, and resolving it would mean choosing
    // which of two readings is the real path.
    if (decodeURIComponent(decoded) !== decoded) return null;
  } catch {
    return null;
  }

  // Backslashes and NULs are separator tricks on the platforms that accept them,
  // and are never part of a path this app wrote.
  if (decoded.includes('\\') || decoded.includes('\u0000')) return null;

  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) return null;

  return decoded;
}

/**
 * Only a file that canonically resolves inside the app's own cache directory may
 * be deleted.
 *
 * `copyToCacheDirectory: true` gives us an app-owned copy in
 * FileSystem.cacheDirectory, and that copy is temporary plaintext we are
 * responsible for. The URI the picker reports when it does NOT copy can point
 * into another app's provider or the user's own storage, and deleting that would
 * destroy a file we were only ever lent.
 */
export function isOwnTemporaryPickerFile(uri: string): boolean {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory || !uri) return false;

  const root = canonicalFileUriPath(cacheDirectory);
  const candidate = canonicalFileUriPath(uri);
  if (root === null || candidate === null) return false;

  // A trailing separator is what makes this containment rather than a prefix:
  // without it `/app/cache` also matches `/app/cache-evil/file.pdf`.
  const rootWithSeparator = root.endsWith('/') ? root : `${root}/`;
  return candidate.startsWith(rootWithSeparator) && candidate.length > rootWithSeparator.length;
}

/** Best effort, and silent: a leftover temp file must never fail a good upload. */
export async function cleanupTemporaryPickerFile(uri: string): Promise<void> {
  if (!isOwnTemporaryPickerFile(uri)) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // The OS clears its own cache directory eventually.
  }
}

async function knownLocalSize(picked: PickedDocument): Promise<number | undefined> {
  if (typeof picked.size === 'number') return picked.size;
  try {
    const info = await FileSystem.getInfoAsync(picked.uri);
    return info.exists && typeof info.size === 'number' ? info.size : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Upload one picked document, then register it.
 *
 * The order matters and is not reversible: the object is written first, because
 * a metadata row pointing at an object that does not exist is a document the
 * user can see and never open. If the row then fails, removal of the object we
 * just created is attempted — that compensation is what makes the pair atomic
 * enough to show the user a result they can trust. It is upload atomicity, not
 * the APP-056 delete cascade.
 *
 * The local record is only returned once the server has confirmed the row, so
 * nothing can appear saved that is not.
 */
export async function uploadDocument(picked: PickedDocument): Promise<DocumentUploadResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, reason: 'not-authenticated' };

  const originalName = normalizeDocumentName(picked.name);
  if (originalName === null) return { ok: false, reason: 'invalid-file' };

  const documentId = newDocumentId();
  const storagePath = documentStoragePath(userId, documentId);
  if (storagePath === null) return { ok: false, reason: 'not-authenticated' };

  const size = await knownLocalSize(picked);
  if (!isDocumentSizeAccepted(size)) return { ok: false, reason: 'invalid-file' };

  let blob: Blob;
  try {
    const response = await fetch(picked.uri);
    blob = await response.blob();
  } catch {
    return { ok: false, reason: 'invalid-file' };
  }

  // Re-check once the real length is known: the picker's reported size is a hint.
  if (!isDocumentSizeAccepted(blob.size)) return { ok: false, reason: 'invalid-file' };

  // upsert:false — the identity is new and immutable, so an existing object at
  // this path would mean a collision, and overwriting it would destroy a file
  // some other row already points at.
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, blob, {
    upsert: false,
    // A transport hint only. Nothing is authorized on the basis of it.
    contentType: picked.mimeType || undefined,
  });
  if (uploadError) return { ok: false, reason: 'upload-failed' };

  const { data, error: insertError } = await supabase
    .from('documents')
    .insert({ id: documentId, user_id: userId, storage_path: storagePath, original_name: originalName })
    .select(SELECT_COLUMNS)
    .single();

  const [document] = insertError || !data ? [] : decodeDocumentRows([data], userId);

  if (!document) {
    // Attempt to compensate for exactly the object this call created, and nothing
    // else. It is an attempt and not a guarantee, deliberately: if the row did
    // commit on the server while this client saw a failure, the Storage policy
    // refuses the removal and the document stays whole rather than being reduced
    // to a row pointing at nothing.
    //
    // If this removal ALSO fails, the object stays in the bucket with no metadata
    // row, and nothing here cleans it up later. Be precise about the backstop:
    // orphaned_document_paths finds objects whose owning prefix no longer names an
    // auth.users row, so it does NOT see this one while the account still exists.
    // It becomes discoverable only once that account is gone. That is a known
    // limitation, recorded in docs/app-055-private-document-bucket.md, not
    // something this story quietly covers.
    try {
      await supabase.storage.from(BUCKET).remove([storagePath]);
    } catch {
      // Never surfaced: the user's fact is that nothing was saved.
    }
    return { ok: false, reason: 'metadata-failed' };
  }

  return { ok: true, document };
}

/**
 * The server list, replacing the local cache.
 *
 * Replacement rather than a merge is correct here because the server is the only
 * writer of these rows: a row that is gone from the server is gone, and there is
 * no local-only document to protect — nothing is recorded locally until the
 * server has confirmed it. Returns null on failure so a network error is not
 * mistaken for an empty document list.
 */
export async function fetchDocuments(): Promise<DocumentRecord[] | null> {
  const userId = await getUserId();
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from('documents')
      .select(SELECT_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !data) return null;
    return sortDocuments(decodeDocumentRows(data, userId));
  } catch {
    return null;
  }
}

/**
 * A short-lived URL for one document, minted now.
 *
 * Keyed by storage path in memory only. Nothing returned from here is ever
 * persisted, logged or promoted to identity: the canonical reference stays the
 * path, and a URL is a temporary way to reach the bytes behind it.
 */
export async function documentReadUrl(storagePath: string): Promise<string | null> {
  const cached = signedUrlCache.get(storagePath);
  if (cached && cached.expiresAt - Date.now() > SIGNED_URL_REFRESH_MARGIN_MS) return cached.url;

  try {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);
    if (!data?.signedUrl) return null;

    signedUrlCache.set(storagePath, {
      url: data.signedUrl,
      expiresAt: Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000,
    });
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Called on logout and before a new login, so no account inherits another's URLs. */
export function clearDocumentSignedUrlCache(): void {
  signedUrlCache.clear();
}

/**
 * Mark this account's documents as released for account deletion, and report the
 * object paths that still belong to it (APP-022).
 *
 * Nothing is destroyed here. The rows — and with them the canonical paths — stay
 * until `auth.users` cascades them away, which is what makes a failed Storage
 * removal retryable: the next attempt calls this again, is handed the same paths,
 * and tries the same objects. An earlier design deleted the rows first, which
 * removed the only record of where the object was the moment the Storage call
 * failed.
 *
 * Every call refreshes `account_deletion_released_at` for this account's rows, so
 * a retry after the 15-minute release window has closed can open a new one. The
 * rows themselves are untouched and the return is every path the account still
 * owns, so repeating the call yields the same manifest — idempotent in what it
 * says, deliberately not in the timestamp it sets.
 *
 * `null` means the manifest is unusable. It is deliberately not `[]`: an account
 * with no documents and an account whose manifest could not be trusted are
 * different facts, and treating the second as the first would delete the account
 * while its files were still in the bucket and its session was the last thing
 * allowed to remove them.
 *
 * The manifest is ALL OR NOTHING. One entry that is not a canonical path
 * belonging to this user rejects the whole list, because a filtered manifest is
 * indistinguishable from a complete one: the flow would delete what it understood,
 * conclude the cleanup was finished and destroy the account, leaving behind
 * whatever the entry it discarded was actually describing. At a boundary where the
 * next step is irreversible, "most of the list" is not a usable answer.
 */
export async function releaseOwnDocumentsForAccountDeletion(userId: string): Promise<string[] | null> {
  try {
    const { data, error } = await supabase.rpc('release_my_documents_for_account_deletion');
    if (error || !Array.isArray(data)) return null;

    const manifest: string[] = [];
    const seen = new Set<string>();

    for (const value of data as unknown[]) {
      if (typeof value !== 'string') return null;

      // Re-derived from the entry's own two segments and compared, so nothing
      // with an extra segment, a filename, a traversal or a non-UUID part can
      // pass as canonical.
      const [owner, documentId, ...rest] = value.split('/');
      if (rest.length > 0) return null;
      if (owner !== userId) return null;
      if (documentStoragePath(owner, documentId ?? '') !== value) return null;

      // One canonical path per document is the server's contract. A repeat means
      // the response is not the response that contract describes, and guessing
      // which reading was intended is exactly what must not happen here.
      if (seen.has(value)) return null;
      seen.add(value);

      manifest.push(value);
    }

    return manifest;
  } catch {
    return null;
  }
}
