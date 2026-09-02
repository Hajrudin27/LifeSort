import { TaskFrequency } from '@/types/household';

const DAYS_BY_FREQUENCY: Record<TaskFrequency, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
};

export function daysUntilDue(lastDone: string | undefined, frequency: TaskFrequency): number {
  if (!lastDone) return 0; // aldrig gjort = forfalder nu
  const dueDate = new Date(lastDone);
  dueDate.setDate(dueDate.getDate() + DAYS_BY_FREQUENCY[frequency]);
  const diffMs = dueDate.getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}