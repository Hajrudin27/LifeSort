import {
  MAX_IDEA_LENGTH,
  MAX_OCCASION_LABEL_LENGTH,
  MAX_PERSON_LABEL_LENGTH,
  hasForbiddenTextCharacter,
} from '@/core/gifts/persistedGift';
import type { MinorUnits } from '@/core/money/minorUnits';
import { parseSupportedMoneyInput } from '@/core/money/supportedMoney';
import type { Gift } from '@/types/gift';
import { parseCalendarDate } from '@/utils/shared/localDate';

/**
 * APP-069 — the Gift planner rules, as pure functions.
 *
 * The persisted FORMAT (limits, key set, decoders) lives in core/gifts and is shared with the
 * backup parser. This file is what a user may DO with a gift: validate form input, create one,
 * edit one, mark it purchased or not, order a list.
 *
 * Nothing here reads the clock, the store or the network: "today", the new id and the creation
 * instant are parameters, so every rule is deterministic and testable.
 *
 * A gift is a plan the user typed. Nothing here suggests, ranks, prices, reminds or links: there is
 * no urgency (a past occasion date is just a date), no recommendation, and no reach into Economy.
 * "Purchased" is not a status; it is the presence of `purchasedOn`.
 */
export { MAX_IDEA_LENGTH, MAX_OCCASION_LABEL_LENGTH, MAX_PERSON_LABEL_LENGTH };

export type GiftField = 'personLabel' | 'idea' | 'occasionLabel' | 'occasionDate' | 'budget' | 'purchasedOn' | 'paid';

/** Fixed codes, so a message is chosen by the UI and no user text ever travels in an error. */
export type GiftErrorCode =
  | 'required'
  | 'tooLong'
  | 'invalidCharacters'
  | 'invalid'
  | 'future'
  | 'invalidAmount'
  | 'negative'
  | 'purchaseRequired';

export type GiftErrors = Partial<Record<GiftField, GiftErrorCode>>;

/**
 * What a form hands over. Everything is untrusted text until validated. An empty optional field
 * means "absent". `purchased` is the switch; `purchasedOn` and `paid` only mean something when it
 * is on, and a `paid` amount handed over without it is refused rather than silently dropped.
 */
export interface GiftInput {
  personLabel: string;
  idea: string;
  occasionLabel?: string;
  occasionDate?: string;
  budget?: string;
  purchased: boolean;
  purchasedOn?: string;
  paid?: string;
}

/** The validated, canonical editable fields. Optional ones are absent, never empty. */
export interface GiftDraft {
  personLabel: string;
  idea: string;
  occasionLabel?: string;
  occasionDate?: string;
  budget?: MinorUnits;
  purchasedOn?: string;
  paid?: MinorUnits;
}

export type GiftValidation = { ok: true; value: GiftDraft } | { ok: false; errors: GiftErrors };

export interface ValidateOptions {
  /** Today's local calendar date, YYYY-MM-DD. */
  today: string;
  /**
   * The gift being edited. Its own stored purchase date is accepted even when it lies in the future
   * (a device whose clock changed), so editing an idea never fails on a date the user did not
   * touch. A different future date is still refused.
   */
  existing?: Pick<Gift, 'purchasedOn'>;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: GiftErrorCode };

function singleLine(raw: unknown, max: number): Parsed<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid' };
  const value = raw.trim();
  if (value.length === 0) return { ok: false, error: 'required' };
  if (hasForbiddenTextCharacter(value)) return { ok: false, error: 'invalidCharacters' };
  if (value.length > max) return { ok: false, error: 'tooLong' };
  return { ok: true, value };
}

/** `undefined` or blank text is absent, not an error. */
function optionalSingleLine(raw: unknown, max: number): Parsed<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'string') return { ok: false, error: 'invalid' };
  if (raw.trim().length === 0) return { ok: true, value: undefined };
  return singleLine(raw, max);
}

function optionalAmount(raw: unknown): Parsed<MinorUnits | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'string') return { ok: false, error: 'invalid' };
  const text = raw.trim();
  if (text.length === 0) return { ok: true, value: undefined };
  // A minus sign is refused as such, so "-0" is never quietly read as zero.
  if (text.startsWith('-')) return { ok: false, error: 'negative' };
  const parsed = parseSupportedMoneyInput(text);
  return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, error: 'invalidAmount' };
}

/** Pure validation of user input into the canonical editable fields. Reports every failing field. */
export function validateGiftInput(input: GiftInput, options: ValidateOptions): GiftValidation {
  const errors: GiftErrors = {};

  const personLabel = singleLine(input.personLabel, MAX_PERSON_LABEL_LENGTH);
  if (!personLabel.ok) errors.personLabel = personLabel.error;
  const idea = singleLine(input.idea, MAX_IDEA_LENGTH);
  if (!idea.ok) errors.idea = idea.error;
  const occasionLabel = optionalSingleLine(input.occasionLabel, MAX_OCCASION_LABEL_LENGTH);
  if (!occasionLabel.ok) errors.occasionLabel = occasionLabel.error;

  // Any valid calendar date, past or future: it is only the date the plan is about.
  let occasionDate: string | undefined;
  if (input.occasionDate !== undefined && input.occasionDate !== '') {
    if (parseCalendarDate(input.occasionDate) === null) errors.occasionDate = 'invalid';
    else occasionDate = input.occasionDate;
  }

  const budget = optionalAmount(input.budget);
  if (!budget.ok) errors.budget = budget.error;

  let purchasedOn: string | undefined;
  let paid: MinorUnits | undefined;
  if (input.purchased) {
    if (input.purchasedOn === undefined || input.purchasedOn === '') {
      errors.purchasedOn = 'required';
    } else if (parseCalendarDate(input.purchasedOn) === null) {
      errors.purchasedOn = 'invalid';
    } else if (input.purchasedOn > options.today && input.purchasedOn !== options.existing?.purchasedOn) {
      errors.purchasedOn = 'future';
    } else {
      purchasedOn = input.purchasedOn;
    }
    const parsedPaid = optionalAmount(input.paid);
    if (!parsedPaid.ok) errors.paid = parsedPaid.error;
    else paid = parsedPaid.value;
  } else if (typeof input.paid === 'string' && input.paid.trim().length > 0) {
    // "Paid" is what was paid for something that was purchased.
    errors.paid = 'purchaseRequired';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: buildDraft({
      personLabel: (personLabel as { value: string }).value,
      idea: (idea as { value: string }).value,
      occasionLabel: (occasionLabel as { value: string | undefined }).value,
      occasionDate,
      budget: (budget as { value: MinorUnits | undefined }).value,
      purchasedOn,
      paid,
    }),
  };
}

/** The canonical key order, with every absent optional key omitted. */
function buildDraft(fields: {
  personLabel: string;
  idea: string;
  occasionLabel?: string;
  occasionDate?: string;
  budget?: MinorUnits;
  purchasedOn?: string;
  paid?: MinorUnits;
}): GiftDraft {
  return {
    personLabel: fields.personLabel,
    idea: fields.idea,
    ...(fields.occasionLabel !== undefined ? { occasionLabel: fields.occasionLabel } : {}),
    ...(fields.occasionDate !== undefined ? { occasionDate: fields.occasionDate } : {}),
    ...(fields.budget !== undefined ? { budget: fields.budget } : {}),
    ...(fields.purchasedOn !== undefined ? { purchasedOn: fields.purchasedOn } : {}),
    ...(fields.paid !== undefined ? { paid: fields.paid } : {}),
  };
}

function buildGift(id: string, createdAt: string, draft: GiftDraft): Gift {
  return {
    id,
    personLabel: draft.personLabel,
    idea: draft.idea,
    ...(draft.occasionLabel !== undefined ? { occasionLabel: draft.occasionLabel } : {}),
    ...(draft.occasionDate !== undefined ? { occasionDate: draft.occasionDate } : {}),
    ...(draft.budget !== undefined ? { budget: draft.budget } : {}),
    ...(draft.purchasedOn !== undefined ? { purchasedOn: draft.purchasedOn } : {}),
    // The purchase invariant, kept here as well as in the decoder: no paid amount without a purchase.
    ...(draft.paid !== undefined && draft.purchasedOn !== undefined ? { paid: draft.paid } : {}),
    createdAt,
  };
}

/** A new gift. The id and the creation instant are chosen by the caller, once. */
export function createGift(draft: GiftDraft, meta: { id: string; createdAt: string }): Gift {
  return buildGift(meta.id, meta.createdAt, draft);
}

/**
 * An edited gift. `id` and `createdAt` are carried over from the original and cannot be changed by
 * an edit; optional fields the draft omits are removed. That is also how a gift is un-purchased:
 * a draft without `purchasedOn` has no `paid` either.
 */
export function applyGiftEdit(original: Gift, draft: GiftDraft): Gift {
  return buildGift(original.id, original.createdAt, draft);
}

/** Purchased is derived, never stored as a status. */
export const isPurchased = (gift: Pick<Gift, 'purchasedOn'>): boolean => gift.purchasedOn !== undefined;

/** The editable fields of a gift, as a draft (for the same-fields comparison and the edit form). */
export function draftOf(gift: Gift): GiftDraft {
  return buildDraft(gift);
}

/** The same gift marked purchased on `purchasedOn`, with an optional paid amount. */
export function markPurchased(gift: Gift, purchase: { purchasedOn: string; paid?: MinorUnits }): Gift {
  return applyGiftEdit(gift, { ...draftOf(gift), purchasedOn: purchase.purchasedOn, paid: purchase.paid });
}

/** The same gift, not purchased: the purchase date and the paid amount are removed together. */
export function unmarkPurchased(gift: Gift): Gift {
  return applyGiftEdit(gift, buildDraft({ ...draftOf(gift), purchasedOn: undefined, paid: undefined }));
}

const compareText = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);
const compareInstantDescending = (a: string, b: string) => {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return left === right ? 0 : left < right ? 1 : -1;
};

type Plannable = Pick<Gift, 'id' | 'createdAt' | 'occasionDate'>;
type Purchasable = Pick<Gift, 'id' | 'createdAt' | 'purchasedOn'>;

/**
 * Planned order: occasion date ascending, undated gifts after dated ones, then creation instant
 * newest first, then id ascending. Total and deterministic, independent of input order. It never
 * consults "today": a past occasion simply stays where its date puts it. Returns a copy.
 */
export function sortPlanned<T extends Plannable>(gifts: readonly T[]): T[] {
  return [...gifts].sort((a, b) => {
    if (a.occasionDate !== b.occasionDate) {
      if (a.occasionDate === undefined) return 1;
      if (b.occasionDate === undefined) return -1;
      return compareText(a.occasionDate, b.occasionDate);
    }
    return compareInstantDescending(a.createdAt, b.createdAt) || compareText(a.id, b.id);
  });
}

/** Purchased order: purchase date newest first, then creation instant newest first, then id ascending. */
export function sortPurchased<T extends Purchasable>(gifts: readonly T[]): T[] {
  return [...gifts].sort((a, b) => {
    if (a.purchasedOn !== b.purchasedOn) {
      if (a.purchasedOn === undefined) return 1;
      if (b.purchasedOn === undefined) return -1;
      return compareText(b.purchasedOn, a.purchasedOn);
    }
    return compareInstantDescending(a.createdAt, b.createdAt) || compareText(a.id, b.id);
  });
}

/** The two list sections. A purchased gift stays visible; nothing is hidden or archived. */
export function partitionGifts(gifts: readonly Gift[]): { planned: Gift[]; purchased: Gift[] } {
  return {
    planned: sortPlanned(gifts.filter((gift) => !isPurchased(gift))),
    purchased: sortPurchased(gifts.filter(isPurchased)),
  };
}
