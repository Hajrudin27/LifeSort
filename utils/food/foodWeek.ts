export function getISOWeekKey(date: Date): string {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNum = d.getUTCDay() || 7; // søndag = 7, ikke 0
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // ryk til ugens torsdag
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${isoYear}-W${weekNum.toString().padStart(2, "0")}`;
}

export function getWeeksInMonth(monthKey: string): string[] {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const weekKeys = new Set<string>();
  for (let day = 1; day <= daysInMonth; day++) {
    weekKeys.add(getISOWeekKey(new Date(year, month, day)));
  }
  return Array.from(weekKeys);
}

export function getWeekdayNames(locale: string): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(2024, 0, 1 + i))
  );
} 

export function getPreviousWeekKey(date: Date): string {
  const prev = new Date(date);
  prev.setDate(prev.getDate() - 7);
  return getISOWeekKey(prev);
}