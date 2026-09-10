import {
  ATTACHMENTS_DIR,
  clearPersistentAttachmentCache,
  clearTemporaryAttachmentCache,
  deleteCachedAttachmentFile,
  persistEncryptedAttachmentFile,
} from '@/core/storage/documentCacheStorage';

export async function persistFile(
  sourceUri: string,
  suggestedName: string,
): Promise<string> {
  return persistEncryptedAttachmentFile(sourceUri);
}

/**
 * Fjerner alle lokalt gemte vedhæftninger (APP-021).
 *
 * Filerne blev tidligere liggende efter log ud: kvitteringer og garantibilleder
 * fra den forrige bruger stod stadig i appens mappe, selvom hendes konto var
 * væk fra skærmen. Det var fund D4 i docs/data-sdk-inventory.md.
 *
 * Filer, der er nået op i skyen, hentes ned igen ved behov; filer, der ikke er,
 * hører til den konto, der lige er logget ud af.
 */
export async function clearAttachmentCache(): Promise<void> {
  try {
    await clearPersistentAttachmentCache();
    await clearTemporaryAttachmentCache();
  } catch {
    // Log ud må aldrig fejle, fordi en fil ikke kunne slettes. Næste forsøg
    // rydder resten.
  }
}

export function cleanupAttachmentUris(uris: Iterable<string | null | undefined>): void {
  for (const uri of uris) {
    if (!uri || uri.startsWith('http')) continue;
    void deleteCachedAttachmentFile(uri).catch(() => undefined);
  }
}

export function cleanupAttachments(attachments: readonly { uri?: string | null }[] | null | undefined): void {
  cleanupAttachmentUris((attachments ?? []).map((attachment) => attachment.uri));
}

export { ATTACHMENTS_DIR, deleteCachedAttachmentFile };
