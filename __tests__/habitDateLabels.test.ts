import { longDateText, monthText, shortDateText } from '@/features/habits/habitDisplay';

/**
 * A civil date (YYYY-MM-DD) must be spoken as that exact day, in any device timezone. The expected
 * weekdays below come from the calendar (checked against an independent integer algorithm in
 * habitDomain.test.ts), not from the formatter under test.
 */
describe('spoken civil dates', () => {
  const cases: Array<[string, string, string]> = [
    // date, English long, Danish long
    ['2026-10-07', 'Wednesday, October 7', 'onsdag 7. oktober'],
    ['2026-10-05', 'Monday, October 5', 'mandag 5. oktober'],
    ['2026-03-29', 'Sunday, March 29', 'søndag 29. marts'], // the spring-forward Sunday in Copenhagen
    ['2026-10-25', 'Sunday, October 25', 'søndag 25. oktober'], // the fall-back Sunday
    ['2028-02-29', 'Tuesday, February 29', 'tirsdag 29. februar'], // a leap day
    ['2026-12-31', 'Thursday, December 31', 'torsdag 31. december'],
    ['2027-01-01', 'Friday, January 1', 'fredag 1. januar'],
  ];

  it.each(cases)('%s is %s / %s', (date, english, danish) => {
    expect(longDateText(date, 'en')).toBe(english);
    expect(longDateText(date, 'da')).toBe(danish);
  });

  it('short and month forms keep the month of the civil date, at both ends of every month', () => {
    expect(shortDateText('2026-10-01', 'en')).toBe('Oct 1');
    expect(shortDateText('2026-09-30', 'en')).toBe('Sep 30');
    expect(shortDateText('2026-10-31', 'en')).toBe('Oct 31');
    expect(monthText('2026-10', 'en')).toBe('October 2026');
    expect(monthText('2026-12', 'da')).toBe('december 2026');
    expect(monthText('2027-01', 'en')).toBe('January 2027');
  });

  it('is formatted in UTC from an instant whose UTC fields ARE the civil date, so no zone can move it', () => {
    const real = Intl.DateTimeFormat;
    const seen: Array<{ timeZone?: string; iso: string }> = [];
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(((locale: string, options: Intl.DateTimeFormatOptions) => {
      const inner = new real(locale, options);
      return { format: (date: Date) => { seen.push({ timeZone: options.timeZone, iso: date.toISOString() }); return inner.format(date); } };
    }) as never);
    try {
      for (const [date] of cases) longDateText(date, 'en');
      shortDateText('2026-10-01', 'da');
      monthText('2026-10', 'en');
    } finally {
      spy.mockRestore();
    }
    expect(seen.length).toBe(cases.length + 2);
    for (const entry of seen) expect(entry.timeZone).toBe('UTC');
    expect(seen.slice(0, cases.length).map((entry) => entry.iso.slice(0, 10))).toEqual(cases.map(([date]) => date));
    expect(seen[cases.length].iso.slice(0, 10)).toBe('2026-10-01');
    expect(seen[cases.length + 1].iso.slice(0, 10)).toBe('2026-10-01'); // a month is spoken from its first day
  });

  it('falls back to the plain date when the platform cannot format it, never to a wrong one', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((() => { throw new RangeError('no zone support'); }) as never);
    try {
      expect(longDateText('2026-10-07', 'en')).toBe('2026-10-07');
    } finally {
      spy.mockRestore();
    }
  });
});
