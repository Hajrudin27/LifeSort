import {
  decodeBackupGifts,
  decodeGift,
  decodeStoredGifts,
} from '@/core/gifts/persistedGift';
import { minorUnits } from '@/core/money/minorUnits';
import {
  applyGiftEdit,
  createGift,
  draftOf,
  isPurchased,
  markPurchased,
  partitionGifts,
  sortPlanned,
  sortPurchased,
  unmarkPurchased,
  validateGiftInput,
  type GiftInput,
} from '@/features/gifts/domain/gift';
import type { Gift } from '@/types/gift';

/**
 * APP-069 — the Gift rules, exactly. Every boundary is tested on both sides, and every decision the
 * domain makes is made without the clock, the store or the network.
 */
const TODAY = '2026-10-12';
const m = (value: number) => minorUnits(value);
const base: GiftInput = { personLabel: 'Anna', idea: 'A book about birds', purchased: false };
const ok = (patch: Partial<GiftInput> = {}, options: { existing?: Pick<Gift, 'purchasedOn'> } = {}) =>
  validateGiftInput({ ...base, ...patch }, { today: TODAY, ...options });
const draftOfValid = (patch: Partial<GiftInput> = {}) => {
  const result = ok(patch);
  if (!result.ok) throw new Error(`expected valid: ${JSON.stringify(result.errors)}`);
  return result.value;
};
const errorsOf = (patch: Partial<GiftInput>, options: { existing?: Pick<Gift, 'purchasedOn'> } = {}) => {
  const result = ok(patch, options);
  if (result.ok) throw new Error('expected invalid');
  return result.errors;
};
const gift = (id: string, patch: Partial<Gift> = {}): Gift => ({
  id, personLabel: `Person ${id}`, idea: `Idea ${id}`, createdAt: '2026-09-01T08:00:00.000Z', ...patch,
});

describe('create', () => {
  it('builds a gift from a valid draft with the id and instant it was given, and never generates either', () => {
    const created = createGift(draftOfValid(), { id: 'fixed-id', createdAt: '2026-10-12T09:30:00.000Z' });
    expect(created).toEqual({ id: 'fixed-id', personLabel: 'Anna', idea: 'A book about birds', createdAt: '2026-10-12T09:30:00.000Z' });
  });

  it('omits every absent optional key: never null, never an empty string', () => {
    const created = createGift(draftOfValid({ occasionLabel: '   ', occasionDate: '', budget: '  ' }), { id: 'x', createdAt: '2026-10-12T09:30:00.000Z' });
    expect(Object.keys(created)).toEqual(['id', 'personLabel', 'idea', 'createdAt']);
    expect(JSON.stringify(created)).not.toMatch(/null|""/);
  });

  it('writes the keys in one canonical order whatever order the draft was built in', () => {
    const created = createGift(
      draftOfValid({ occasionLabel: 'Birthday', occasionDate: '2026-12-01', budget: '300', purchased: true, purchasedOn: '2026-10-01', paid: '280' }),
      { id: 'x', createdAt: '2026-10-12T09:30:00.000Z' },
    );
    expect(Object.keys(created)).toEqual(['id', 'personLabel', 'idea', 'occasionLabel', 'occasionDate', 'budget', 'purchasedOn', 'paid', 'createdAt']);
  });
});

describe('person label, idea and occasion label', () => {
  it('requires a person and an idea, and trims both', () => {
    expect(errorsOf({ personLabel: '', idea: '' })).toEqual({ personLabel: 'required', idea: 'required' });
    expect(errorsOf({ personLabel: '   ', idea: '  ' })).toEqual({ personLabel: 'required', idea: 'required' });
    const draft = draftOfValid({ personLabel: '  Anna  ', idea: '\t A book  ', occasionLabel: '  Jul  ' });
    expect(draft).toMatchObject({ personLabel: 'Anna', idea: 'A book', occasionLabel: 'Jul' });
  });

  it.each([
    ['personLabel', 100],
    ['idea', 200],
    ['occasionLabel', 100],
  ] as const)('%s: exactly %i UTF-16 units is accepted and one more is refused', (field, max) => {
    expect(ok({ [field]: 'x'.repeat(max) }).ok).toBe(true);
    expect(errorsOf({ [field]: 'x'.repeat(max + 1) })).toEqual({ [field]: 'tooLong' });
    // The limit counts after trimming: padding never uses it up.
    expect(ok({ [field]: ` ${'x'.repeat(max)} ` }).ok).toBe(true);
  });

  it('counts UTF-16 units, so an emoji outside the BMP is two', () => {
    expect(ok({ personLabel: '🎁'.repeat(50) }).ok).toBe(true);
    expect(errorsOf({ personLabel: '🎁'.repeat(51) })).toEqual({ personLabel: 'tooLong' });
  });

  it.each(['a\nb', 'a\r\nb', 'a\tb', 'a\u0000b', 'a\u001Fb', 'a\u007Fb', 'a\u0085b', 'a\u009Fb', 'a b', 'a b'])(
    'refuses a control character or line break inside a single-line field (%j)',
    (text) => {
      expect(errorsOf({ personLabel: text, idea: text, occasionLabel: text })).toEqual({
        personLabel: 'invalidCharacters', idea: 'invalidCharacters', occasionLabel: 'invalidCharacters',
      });
    },
  );

  it('allows any Unicode text, keeps its case and does not normalise it', () => {
    const draft = draftOfValid({ personLabel: 'Søren Ærø-Ålborg 🎁', idea: 'Ｆｕｌｌｗｉｄｔｈ ÅÆØ', occasionLabel: 'JUBILÆUM' });
    expect(draft).toMatchObject({ personLabel: 'Søren Ærø-Ålborg 🎁', idea: 'Ｆｕｌｌｗｉｄｔｈ ÅÆØ', occasionLabel: 'JUBILÆUM' });
  });

  it('allows the same person and the same occasion on many gifts', () => {
    const a = createGift(draftOfValid({ personLabel: 'Anna', occasionLabel: 'Birthday' }), { id: 'a', createdAt: '2026-10-12T09:30:00.000Z' });
    const b = createGift(draftOfValid({ personLabel: 'Anna', occasionLabel: 'Birthday' }), { id: 'b', createdAt: '2026-10-12T09:31:00.000Z' });
    expect(decodeBackupGifts([a, b])).toHaveLength(2);
    expect(decodeStoredGifts([a, b])).toHaveLength(2);
  });

  it('rejects a value that is not text, with a fixed code and without echoing it', () => {
    const result = validateGiftInput({ ...base, personLabel: 42 as never }, { today: TODAY });
    expect(result).toEqual({ ok: false, errors: { personLabel: 'invalid' } });
  });

  it('never puts the typed text into an error', () => {
    const secret = 'Sentinel\nPerson';
    const result = validateGiftInput({ ...base, personLabel: secret }, { today: TODAY });
    expect(result).toEqual({ ok: false, errors: { personLabel: 'invalidCharacters' } });
    expect(JSON.stringify(result)).not.toContain('Sentinel');
  });
});

describe('occasion date', () => {
  it.each(['2026-12-24', '1999-01-01', '2999-12-31', '0001-01-01', '2028-02-29', '9999-12-31'])('accepts the valid calendar date %s, past or future', (date) => {
    expect(draftOfValid({ occasionDate: date }).occasionDate).toBe(date);
  });

  it.each(['2027-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2026-6-1', '26-06-01', '2026-06-01T00:00:00Z', 'tomorrow', ' 2026-06-01', '2026/06/01'])(
    'refuses %j',
    (date) => {
      expect(errorsOf({ occasionDate: date })).toEqual({ occasionDate: 'invalid' });
    },
  );

  it('treats an empty date as absent, and keeps the label independent of the date', () => {
    expect(draftOfValid({ occasionDate: '' })).not.toHaveProperty('occasionDate');
    expect(draftOfValid({ occasionLabel: 'Birthday' })).not.toHaveProperty('occasionDate');
    expect(draftOfValid({ occasionDate: '2026-12-24' })).not.toHaveProperty('occasionLabel');
  });

  it('never compares the occasion date with today: a past date is only a date', () => {
    expect(ok({ occasionDate: '2000-01-01' }).ok).toBe(true);
    expect(ok({ occasionDate: '2026-10-11' }).ok).toBe(true);
  });
});

describe('budget and paid (DKK minor units, zero allowed, never negative)', () => {
  it.each([
    ['250', 25_000],
    ['249,50', 24_950],
    ['249.50', 24_950],
    ['0', 0],
    ['0,00', 0],
    ['0,01', 1],
    ['  12  ', 1_200],
    ['1000000', 100_000_000],
  ])('reads %j as %i minor units, exactly', (text, expected) => {
    expect(draftOfValid({ budget: text }).budget).toBe(expected);
  });

  it('allows a zero budget and keeps it as zero, not absent', () => {
    const draft = draftOfValid({ budget: '0' });
    expect(draft.budget).toBe(0);
    expect('budget' in draft).toBe(true);
  });

  it.each(['-1', '-0', '-0,01', '- 5', '--1'])('refuses a negative amount (%j), and "-0" is not quietly zero', (text) => {
    expect(errorsOf({ budget: text })).toEqual({ budget: 'negative' });
  });

  it.each(['abc', '1,234', '1.234,50', '12,345', '1e3', '12 kr', '1,2,3', '٣٤', '99999999999999999999'])('refuses the amount %j', (text) => {
    expect(errorsOf({ budget: text })).toEqual({ budget: 'invalidAmount' });
  });

  it('uses integer arithmetic only: no float can leak in', () => {
    // 0.1 + 0.2 style traps: 19,99 must be 1999, not 1998.9999999999998.
    expect(draftOfValid({ budget: '19,99' }).budget).toBe(1_999);
    expect(Number.isInteger(draftOfValid({ budget: '1,15' }).budget)).toBe(true);
  });

  it('keeps Budget (planned) and Paid (actual) separate: one never fills the other', () => {
    const planned = draftOfValid({ budget: '300' });
    expect(planned).not.toHaveProperty('paid');
    const bought = draftOfValid({ purchased: true, purchasedOn: '2026-10-01', paid: '280' });
    expect(bought.paid).toBe(28_000);
    expect(bought).not.toHaveProperty('budget');
    const both = draftOfValid({ budget: '300', purchased: true, purchasedOn: '2026-10-01', paid: '280' });
    expect([both.budget, both.paid]).toEqual([30_000, 28_000]);
  });
});

describe('purchase', () => {
  it('requires a purchase date once purchased is on', () => {
    expect(errorsOf({ purchased: true })).toEqual({ purchasedOn: 'required' });
    expect(errorsOf({ purchased: true, purchasedOn: '' })).toEqual({ purchasedOn: 'required' });
  });

  it.each(['2026-02-30', '2026-6-1', 'today', '2026-10-12T00:00:00Z'])('refuses the purchase date %j as invalid', (date) => {
    expect(errorsOf({ purchased: true, purchasedOn: date })).toEqual({ purchasedOn: 'invalid' });
  });

  it('accepts today and any earlier date, and refuses a future date on input', () => {
    expect(ok({ purchased: true, purchasedOn: TODAY }).ok).toBe(true);
    expect(ok({ purchased: true, purchasedOn: '2000-01-01' }).ok).toBe(true);
    expect(errorsOf({ purchased: true, purchasedOn: '2026-10-13' })).toEqual({ purchasedOn: 'future' });
    expect(errorsOf({ purchased: true, purchasedOn: '2999-01-01' })).toEqual({ purchasedOn: 'future' });
  });

  it('accepts an unchanged stored future date on edit (a changed device clock), but not a different future one', () => {
    const existing = { purchasedOn: '2027-03-01' };
    expect(ok({ purchased: true, purchasedOn: '2027-03-01' }, { existing }).ok).toBe(true);
    expect(errorsOf({ purchased: true, purchasedOn: '2027-03-02' }, { existing })).toEqual({ purchasedOn: 'future' });
  });

  it('accepts a paid amount with a purchase, zero included, and refuses a negative one', () => {
    expect(draftOfValid({ purchased: true, purchasedOn: TODAY, paid: '0' }).paid).toBe(0);
    expect(draftOfValid({ purchased: true, purchasedOn: TODAY, paid: '149,95' }).paid).toBe(14_995);
    expect(errorsOf({ purchased: true, purchasedOn: TODAY, paid: '-1' })).toEqual({ paid: 'negative' });
    expect(errorsOf({ purchased: true, purchasedOn: TODAY, paid: 'x' })).toEqual({ paid: 'invalidAmount' });
  });

  it('refuses a paid amount handed over without a purchase, rather than silently dropping it', () => {
    expect(errorsOf({ purchased: false, paid: '100' })).toEqual({ paid: 'purchaseRequired' });
    // Blank is simply absent.
    expect(ok({ purchased: false, paid: '  ' }).ok).toBe(true);
  });

  it('drops the purchase fields entirely when purchased is off', () => {
    const draft = draftOfValid({ purchased: false, purchasedOn: '2026-10-01' });
    expect(draft).not.toHaveProperty('purchasedOn');
    expect(draft).not.toHaveProperty('paid');
  });

  it('derives "purchased" from purchasedOn alone: there is no status', () => {
    expect(isPurchased(gift('a'))).toBe(false);
    expect(isPurchased(gift('a', { purchasedOn: '2026-10-01' }))).toBe(true);
    expect(Object.keys(gift('a', { purchasedOn: '2026-10-01', paid: m(0) })).some((key) => /status|state|purchased$/.test(key))).toBe(false);
  });

  it('marks purchased, then unmarks, removing the date and the paid amount together', () => {
    const planned = gift('a', { budget: m(30_000), occasionLabel: 'Birthday' });
    const bought = markPurchased(planned, { purchasedOn: '2026-10-01', paid: m(28_000) });
    expect(bought).toMatchObject({ id: 'a', purchasedOn: '2026-10-01', paid: 28_000, budget: 30_000, occasionLabel: 'Birthday' });
    const back = unmarkPurchased(bought);
    expect(back).toEqual(planned);
    expect(back).not.toHaveProperty('purchasedOn');
    expect(back).not.toHaveProperty('paid');
    // The planned budget is untouched by either.
    expect(back.budget).toBe(30_000);
  });

  it('cannot mark a paid amount without the date it belongs to', () => {
    const edited = applyGiftEdit(gift('a'), { personLabel: 'A', idea: 'I', paid: m(100) });
    expect(edited).not.toHaveProperty('paid');
  });

  it('can correct the purchase date and the paid amount afterwards', () => {
    const bought = markPurchased(gift('a'), { purchasedOn: '2026-10-01', paid: m(28_000) });
    const corrected = applyGiftEdit(bought, draftOfValid({ purchased: true, purchasedOn: '2026-09-28', paid: '275' }));
    expect(corrected).toMatchObject({ purchasedOn: '2026-09-28', paid: 27_500, id: 'a', createdAt: bought.createdAt });
  });
});

describe('identity is immutable', () => {
  it('an edit keeps id and createdAt, whatever the draft says', () => {
    const original = gift('a', { createdAt: '2026-01-02T03:04:05.006Z', idea: 'Old' });
    const edited = applyGiftEdit(original, { ...draftOf(original), idea: 'New', ...({ id: 'hijack', createdAt: '1999-01-01T00:00:00.000Z' } as object) });
    expect(edited).toMatchObject({ id: 'a', createdAt: '2026-01-02T03:04:05.006Z', idea: 'New' });
  });

  it('removes an optional field the edit omits', () => {
    const original = gift('a', { occasionLabel: 'Birthday', occasionDate: '2026-12-01', budget: m(100) });
    const edited = applyGiftEdit(original, draftOfValid({ personLabel: 'Person a', idea: 'Idea a' }));
    expect(Object.keys(edited)).toEqual(['id', 'personLabel', 'idea', 'createdAt']);
  });
});

describe('Planned order', () => {
  const items = [
    gift('a', { occasionDate: '2026-12-24', createdAt: '2026-09-01T08:00:00.000Z' }),
    gift('b', { occasionDate: '2026-11-01', createdAt: '2026-09-01T08:00:00.000Z' }),
    gift('c', { createdAt: '2026-09-05T08:00:00.000Z' }),
    gift('d', { createdAt: '2026-09-02T08:00:00.000Z' }),
    gift('e', { occasionDate: '2026-11-01', createdAt: '2026-09-03T08:00:00.000Z' }),
    gift('f', { occasionDate: '2026-11-01', createdAt: '2026-09-03T08:00:00.000Z' }),
    gift('g', { occasionDate: '2000-01-01', createdAt: '2026-09-01T08:00:00.000Z' }),
  ];

  it('is occasion date ascending, undated after dated, then newest created first, then id', () => {
    // g (2000, long past) stays first: a missed occasion is not demoted or hidden.
    // e/f share date and instant, so id breaks the tie; b is older, so it follows them.
    expect(sortPlanned(items).map((x) => x.id)).toEqual(['g', 'e', 'f', 'b', 'a', 'c', 'd']);
  });

  it('is independent of the input order, for every permutation', () => {
    const expected = sortPlanned(items).map((x) => x.id);
    const permutations = (list: Gift[]): Gift[][] =>
      list.length <= 1 ? [list] : list.flatMap((item, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [item, ...rest]));
    for (const permutation of permutations(items.slice(0, 6))) {
      expect(sortPlanned(permutation).map((x) => x.id)).toEqual(expected.filter((id) => permutation.some((x) => x.id === id)));
    }
  });

  it('returns a copy and leaves the input untouched', () => {
    const copy = [...items];
    sortPlanned(items);
    expect(items).toEqual(copy);
  });

  it('does not consult the clock: the same order on any day', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2001-01-01T00:00:00Z'));
      const early = sortPlanned(items).map((x) => x.id);
      jest.setSystemTime(new Date('2099-12-31T23:59:59Z'));
      expect(sortPlanned(items).map((x) => x.id)).toEqual(early);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Purchased order', () => {
  const items = [
    gift('a', { purchasedOn: '2026-10-01', createdAt: '2026-09-01T08:00:00.000Z' }),
    gift('b', { purchasedOn: '2026-10-05', createdAt: '2026-09-01T08:00:00.000Z' }),
    gift('c', { purchasedOn: '2026-10-01', createdAt: '2026-09-04T08:00:00.000Z' }),
    gift('d', { purchasedOn: '2026-10-01', createdAt: '2026-09-04T08:00:00.000Z' }),
    gift('e', { purchasedOn: '2025-01-01', createdAt: '2026-09-09T08:00:00.000Z' }),
  ];

  it('is purchase date newest first, then newest created first, then id', () => {
    expect(sortPurchased(items).map((x) => x.id)).toEqual(['b', 'c', 'd', 'a', 'e']);
  });

  it('is independent of the input order', () => {
    const expected = sortPurchased(items).map((x) => x.id);
    expect(sortPurchased([...items].reverse()).map((x) => x.id)).toEqual(expected);
    expect(sortPurchased([items[2], items[4], items[0], items[3], items[1]]).map((x) => x.id)).toEqual(expected);
  });
});

describe('the two sections', () => {
  it('puts a purchased gift in Purchased and keeps it visible: nothing is hidden or archived', () => {
    const planned = gift('p');
    const bought = gift('q', { purchasedOn: '2026-10-01' });
    const { planned: plannedList, purchased } = partitionGifts([bought, planned]);
    expect(plannedList.map((x) => x.id)).toEqual(['p']);
    expect(purchased.map((x) => x.id)).toEqual(['q']);
    expect(plannedList.length + purchased.length).toBe(2);
  });

  it('gives an empty list two empty sections', () => {
    expect(partitionGifts([])).toEqual({ planned: [], purchased: [] });
  });
});

describe('the persisted decoder (greenfield: one strict mode)', () => {
  const stored = (patch: Record<string, unknown> = {}) => ({
    id: 'g1', personLabel: 'Anna', idea: 'A book', createdAt: '2026-10-12T09:30:00.000Z', ...patch,
  });
  const full = stored({ occasionLabel: 'Birthday', occasionDate: '2026-12-24', budget: 30_000, purchasedOn: '2026-10-01', paid: 28_000 });

  it('decodes the exact nine-key shape, in canonical key order', () => {
    const decoded = decodeGift(full)!;
    expect(decoded).toEqual(full);
    expect(Object.keys(decoded)).toEqual(['id', 'personLabel', 'idea', 'occasionLabel', 'occasionDate', 'budget', 'purchasedOn', 'paid', 'createdAt']);
    expect(decoded).not.toBe(full);
  });

  it('decodes the minimal shape with no optional key', () => {
    expect(Object.keys(decodeGift(stored())!)).toEqual(['id', 'personLabel', 'idea', 'createdAt']);
  });

  it.each([
    ['an unknown key', { extra: 1 }],
    ['a legacy-looking key', { status: 'purchased' }],
    ['a contact key', { contactId: 'c1' }],
    ['a budget link', { budgetAllocationId: 'x' }],
    ['a null optional', { occasionLabel: null }],
    ['an empty-string optional', { occasionLabel: '' }],
    ['an empty-string date', { occasionDate: '' }],
    ['an untrimmed person', { personLabel: ' Anna' }],
    ['a person with a newline', { personLabel: 'An\nna' }],
    ['a person above 100 units', { personLabel: 'x'.repeat(101) }],
    ['an idea above 200 units', { idea: 'x'.repeat(201) }],
    ['an occasion label above 100 units', { occasionLabel: 'x'.repeat(101) }],
    ['a blank id', { id: '  ' }],
    ['a numeric id', { id: 7 }],
    ['an impossible occasion date', { occasionDate: '2026-02-30' }],
    ['an impossible purchase date', { purchasedOn: '2026-13-01' }],
    ['a negative budget', { budget: -1 }],
    ['a fractional budget', { budget: 1.5 }],
    ['a string budget', { budget: '250' }],
    ['a NaN budget', { budget: Number.NaN }],
    ['an infinite budget', { budget: Number.POSITIVE_INFINITY }],
    ['an unsafe budget', { budget: 2 ** 60 }],
    ['a negative paid amount', { purchasedOn: '2026-10-01', paid: -1 }],
    ['paid without purchasedOn', { paid: 100 }],
    ['a createdAt that is not an ISO instant', { createdAt: 'yesterday' }],
    ['a createdAt without milliseconds', { createdAt: '2026-10-12T09:30:00Z' }],
    ['a createdAt with an impossible date', { createdAt: '2026-02-30T09:30:00.000Z' }],
    ['a createdAt with an impossible hour', { createdAt: '2026-10-12T25:30:00.000Z' }],
  ])('refuses %s', (_label, patch) => {
    expect(decodeGift(stored(patch))).toBeNull();
  });

  it.each([null, undefined, 3, 'gift', [], [stored()]])('refuses a value that is not a record (%j)', (value) => {
    expect(decodeGift(value)).toBeNull();
  });

  it('refuses a row missing a required key', () => {
    for (const key of ['id', 'personLabel', 'idea', 'createdAt']) {
      const row: Record<string, unknown> = stored();
      delete row[key];
      expect(decodeGift(row)).toBeNull();
    }
  });

  it('allows zero for budget and paid', () => {
    expect(decodeGift(stored({ budget: 0, purchasedOn: '2026-10-01', paid: 0 }))).toMatchObject({ budget: 0, paid: 0 });
  });

  it('reads the clock never: a stored future purchase date decodes the same on every day', () => {
    const row = stored({ purchasedOn: '2999-01-01' });
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2001-01-01T00:00:00Z'));
      const early = decodeGift(row);
      jest.setSystemTime(new Date('2098-01-01T00:00:00Z'));
      const late = decodeGift(row);
      expect(early).toEqual(late);
      expect(early).toMatchObject({ purchasedOn: '2999-01-01' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('hydrating drops an unrecognisable row and a repeated id, and never throws', () => {
    const rows = [stored({ id: 'a' }), stored({ id: 'bad', budget: -1 }), stored({ id: 'a', idea: 'second a' }), 'junk', null, stored({ id: 'b' })];
    expect(decodeStoredGifts(rows).map((x) => [x.id, x.idea])).toEqual([['a', 'A book'], ['b', 'A book']]);
    for (const value of [null, undefined, {}, 'x', 3]) expect(decodeStoredGifts(value)).toEqual([]);
  });

  it('a backup is all-or-nothing: one bad row, one unknown key or one repeated id rejects the list', () => {
    expect(decodeBackupGifts([stored({ id: 'a' }), stored({ id: 'b' })])).toHaveLength(2);
    expect(decodeBackupGifts([stored({ id: 'a' }), stored({ id: 'b', budget: -1 })])).toBeNull();
    expect(decodeBackupGifts([stored({ id: 'a' }), stored({ id: 'b', extra: true })])).toBeNull();
    expect(decodeBackupGifts([stored({ id: 'a' }), stored({ id: 'a' })])).toBeNull();
    expect(decodeBackupGifts('not a list')).toBeNull();
    expect(decodeBackupGifts([])).toEqual([]);
  });
});
