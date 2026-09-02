export type TaskKind = 'cleaning' | 'maintenance';
export type TaskFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface HouseholdTask {
  id: string;
  kind: TaskKind;
  title: string;
  frequency: TaskFrequency;
  lastDone?: string; // ISO-dato
  createdAt: string;
}

export interface HouseholdItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface MovingItem {
  id: string;
  label: string;
  checked: boolean;
}