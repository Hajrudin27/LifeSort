import { randomUUID } from 'expo-crypto';

import type { Attachment } from '@/types/attachment';
import type { TripAttachment } from '@/types/trip';

export type AttachmentViewerSource = Pick<Attachment | TripAttachment, 'id' | 'uri' | 'name' | 'kind'> & {
  kind: 'image';
  storagePath?: string;
};

type ImageAttachment = Pick<Attachment | TripAttachment, 'id' | 'uri' | 'name'> & {
  kind: 'image';
  storagePath?: string;
};

const viewerSources = new Map<string, AttachmentViewerSource>();

/** Drop pending user-scoped handoffs on logout/account switch. */
export function clearAttachmentViewerSources(): void {
  viewerSources.clear();
}

export function registerAttachmentViewerSource(attachment: ImageAttachment): string {
  const sourceId = randomUUID();
  viewerSources.set(sourceId, {
    id: attachment.id,
    uri: attachment.uri,
    name: attachment.name,
    kind: 'image',
    storagePath: 'storagePath' in attachment ? attachment.storagePath : undefined,
  });
  return sourceId;
}

export function consumeAttachmentViewerSource(sourceId: string | undefined): AttachmentViewerSource | null {
  if (!sourceId) return null;
  const source = viewerSources.get(sourceId) ?? null;
  viewerSources.delete(sourceId);
  return source;
}
