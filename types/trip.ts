import { Attachment } from "./attachment";

export type TripExpenseCategory =
  | "flight"
  | "accommodation"
  | "transport"
  | "food"
  | "activities"
  | "shopping"
  | "other";

export interface TripExpense {
  id: string;
  tripId: string;
  name: string;
  amount: number; // altid i DKK, uanset oprindelig valuta
  category: TripExpenseCategory;
  currency?: string; // fx "EUR" — kun sat hvis udgiften blev logget i en anden valuta end DKK
  originalAmount?: number; // beløbet i den oprindelige valuta
  exchangeRate?: number; // DKK per 1 enhed af den oprindelige valuta, fastfrosset på registreringstidspunktet
  attachments: Attachment[];
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
  /** Opaque text. New ids are crypto UUIDs; legacy ids keep whatever shape they had. */
  id: string;
  name: string;
  /**
   * The canonical owner, `trips.user_id`, as the server said it — or absent when it is not
   * known yet (a trip that predates this field, before its first fetch). Absent means
   * "unknown", never "mine": nothing owner-only is offered on an unknown owner (APP-058).
   */
  ownerId?: string;
  /**
   * Canonical destination (APP-058). Required for every trip the app creates now;
   * absent on trips that predate it, which stay readable and editable.
   */
  destination?: string;
  /** Calendar dates, 'YYYY-MM-DD'; the end is never before the start. */
  startDate: string;
  endDate: string;
  budget: number | null;
  /**
   * LEGACY on-device files only. Before APP-058 a trip's files were local encrypted
   * attachments that never left the phone. They stay reachable here until the user
   * explicitly moves one to Documents; new trip documents are references to
   * standalone Documents and are never stored on the trip.
   */
  documents: Attachment[];
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