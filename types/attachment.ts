export type AttachmentKind = 'image' | 'document';

export interface Attachment {
  id: string;
  uri: string; // lokal fil-URI (nyoprettet) ELLER en signeret remote-URL (hentet fra et andet device)
  storagePath?: string; // sti i Supabase Storage — sat når upload er lykkedes, bruges til sletning/re-signering
  name: string;
  kind: AttachmentKind;
}