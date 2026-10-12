import type { ApplicationStatus, JobApplication } from '@/types/career';
import { parseCalendarDate } from '@/utils/shared/localDate';

/**
 * APP-067 — the persisted job-application FORMAT, and nothing else.
 *
 * What a stored application looks like (the unchanged eight-key shape, the closed four-value
 * status set, the length and character limits, a strict calendar date, an http(s)-only link) and
 * how a list of them is decoded. The local store and the backup parser — the latter is core —
 * must validate exactly what the store persists, so this is the documented C2 exception for a
 * persisted-format contract (like core/habits/persistedHabit, core/goals/persistedGoal;
 * docs/core-contract.md).
 *
 * Deliberately NOT here: input parsing for forms, "today", creating or editing an application,
 * ordering, counts and display. Those are the Career module's rules and live in
 * features/career/domain, which imports from here: the dependency points inward.
 *
 * Nothing in this file reads the clock. Whether a stored date is in the future is a question
 * about "today", and a decoder that answered it would reject the same bytes tomorrow that it
 * accepted today (or the reverse after a timezone change). A future-dated application is
 * preserved; only USER INPUT is refused a future date (features/career/domain).
 *
 * Status is always user-declared. Nothing here, or anywhere in APP-067, infers a status, a
 * score or a verdict about an employer.
 */
export const APPLICATION_STATUSES: readonly ApplicationStatus[] = Object.freeze([
  'applied',
  'interview',
  'offer',
  'rejected',
]);

export const MAX_COMPANY_LENGTH = 200;
export const MAX_POSITION_LENGTH = 200;
export const MAX_LINK_LENGTH = 2048;
export const MAX_NOTES_LENGTH = 10_000;

export const isApplicationStatus = (value: unknown): value is ApplicationStatus =>
  typeof value === 'string' && (APPLICATION_STATUSES as readonly string[]).includes(value);

/** C0 controls, DEL and C1 controls. Includes NUL, tab and line breaks. */
// eslint-disable-next-line no-control-regex
const ANY_CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
/** The same, except tab, line feed and carriage return, which plain multiline notes may hold. */
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_WHITESPACE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

/** A single-line text field may contain no control character at all. */
export const hasControlCharacter = (value: string): boolean => ANY_CONTROL.test(value);
/** Notes are plain multiline text: line breaks and tabs are text, everything else is not. */
export const hasForbiddenNoteCharacter = (value: string): boolean => CONTROL_EXCEPT_WHITESPACE.test(value);

/**
 * Exactly http:// or https:// followed by a non-empty host, no whitespace anywhere. Case
 * insensitive on the scheme only. `javascript:`, `file:`, `data:`, `intent:` and every custom
 * scheme fail here, and so does a bare `https://`.
 */
const HTTP_URL = /^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i;

export const isHttpUrl = (value: string): boolean => value.length <= MAX_LINK_LENGTH && HTTP_URL.test(value);

const KEYS = ['id', 'company', 'position', 'status', 'appliedDate', 'link', 'notes', 'createdAt'] as const;
const REQUIRED = ['id', 'company', 'position', 'status', 'appliedDate', 'createdAt'] as const;

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasKey = (value: Json, key: string) => Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined;
const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/**
 * Both modes read HISTORY, so both are compatibility-aware: they check that a record is a
 * recognisable application (the canonical structure) and nothing else.
 *
 * `stored`  — what this device already holds. Required identity fields, a non-blank company and
 *             role, the closed status set, a strict calendar date, a valid creation instant, string
 *             link and notes. Unknown keys are dropped.
 * `backup`  — a file written by an app version BEFORE APP-067 (formats 1-12; format 13 carries no
 *             applications at all). The same checks, plus no unknown keys.
 *
 * Neither mode applies the limits introduced by APP-067 (200/200/2048/10,000 characters, control
 * characters, an http(s)-only link). The earlier form enforced none of them, so a long note, a
 * link typed without `https://` or even `javascript:` is a value the old product legitimately
 * created. It is preserved exactly, never normalised (no scheme is prepended), and an unsafe link
 * stays inert text that is never opened (`openableLink`). Those limits bind NEW input only
 * (features/career/domain), so editing such a row asks the user to correct the value first.
 */
export type ApplicationDecodeMode = 'stored' | 'backup';

/** Decode one application into a fresh object, or null. */
export function decodeApplication(value: unknown, mode: ApplicationDecodeMode): JobApplication | null {
  if (!record(value) || !REQUIRED.every((key) => hasKey(value, key))) return null;
  if (mode === 'backup' && !Object.keys(value).every((key) => (KEYS as readonly string[]).includes(key))) return null;

  if (!nonBlank(value.id) || !nonBlank(value.company) || !nonBlank(value.position)) return null;
  if (!isApplicationStatus(value.status)) return null;
  if (parseCalendarDate(value.appliedDate) === null || !instant(value.createdAt)) return null;

  const link = value.link;
  const notes = value.notes;
  if (hasKey(value, 'link') && typeof link !== 'string') return null;
  if (hasKey(value, 'notes') && typeof notes !== 'string') return null;

  const decoded: JobApplication = {
    id: value.id,
    company: value.company,
    position: value.position,
    status: value.status,
    appliedDate: value.appliedDate as string,
    createdAt: value.createdAt as string,
  };
  // An empty string was never written by the old form (`|| undefined`), and means "absent".
  if (typeof link === 'string' && link.length > 0) decoded.link = link;
  if (typeof notes === 'string' && notes.length > 0) decoded.notes = notes;
  return decoded;
}

/**
 * Hydrating this device's own state. Rows that are not a recognisable application are left
 * out of memory (never rendered), a repeated id keeps its first row. Never throws.
 */
export function decodeStoredApplications(value: unknown): JobApplication[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: JobApplication[] = [];
  for (const entry of value) {
    const application = decodeApplication(entry, 'stored');
    if (!application || seen.has(application.id)) continue;
    seen.add(application.id);
    out.push(application);
  }
  return out;
}

/**
 * A pre-APP-067 backup file: all-or-nothing. One unrecognisable row (structure, status, date,
 * field type, unknown key) or a repeated id rejects the list. A row that merely predates the
 * APP-067 limits is not unrecognisable. Nothing about a rejected row is logged or returned.
 */
export function decodeBackupApplications(value: unknown): JobApplication[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const out: JobApplication[] = [];
  for (const entry of value) {
    const application = decodeApplication(entry, 'backup');
    if (!application || seen.has(application.id)) return null;
    seen.add(application.id);
    out.push(application);
  }
  return out;
}
