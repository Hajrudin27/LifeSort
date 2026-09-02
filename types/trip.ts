export type TripExpenseCategory =
  | "flight"
  | "accommodation"
  | "transport"
  | "food"
  | "activities"
  | "shopping"
  | "other";

export interface TripAttachment {
  id: string;
  uri: string;
  name: string;
  kind: "image" | "document";
}

export interface TripExpense {
  id: string;
  tripId: string;
  name: string;
  amount: number; // altid i DKK, uanset oprindelig valuta
  category: TripExpenseCategory;
  currency?: string; // fx "EUR" — kun sat hvis udgiften blev logget i en anden valuta end DKK
  originalAmount?: number; // beløbet i den oprindelige valuta
  exchangeRate?: number; // DKK per 1 enhed af den oprindelige valuta, fastfrosset på registreringstidspunktet
  attachments: TripAttachment[];
  createdAt: string;
}

export type PackingCategory = 'essentials' | 'clothing' | 'electronics' | 'toiletries' | 'other';

export interface PackingItem {
  id: string;
  tripId: string;
  label: string;
  checked: boolean;
  isDefault: boolean;
  category: PackingCategory;
}

export interface Trip {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  budget: number | null;
  documents: TripAttachment[];
  createdAt: string;
}

export interface TripParticipant {
  tripId: string;
  ownerId: string;
  userId: string;
  invitedEmail: string;
  status: 'pending' | 'accepted' | 'declined';
  invitedAt: string;
}