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
  targetAmount: number;
  savedAmount: number;
  deadline?: string;
  archived?: boolean;
  createdAt: string;
}

export interface SavingsContribution {
  id: string;
  goalId: string;
  amount: number; // signeret: positiv = indbetaling, negativ = udtræk
  date: string; // ISO
}
