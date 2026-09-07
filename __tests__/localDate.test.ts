import {
  addDaysIso,
  daysBetweenIso,
  parseIsoDate,
  toLocalIsoDate,
} from '@/utils/shared/localDate';

// Kører i Europe/Copenhagen — se package.json. EU skifter til sommertid
// søndag 29. marts 2026 og tilbage søndag 25. oktober 2026.

describe('toLocalIsoDate / parseIsoDate', () => {
  it('bevarer datoen frem og tilbage', () => {
    for (const iso of ['2026-01-15', '2026-04-07', '2026-07-01', '2026-11-20']) {
      expect(toLocalIsoDate(parseIsoDate(iso))).toBe(iso);
    }
  });

  it('læser den lokale dato, ikke UTC-datoen', () => {
    // Kl. 00:30 dansk sommertid er klokken 22:30 dagen før i UTC.
    expect(toLocalIsoDate(new Date(2026, 6, 1, 0, 30))).toBe('2026-07-01');
  });

  it('læser den lokale dato lige før midnat', () => {
    expect(toLocalIsoDate(new Date(2026, 6, 1, 23, 59))).toBe('2026-07-01');
  });
});

describe('daysBetweenIso', () => {
  it('tæller almindelige afstande', () => {
    expect(daysBetweenIso('2026-01-01', '2026-01-29')).toBe(28);
    expect(daysBetweenIso('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('er negativ når datoen ligger før', () => {
    expect(daysBetweenIso('2026-01-29', '2026-01-01')).toBe(-28);
  });

  it('taber ikke en dag hen over forårets omstilling', () => {
    expect(daysBetweenIso('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetweenIso('2026-03-01', '2026-03-31')).toBe(30);
    expect(daysBetweenIso('2026-03-10', '2026-04-07')).toBe(28);
  });

  it('lægger ikke en dag til hen over efterårets omstilling', () => {
    expect(daysBetweenIso('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetweenIso('2026-10-01', '2026-10-31')).toBe(30);
  });

  it('håndterer skudår', () => {
    expect(daysBetweenIso('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetweenIso('2026-02-28', '2026-03-01')).toBe(1);
  });
});

describe('addDaysIso', () => {
  it('lægger dage til hen over månedsskift', () => {
    expect(addDaysIso('2026-01-15', 28)).toBe('2026-02-12');
    expect(addDaysIso('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('lægger dage til hen over begge tidsomstillinger', () => {
    expect(addDaysIso('2026-03-10', 28)).toBe('2026-04-07');
    expect(addDaysIso('2026-10-10', 28)).toBe('2026-11-07');
  });

  it('trækker fra ved negative tal', () => {
    expect(addDaysIso('2026-02-12', -14)).toBe('2026-01-29');
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('håndterer skudår', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01');
  });
});
