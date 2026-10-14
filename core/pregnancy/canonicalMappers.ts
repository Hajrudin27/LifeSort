import type { PregnancyEntityType } from '@/core/pregnancy/protectedRepository';
import { isPregnancyUuid } from '@/core/pregnancy/syncPull';
import type { PregnancyChange } from '@/core/pregnancy/syncContract';
import type { PregnancyAppointment, PregnancyEntry, PregnancySettings, PregnancySymptomLog } from '@/types/pregnancy';

/** Explicit column lists: a column that is not named here is never read from the server. */
export const PREGNANCY_CANONICAL_COLUMNS = {
  pregnancy: 'id,user_id,method,lmp_date,conception_date,due_date_override,due_date_source,ended_at,outcome,outcome_notes,recovery_ended_at,revision,updated_at,deleted_at,created_at',
  log: 'id,user_id,pregnancy_id,date,symptoms,weight_kg,belly_measurement_cm,notes,revision,updated_at,deleted_at',
  appointment: 'id,user_id,pregnancy_id,starts_at,time_zone,title,notes,completed,reminder_enabled,revision,updated_at,deleted_at',
  settings: 'user_id,recovery_display_days,privacy_mode,revision,updated_at',
} as const;

export const PREGNANCY_CANONICAL_TABLES = {
  pregnancy: 'pregnancies', log: 'pregnancy_symptom_logs', appointment: 'pregnancy_appointments', settings: 'pregnancy_settings',
} as const;

/**
 * What the server's canonical row means locally. A tombstone is only a revision: the
 * server scrubs every clinical column on delete, and nothing here ever carries one.
 */
export type RemoteLiveEntity =
  | { readonly entityType: 'pregnancy'; readonly entity: PregnancyEntry }
  | { readonly entityType: 'log'; readonly entity: PregnancySymptomLog }
  | { readonly entityType: 'appointment'; readonly entity: PregnancyAppointment }
  | { readonly entityType: 'settings'; readonly entity: PregnancySettings };
export type RemoteEntityState =
  | { readonly kind: 'live'; readonly revision: number; readonly live: RemoteLiveEntity }
  | { readonly kind: 'tombstone'; readonly revision: number };

/** A ledger-explained remote entity, ready for protected reconciliation. */
export type RemoteEntitySnapshot = {
  readonly entityType: PregnancyEntityType;
  readonly entityId: string;
  /** The highest revision any ledger row on this page announced for the entity. */
  readonly metadataRevision: number;
  /** The highest ledger position that announced it, for the payload-free tombstone. */
  readonly changeSeq: number;
  readonly state: RemoteEntityState;
};

const SYMPTOMS = ['nausea', 'fatigue', 'backache', 'heartburn', 'swelling', 'cramps', 'moodSwings', 'braxtonHicks', 'insomnia', 'other'];
const METHODS = ['lmp', 'conception', 'dueDate'];
const DUE_SOURCES = ['user', 'lmp', 'scan', 'clinician'];
const OUTCOMES = ['birth', 'stillbirth', 'miscarriage', 'termination', 'other', 'preferNotToSay'];

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function safeInteger(value: unknown, minimum: number): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum; }
function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$/.test(value) && Number.isFinite(Date.parse(value));
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** `null` is "absent"; anything else must pass `valid`. Never coerces. */
function optional<T>(row: Record<string, unknown>, key: string, valid: (value: unknown) => value is T): { ok: true; value: T | undefined } | { ok: false } {
  const value = row[key];
  if (value === null) return { ok: true, value: undefined };
  return valid(value) ? { ok: true, value } : { ok: false };
}
function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

const ALLOWED_KEYS: Record<PregnancyEntityType, readonly string[]> = {
  pregnancy: PREGNANCY_CANONICAL_COLUMNS.pregnancy.split(','),
  log: PREGNANCY_CANONICAL_COLUMNS.log.split(','),
  appointment: PREGNANCY_CANONICAL_COLUMNS.appointment.split(','),
  settings: PREGNANCY_CANONICAL_COLUMNS.settings.split(','),
};

/**
 * Parses one owner row. The tombstone check comes first and deliberately does not
 * validate clinical columns: a row deleted by another device between the ledger read
 * and this read is legitimate race-forward evidence whose clinical columns are
 * scrubbed. A live row is validated field by field; nothing is coerced.
 *
 * Returns null for anything neither a valid live row nor a valid tombstone.
 */
export function mapPregnancyCanonicalRow(
  entityType: PregnancyEntityType, row: unknown, accountId: string, expectedId: string,
): RemoteEntityState | null {
  if (!record(row) || !Object.keys(row).every((key) => ALLOWED_KEYS[entityType].includes(key))) return null;
  if (row.user_id !== accountId) return null;
  const identity = entityType === 'settings' ? row.user_id : row.id;
  if (identity !== expectedId || (entityType !== 'settings' && !isPregnancyUuid(identity))) return null;
  if (!safeInteger(row.revision, 1)) return null;
  if (entityType !== 'settings' && row.deleted_at !== null) {
    return isTimestamp(row.deleted_at) ? { kind: 'tombstone', revision: row.revision } : null;
  }
  if (!isTimestamp(row.updated_at)) return null;
  if (entityType === 'settings') {
    if (!safeInteger(row.recovery_display_days, 0) || typeof row.privacy_mode !== 'boolean') return null;
    return { kind: 'live', revision: row.revision, live: { entityType, entity: { recoveryDisplayDays: row.recovery_display_days, privacyMode: row.privacy_mode, revision: row.revision, updatedAt: row.updated_at } } };
  }
  if (!isTimestamp(row.created_at) && entityType === 'pregnancy') return null;
  if (entityType === 'pregnancy') {
    const lmp = optional(row, 'lmp_date', isDate), conception = optional(row, 'conception_date', isDate), due = optional(row, 'due_date_override', isDate);
    const source = optional(row, 'due_date_source', (v): v is string => typeof v === 'string' && DUE_SOURCES.includes(v));
    const ended = optional(row, 'ended_at', isDate), outcome = optional(row, 'outcome', (v): v is string => typeof v === 'string' && OUTCOMES.includes(v));
    const notes = optional(row, 'outcome_notes', (v): v is string => typeof v === 'string'), recovery = optional(row, 'recovery_ended_at', isDate);
    if (!lmp.ok || !conception.ok || !due.ok || !source.ok || !ended.ok || !outcome.ok || !notes.ok || !recovery.ok) return null;
    if (typeof row.method !== 'string' || !METHODS.includes(row.method)) return null;
    // The server's own active-shape constraint: an end date and an outcome come together.
    if ((ended.value === undefined) !== (outcome.value === undefined)) return null;
    const entity = omitUndefined({
      id: expectedId, method: row.method as PregnancyEntry['method'], lmpDate: lmp.value, conceptionDate: conception.value, dueDateOverride: due.value,
      dueDateSource: source.value as PregnancyEntry['dueDateSource'], endedAt: ended.value, outcome: outcome.value as PregnancyEntry['outcome'],
      outcomeNotes: notes.value, recoveryEndedAt: recovery.value, revision: row.revision, updatedAt: row.updated_at, createdAt: row.created_at as string,
    }) as PregnancyEntry;
    return { kind: 'live', revision: row.revision, live: { entityType, entity } };
  }
  if (!isPregnancyUuid(row.pregnancy_id)) return null;
  const notes = optional(row, 'notes', (v): v is string => typeof v === 'string');
  if (!notes.ok) return null;
  if (entityType === 'log') {
    const weight = optional(row, 'weight_kg', (v): v is number => typeof v === 'number' && Number.isFinite(v));
    const belly = optional(row, 'belly_measurement_cm', (v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!weight.ok || !belly.ok || !isDate(row.date) || !Array.isArray(row.symptoms) || !row.symptoms.every((item) => typeof item === 'string' && SYMPTOMS.includes(item))) return null;
    const entity = omitUndefined({
      id: expectedId, pregnancyId: row.pregnancy_id, date: row.date, symptoms: [...row.symptoms] as PregnancySymptomLog['symptoms'],
      weightKg: weight.value, bellyMeasurementCm: belly.value, notes: notes.value, revision: row.revision, updatedAt: row.updated_at,
    }) as PregnancySymptomLog;
    return { kind: 'live', revision: row.revision, live: { entityType, entity } };
  }
  if (!isTimestamp(row.starts_at) || !text(row.time_zone) || !text(row.title) || typeof row.completed !== 'boolean' || typeof row.reminder_enabled !== 'boolean') return null;
  const entity = omitUndefined({
    id: expectedId, pregnancyId: row.pregnancy_id, startsAt: row.starts_at, timeZone: row.time_zone, title: row.title, notes: notes.value,
    completed: row.completed, reminderEnabled: row.reminder_enabled, revision: row.revision, updatedAt: row.updated_at,
  }) as PregnancyAppointment;
  return { kind: 'live', revision: row.revision, live: { entityType: 'appointment', entity } };
}

export const pregnancyEntityKey = (entityType: PregnancyEntityType, entityId: string) => `${entityType}:${entityId}`;

/**
 * Joins one ledger page with the owner rows read for it. Every entity the page
 * announced must be explained by a valid live row or a valid tombstone at (or beyond)
 * the announced revision; otherwise the whole page is unexplained and the caller must
 * fail closed without moving the cursor. A live row that the ledger says was deleted
 * is impossible; a tombstone where the ledger says "live" is the legitimate race.
 */
export function buildPregnancyRemoteSnapshots(
  changes: readonly PregnancyChange[], states: ReadonlyMap<string, RemoteEntityState>,
): RemoteEntitySnapshot[] | null {
  const order: string[] = [];
  const latest = new Map<string, { type: PregnancyEntityType; id: string; revision: number; seq: number; deleted: boolean }>();
  for (const change of changes) {
    const key = pregnancyEntityKey(change.entityType, change.entityId);
    const current = latest.get(key);
    if (!current) order.push(key);
    latest.set(key, {
      type: change.entityType, id: change.entityId, revision: Math.max(current?.revision ?? 0, change.revision),
      seq: change.changeSeq, deleted: change.deleted,
    });
  }
  const snapshots: RemoteEntitySnapshot[] = [];
  for (const key of order) {
    const meta = latest.get(key)!;
    const state = states.get(key);
    if (!state || state.revision < meta.revision) return null;
    if (state.kind === 'live' && meta.deleted) return null;
    snapshots.push({ entityType: meta.type, entityId: meta.id, metadataRevision: meta.revision, changeSeq: meta.seq, state });
  }
  return snapshots;
}
