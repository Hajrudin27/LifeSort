import { Attachment } from './attachment';

export type WarrantyType =
  | "insurance"
  | "rental"
  | "warranty"
  | "receipt"
  | "other";

export interface Warranty {
  id: string;
  /** The product label. Kept under its original name for compatibility (APP-057). */
  name: string;
  type: WarrantyType;
  /** Canonical coverage end, 'YYYY-MM-DD'. Reminders derive from this date only. */
  expiryDate: string;
  notes?: string;
  /** Optional calendar date of purchase, 'YYYY-MM-DD'; never after `expiryDate`. */
  purchaseDate?: string;
  /** Optional seller, free text. */
  seller?: string;
  /**
   * Optional opaque id of one of the user's own standalone documents (APP-055).
   * An id only — never the file, its path, its name or a URL.
   */
  receiptDocumentId?: string;
  attachments: Attachment[];
  createdAt: string;
}
