export interface MonthDayInfo {
    key: string | null; // ISO-dato, eller null = udfyldning uden for måneden
    dayNumber: number | null;
    isToday: boolean;
    isFuture: boolean;
  }
  
  export function getMonthCalendarWeeks(monthKey: string, todayKey: string): MonthDayInfo[][] {
    const [yearStr, monthStr] = monthKey.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr) - 1; // JS-måneder er 0-indekserede
  
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1);
    const firstWeekday = firstDay.getDay() || 7; // søndag = 7, ikke 0 — så ugen starter mandag
  
    const days: MonthDayInfo[] = [];
  
    for (let i = 1; i < firstWeekday; i++) {
      days.push({ key: null, dayNumber: null, isToday: false, isFuture: false });
    }
  
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${monthKey}-${d.toString().padStart(2, '0')}`;
      days.push({ key, dayNumber: d, isToday: key === todayKey, isFuture: key > todayKey });
    }
  
    while (days.length % 7 !== 0) {
      days.push({ key: null, dayNumber: null, isToday: false, isFuture: false });
    }
  
    const weeks: MonthDayInfo[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
    return weeks;
  }
  
  export function getWeekdayNarrowLabels(locale: string): string[] {
    // 1. januar 2024 var en mandag — bruges kun som fast reference til at generere ugedags-navne
    return Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i))
    );
  }