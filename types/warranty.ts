export type WarrantyType =
  | "insurance"
  | "rental"
  | "warranty"
  | "receipt"
  | "other";

export interface WarrantyAttachment {
  id: string;
  uri: string;
  name: string;
  kind: "image" | "document";
}

export interface Warranty {
  id: string;
  name: string;
  type: WarrantyType;
  expiryDate: string;
  notes?: string;
  attachments: WarrantyAttachment[];
  createdAt: string;
}
