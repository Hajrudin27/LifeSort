import { Attachment } from "./attachment";
import type { MinorUnits } from "@/core/money/minorUnits";
import type { FinancialSemantic } from "@/features/economy/financialReadModel";

export type TripExpenseCategory =
  | "flight"
  | "accommodation"
  | "transport"
  | "food"
  | "activities"
  | "shopping"
  | "other";

/**
 * The one narrow durable draft used while a new Travel expense is being linked
 * into Economy. It is not a general outbox: one record is only the identity and
 * immutable idempotency payload needed to retry an ambiguous server response.
 */
export interface PendingTripExpenseDraft {
  expenseId: string;
  accountId: string;
  tripId: string;
  name: string;
  amount: MinorUnits;
  category: TripExpenseCategory;
  transactionDate: string;
  status: 'pending' | 'ambiguous' | 'confirmed';
}

export interface TripExpense {
  id: string;
  tripId: string;
  /** Server author when known; another participant's row cannot be re-attributed. */
  authorId?: string;
  name: string;
  /** The untouched pre-APP-059 major-unit value. Legacy Travel rows are historical only. */
  amount: number;
  /** Present only when APP-040 can convert `amount` without guessing or rounding. */
  amountMinor?: MinorUnits;
  category: TripExpenseCategory;
  currency?: string; // fx "EUR" — kun sat hvis udgiften blev logget i en anden valuta end DKK
  originalAmount?: number; // beløbet i den oprindelige valuta
  exchangeRate?: number; // DKK per 1 enhed af den oprindelige valuta, fastfrosset på registreringstidspunktet
  attachments: Attachment[];
  createdAt?: string;
  /** APP-059 never invents the missing historical transaction date. */
  resolutionStatus?: "requires-transaction-date";
}

/** Minimal Economy projection authorized for one trip. Never a second financial record. */
export interface TripFinancialProjection {
  tripId: string;
  expenseOwnerId: string;
  expenseId: string;
  name: string;
  amount: MinorUnits;
  category: TripExpenseCategory;
  transactionDate: string;
  semantic: FinancialSemantic;
  status: "pending" | "booked";
  legacyTripExpenseId?: string;
  currency?: string;
  originalAmount?: number;
  exchangeRate?: number;
}

export type PackingCategory = 'essentials' | 'clothing' | 'electronics' | 'toiletries' | 'other';

export interface PackingItem {
  id: string;
  tripId: string;
  /** Server author when known; participant edits must not re-attribute the row. */
  authorId?: string;
  label: string;
  checked: boolean;
  isDefault: boolean;
  category: PackingCategory;
}

/** Durable Trip-level record that one exact global template release was explicitly applied. */
export interface AppliedPackingTemplate {
  tripId: string;
  templateId: string;
  templateVersion: number;
  appliedBy?: string;
  appliedAt?: string;
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
  /** Canonical local budget in DKK MinorUnits (APP-059). */
  budget: MinorUnits | null;
  /** An unsafe legacy major-unit value is preserved here and never rounded. */
  legacyBudgetMajor?: number;
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
