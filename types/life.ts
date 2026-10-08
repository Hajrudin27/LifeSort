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

/** What the habit is about. A log means the commitment was kept on that date in BOTH directions. */
export type HabitDirection = 'build' | 'quit';

/** ISO weekday: Monday = 1 … Sunday = 7. Independent of locale and device timezone. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * What the habit asks of a day or week. `weekdays` names the days (ascending, unique;
 * "every day" is all seven), `weekly` is a count of 1–7 completions in an ISO week with no
 * fixed day, `open` has no expectation at all.
 */
export type HabitSchedule =
  | { kind: 'weekdays'; days: IsoWeekday[] }
  | { kind: 'weekly'; target: number }
  | { kind: 'open' };

/** The schedule applies from `effectiveFrom` (a local calendar date) until the next period starts. */
export interface HabitSchedulePeriod {
  effectiveFrom: string; // LocalDate, YYYY-MM-DD
  schedule: HabitSchedule;
}

/** One kept-the-commitment entry on a local calendar date. At most one per habit per date. */
export interface HabitLog {
  id: string;
  date: string; // LocalDate, YYYY-MM-DD
}

export interface Habit {
  id: string;
  title: string;
  direction: HabitDirection;
  /** The moment of creation (an instant). Never used to decide which day anything belongs to. */
  createdAt: string;
  /** First local calendar date the habit counts from. Stored; never moves with the timezone. */
  startDate: string;
  /** At least one period; the first starts on `startDate`; strictly increasing `effectiveFrom`. */
  scheduleHistory: HabitSchedulePeriod[];
  logs: HabitLog[];
}
