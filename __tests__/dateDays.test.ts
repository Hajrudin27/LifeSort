import { daysUntil } from '@/utils/shared/dateDays';

function at(y: number, m: number, d: number, h = 12, min = 0) {
  jest.useFakeTimers().setSystemTime(new Date(y, m - 1, d, h, min));
}
afterEach(() => jest.useRealTimers());

describe('daysUntil', () => {
  it('giver 0 for i dag', () => {
    at(2026, 7, 1);
    expect(daysUntil('2026-07-01')).toBe(0);
  });

  it('giver 0 for i dag også lige efter midnat', () => {
    at(2026, 7, 1, 0, 30);
    expect(daysUntil('2026-07-01')).toBe(0);
  });

  it('giver 0 for i dag også lige før midnat', () => {
    at(2026, 7, 1, 23, 59);
    expect(daysUntil('2026-07-01')).toBe(0);
  });

  it('tæller fremad og bagud', () => {
    at(2026, 7, 1);
    expect(daysUntil('2026-07-02')).toBe(1);
    expect(daysUntil('2026-07-31')).toBe(30);
    expect(daysUntil('2026-06-30')).toBe(-1);
  });

  it('forskydes ikke af forårets tidsomstilling', () => {
    at(2026, 3, 20);
    expect(daysUntil('2026-04-01')).toBe(12);
  });

  it('forskydes ikke af efterårets tidsomstilling', () => {
    at(2026, 10, 20);
    expect(daysUntil('2026-11-01')).toBe(12);
  });

  it('tåler en dato med klokkeslæt på', () => {
    at(2026, 7, 1);
    expect(daysUntil('2026-07-03T10:00:00.000Z')).toBe(2);
  });
});
