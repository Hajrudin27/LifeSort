import { decodeHabit, decodeLegacyHabit } from '@/core/habits/persistedHabit';
import { scheduleForDisplay } from '@/features/habits/domain/habitStatus';
import type { Habit } from '@/types/life';
import { parseCalendarDate } from '@/utils/shared/localDate';

/**
 * APP-064 — the `public.habits` row. The table keeps its original columns so an older client
 * still reads and writes it, and gains two nullable ones that carry the canonical model:
 * `start_date` and `schedule_history`. `logs` stays an embedded jsonb array of `{ id, date }`.
 *
 * Sync is still the original whole-row upsert (ADR-0052): this module only maps shapes. It
 * does not make concurrent edits safe.
 */
type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const absent = (value: unknown) => value === null || value === undefined;

/**
 * `target_per_week` is a COMPATIBILITY MIRROR for older clients and nothing else: the weekly
 * target of the schedule in effect on `today`, otherwise NULL. A weekly change that is still
 * waiting for Monday is NOT mirrored yet — an older client must not show next week's target
 * today. The cost is that the mirror reflects the schedule as of the last write, so a change
 * that took effect on Monday reaches an older client only with the next write. This client
 * never reads the mirror back while `schedule_history` is present, so an older client editing
 * it cannot change a canonical schedule.
 */
export function mirroredTargetPerWeek(habit: Habit, today: string): number | null {
  const active = scheduleForDisplay(habit, today);
  return active.kind === 'weekly' ? active.target : null;
}

/** `today` is the device-local date, captured when the user acted (the mapper itself reads no clock). */
export function habitToRow(userId: string, habit: Habit, today: string) {
  return {
    id: habit.id,
    user_id: userId,
    title: habit.title,
    direction: habit.direction,
    target_per_week: mirroredTargetPerWeek(habit, today),
    logs: habit.logs,
    created_at: habit.createdAt,
    start_date: habit.startDate,
    schedule_history: habit.scheduleHistory,
  };
}

/**
 * An older client lets its user mark every day from the UTC date of `created_at` onward. A habit a
 * current client created within the first hours of a local day east of UTC has a `start_date` one day
 * LATER than that (the local date), so the older client can write an entry dated before `start_date`
 * while leaving `start_date` and `schedule_history` untouched. Strict decoding would reject that row
 * and the user would lose the whole habit from view on a fresh device.
 *
 * The compatible reading is the same rule the legacy mapping uses: the habit counts from the earlier of
 * its start date and its earliest entry. Only the first period's start moves back to that day, so the
 * user's own schedule now also covers a day they themselves marked. Nothing else changes: no entry is
 * dropped or re-dated, no period is invented, and the window is exactly the older client's legal range
 * (never earlier than the UTC date of `created_at`), so a hand-edited or corrupt row is still refused.
 * Local persistence and backups keep the strict rule: what this returns is already coherent.
 */
function decodeWithOlderClientEntries(input: Json): Habit | null {
  const { createdAt, startDate, scheduleHistory, logs } = input;
  if (typeof createdAt !== 'string' || typeof startDate !== 'string' || parseCalendarDate(startDate) === null) return null;
  const windowStart = createdAt.slice(0, 10);
  if (parseCalendarDate(windowStart) === null) return null;
  if (!Array.isArray(logs) || !Array.isArray(scheduleHistory) || !record(scheduleHistory[0])) return null;
  let earliest = startDate;
  for (const log of logs) {
    if (record(log) && typeof log.date === 'string' && parseCalendarDate(log.date) !== null && log.date < earliest) earliest = log.date;
  }
  // Nothing earlier than start_date, or earlier than the older client could ever have written. (When the habit
  // was created on or after start_date there is no window at all: every earlier entry is below windowStart.)
  if (earliest === startDate || earliest < windowStart) return null;
  return decodeHabit({
    ...input, startDate: earliest,
    scheduleHistory: [{ ...scheduleHistory[0], effectiveFrom: earliest }, ...scheduleHistory.slice(1)],
  });
}

/**
 * A server row. Both new columns NULL is a LEGACY habit, permanently (an older client writes
 * it): it is read through the same mapping as the local migration (`target_per_week` becomes
 * the schedule, the start date is derived) and is never an error. Both present is canonical
 * and `target_per_week` is ignored. Exactly one present is malformed. Any row that does not
 * decode strictly is dropped (null) — never rendered, never guessed at, never half applied —
 * except the one older-client case documented on `decodeWithOlderClientEntries`.
 */
export function decodeRemoteHabitRow(row: unknown): Habit | null {
  if (!record(row)) return null;
  const hasStart = !absent(row.start_date);
  const hasHistory = !absent(row.schedule_history);
  if (hasStart !== hasHistory) return null;
  const logs = row.logs ?? [];
  if (!hasStart) {
    return decodeLegacyHabit({
      id: row.id, title: row.title, direction: row.direction,
      ...(absent(row.target_per_week) ? {} : { targetPerWeek: row.target_per_week }),
      logs, createdAt: row.created_at,
    });
  }
  const canonical = {
    id: row.id, title: row.title, direction: row.direction, createdAt: row.created_at,
    startDate: row.start_date, scheduleHistory: row.schedule_history, logs,
  };
  return decodeHabit(canonical) ?? decodeWithOlderClientEntries(canonical);
}
