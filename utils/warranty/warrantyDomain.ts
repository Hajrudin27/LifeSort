import { isDocumentId } from '@/core/documents/documents';
import { parseCalendarDate } from '@/utils/shared/localDate';

/**
 * The warranty's own rules (APP-057), pure so they can be tested directly.
 *
 * Both dates are calendar dates, 'YYYY-MM-DD', validated by the one strict parser
 * the app already has. Nothing here repairs a date: an impossible day, a timestamp
 * or a missing zero is refused, never rolled over or reformatted.
 */

export type WarrantyDateProblem =
  /** Coverage end is not a canonical calendar date. */
  | 'invalid-coverage-end'
  /** A purchase date was given and is not a canonical calendar date. */
  | 'invalid-purchase-date'
  /** Bought after the coverage had already ended. */
  | 'purchase-after-coverage-end';

export function warrantyDateProblem(dates: {
  expiryDate: unknown;
  purchaseDate?: unknown;
}): WarrantyDateProblem | null {
  if (parseCalendarDate(dates.expiryDate) === null) return 'invalid-coverage-end';
  if (dates.purchaseDate === undefined) return null;
  if (parseCalendarDate(dates.purchaseDate) === null) return 'invalid-purchase-date';
  // Two validated 'YYYY-MM-DD' strings order exactly as their calendar days do.
  return (dates.purchaseDate as string) > (dates.expiryDate as string) ? 'purchase-after-coverage-end' : null;
}

/** Free text; blank means "not recorded", not an empty seller. */
export function normalizeWarrantySeller(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * A receipt reference is a document id or nothing. The shape is all that is
 * checked here; ownership and existence are the database's to decide.
 */
export function isWarrantyReceiptReference(value: unknown): value is string {
  return isDocumentId(value);
}
