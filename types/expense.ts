import type { MinorUnits } from '@/core/money/minorUnits';
import { Attachment } from './attachment';

export type ExpenseCategory = string;

export interface Expense {
  id: string;
  seriesId: string;      // grupperer instanser af "samme" udgift på tværs af måneder
  isRecurring: boolean;  
  name: string;
  amount: MinorUnits;     // DKK øre (APP-040); signed values are preserved as entered
  category: ExpenseCategory;
  nextPaymentDate: string;
  attachments: Attachment[]; // kvitteringer knyttet til DENNE måneds instans, ikke hele serien
  createdAt: string;
}