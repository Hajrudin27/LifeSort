import {
  getAverageCycleLength,
  getAveragePeriodLength,
  getFertileWindow,
  getPredictedNextPeriod,
} from '@/utils/cycle/cyclePredictions';
import { CycleEntry } from '@/types/cycle';

// Testene kører i Europe/Copenhagen (sat i test-scriptet). Fejlklassen her
// opstår kun i en tidszone med offset != 0, så en fast zone er nødvendig for
// at de overhovedet er meningsfulde — og for at de giver samme svar i CI.

const cycle = (startDate: string, endDate?: string): CycleEntry =>
  ({ id: startDate, startDate, endDate } as CycleEntry);

describe('getPredictedNextPeriod', () => {
  it('lægger cykluslængden til startdatoen som kalenderdage', () => {
    expect(getPredictedNextPeriod([cycle('2026-01-15')], 28)).toBe('2026-02-12');
  });

  it('rammer rigtigt midt om sommeren (UTC+2)', () => {
    expect(getPredictedNextPeriod([cycle('2026-06-10')], 28)).toBe('2026-07-08');
  });

  it('rammer rigtigt hen over forårets tidsomstilling', () => {
    // EU skifter til sommertid søndag 29. marts 2026.
    expect(getPredictedNextPeriod([cycle('2026-03-10')], 28)).toBe('2026-04-07');
  });

  it('rammer rigtigt hen over efterårets tidsomstilling', () => {
    // Tilbage til normaltid søndag 25. oktober 2026.
    expect(getPredictedNextPeriod([cycle('2026-10-10')], 28)).toBe('2026-11-07');
  });
});

describe('getFertileWindow', () => {
  it('placerer ægløsning lutealPhaseLength dage før næste menstruation', () => {
    // Næste menstruation 2026-02-12, luteal fase 14 dage -> ægløsning 2026-01-29.
    // Vinduet er fem dage før ægløsning til dagen efter.
    expect(getFertileWindow([cycle('2026-01-15')], 28, 14)).toEqual({
      start: '2026-01-24',
      ovulation: '2026-01-29',
      end: '2026-01-30',
    });
  });
});

describe('getAverageCycleLength', () => {
  it('måler afstanden mellem starter i kalenderdage', () => {
    expect(getAverageCycleLength([cycle('2026-01-01'), cycle('2026-01-29')])).toBe(28);
  });

  it('taber ikke en dag hen over forårets tidsomstilling', () => {
    expect(getAverageCycleLength([cycle('2026-03-10'), cycle('2026-04-07')])).toBe(28);
  });
});

describe('getAveragePeriodLength', () => {
  it('tæller start- og slutdag med', () => {
    expect(getAveragePeriodLength([cycle('2026-01-05', '2026-01-09')])).toBe(5);
  });

  it('taber ikke en dag hen over forårets tidsomstilling', () => {
    // 27. marts til 31. marts er fem dage, også selvom uret skifter undervejs.
    expect(getAveragePeriodLength([cycle('2026-03-27', '2026-03-31')])).toBe(5);
  });
});
