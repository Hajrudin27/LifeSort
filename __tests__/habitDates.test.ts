import { getCurrentWeekDays, getTodayKey } from '@/utils/habit/habitWeek';
import { getCurrentStreak, hasLoggedToday } from '@/utils/habit/habitStreak';
import { HabitLog } from '@/types/life';

// Kører i Europe/Copenhagen. Onsdag 1. juli 2026 er sommertid (UTC+2), så kl.
// 00:30 lokalt er klokken 22:30 den 30. juni i UTC — netop der hvor en
// UTC-baseret "i dag" peger på gårsdagen.

const log = (date: string): HabitLog => ({ date } as HabitLog);

function at(y: number, m: number, d: number, h = 12, min = 0) {
  jest.useFakeTimers().setSystemTime(new Date(y, m - 1, d, h, min));
}

afterEach(() => jest.useRealTimers());

describe('getTodayKey', () => {
  it('giver dagens dato midt på dagen', () => {
    at(2026, 7, 1);
    expect(getTodayKey()).toBe('2026-07-01');
  });

  it('giver stadig dagens dato lige efter midnat', () => {
    at(2026, 7, 1, 0, 30);
    expect(getTodayKey()).toBe('2026-07-01');
  });

  it('giver stadig dagens dato lige før midnat', () => {
    at(2026, 7, 1, 23, 59);
    expect(getTodayKey()).toBe('2026-07-01');
  });
});

describe('getCurrentWeekDays', () => {
  it('spænder fra mandag til søndag med korrekte datoer', () => {
    at(2026, 7, 1); // onsdag
    const days = getCurrentWeekDays('da-DK');
    expect(days.map((d) => d.key)).toEqual([
      '2026-06-29', '2026-06-30', '2026-07-01',
      '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05',
    ]);
  });

  it('markerer i dag', () => {
    at(2026, 7, 1);
    const days = getCurrentWeekDays('da-DK');
    expect(days.filter((d) => d.isToday).map((d) => d.key)).toEqual(['2026-07-01']);
  });

  it('markerer i dag også lige efter midnat', () => {
    at(2026, 7, 1, 0, 30);
    const days = getCurrentWeekDays('da-DK');
    expect(days.filter((d) => d.isToday).map((d) => d.key)).toEqual(['2026-07-01']);
  });

  it('regner kun senere dage som fremtid', () => {
    at(2026, 7, 1);
    const days = getCurrentWeekDays('da-DK');
    expect(days.filter((d) => d.isFuture).map((d) => d.key)).toEqual([
      '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05',
    ]);
  });
});

describe('hasLoggedToday', () => {
  it('genkender dagens log midt på dagen', () => {
    at(2026, 7, 1);
    expect(hasLoggedToday([log('2026-07-01')])).toBe(true);
    expect(hasLoggedToday([log('2026-06-30')])).toBe(false);
  });

  it('genkender dagens log lige efter midnat', () => {
    at(2026, 7, 1, 0, 30);
    expect(hasLoggedToday([log('2026-07-01')])).toBe(true);
    expect(hasLoggedToday([log('2026-06-30')])).toBe(false);
  });
});

describe('getCurrentStreak', () => {
  it('tæller sammenhængende dage frem til i dag', () => {
    at(2026, 7, 1);
    expect(getCurrentStreak([log('2026-07-01'), log('2026-06-30'), log('2026-06-29')])).toBe(3);
  });

  it('stopper ved et hul', () => {
    at(2026, 7, 1);
    expect(getCurrentStreak([log('2026-07-01'), log('2026-06-29')])).toBe(1);
  });

  it('tæller korrekt lige efter midnat', () => {
    at(2026, 7, 1, 0, 30);
    expect(getCurrentStreak([log('2026-07-01'), log('2026-06-30')])).toBe(2);
  });

  it('taber ikke dage hen over forårets tidsomstilling', () => {
    at(2026, 3, 30); // dagen efter omstillingen
    expect(getCurrentStreak([log('2026-03-30'), log('2026-03-29'), log('2026-03-28')])).toBe(3);
  });
});
