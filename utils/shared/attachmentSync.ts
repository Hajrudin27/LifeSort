import { supabase } from '@/lib/supabase';
import { Attachment } from '@/types/attachment';

const BUCKET = 'attachments';

// En signeret URL giver adgang til filen uden om login og RLS, og den kan ikke
// trækkes tilbage igen. Derfor er den kortlivet og udstedes først i det øjeblik,
// en fil faktisk skal vises — den gemmes aldrig på disk sammen med data.
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60;

// Forny lidt før udløb, så en URL ikke når at dø midt i en visning.
const SIGNED_URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Kun i hukommelsen — ryddes ved log ud og overlever ikke en app-genstart. */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export type AttachmentOwnerType = 'warranty' | 'expense';

// Stien i Storage er `<userId>/<type>/<ownerId>/<id>.<ext>`, og storage-policyen
// afgør ejerskab ud fra det FØRSTE segment. Kan et segment indeholde "/" eller
// "..", kan filen skrives uden for brugerens egen mappe og dermed uden om den
// policy. Derfor slipper kun tegn igennem, der ikke kan forme en sti.
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;
const SAFE_EXTENSION = /^[A-Za-z0-9]{1,8}$/;

/**
 * Filendelsen kommer fra et filnavn, brugeren — eller på Android en anden app —
 * har bestemt. Den accepteres kun, hvis den er ren alfanumerisk; ellers bruges
 * en fast endelse ud fra typen.
 */
function safeExtension(name: string, kind: Attachment['kind']): string {
  const fallback = kind === 'image' ? 'jpg' : 'dat';
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1) return fallback;

  const ext = name.slice(lastDot + 1).toLowerCase();
  return SAFE_EXTENSION.test(ext) ? ext : fallback;
}

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

    // Ingen af de tre segmenter må kunne udvide sig til en anden sti.
    if (!SAFE_SEGMENT.test(userId) || !SAFE_SEGMENT.test(ownerId) || !SAFE_SEGMENT.test(attachment.id)) {
      return null;
    }

    const ext = safeExtension(attachment.name, attachment.kind);
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
 * Henter vedhæftninger for én ejer (fx én garanti eller én udgift).
 * Bruges når data hentes fra Supabase på et device, der ikke har filerne lokalt.
 * Returnerer kun stien — brug resolveAttachmentUri for at få noget visbart.
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

    // Der signeres bevidst IKKE her. Ville vi det, endte en URL med lang levetid
    // i zustand og dermed i AsyncStorage. I stedet gemmes kun stien, og URL'en
    // udstedes af resolveAttachmentUri, når filen rent faktisk skal vises.
    return data.map((row) => ({
      id: row.id,
      uri: '',
      storagePath: row.storage_path,
      name: row.name,
      kind: row.kind as Attachment['kind'],
    }));
  } catch {
    return [];
  }
}

async function getSignedUrl(storagePath: string): Promise<string | null> {
  const cached = signedUrlCache.get(storagePath);
  if (cached && cached.expiresAt - Date.now() > SIGNED_URL_REFRESH_MARGIN_MS) {
    return cached.url;
  }

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

/**
 * Finder en URI, filen kan vises fra.
 *
 * Ligger filen lokalt (den er oprettet på denne enhed), bruges den direkte og der
 * røres ikke netværk. Ellers udstedes en kortlivet signeret URL ud fra stien.
 */
export async function resolveAttachmentUri(attachment: Attachment): Promise<string | null> {
  const isRemote = attachment.uri.startsWith('http');

  if (attachment.uri && !isRemote) return attachment.uri;

  if (attachment.storagePath) {
    const signed = await getSignedUrl(attachment.storagePath);
    if (signed) return signed;
  }

  // Ældre data kan have en gemt signeret URL uden sti. Den bruges som sidste
  // udvej, indtil vedhæftningen er hentet igen.
  return isRemote ? attachment.uri : null;
}

/** Kaldes ved log ud, så en ny bruger ikke arver den forriges signerede URL'er. */
export function clearSignedUrlCache(): void {
  signedUrlCache.clear();
}
