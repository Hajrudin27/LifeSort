import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  cleanupTemporaryPickerFile,
  fetchDocuments,
  uploadDocument,
  type DocumentUploadFailure,
  type PickedDocument,
} from '@/core/documents/documentSync';
import { sortDocuments, type DocumentRecord } from '@/core/documents/documents';
import { documentMetadataEncryptedStorage } from '@/core/storage/documentCacheStorage';
import { migrationGatedStorage } from '@/core/storage/migrations/runtime';

/**
 * Standalone documents (APP-055).
 *
 * Metadata only. Bytes never enter this store, and neither do signed URLs or the
 * picker's temporary file URI: a filename and a purchase receipt's existence are
 * already personal data, so this is a Profile B surface written through the
 * APP-029 encrypted adapter rather than plain AsyncStorage.
 *
 * Nothing is added locally until the server has confirmed the row. That is what
 * makes the list honest offline: a document shown here exists in the cloud.
 */

interface DocumentsState {
  documents: DocumentRecord[];
  /** An upload is in flight. The screen disables its own action rather than queueing. */
  uploading: boolean;
  /** The last upload failure, so the screen can offer a retry instead of a spinner. */
  uploadError: DocumentUploadFailure | null;
  addDocument: (picked: PickedDocument) => Promise<boolean>;
  clearUploadError: () => void;
  fetchFromSupabase: () => Promise<void>;
}

export const useDocumentsStore = create<DocumentsState>()(
  persist(
    (set, get) => ({
      documents: [],
      uploading: false,
      uploadError: null,

      clearUploadError: () => set({ uploadError: null }),

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

      async fetchFromSupabase() {
        const fetched = await fetchDocuments();
        // null is a failed read, not an empty account. Replacing the cache with
        // [] here would make a network error look like deleted documents.
        if (fetched === null) return;
        set({ documents: fetched });
      },
    }),
    {
      name: 'lifesort-documents',
      storage: createJSONStorage(() => migrationGatedStorage(documentMetadataEncryptedStorage)),
      // In-flight upload state belongs to one screen in one session.
      partialize: (state) => ({ documents: state.documents }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.documents = sortDocuments(state.documents ?? []);
      },
    },
  ),
);
