import { useEffect, useState } from 'react';

import { Attachment } from '@/types/attachment';
import { TripAttachment } from '@/types/trip';
import { resolveAttachmentUri } from '@/utils/shared/attachmentSync';
import {
  deleteCachedAttachmentFile,
  isTemporaryDecryptedAttachmentUri,
} from '@/core/storage/documentCacheStorage';

type UseAttachmentUriOptions = {
  enabled?: boolean;
};

type ResolvableAttachment = Attachment | TripAttachment | null | undefined;

function cleanupOwnedTemporaryUri(uri: string | null): void {
  if (uri && isTemporaryDecryptedAttachmentUri(uri)) {
    void deleteCachedAttachmentFile(uri).catch(() => undefined);
  }
}

/**
 * Giver en URI, en vedhæftning kan vises fra.
 *
 * Ligger filen lokalt, er værdien klar med det samme. Ligger den kun i Storage,
 * udstedes en kortlivet signeret URL, når komponenten vises — og først der.
 * Returnerer null, indtil den er klar, eller hvis filen ikke kunne nås.
 */
export function useAttachmentUri(
  attachment: ResolvableAttachment,
  options: UseAttachmentUriOptions = {},
): string | null {
  const [uri, setUri] = useState<string | null>(null);
  const enabled = options.enabled ?? true;

  useEffect(() => {
    let cancelled = false;
    let ownedTemporaryUri: string | null = null;

    if (!attachment || !enabled) {
      setUri(null);
      return () => {
        cancelled = true;
      };
    }

    setUri(null);
    resolveAttachmentUri(attachment)
      .then((resolved) => {
        ownedTemporaryUri = resolved && isTemporaryDecryptedAttachmentUri(resolved) ? resolved : null;
        if (cancelled) {
          cleanupOwnedTemporaryUri(ownedTemporaryUri);
          return;
        }
        setUri(resolved);
      })
      .catch(() => {
        if (!cancelled) setUri(null);
      });
    return () => {
      cancelled = true;
      cleanupOwnedTemporaryUri(ownedTemporaryUri);
    };
  }, [
    attachment?.id,
    attachment?.kind,
    attachment?.name,
    attachment?.uri,
    attachment && 'storagePath' in attachment ? attachment.storagePath : undefined,
    enabled,
  ]);

  return uri;
}
