export function formatCvMonthYear(dateStr: string, locale: string): string {
    const [year, month] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, 1);
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(d);
  }
  
  export function formatCvDateRange(startDate: string, endDate: string | undefined, locale: string, currentLabel: string): string {
    const start = formatCvMonthYear(startDate, locale);
    const end = endDate ? formatCvMonthYear(endDate, locale) : currentLabel;
    return `${start} – ${end}`;
  }