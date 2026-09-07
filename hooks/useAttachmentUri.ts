import { useEffect, useState } from 'react';

import { Attachment } from '@/types/attachment';
import { resolveAttachmentUri } from '@/utils/shared/attachmentSync';

/**
 * Giver en URI, en vedhæftning kan vises fra.
 *
 * Ligger filen lokalt, er værdien klar med det samme. Ligger den kun i Storage,
 * udstedes en kortlivet signeret URL, når komponenten vises — og først der.
 * Returnerer null, indtil den er klar, eller hvis filen ikke kunne nås.
 */
export function useAttachmentUri(attachment: Attachment): string | null {
  const isLocal = attachment.uri !== '' && !attachment.uri.startsWith('http');
  const [uri, setUri] = useState<string | null>(isLocal ? attachment.uri : null);

  useEffect(() => {
    if (isLocal) {
      setUri(attachment.uri);
      return;
    }

    let cancelled = false;
    resolveAttachmentUri(attachment).then((resolved) => {
      if (!cancelled) setUri(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.id, attachment.uri, attachment.storagePath, isLocal]);

  return uri;
}
