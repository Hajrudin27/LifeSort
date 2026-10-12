import { isSupportedMoney } from '@/core/money/supportedMoney';
import { minorUnits } from '@/core/money/minorUnits';
import type { Gift } from '@/types/gift';
import { parseCalendarDate } from '@/utils/shared/localDate';

/**
 * APP-069 — the persisted gift FORMAT, and nothing else.
 *
 * What a stored gift looks like (the exact nine-key shape, the text limits, strict calendar dates,
 * supported non-negative DKK minor units, the purchase invariant) and how a list of them is
 * decoded. The local store and the backup parser — the latter is core — must validate exactly what
 * the store persists, so this is the documented C2 exception for a persisted-format contract (like
 * core/career/persistedApplication; docs/core-contract.md).
 *
 * Gifts are a greenfield domain: no earlier release ever wrote one, so there is ONE decoder and no
 * compatibility mode. Stored bytes and a backup file are held to the same rules.
 *
 * Deliberately NOT here: parsing form input, "today", creating or editing, ordering, display. Those
 * are the Gifts module's rules and live in features/gifts/domain, which imports from here: the
 * dependency points inward.
 *
 * Nothing in this file reads the clock. Whether a stored purchase date is in the future is a
 * question about "today", and a decoder that answered it would reject the same bytes tomorrow that
 * it accepted today. A future `purchasedOn` is preserved; only USER INPUT is refused one
 * (features/gifts/domain).
 */
export const MAX_PERSON_LABEL_LENGTH = 100;
export const MAX_IDEA_LENGTH = 200;
export const MAX_OCCASION_LABEL_LENGTH = 100;

/**
 * Single-line text: no C0 control, DEL or C1 control (tab, line feed, carriage return and NUL
 * included), and neither Unicode line nor paragraph separator.
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_IN_SINGLE_LINE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

export const hasForbiddenTextCharacter = (value: string): boolean => FORBIDDEN_IN_SINGLE_LINE.test(value);

/** Canonical stored text: trimmed, 1..max UTF-16 units, one line. */
const isCanonicalText = (value: unknown, max: number): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= max
  && value.trim() === value
  && !hasForbiddenTextCharacter(value);

/**
 * The instant `Date.prototype.toISOString` writes: `YYYY-MM-DDTHH:mm:ss.sssZ`. Checked as text so
 * that no Date object (and so no clock) is involved; sorting then compares identical shapes.
 */
const INSTANT = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)\.\d{3}Z$/;
export const isGiftInstant = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const match = INSTANT.exec(value);
  return match !== null && parseCalendarDate(match[1]) !== null;
};

const KEYS = ['id', 'personLabel', 'idea', 'occasionLabel', 'occasionDate', 'budget', 'purchasedOn', 'paid', 'createdAt'] as const;
const REQUIRED = ['id', 'personLabel', 'idea', 'createdAt'] as const;

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
/** `undefined` is absent. `null` and `''` are NOT absent: they are values the format never writes. */
const present = (value: Json, key: string) => Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined;
const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** A stored amount: supported DKK minor units, zero allowed, never negative. */
export const isGiftAmount = (value: unknown): value is number =>
  isSupportedMoney(value) && value >= 0;

/**
 * Decode one gift into a fresh object in the canonical key order, or null.
 *
 * Exact known keys; required text present and canonical; optional keys omitted when absent;
 * dates strict; amounts supported and non-negative; `paid` only together with `purchasedOn`.
 */
export function decodeGift(value: unknown): Gift | null {
  if (!record(value)) return null;
  if (!Object.keys(value).every((key) => (KEYS as readonly string[]).includes(key))) return null;
  if (!REQUIRED.every((key) => present(value, key))) return null;

  if (!nonBlank(value.id)) return null;
  if (!isCanonicalText(value.personLabel, MAX_PERSON_LABEL_LENGTH)) return null;
  if (!isCanonicalText(value.idea, MAX_IDEA_LENGTH)) return null;
  if (!isGiftInstant(value.createdAt)) return null;

  if (present(value, 'occasionLabel') && !isCanonicalText(value.occasionLabel, MAX_OCCASION_LABEL_LENGTH)) return null;
  if (present(value, 'occasionDate') && parseCalendarDate(value.occasionDate) === null) return null;
  if (present(value, 'budget') && !isGiftAmount(value.budget)) return null;
  if (present(value, 'purchasedOn') && parseCalendarDate(value.purchasedOn) === null) return null;
  if (present(value, 'paid')) {
    if (!isGiftAmount(value.paid)) return null;
    if (!present(value, 'purchasedOn')) return null;
  }

  // A fresh object in the canonical key order, so an exported file is stable and byte-comparable.
  return {
    id: value.id,
    personLabel: value.personLabel,
    idea: value.idea,
    ...(present(value, 'occasionLabel') ? { occasionLabel: value.occasionLabel as string } : {}),
    ...(present(value, 'occasionDate') ? { occasionDate: value.occasionDate as string } : {}),
    ...(present(value, 'budget') ? { budget: minorUnits(value.budget as number) } : {}),
    ...(present(value, 'purchasedOn') ? { purchasedOn: value.purchasedOn as string } : {}),
    ...(present(value, 'paid') ? { paid: minorUnits(value.paid as number) } : {}),
    createdAt: value.createdAt,
  };
}

/**
 * Hydrating this device's own state. A row that is not a recognisable gift is left out of memory
 * (never rendered); a repeated id keeps its first row. Never throws.
 */
export function decodeStoredGifts(value: unknown): Gift[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Gift[] = [];
  for (const entry of value) {
    const gift = decodeGift(entry);
    if (!gift || seen.has(gift.id)) continue;
    seen.add(gift.id);
    out.push(gift);
  }
  return out;
}

/**
 * A backup file: all-or-nothing. One unrecognisable row (structure, unknown key, text, date, money,
 * the purchase invariant) or a repeated id rejects the whole list. Nothing about a rejected row is
 * logged or returned.
 */
export function decodeBackupGifts(value: unknown): Gift[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const out: Gift[] = [];
  for (const entry of value) {
    const gift = decodeGift(entry);
    if (!gift || seen.has(gift.id)) return null;
    seen.add(gift.id);
    out.push(gift);
  }
  return out;
}
