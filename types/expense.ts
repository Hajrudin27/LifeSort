import { Attachment } from './attachment';

export type ExpenseCategory = string;

export interface Expense {
  id: string;
  seriesId: string;      // grupperer instanser af "samme" udgift på tværs af måneder
  isRecurring: boolean;  
  name: string;
  amount: number;
  category: ExpenseCategory;
  nextPaymentDate: string;
  attachments: Attachment[]; // kvitteringer knyttet til DENNE måneds instans, ikke hele serien
  createdAt: string;
}