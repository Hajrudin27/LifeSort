import { decodeHabits, decodeLegacyHabits } from '@/core/habits/persistedHabit';
import type { LocalMigrationDefinition } from './harness';

/**
 * APP-064. Habits Z0 to Z1.
 *
 * Z0 is the pre-APP-064 `{ id, title, direction, targetPerWeek?, logs[], createdAt }`. Each
 * habit becomes a canonical habit: id, title, direction, createdAt and every log id and date
 * are kept verbatim; `startDate` is the earlier of the civil date at the head of `createdAt`
 * and the earliest logged date; `targetPerWeek` becomes the single initial schedule period
 * (absent, null or an out-of-range number is `open`; an integer 1 to 7 is `weekly`).
 *
 * A log is read as "the commitment was kept on that date", for both directions. A malformed
 * row, an unknown field, a log date that is not a calendar date, a duplicate date or id, or a
 * future version fails closed and leaves the original bytes untouched.
 *
 * Imports the persisted-format contract from core/habits (the migration and the backup parser
 * must validate exactly what the store persists).
 */
type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

function habitsEnvelope(value: unknown, version: number): unknown[] | null {
  if (!record(value) || value.version !== version || !record(value.state)) return null;
  if (!Object.keys(value).every((key) => key === 'state' || key === 'version')) return null;
  if (!Object.keys(value.state).every((key) => key === 'habits')) return null;
  return Array.isArray(value.state.habits) ? value.state.habits : null;
}

export const habitsMigration: LocalMigrationDefinition = {
  storeId: 'async-storage:lifesort-habits',
  storageKey: 'lifesort-habits',
  currentVersion: 1,
  detectVersion: (value) => record(value) && typeof value.version === 'number' ? value.version : null,
  steps: {
    0: (value) => {
      const legacy = habitsEnvelope(value, 0);
      const habits = legacy ? decodeLegacyHabits(legacy) : null;
      if (!habits) throw new Error('unknown-legacy-shape');
      return { ...(value as Json), version: 1, state: { habits } };
    },
  },
  validateCurrent: (value) => {
    const habits = habitsEnvelope(value, 1);
    return habits !== null && decodeHabits(habits) !== null;
  },
};
