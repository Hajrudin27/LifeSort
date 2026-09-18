export function getMonthKey(date: Date): string {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
  }
  
  export function addMonths(date: Date, delta: number): Date {
    return new Date(date.getFullYear(), date.getMonth() + delta, 1);
  }
  
  export function formatMonthLabel(date: Date, locale: string): string {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date);
  }

  /**
   * A 'YYYY-MM' key's first day as a local Date, for month navigation and labels.
   * Built from the key's own fields, so no device timezone can move it into
   * another month (APP-045).
   */
  export function monthKeyToDate(monthKey: string): Date {
    const [year, month] = monthKey.split('-').map(Number);
    return new Date(year, month - 1, 1);
  }