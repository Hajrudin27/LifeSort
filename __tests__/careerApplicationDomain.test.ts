import {
  APPLICATION_STATUSES,
  decodeApplication,
  decodeBackupApplications,
  decodeStoredApplications,
  isHttpUrl,
} from '@/core/career/persistedApplication';
import {
  applyApplicationEdit,
  createApplication,
  interviewApplicationCount,
  openApplicationCount,
  openableLink,
  sortApplications,
  validateApplicationInput,
  type ApplicationInput,
} from '@/features/career/domain/application';
import * as domain from '@/features/career/domain/application';
import type { ApplicationStatus, JobApplication } from '@/types/career';

/**
 * APP-067 — the Career application rules and the persisted format, as pure functions.
 * "Today" is always a parameter, so nothing here depends on the clock or the timezone.
 */
const TODAY = '2026-10-09';
const valid: ApplicationInput = { company: 'Acme', position: 'Engineer', status: 'applied', appliedDate: '2026-10-01' };
const validate = (patch: Partial<ApplicationInput> = {}, options: { existing?: { appliedDate: string } } = {}) =>
  validateApplicationInput({ ...valid, ...patch }, { today: TODAY, ...options });
const errorsOf = (patch: Partial<ApplicationInput>) => {
  const result = validate(patch);
  return result.ok ? null : result.errors;
};
const stored = (patch: Record<string, unknown> = {}) => ({
  id: 'a1', company: 'Acme', position: 'Engineer', status: 'applied', appliedDate: '2026-10-01', createdAt: '2026-10-01T08:00:00.000Z', ...patch,
});

describe('create', () => {
  it('accepts a valid application and returns exactly the canonical fields', () => {
    const result = validate({ link: 'https://example.com/job', notes: 'Line one\nLine two' });
    expect(result).toEqual({
      ok: true,
      value: { company: 'Acme', position: 'Engineer', status: 'applied', appliedDate: '2026-10-01', link: 'https://example.com/job', notes: 'Line one\nLine two' },
    });
  });

  it('makes an application from a draft with the id and creation instant it is given, and nothing else', () => {
    const result = validate();
    if (!result.ok) throw new Error('expected valid');
    const application = createApplication(result.value, { id: 'new-id', createdAt: '2026-10-09T10:00:00.000Z' });
    expect(application).toEqual({ id: 'new-id', createdAt: '2026-10-09T10:00:00.000Z', company: 'Acme', position: 'Engineer', status: 'applied', appliedDate: '2026-10-01' });
    expect(Object.keys(application).sort()).toEqual(['appliedDate', 'company', 'createdAt', 'id', 'position', 'status']);
  });

  it('removes absent optional fields instead of storing empty ones', () => {
    const result = validate({ link: '   ', notes: '  \n ' });
    expect(result).toEqual({ ok: true, value: { company: 'Acme', position: 'Engineer', status: 'applied', appliedDate: '2026-10-01' } });
  });
});

describe('company and position', () => {
  it.each(['company', 'position'] as const)('%s is required, trimmed and never blank', (field) => {
    expect(errorsOf({ [field]: '' })).toEqual({ [field]: 'required' });
    expect(errorsOf({ [field]: ' \t \n ' })).toEqual({ [field]: 'required' });
    const result = validate({ [field]: '  Padded  ' });
    expect(result.ok && result.value[field]).toBe('Padded');
  });

  it.each(['company', 'position'] as const)('%s accepts exactly 200 UTF-16 units and refuses 201', (field) => {
    expect(validate({ [field]: 'x'.repeat(200) }).ok).toBe(true);
    expect(errorsOf({ [field]: 'x'.repeat(201) })).toEqual({ [field]: 'tooLong' });
    // Length is counted after trimming, so padding never causes a refusal.
    expect(validate({ [field]: `  ${'x'.repeat(200)}  ` }).ok).toBe(true);
  });

  it.each(['company', 'position'] as const)('%s refuses NUL and every other control character, including line breaks', (field) => {
    for (const bad of ['a\u0000b', 'a\tb', 'a\nb', 'a\rb', 'a\u001Fb', 'a\u007Fb', 'a\u0085b', 'a\u009Fb']) {
      expect(errorsOf({ [field]: bad })).toEqual({ [field]: 'invalidCharacters' });
    }
    expect(validate({ [field]: 'Æblegården A/S – København ✓' }).ok).toBe(true);
  });

  it('refuses a value that is not text', () => {
    expect(errorsOf({ company: 5 as unknown as string })).toEqual({ company: 'invalid' });
  });
});

describe('status', () => {
  it('is exactly the four existing values, in a closed set', () => {
    expect([...APPLICATION_STATUSES]).toEqual(['applied', 'interview', 'offer', 'rejected']);
    for (const status of APPLICATION_STATUSES) expect(validate({ status }).ok).toBe(true);
  });

  it.each(['withdrawn', 'accepted', 'Applied', 'APPLIED', ' applied', '', 'ghosted', null, undefined, 1, {}])('refuses %p', (status) => {
    expect(errorsOf({ status })).toEqual({ status: 'invalid' });
  });

  it('lets any status be corrected to any other, only by an explicit edit', () => {
    const original: JobApplication = { id: 'a', createdAt: '2026-10-01T08:00:00.000Z', company: 'Acme', position: 'Engineer', status: 'applied', appliedDate: '2026-10-01' };
    for (const from of APPLICATION_STATUSES) {
      for (const to of APPLICATION_STATUSES) {
        const result = validate({ status: to });
        if (!result.ok) throw new Error('expected valid');
        const edited = applyApplicationEdit({ ...original, status: from as ApplicationStatus }, result.value);
        expect(edited.status).toBe(to);
      }
    }
  });
});

describe('applied date', () => {
  it('is a strict calendar date', () => {
    for (const bad of ['', '2026-1-01', '2026-13-01', '2026-00-10', '2026-02-30', '2025-02-29', '2026-04-31', '20261001', '2026-10-01T00:00:00Z', ' 2026-10-01', 'tomorrow']) {
      expect(errorsOf({ appliedDate: bad })).toEqual({ appliedDate: 'invalid' });
    }
    expect(validate({ appliedDate: '2028-02-29' }, { existing: { appliedDate: '2028-02-29' } }).ok).toBe(true);
  });

  it('refuses a future date typed by the user, and accepts today and the past', () => {
    expect(errorsOf({ appliedDate: '2026-10-10' })).toEqual({ appliedDate: 'future' });
    expect(validate({ appliedDate: TODAY }).ok).toBe(true);
    expect(validate({ appliedDate: '1999-12-31' }).ok).toBe(true);
  });

  it('keeps an existing application\'s own stored date editable even when it lies in the future', () => {
    expect(validate({ appliedDate: '2026-12-01' }, { existing: { appliedDate: '2026-12-01' } }).ok).toBe(true);
    expect(validate({ appliedDate: '2026-12-02' }, { existing: { appliedDate: '2026-12-01' } }).ok).toBe(false);
  });

  it('is decoded without any clock, so the same stored bytes decode the same on every day and in every timezone', () => {
    const future = stored({ appliedDate: '2099-01-01' });
    expect(decodeApplication(future, 'stored')).toMatchObject({ appliedDate: '2099-01-01' });
    expect(decodeApplication(future, 'backup')).toMatchObject({ appliedDate: '2099-01-01' });
    // The calendar date is never round-tripped through a Date, so a boundary day cannot shift.
    for (const day of ['2026-03-29', '2026-10-25', '2026-12-31', '2027-01-01']) {
      expect(decodeApplication(stored({ appliedDate: day }), 'stored')?.appliedDate).toBe(day);
    }
  });
});

describe('link', () => {
  it.each(['http://example.com', 'https://example.com/a?b=c#d', 'HTTPS://EXAMPLE.COM', 'https://example.com:8443/x'])('accepts %s', (link) => {
    const result = validate({ link });
    expect(result.ok && result.value.link).toBe(link);
    expect(openableLink(link)).toBe(link);
  });

  it.each([
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'ftp://example.com', 'intent://x#Intent;end',
    'mailto:a@b.c', 'tel:+4512345678', 'lifesort://settings', 'example.com', '//example.com', 'https://', 'https:///x', 'https://exa mple.com',
    'https://example.com/\nsecond', 'http:/example.com',
  ])('refuses %p and never offers it for opening', (link) => {
    expect(errorsOf({ link })).toEqual({ link: 'invalidLink' });
    expect(openableLink(link)).toBeNull();
    expect(isHttpUrl(link)).toBe(false);
  });

  it('trims, treats empty as absent, and limits the length to 2048', () => {
    expect(validate({ link: '  https://example.com  ' })).toMatchObject({ ok: true, value: { link: 'https://example.com' } });
    expect(validate({ link: '' })).toEqual({ ok: true, value: { company: 'Acme', position: 'Engineer', status: 'applied', appliedDate: '2026-10-01' } });
    const base = 'https://example.com/';
    expect(validate({ link: base + 'a'.repeat(2048 - base.length) }).ok).toBe(true);
    expect(errorsOf({ link: base + 'a'.repeat(2049 - base.length) })).toEqual({ link: 'tooLong' });
  });

  it('opens nothing for an absent or non-text value', () => {
    expect(openableLink(undefined)).toBeNull();
    expect(openableLink(7 as unknown as string)).toBeNull();
  });
});

describe('notes', () => {
  it('are plain multiline text: line breaks and tabs are kept, nothing is interpreted', () => {
    const notes = 'First\n\n  # not a heading\n**not bold** <b>not html</b>\n\tTabbed\r\nWindows';
    expect(validate({ notes })).toMatchObject({ ok: true, value: { notes } });
  });

  it('are trimmed, and empty means absent', () => {
    expect(validate({ notes: '  hello  ' })).toMatchObject({ ok: true, value: { notes: 'hello' } });
    expect(validate({ notes: ' \n ' }).ok && 'notes' in (validate({ notes: ' \n ' }) as { value: object }).value).toBe(false);
  });

  it('accept exactly 10,000 characters and refuse 10,001', () => {
    expect(validate({ notes: 'n'.repeat(10_000) }).ok).toBe(true);
    expect(errorsOf({ notes: 'n'.repeat(10_001) })).toEqual({ notes: 'tooLong' });
  });

  it('refuse NUL and other control characters', () => {
    for (const bad of ['a\u0000b', 'a\u0007b', 'a\u001Bb', 'a\u007Fb', 'a\u0090b']) {
      expect(errorsOf({ notes: bad })).toEqual({ notes: 'invalidCharacters' });
    }
  });
});

describe('every failing field is reported at once', () => {
  it('returns a code per field and never any of the text that was typed', () => {
    const result = validate({ company: '', position: 'x'.repeat(201), status: 'nope', appliedDate: '2026-02-30', link: 'javascript:1', notes: 'a\u0000' });
    expect(result).toEqual({
      ok: false,
      errors: { company: 'required', position: 'tooLong', status: 'invalid', appliedDate: 'invalid', link: 'invalidLink', notes: 'invalidCharacters' },
    });
    expect(JSON.stringify(result)).not.toContain('javascript');
  });
});

describe('identity and creation time', () => {
  const original: JobApplication = { id: 'legacy-1725206400000-4821', createdAt: '2026-09-01T08:00:00.000Z', company: 'Acme', position: 'Engineer', status: 'interview', appliedDate: '2026-09-01', notes: 'old' };

  it('an edit never changes id or createdAt, and removes optional fields the draft omits', () => {
    const result = validate({ company: 'Other', notes: '' });
    if (!result.ok) throw new Error('expected valid');
    const edited = applyApplicationEdit(original, result.value);
    expect(edited.id).toBe(original.id);
    expect(edited.createdAt).toBe(original.createdAt);
    expect(edited.company).toBe('Other');
    expect('notes' in edited).toBe(false);
  });

  it('keeps legacy ids opaque: any non-blank string decodes, nothing demands a UUID', () => {
    for (const id of ['1725206400000-4821', 'abc', '7', 'a'.repeat(300)]) {
      expect(decodeApplication(stored({ id }), 'stored')?.id).toBe(id);
    }
    expect(decodeApplication(stored({ id: '' }), 'stored')).toBeNull();
    expect(decodeApplication(stored({ id: 12 }), 'stored')).toBeNull();
  });

  it('createdAt must be a valid instant', () => {
    expect(decodeApplication(stored({ createdAt: 'not a date' }), 'stored')).toBeNull();
    expect(decodeApplication(stored({ createdAt: '' }), 'stored')).toBeNull();
    expect(decodeApplication(stored({ createdAt: 1 }), 'stored')).toBeNull();
  });
});

describe('list order', () => {
  const app = (id: string, appliedDate: string, createdAt: string): JobApplication =>
    ({ id, appliedDate, createdAt, company: 'C', position: 'P', status: 'applied' });

  it('is applied date descending, then created descending, then id ascending', () => {
    const list = [
      app('b', '2026-10-01', '2026-10-01T08:00:00.000Z'),
      app('a', '2026-10-01', '2026-10-01T08:00:00.000Z'),
      app('c', '2026-10-01', '2026-10-01T09:00:00.000Z'),
      app('d', '2026-10-05', '2026-09-01T09:00:00.000Z'),
      app('e', '2026-09-30', '2026-10-09T09:00:00.000Z'),
    ];
    expect(sortApplications(list).map((a) => a.id)).toEqual(['d', 'c', 'a', 'b', 'e']);
  });

  it('is independent of the input order and does not mutate it', () => {
    const list = [app('x', '2026-10-01', '2026-10-01T08:00:00.000Z'), app('y', '2026-10-02', '2026-10-01T08:00:00.000Z'), app('z', '2026-10-01', '2026-10-01T08:00:00.000Z')];
    const copy = [...list];
    const forward = sortApplications(list).map((a) => a.id);
    expect(sortApplications([...list].reverse()).map((a) => a.id)).toEqual(forward);
    expect(list).toEqual(copy);
  });

  it('ranks nothing about the employer: status, company, role and notes never move a row', () => {
    const base = app('m', '2026-10-01', '2026-10-01T08:00:00.000Z');
    const a = { ...base, id: 'a', status: 'rejected' as const, company: 'Zzz', notes: 'great fit' };
    const b = { ...base, id: 'b', status: 'offer' as const, company: 'Aaa' };
    expect(sortApplications([b, a]).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('counts', () => {
  it('count the user\'s own declared statuses and nothing else', () => {
    const list = (['applied', 'interview', 'interview', 'offer', 'rejected', 'rejected'] as const).map((status) => ({ status }));
    expect(openApplicationCount(list)).toBe(4);
    expect(interviewApplicationCount(list)).toBe(2);
    expect(openApplicationCount([])).toBe(0);
  });
});

describe('persisted decoding', () => {
  it('reads the unchanged eight-key shape, with optional link and notes', () => {
    expect(decodeApplication(stored({ link: 'https://example.com', notes: 'n' }), 'backup')).toEqual(
      stored({ link: 'https://example.com', notes: 'n' }),
    );
    expect(Object.keys(decodeApplication(stored(), 'stored')!).sort()).toEqual(['appliedDate', 'company', 'createdAt', 'id', 'position', 'status']);
  });

  it.each([
    ['an unknown status', { status: 'ghosted' }],
    ['a withdrawn status', { status: 'withdrawn' }],
    ['a blank company', { company: '   ' }],
    ['a blank position', { position: '' }],
    ['an impossible date', { appliedDate: '2026-02-30' }],
    ['a non-string link', { link: 7 }],
    ['a non-string note', { notes: {} }],
  ])('refuses %s in both modes', (_label, patch) => {
    expect(decodeApplication(stored(patch), 'stored')).toBeNull();
    expect(decodeApplication(stored(patch), 'backup')).toBeNull();
  });

  // The previous form enforced no limit and no link rule, so these are values the old product created.
  const LEGACY_VALUES: [string, Record<string, unknown>][] = [
    ['a company over 200', { company: 'c'.repeat(500) }],
    ['a position over 200', { position: 'p'.repeat(201) }],
    ['notes over 10,000', { notes: 'n'.repeat(20_000) }],
    ['a link over 2048', { link: `https://x.com/${'a'.repeat(3000)}` }],
    ['a scheme-less link', { link: 'linkedin.com/jobs/123' }],
    ['a javascript link', { link: 'javascript:alert(1)' }],
    ['a file link', { link: 'file:///etc/passwd' }],
    ['a pasted tab and newline in the company', { company: 'Acme\tA/S\n' }],
    ['a NUL in the notes', { notes: 'a\u0000b' }],
  ];

  it.each(['stored', 'backup'] as const)('%s mode preserves every value the old product could create, exactly, and never normalises a link', (mode) => {
    for (const [, patch] of LEGACY_VALUES) {
      expect(decodeApplication(stored(patch), mode)).toEqual(stored(patch));
    }
    expect(decodeApplication(stored({ link: 'linkedin.com/jobs/123' }), mode)!.link).toBe('linkedin.com/jobs/123');
  });

  it('opens none of the unsafe legacy links', () => {
    for (const link of ['linkedin.com/jobs/123', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'lifesort://x']) {
      expect(openableLink(link)).toBeNull();
    }
  });

  it('NEW input still refuses every one of those values, so editing a legacy row asks for a correction', () => {
    expect(errorsOf({ company: 'c'.repeat(201) })).toEqual({ company: 'tooLong' });
    expect(errorsOf({ notes: 'n'.repeat(10_001) })).toEqual({ notes: 'tooLong' });
    expect(errorsOf({ link: 'linkedin.com/jobs/123' })).toEqual({ link: 'invalidLink' });
    expect(errorsOf({ link: 'javascript:alert(1)' })).toEqual({ link: 'invalidLink' });
    expect(errorsOf({ notes: 'a\u0000b' })).toEqual({ notes: 'invalidCharacters' });
  });

  it('backup mode still refuses structure, types, unknown keys and duplicate ids; an empty link means absent', () => {
    for (const patch of [{ extra: 'field' }, { salary: 1 }, { link: 5 }, { notes: null }, { id: ' ' }, { createdAt: 'yesterday' }]) {
      expect(decodeApplication(stored(patch), 'backup')).toBeNull();
    }
    expect(decodeApplication(stored({ link: '' }), 'backup')).toEqual(stored());
    expect(decodeBackupApplications([stored(), stored()])).toBeNull();
    expect(decodeBackupApplications([stored({ id: 'a' }), stored({ id: 'b' })])).toHaveLength(2);
    expect(decodeBackupApplications([stored(), { company: 'bad' }])).toBeNull();
    expect(decodeBackupApplications('nope')).toBeNull();
    expect(decodeBackupApplications([])).toEqual([]);
  });

  it('stored mode drops unrecognisable rows and repeated ids, never throws, and never returns a bad status', () => {
    const rows = decodeStoredApplications([stored({ id: 'a' }), stored({ id: 'a', company: 'dup' }), stored({ id: 'b', status: 'ghosted' }), null, 'x', stored({ id: 'c' })]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'c']);
    expect(rows[0].company).toBe('Acme');
    expect(decodeStoredApplications(undefined)).toEqual([]);
    expect(decodeStoredApplications({})).toEqual([]);
  });

  it('returns fresh objects and drops unknown keys in stored mode', () => {
    const input = stored({ extra: 'x' });
    const out = decodeApplication(input, 'stored')!;
    expect(out).not.toBe(input);
    expect('extra' in out).toBe(false);
  });
});

describe('no inference', () => {
  it('the domain exposes no scoring, ranking, probability or recommendation, and the status is only ever the input\'s', () => {
    expect(Object.keys(domain).sort()).toEqual([
      'APPLICATION_STATUSES', 'MAX_COMPANY_LENGTH', 'MAX_LINK_LENGTH', 'MAX_NOTES_LENGTH', 'MAX_POSITION_LENGTH',
      'applyApplicationEdit', 'createApplication', 'interviewApplicationCount', 'openApplicationCount', 'openableLink',
      'sortApplications', 'validateApplicationInput',
    ]);
    // Same company, role, notes and date, different declared status: the result differs only by that status.
    const a = validate({ status: 'applied', notes: 'Great culture, very likely to hire' });
    const b = validate({ status: 'rejected', notes: 'Great culture, very likely to hire' });
    if (!a.ok || !b.ok) throw new Error('expected valid');
    expect({ ...a.value, status: 'x' }).toEqual({ ...b.value, status: 'x' });
  });
});
