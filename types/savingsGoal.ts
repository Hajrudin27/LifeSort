import type { MinorUnits } from '@/core/money/minorUnits';

export type SavingsGoalIcon =
  | "travel"
  | "home"
  | "car"
  | "gift"
  | "tech"
  | "emergency"
  | "longTerm"
  | "other";

export interface SavingsGoal {
  id: string;
  name: string;
  icon: SavingsGoalIcon;
  targetAmount: MinorUnits; // DKK øre (APP-040)
  savedAmount: MinorUnits;
  deadline?: string;
  archived?: boolean;
  createdAt: string;
}

export interface SavingsContribution {
  id: string;
  goalId: string;
  amount: MinorUnits; // DKK øre, signeret: positiv = indbetaling, negativ = udtræk
  date: string; // ISO
}
