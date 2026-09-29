import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  cleanupTemporaryPickerFile,
  deleteDocument as deleteDocumentRemotely,
  fetchDocuments,
  uploadDocument,
  type DocumentDeleteFailure,
  type DocumentDeleteResult,
  type DocumentUploadFailure,
  type PickedDocument,
} from '@/core/documents/documentSync';
import { sortDocuments, type DocumentRecord } from '@/core/documents/documents';
import { documentMetadataEncryptedStorage } from '@/core/storage/documentCacheStorage';
import { migrationGatedStorage } from '@/core/storage/migrations/runtime';

/**
 * Standalone documents (APP-055, APP-056).
 *
 * Metadata only. Bytes never enter this store, and neither do signed URLs or the
 * picker's temporary file URI: a filename and a purchase receipt's existence are
 * already personal data, so this is a Profile B surface written through the
 * APP-029 encrypted adapter rather than plain AsyncStorage.
 *
 * Nothing is added locally until the server has confirmed the row, and nothing is
 * removed locally until the server has confirmed the deletion. That is what makes
 * the list honest offline: a document shown here exists in the cloud, or did the
 * last time the server was asked.
 */

/**
 * How many deletions the server has confirmed in this process. Memory only, and
 * only ever compared across a single fetch: a read that was already in flight
 * when a deletion was confirmed may predate it, and applying that read would put
 * the deleted document back on screen until the next one.
 */
let confirmedDeletions = 0;

interface DocumentsState {
  documents: DocumentRecord[];
  /** An upload is in flight. The screen disables its own action rather than queueing. */
  uploading: boolean;
  /** The last upload failure, so the screen can offer a retry instead of a spinner. */
  uploadError: DocumentUploadFailure | null;
  /**
   * The one document whose deletion is in flight. One at a time: a second request
   * while this is set is refused rather than queued, so a double tap can never
   * start two lifecycles.
   */
  deletingId: string | null;
  /** The last deletion failure, so the screen can say so and the user can retry. */
  deleteError: DocumentDeleteFailure | null;
  addDocument: (picked: PickedDocument) => Promise<boolean>;
  clearUploadError: () => void;
  deleteDocument: (documentId: string) => Promise<boolean>;
  clearDeleteError: () => void;
  fetchFromSupabase: () => Promise<void>;
}

export const useDocumentsStore = create<DocumentsState>()(
  persist(
    (set, get) => ({
      documents: [],
      uploading: false,
      uploadError: null,
      deletingId: null,
      deleteError: null,

      clearUploadError: () => set({ uploadError: null }),
      clearDeleteError: () => set({ deleteError: null }),

      async addDocument(picked) {
        if (get().uploading) return false;
        set({ uploading: true, uploadError: null });

        try {
          const result = await uploadDocument(picked);

          if (!result.ok) {
            set({ uploading: false, uploadError: result.reason });
            return false;
          }

          set((state) => ({
            documents: sortDocuments([...state.documents.filter((d) => d.id !== result.document.id), result.document]),
            uploading: false,
            uploadError: null,
          }));
          return true;
        } finally {
          // The picked copy is temporary plaintext this app asked for. It goes
          // away whether the upload succeeded or not, and only if it is provably
          // inside our own cache directory.
          await cleanupTemporaryPickerFile(picked.uri);
          if (get().uploading) set({ uploading: false });
        }
      },

      async deleteDocument(documentId) {
        if (get().deletingId !== null) return false;
        // Nothing leaves the list here. Until the server confirms, the document is
        // still the user's, still listed, and its deletion still retryable.
        set({ deletingId: documentId, deleteError: null });

        let result: DocumentDeleteResult;
        try {
          result = await deleteDocumentRemotely(documentId);
        } catch {
          result = { ok: false, reason: 'delete-incomplete' };
        }

        if (!result.ok) {
          set({ deletingId: null, deleteError: result.reason });
          return false;
        }

        // The server has confirmed it — deleted now, or on an earlier attempt whose
        // answer was lost. That is the truth from here on. If writing the local
        // cache fails, the in-memory list has already changed and the next fetch
        // is authoritative; nothing local may turn this back into "not deleted".
        confirmedDeletions += 1;
        try {
          set((state) => ({
            documents: state.documents.filter((d) => d.id !== documentId),
            deletingId: null,
            deleteError: null,
          }));
        } catch {
          // Deliberately not surfaced; see above.
        }
        return true;
      },

      async fetchFromSupabase() {
        const deletionsBefore = confirmedDeletions;
        const fetched = await fetchDocuments();
        // null is a failed read, not an empty account. Replacing the cache with
        // [] here would make a network error look like deleted documents.
        if (fetched === null) return;
        // A read that overlapped a confirmed deletion may still list the deleted
        // document. It is dropped rather than applied; the next read decides.
        if (confirmedDeletions !== deletionsBefore) return;
        set({ documents: fetched });
      },
    }),
    {
      name: 'lifesort-documents',
      storage: createJSONStorage(() => migrationGatedStorage(documentMetadataEncryptedStorage)),
      // In-flight upload and delete state belongs to one screen in one session.
      partialize: (state) => ({ documents: state.documents }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.documents = sortDocuments(state.documents ?? []);
      },
    },
  ),
);
