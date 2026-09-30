import {
  deleteCachedAttachmentFile,
  isEncryptedAttachmentCacheUri,
  isTemporaryDecryptedAttachmentUri,
} from '@/core/storage/documentCacheStorage';
import { uploadDocument, type DocumentUploadResult, type PickedDocument } from '@/core/documents/documentSync';
import type { Attachment } from '@/types/attachment';
import { resolveAttachmentUri } from '@/utils/shared/attachmentSync';
import { linkTripDocument, type TripDocumentLinkResult } from '@/utils/trip/tripRemote';

/**
 * Moving one legacy on-device trip file into Documents (APP-058) — only ever on the
 * user's explicit request, one file at a time.
 *
 * Before APP-058 a trip's files were local, encrypted, and never uploaded. They may
 * be real boarding passes and bookings, so nothing here may lose one. The order is
 * fixed and the legacy copy is the LAST thing to go:
 *
 *   1. resolve the file through the existing attachment resolver, which decrypts an
 *      encrypted local file into a temporary plaintext copy
 *   2. upload that plaintext copy as a standalone APP-055 Document
 *   3. server confirms the Document row
 *   4. link the Document to the trip
 *   5. only now remove the legacy metadata and its encrypted file
 *   6. always, success or not: delete the temporary plaintext copy
 *
 * The encrypted `.lsenc` bytes are never handed to the uploader: they are not a
 * document, and uploading them would store ciphertext under a filename.
 *
 * Failure semantics — each stops and leaves the legacy copy exactly where it was:
 *   - unreadable / upload-failed: nothing was stored remotely.
 *   - link-failed: the standalone Document EXISTS (it was confirmed) but the trip
 *     does not reference it yet. The legacy copy is kept and the uploaded document's
 *     id is remembered in memory, so the next try only links — it does not upload a
 *     second copy. If the app is closed first, that memory is gone and a later try
 *     uploads again, leaving a duplicate standalone Document the user can delete in
 *     Documents. That duplicate is a stated cost, not a data loss.
 */

export type LegacyTripDocumentResult =
  | { ok: true; documentId: string }
  | { ok: false; reason: 'busy' | 'unreadable' | 'upload-failed' | 'link-failed' };

export interface LegacyTripDocumentDeps {
  resolveUri: (attachment: Attachment) => Promise<string | null>;
  upload: (picked: PickedDocument) => Promise<DocumentUploadResult>;
  link: (tripId: string, documentId: string) => Promise<TripDocumentLinkResult>;
  /** Deletes a temporary decrypted copy. Must be safe to call when there is none. */
  cleanupTemporary: (uri: string) => Promise<void>;
}

const defaultDeps: LegacyTripDocumentDeps = {
  resolveUri: resolveAttachmentUri,
  upload: uploadDocument,
  link: linkTripDocument,
  cleanupTemporary: async (uri) => {
    if (isTemporaryDecryptedAttachmentUri(uri)) await deleteCachedAttachmentFile(uri);
  },
};

/** Uploaded but not yet linked: `${tripId}:${attachmentId}` → document id. Memory only. */
const uploadedNotLinked = new Map<string, string>();
const inFlight = new Set<string>();

/**
 * Drops the in-memory progress. Nothing calls this on logout — core may not import a
 * domain util — and nothing needs to: progress is keyed by a trip id and an attachment
 * id, both random per account, and dies with the process.
 */
export function clearLegacyTripDocumentProgress(): void {
  uploadedNotLinked.clear();
  inFlight.clear();
}

export async function moveLegacyTripDocumentToDocuments(
  tripId: string,
  attachment: Attachment,
  /** Removes the legacy metadata and its local file. Called only after upload AND link succeeded. */
  removeLegacy: () => void,
  deps: LegacyTripDocumentDeps = defaultDeps,
): Promise<LegacyTripDocumentResult> {
  const key = `${tripId}:${attachment.id}`;
  if (inFlight.has(key)) return { ok: false, reason: 'busy' };
  inFlight.add(key);

  try {
    let documentId = uploadedNotLinked.get(key);

    if (documentId === undefined) {
      let uri: string | null = null;
      try {
        try {
          uri = await deps.resolveUri(attachment);
        } catch {
          return { ok: false, reason: 'unreadable' };
        }
        // No usable file, or the resolver handed back the encrypted bytes themselves.
        if (!uri || isEncryptedAttachmentCacheUri(uri)) return { ok: false, reason: 'unreadable' };

        let uploaded: DocumentUploadResult;
        try {
          uploaded = await deps.upload({ uri, name: attachment.name });
        } catch {
          return { ok: false, reason: 'upload-failed' };
        }
        if (!uploaded.ok) return { ok: false, reason: 'upload-failed' };
        documentId = uploaded.document.id;
      } finally {
        if (uri) {
          try { await deps.cleanupTemporary(uri); } catch { /* the OS clears its own cache eventually */ }
        }
      }
      uploadedNotLinked.set(key, documentId);
    }

    const linked = await deps.link(tripId, documentId);
    if (linked === 'failed') return { ok: false, reason: 'link-failed' };

    uploadedNotLinked.delete(key);
    removeLegacy();
    return { ok: true, documentId };
  } finally {
    inFlight.delete(key);
  }
}
