import { Attachment } from './attachment';

export type WarrantyType =
  | "insurance"
  | "rental"
  | "warranty"
  | "receipt"
  | "other";

export interface Warranty {
  id: string;
  name: string;
  type: WarrantyType;
  expiryDate: string;
  notes?: string;
  attachments: Attachment[];
  createdAt: string;
}