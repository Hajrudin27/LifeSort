import { supabase } from '@/lib/supabase';
import { Attachment } from '@/types/attachment';

const BUCKET = 'attachments';
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 365; // 1 år — pragmatisk for en personlig app, undgår re-signeringskompleksitet

export type AttachmentOwnerType = 'warranty' | 'expense';

async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * Uploader en vedhæftning i baggrunden og registrerer den i `attachments`-tabellen.
 * Fejler stille — den lokale fil er allerede vist til brugeren uanset om dette lykkes,
 * så en netværksfejl her må aldrig afbryde brugerens flow.
 */
export async function uploadAttachment(
  ownerType: AttachmentOwnerType,
  ownerId: string,
  attachment: Attachment,
): Promise<{ storagePath: string } | null> {
  try {
    const userId = await getUserId();
    if (!userId) return null;

    const ext = attachment.name.includes('.')
      ? attachment.name.split('.').pop()
      : attachment.kind === 'image'
        ? 'jpg'
        : 'dat';
    const storagePath = `${userId}/${ownerType}/${ownerId}/${attachment.id}.${ext}`;

    const response = await fetch(attachment.uri);
    const blob = await response.blob();

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, blob, {
      upsert: true,
      contentType: attachment.kind === 'image' ? 'image/jpeg' : undefined,
    });
    if (uploadError) return null;

    const { error: insertError } = await supabase.from('attachments').upsert({
      id: attachment.id,
      user_id: userId,
      owner_type: ownerType,
      owner_id: ownerId,
      storage_path: storagePath,
      name: attachment.name,
      kind: attachment.kind,
    });
    if (insertError) return null;

    return { storagePath };
  } catch {
    return null;
  }
}

export async function deleteAttachmentRemote(attachmentId: string, storagePath?: string): Promise<void> {
  try {
    const userId = await getUserId();
    if (!userId) return;
    if (storagePath) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
    }
    await supabase.from('attachments').delete().eq('id', attachmentId).eq('user_id', userId);
  } catch {
    // Best-effort — den lokale sletning er allerede sket uanset.
  }
}

/**
 * Henter vedhæftninger for én ejer (fx én garanti eller én udgift) med friske signerede URL'er.
 * Bruges når data hentes fra Supabase på et device, der ikke har filerne lokalt.
 */
export async function fetchAttachmentsFor(ownerType: AttachmentOwnerType, ownerId: string): Promise<Attachment[]> {
  try {
    const userId = await getUserId();
    if (!userId) return [];

    const { data, error } = await supabase
      .from('attachments')
      .select('id, storage_path, name, kind')
      .eq('user_id', userId)
      .eq('owner_type', ownerType)
      .eq('owner_id', ownerId);

    if (error || !data) return [];

    const results: Attachment[] = [];
    for (const row of data) {
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.storage_path, SIGNED_URL_EXPIRY_SECONDS);
      if (!signed?.signedUrl) continue;
      results.push({
        id: row.id,
        uri: signed.signedUrl,
        storagePath: row.storage_path,
        name: row.name,
        kind: row.kind as Attachment['kind'],
      });
    }
    return results;
  } catch {
    return [];
  }
}