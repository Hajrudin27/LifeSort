import { decodeGoals, decodeLegacyGoals } from '@/core/goals/persistedGoal';
import type { LocalMigrationDefinition } from './harness';

/**
 * APP-063. Life Goals Z0 to Z1.
 *
 * Z0 is the pre-APP-063 `{ id, title, description?, deadline?, subGoals[], createdAt }`.
 * Each such goal becomes a BINARY goal: its sub-goals are kept verbatim as milestones and
 * `completed` restates the only completion rule the app ever had (at least one sub-goal and
 * all done). No count, amount, duration or unit is inferred. A malformed row, an unknown
 * field, a duplicate id or a future version fails closed and leaves the original bytes.
 *
 * Imports the persisted-format contract from core/goals (the migration and the backup parser
 * must validate exactly what the store persists).
 */
type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

function goalsEnvelope(value: unknown, version: number): unknown[] | null {
  if (!record(value) || value.version !== version || !record(value.state)) return null;
  if (!Object.keys(value).every((key) => key === 'state' || key === 'version')) return null;
  if (!Object.keys(value.state).every((key) => key === 'goals')) return null;
  return Array.isArray(value.state.goals) ? value.state.goals : null;
}

export const goalsMigration: LocalMigrationDefinition = {
  storeId: 'async-storage:lifesort-life-goals',
  storageKey: 'lifesort-life-goals',
  currentVersion: 1,
  detectVersion: (value) => record(value) && typeof value.version === 'number' ? value.version : null,
  steps: {
    0: (value) => {
      const legacy = goalsEnvelope(value, 0);
      const goals = legacy ? decodeLegacyGoals(legacy) : null;
      if (!goals) throw new Error('unknown-legacy-shape');
      return { ...(value as Json), version: 1, state: { goals } };
    },
  },
  validateCurrent: (value) => {
    const goals = goalsEnvelope(value, 1);
    return goals !== null && decodeGoals(goals) !== null;
  },
};
