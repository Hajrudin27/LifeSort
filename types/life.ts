export type TodoImportance = 'low' | 'medium' | 'high';

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  importance: TodoImportance;
  dueDate?: string;
  completed: boolean;
  createdAt: string;
}

/** A supporting step. Milestones never determine a goal's progress or completion. */
export interface GoalMilestone {
  id: string;
  title: string;
  completed: boolean;
}

interface GoalBase {
  id: string;
  title: string;
  description?: string;
  /** Civil date, YYYY-MM-DD. Optional; a passed deadline is not a failure. */
  deadline?: string;
  milestones: GoalMilestone[];
  createdAt: string;
}

/** One yes/no outcome. Carries no numbers and no unit. */
export interface BinaryGoal extends GoalBase {
  type: 'binary';
  completed: boolean;
}

/** A discrete tally with no unit. Integers. */
export interface CountGoal extends GoalBase {
  type: 'count';
  target: number;
  current: number;
}

/** A non-currency quantity in a free-text unit, stored as integer hundredths of that unit. */
export interface AmountGoal extends GoalBase {
  type: 'amount';
  target: number;
  current: number;
  unit: string;
}

/** A finite amount of time, stored as integer minutes. Not a recurring schedule. */
export interface DurationGoal extends GoalBase {
  type: 'duration';
  target: number;
  current: number;
}

export type LifeGoal = BinaryGoal | CountGoal | AmountGoal | DurationGoal;
export type GoalType = LifeGoal['type'];

export type HabitDirection = 'build' | 'quit'; // en vane du vil opbygge, eller en du vil af med

export interface HabitLog {
  id: string;
  date: string; // ISO-dato, kun dagen tæller ("2026-08-23")
}

export interface Habit {
  id: string;
  title: string;
  direction: HabitDirection;
  targetPerWeek?: number; // valgfrit mål, fx "3 gange om ugen"
  logs: HabitLog[];
  createdAt: string;
}