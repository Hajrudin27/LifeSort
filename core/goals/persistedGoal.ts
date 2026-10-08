import type { GoalMilestone, GoalType, LifeGoal } from '@/types/life';
import { parseCalendarDate } from '@/utils/shared/localDate';

/**
 * APP-063 — the persisted Life Goal FORMAT, and nothing else.
 *
 * What a stored goal looks like (exact per-type key sets, the 10^12 integer bound, the unit
 * rule), how a list of them is decoded strictly, and the frozen mapping of the pre-APP-063
 * `subGoals` shape onto a binary goal. The local migration and the backup parser — both core —
 * must validate exactly what the store persists, so this is the documented C2 exception for a
 * persisted-format contract (like core/food/ingredients, core/economy/recurrence, core/home/moving;
 * docs/core-contract.md). It depends only on shared entity types and the calendar primitive.
 *
 * Deliberately NOT here: progress, completion, building or changing goals, input parsing,
 * server-row mapping, display. Those are the Goals module's rules and live in
 * features/goals/domain, which imports from here: the dependency points inward.
 */
export const GOAL_TYPES: readonly GoalType[] = Object.freeze(['binary', 'count', 'amount', 'duration']);
/** Largest stored integer: count, hundredths of a unit, or minutes. Safe in JS and bigint in SQL. */
export const MAX_GOAL_VALUE = 1_000_000_000_000;
export const MAX_GOAL_UNIT_LENGTH = 24;


type Json = Record<string, unknown>;
export const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
export const hasOnly = (value: Json, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key));
export const has = (value: Json, key: string) => Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined;
export const nonEmptyText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

export const isGoalValue = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_GOAL_VALUE;
export const isGoalTarget = (value: unknown): value is number => isGoalValue(value) && value >= 1;
/** Trimmed already: the stored unit is exactly what the user sees, so SQL can compare it plainly. */
export const isGoalUnit = (value: unknown): value is string =>
  typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= MAX_GOAL_UNIT_LENGTH;

export function decodeMilestone(value: unknown): GoalMilestone | null {
  if (!record(value) || !hasOnly(value, ['id', 'title', 'completed'])) return null;
  if (!nonEmptyText(value.id) || !nonEmptyText(value.title) || typeof value.completed !== 'boolean') return null;
  return { id: value.id, title: value.title, completed: value.completed };
}

/** All-or-nothing, ids unique. There is deliberately no count limit: history may be larger than any UX limit. */
export function decodeMilestones(value: unknown): GoalMilestone[] | null {
  if (!Array.isArray(value)) return null;
  const out: GoalMilestone[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const milestone = decodeMilestone(entry);
    if (!milestone || seen.has(milestone.id)) return null;
    seen.add(milestone.id);
    out.push(milestone);
  }
  return out;
}

const BASE_KEYS = ['id', 'title', 'description', 'deadline', 'milestones', 'createdAt', 'type'] as const;
const TYPE_KEYS: Record<GoalType, readonly string[]> = {
  binary: ['completed'],
  count: ['target', 'current'],
  amount: ['target', 'current', 'unit'],
  duration: ['target', 'current'],
};

/** Strict canonical decode: exact per-type key set, no cross-type field, fresh object out. */
export function decodeGoal(value: unknown): LifeGoal | null {
  if (!record(value) || typeof value.type !== 'string' || !GOAL_TYPES.includes(value.type as GoalType)) return null;
  const type = value.type as GoalType;
  const keys = TYPE_KEYS[type];
  if (!hasOnly(value, [...BASE_KEYS, ...keys]) || !keys.every((key) => has(value, key))) return null;
  if (!nonEmptyText(value.id) || !nonEmptyText(value.title) || !instant(value.createdAt)) return null;
  if (has(value, 'description') && typeof value.description !== 'string') return null;
  if (has(value, 'deadline') && parseCalendarDate(value.deadline) === null) return null;
  const milestones = decodeMilestones(value.milestones);
  if (!milestones) return null;
  const base = {
    id: value.id, title: value.title,
    ...(has(value, 'description') ? { description: value.description as string } : {}),
    ...(has(value, 'deadline') ? { deadline: value.deadline as string } : {}),
    milestones, createdAt: value.createdAt,
  };
  if (type === 'binary') return typeof value.completed === 'boolean' ? { ...base, type, completed: value.completed } : null;
  if (!isGoalTarget(value.target) || !isGoalValue(value.current)) return null;
  if (type === 'amount') return isGoalUnit(value.unit) ? { ...base, type, target: value.target, current: value.current, unit: value.unit } : null;
  return { ...base, type, target: value.target, current: value.current };
}

export function decodeGoals(value: unknown): LifeGoal[] | null {
  if (!Array.isArray(value)) return null;
  const out: LifeGoal[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const goal = decodeGoal(entry);
    if (!goal || seen.has(goal.id)) return null;
    seen.add(goal.id);
    out.push(goal);
  }
  return out;
}

/** The only definition of "completed" a pre-APP-063 goal ever had. */
export const legacyCompletion = (milestones: readonly GoalMilestone[]) =>
  milestones.length > 0 && milestones.every((milestone) => milestone.completed);

/**
 * The pre-APP-063 shape `{ id, title, description?, deadline?, subGoals[], createdAt }`.
 * It becomes a BINARY goal: the old sub-goals are kept verbatim as milestones, and nothing
 * numeric is inferred. A historically completed goal stays completed.
 */
export function decodeLegacyGoal(value: unknown): LifeGoal | null {
  if (!record(value) || !hasOnly(value, ['id', 'title', 'description', 'deadline', 'subGoals', 'createdAt'])) return null;
  const milestones = decodeMilestones(value.subGoals);
  if (!milestones) return null;
  return decodeGoal({
    id: value.id, title: value.title,
    ...(has(value, 'description') ? { description: value.description } : {}),
    ...(has(value, 'deadline') ? { deadline: value.deadline } : {}),
    milestones, createdAt: value.createdAt, type: 'binary', completed: legacyCompletion(milestones),
  });
}

export function decodeLegacyGoals(value: unknown): LifeGoal[] | null {
  if (!Array.isArray(value)) return null;
  const out: LifeGoal[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const goal = decodeLegacyGoal(entry);
    if (!goal || seen.has(goal.id)) return null;
    seen.add(goal.id);
    out.push(goal);
  }
  return out;
}
