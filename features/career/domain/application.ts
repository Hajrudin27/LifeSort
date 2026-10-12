import {
  APPLICATION_STATUSES,
  MAX_COMPANY_LENGTH,
  MAX_LINK_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_POSITION_LENGTH,
  hasControlCharacter,
  hasForbiddenNoteCharacter,
  isApplicationStatus,
  isHttpUrl,
} from '@/core/career/persistedApplication';
import type { ApplicationStatus, JobApplication } from '@/types/career';
import { parseCalendarDate } from '@/utils/shared/localDate';

/**
 * APP-067 — the Career application rules, as pure functions.
 *
 * The persisted FORMAT (status set, limits, link scheme) lives in core/career and is shared with
 * the backup parser. This file is what a user may DO with an application: validate form input,
 * create one, edit one, order a list, decide whether a stored link may be opened.
 *
 * Nothing here reads the clock, the store or the network: "today", the new id and the creation
 * instant are parameters, so every rule is deterministic and testable.
 *
 * Nothing here infers anything. A status changes only when the user picks it; company and role
 * are opaque text; notes are opaque private text. There is no score, rank, probability or
 * recommendation about an employer or an opportunity, and none may be added without an ADR.
 */
export { APPLICATION_STATUSES, MAX_COMPANY_LENGTH, MAX_LINK_LENGTH, MAX_NOTES_LENGTH, MAX_POSITION_LENGTH };

export type ApplicationField = 'company' | 'position' | 'status' | 'appliedDate' | 'link' | 'notes';

/** Fixed codes, so a message is chosen by the UI and no user text ever travels in an error. */
export type ApplicationErrorCode = 'required' | 'tooLong' | 'invalidCharacters' | 'invalid' | 'future' | 'invalidLink';

export type ApplicationErrors = Partial<Record<ApplicationField, ApplicationErrorCode>>;

/** What a form hands over. Everything is untrusted text until validated. */
export interface ApplicationInput {
  company: string;
  position: string;
  status: unknown;
  appliedDate: string;
  link?: string;
  notes?: string;
}

/** The validated, canonical editable fields. Optional ones are absent, never empty. */
export interface ApplicationDraft {
  company: string;
  position: string;
  status: ApplicationStatus;
  appliedDate: string;
  link?: string;
  notes?: string;
}

export type ApplicationValidation =
  | { ok: true; value: ApplicationDraft }
  | { ok: false; errors: ApplicationErrors };

export interface ValidateOptions {
  /** Today's local calendar date, YYYY-MM-DD. */
  today: string;
  /**
   * The application being edited. Its own stored date is accepted even when it lies in the
   * future (legacy data, or a device whose clock changed), so editing a note never fails on a
   * date the user did not touch. A different future date is still refused.
   */
  existing?: Pick<JobApplication, 'appliedDate'>;
}

function requiredText(raw: unknown, max: number): { ok: true; value: string } | { ok: false; error: ApplicationErrorCode } {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid' };
  const value = raw.trim();
  if (value.length === 0) return { ok: false, error: 'required' };
  if (hasControlCharacter(value)) return { ok: false, error: 'invalidCharacters' };
  if (value.length > max) return { ok: false, error: 'tooLong' };
  return { ok: true, value };
}

/** Pure validation of user input into the canonical editable fields. Reports every failing field. */
export function validateApplicationInput(input: ApplicationInput, options: ValidateOptions): ApplicationValidation {
  const errors: ApplicationErrors = {};

  const company = requiredText(input.company, MAX_COMPANY_LENGTH);
  if (!company.ok) errors.company = company.error;
  const position = requiredText(input.position, MAX_POSITION_LENGTH);
  if (!position.ok) errors.position = position.error;

  if (!isApplicationStatus(input.status)) errors.status = 'invalid';

  if (parseCalendarDate(input.appliedDate) === null) {
    errors.appliedDate = 'invalid';
  } else if (input.appliedDate > options.today && input.appliedDate !== options.existing?.appliedDate) {
    errors.appliedDate = 'future';
  }

  let link: string | undefined;
  if (input.link !== undefined) {
    if (typeof input.link !== 'string') {
      errors.link = 'invalid';
    } else {
      const trimmed = input.link.trim();
      if (trimmed.length > MAX_LINK_LENGTH) errors.link = 'tooLong';
      else if (trimmed.length > 0) {
        if (isHttpUrl(trimmed)) link = trimmed;
        else errors.link = 'invalidLink';
      }
    }
  }

  let notes: string | undefined;
  if (input.notes !== undefined) {
    if (typeof input.notes !== 'string') {
      errors.notes = 'invalid';
    } else {
      const trimmed = input.notes.trim();
      if (hasForbiddenNoteCharacter(trimmed)) errors.notes = 'invalidCharacters';
      else if (trimmed.length > MAX_NOTES_LENGTH) errors.notes = 'tooLong';
      else if (trimmed.length > 0) notes = trimmed;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const value: ApplicationDraft = {
    company: (company as { value: string }).value,
    position: (position as { value: string }).value,
    status: input.status as ApplicationStatus,
    appliedDate: input.appliedDate,
  };
  if (link !== undefined) value.link = link;
  if (notes !== undefined) value.notes = notes;
  return { ok: true, value };
}

/** A new application. The id and the creation instant are chosen by the caller, once. */
export function createApplication(draft: ApplicationDraft, meta: { id: string; createdAt: string }): JobApplication {
  return { id: meta.id, createdAt: meta.createdAt, ...draft };
}

/**
 * An edited application. `id` and `createdAt` are carried over from the original and cannot be
 * changed by an edit; optional fields the draft omits are removed. Any status may become any
 * other status — only an explicit user choice changes it.
 */
export function applyApplicationEdit(original: JobApplication, draft: ApplicationDraft): JobApplication {
  return { id: original.id, createdAt: original.createdAt, ...draft };
}

/**
 * The single list order: applied date newest first, then creation instant newest first, then id
 * ascending. Total and deterministic; it ranks nothing about the opportunity. Returns a copy.
 */
export function sortApplications<T extends Pick<JobApplication, 'appliedDate' | 'createdAt' | 'id'>>(applications: readonly T[]): T[] {
  return [...applications].sort((a, b) => {
    if (a.appliedDate !== b.appliedDate) return a.appliedDate < b.appliedDate ? 1 : -1;
    const createdA = Date.parse(a.createdAt);
    const createdB = Date.parse(b.createdAt);
    if (createdA !== createdB) return createdA < createdB ? 1 : -1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
}

/**
 * The link to hand to the operating system, or null. Only a canonical http(s) URL qualifies;
 * anything else a legacy row may hold is shown as text and never opened.
 */
export function openableLink(link: string | undefined): string | null {
  if (typeof link !== 'string') return null;
  const trimmed = link.trim();
  return isHttpUrl(trimmed) ? trimmed : null;
}

/**
 * Applications the user has not marked rejected. A count of the user's own declared statuses —
 * not a measure of opportunity.
 */
export function openApplicationCount(applications: readonly Pick<JobApplication, 'status'>[]): number {
  return applications.filter((application) => application.status !== 'rejected').length;
}

/** Applications the user has marked as interview. */
export function interviewApplicationCount(applications: readonly Pick<JobApplication, 'status'>[]): number {
  return applications.filter((application) => application.status === 'interview').length;
}
