export interface WeekDayInfo {
    key: string; // ISO-dato, fx "2026-08-18"
    label: string; // kort ugedag, fx "M", "T"
    isToday: boolean;
    isFuture: boolean;
  }
  
  export function getCurrentWeekDays(locale: string): WeekDayInfo[] {
    const now = new Date();
    const dayNum = now.getDay() || 7; // søndag = 7, ikke 0
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayNum + 1);
    monday.setHours(0, 0, 0, 0);
  
    const todayKey = now.toISOString().slice(0, 10);
  
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      return {
        key,
        label: new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(d),
        isToday: key === todayKey,
        isFuture: key > todayKey,
      };
    });
  }
  
  export function getTodayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  export function isDateInCurrentWeek(dateKey: string, locale: string): boolean {
    const days = getCurrentWeekDays(locale);
    const weekStart = days[0].key;
    const weekEnd = days[6].key;
    return dateKey >= weekStart && dateKey <= weekEnd;
  }