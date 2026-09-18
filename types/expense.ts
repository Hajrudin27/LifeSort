import type { RecurrenceFrequency } from '@/core/economy/recurrence';
import type { MinorUnits } from '@/core/money/minorUnits';
import { Attachment } from './attachment';

export type ExpenseCategory = string;

export interface Expense {
  id: string;
  seriesId: string;      // grupperer instanser af "samme" udgift på tværs af måneder
  isRecurring: boolean;
  /** APP-042: null when isRecurring is false, otherwise the cadence. Never both. */
  recurrenceFrequency: RecurrenceFrequency | null;
  /**
   * APP-042: the day of the month the schedule is anchored to, 1–31, or null for
   * a one-time cost. Internal metadata derived from the payment date the user
   * picked: a short month clamps one occurrence, never this anchor.
   */
  recurrenceAnchorDay: number | null;
  name: string;
  amount: MinorUnits;     // DKK øre (APP-040); signed values are preserved as entered
  category: ExpenseCategory;
  nextPaymentDate: string;
  attachments: Attachment[]; // kvitteringer knyttet til DENNE måneds instans, ikke hele serien
  createdAt: string;
}