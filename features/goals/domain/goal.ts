import {
  decodeGoal,
  decodeLegacyGoal,
  decodeMilestone,
  decodeMilestones,
  GOAL_TYPES,
  has,
  hasOnly,
  isGoalTarget,
  isGoalUnit,
  isGoalValue,
  MAX_GOAL_UNIT_LENGTH,
  MAX_GOAL_VALUE,
  record,
} from '@/core/goals/persistedGoal';
import type { GoalMilestone, GoalType, LifeGoal } from '@/types/life';
import { parseCalendarDate } from '@/utils/shared/localDate';

// The persisted-format contract lives in core (the migration and backup parser consume it);
// it is re-exported so every Goals caller keeps one import path.
export {
  decodeGoal,
  decodeGoals,
  decodeLegacyGoal,
  decodeLegacyGoals,
  decodeMilestone,
  decodeMilestones,
  GOAL_TYPES,
  isGoalTarget,
  isGoalUnit,
  isGoalValue,
  legacyCompletion,
  MAX_GOAL_UNIT_LENGTH,
  MAX_GOAL_VALUE,
} from '@/core/goals/persistedGoal';

/**
 * APP-063 — the Life Goal rules: progress and completion, building and changing goals, and
 * mapping server rows. The module's own business logic.
 *
 * A pure leaf: it imports the persisted-format contract from core (the inward direction),
 * the shared entity types and the calendar primitive, and nothing else — no store, UI, i18n,
 * network, clock or money primitive. `__tests__/goalDomainBoundary.test.ts` holds it to that.
 *
 * Exactly four types. Numeric completion is derived (`current >= target`), so no stored
 * flag can disagree with the numbers; only a binary goal stores `completed`. Milestones are
 * supporting structure and never take part in progress or completion.
 */

export type GoalErrorCode =
  | 'goal_type_invalid' | 'goal_title_invalid' | 'goal_description_invalid' | 'goal_deadline_invalid'
  | 'goal_target_invalid' | 'goal_current_invalid' | 'goal_unit_invalid' | 'goal_milestone_invalid'
  | 'goal_field_invalid' | 'goal_type_mismatch';

/** Fixed codes only: never an amount, title, id or date. */
export class GoalError extends Error {
  constructor(readonly code: GoalErrorCode) {
    super(code);
    this.name = 'GoalError';
  }
}

type Json = Record<string, unknown>;

// ---------- server rows -------------------------------------------------------------------

const TYPED_COLUMNS = ['goal_type', 'target_value', 'current_value', 'unit', 'completed'] as const;
const dbInteger = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  return typeof value === 'string' && /^\d{1,13}$/.test(value) ? Number(value) : null;
};

/**
 * A server row. All typed columns NULL is a LEGACY goal, permanently (an older client
 * writes it): it is read through the same mapping as the local migration and is never an
 * error. Any other mix is malformed and the row is dropped rather than guessed at.
 */
export function decodeRemoteGoalRow(row: unknown): LifeGoal | null {
  if (!record(row)) return null;
  const base = {
    id: row.id, title: row.title,
    ...(row.description === null || row.description === undefined ? {} : { description: row.description }),
    ...(row.deadline === null || row.deadline === undefined ? {} : { deadline: row.deadline }),
    createdAt: row.created_at,
  };
  const milestones = decodeMilestones(row.sub_goals ?? []);
  if (!milestones) return null;
  const typed = TYPED_COLUMNS.map((column) => row[column] !== null && row[column] !== undefined);
  if (!typed.some(Boolean)) return decodeLegacyGoal({ ...base, subGoals: milestones });
  if (typeof row.goal_type !== 'string') return null;
  const type = row.goal_type;
  const target = row.target_value === null || row.target_value === undefined ? undefined : dbInteger(row.target_value);
  const current = row.current_value === null || row.current_value === undefined ? undefined : dbInteger(row.current_value);
  if (target === null || current === null) return null;
  const extra = type === 'binary' ? { completed: row.completed }
    : type === 'amount' ? { target, current, unit: row.unit }
    : { target, current };
  // Fields that do not belong to the type must be NULL; decodeGoal's exact key set then enforces it.
  const stray = type === 'binary' ? [target, current, row.unit] : type === 'amount' ? [row.completed]
    : [row.unit, row.completed];
  if (stray.some((value) => value !== null && value !== undefined)) return null;
  return decodeGoal({ ...base, milestones, type, ...extra });
}

export function goalToRow(userId: string, goal: LifeGoal) {
  const numeric = goal.type === 'binary' ? null : goal;
  return {
    id: goal.id,
    user_id: userId,
    title: goal.title,
    description: goal.description ?? null,
    deadline: goal.deadline ?? null,
    sub_goals: goal.milestones, // the column keeps its historical name for older clients
    created_at: goal.createdAt,
    goal_type: goal.type,
    target_value: numeric ? numeric.target : null,
    current_value: numeric ? numeric.current : null,
    unit: goal.type === 'amount' ? goal.unit : null,
    completed: goal.type === 'binary' ? goal.completed : null,
  };
}

// ---------- the one progress / completion definition -------------------------------------

export function goalIsCompleted(goal: LifeGoal): boolean {
  if (goal.type === 'binary') return goal.completed;
  return goal.target >= 1 && goal.current >= goal.target;
}

/** 0..1. Binary is 0 or 1; numeric is `min(1, current / target)`. Milestones are never consulted. */
export function goalProgress(goal: LifeGoal): number {
  if (goal.type === 'binary') return goal.completed ? 1 : 0;
  if (!(goal.target >= 1)) return 0;
  return Math.min(1, Math.max(0, goal.current / goal.target));
}

/** Mean of each goal's own progress; 0 with no goals. */
export function meanGoalProgress(goals: readonly LifeGoal[]): number {
  if (goals.length === 0) return 0;
  return goals.reduce((sum, goal) => sum + goalProgress(goal), 0) / goals.length;
}

export function goalMilestoneSummary(goal: Pick<LifeGoal, 'milestones'>): { done: number; total: number } {
  return { done: goal.milestones.filter((milestone) => milestone.completed).length, total: goal.milestones.length };
}

// ---------- building and changing goals (pure; throw GoalError, never partial) ------------

export type NewGoalInput = {
  title: string;
  description?: string;
  deadline?: string;
} & (
  | { type: 'binary' }
  | { type: 'count'; target: number; current?: number }
  | { type: 'amount'; target: number; current?: number; unit: string }
  | { type: 'duration'; target: number; current?: number }
);

const fail = (code: GoalErrorCode): never => { throw new GoalError(code); };

function cleanDescription(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return fail('goal_description_invalid');
  return value.trim() || undefined;
}

function checkedDeadline(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  return parseCalendarDate(value) === null ? fail('goal_deadline_invalid') : value;
}

/** Validates the whole input and returns canonical state, or throws one fixed code. */
export function buildGoal(input: NewGoalInput, id: string, createdAt: string): LifeGoal {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) fail('goal_title_invalid');
  if (!GOAL_TYPES.includes((input as { type: GoalType }).type)) fail('goal_type_invalid');
  const description = cleanDescription(input.description);
  const deadline = checkedDeadline(input.deadline);
  const base = {
    id, title,
    ...(description === undefined ? {} : { description }),
    ...(deadline === undefined ? {} : { deadline }),
    milestones: [] as GoalMilestone[], createdAt,
  };
  if (input.type === 'binary') {
    if (Object.keys(input).some((key) => ['target', 'current', 'unit'].includes(key))) fail('goal_field_invalid');
    return { ...base, type: 'binary', completed: false };
  }
  if (!isGoalTarget(input.target)) fail('goal_target_invalid');
  const current = input.current ?? 0;
  if (!isGoalValue(current)) fail('goal_current_invalid');
  if (input.type === 'amount') {
    const unit = typeof input.unit === 'string' ? input.unit.trim() : '';
    if (!isGoalUnit(unit)) fail('goal_unit_invalid');
    return { ...base, type: 'amount', target: input.target, current, unit };
  }
  if ('unit' in input && (input as { unit?: unknown }).unit !== undefined) fail('goal_field_invalid');
  return { ...base, type: input.type, target: input.target, current };
}

export interface GoalUpdate {
  title?: string;
  description?: string | null;
  /** `null` clears the deadline. */
  deadline?: string | null;
  target?: number;
  unit?: string;
}

/** The type is immutable: an update can only touch fields that belong to the goal's own type. */
export function updateGoalFields(goal: LifeGoal, update: GoalUpdate): LifeGoal {
  const next: Json = { ...goal };
  if (update.title !== undefined) {
    const title = typeof update.title === 'string' ? update.title.trim() : '';
    if (!title) fail('goal_title_invalid');
    next.title = title;
  }
  if (update.description !== undefined) {
    const description = update.description === null ? undefined : cleanDescription(update.description);
    if (description === undefined) delete next.description; else next.description = description;
  }
  if (update.deadline !== undefined) {
    const deadline = checkedDeadline(update.deadline);
    if (deadline === undefined) delete next.deadline; else next.deadline = deadline;
  }
  if (update.target !== undefined) {
    if (goal.type === 'binary') fail('goal_field_invalid');
    if (!isGoalTarget(update.target)) fail('goal_target_invalid');
    next.target = update.target;
  }
  if (update.unit !== undefined) {
    if (goal.type !== 'amount') fail('goal_field_invalid');
    const unit = typeof update.unit === 'string' ? update.unit.trim() : '';
    if (!isGoalUnit(unit)) fail('goal_unit_invalid');
    next.unit = unit;
  }
  return decodeGoal(next) ?? fail('goal_field_invalid');
}

/** Absolute value, never a delta: replaying it is harmless. */
export function withCurrent(goal: LifeGoal, current: number): LifeGoal {
  if (goal.type === 'binary') return fail('goal_type_mismatch');
  if (!isGoalValue(current)) return fail('goal_current_invalid');
  return { ...goal, current };
}

export function withCompleted(goal: LifeGoal, completed: boolean): LifeGoal {
  if (goal.type !== 'binary') return fail('goal_type_mismatch');
  if (typeof completed !== 'boolean') return fail('goal_field_invalid');
  return { ...goal, completed };
}

export function withMilestone(goal: LifeGoal, milestone: GoalMilestone): LifeGoal {
  const added = decodeMilestone(milestone) ?? fail('goal_milestone_invalid');
  if (goal.milestones.some((entry) => entry.id === added.id)) fail('goal_milestone_invalid');
  return { ...goal, milestones: [...goal.milestones, added] };
}

export function withMilestoneToggled(goal: LifeGoal, milestoneId: string): LifeGoal {
  return { ...goal, milestones: goal.milestones.map((m) => (m.id === milestoneId ? { ...m, completed: !m.completed } : m)) };
}

export function withoutMilestone(goal: LifeGoal, milestoneId: string): LifeGoal {
  return { ...goal, milestones: goal.milestones.filter((m) => m.id !== milestoneId) };
}
