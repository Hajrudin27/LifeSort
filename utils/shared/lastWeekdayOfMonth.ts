export function getLastWeekdayOfMonth(year: number, monthIndex: number): Date {
    // monthIndex + 1, dag 0 = sidste dag i "monthIndex" (JS-trick fra DatePickerField)
    const date = new Date(year, monthIndex + 1, 0);
  
    // 0 = søndag, 6 = lørdag — ryk bagud til vi rammer en hverdag
    while (date.getDay() === 0 || date.getDay() === 6) {
      date.setDate(date.getDate() - 1);
    }
  
    return date;
  }