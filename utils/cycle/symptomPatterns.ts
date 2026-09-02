import { Symptom, SymptomLog } from '@/types/cycle';

export interface SymptomPattern {
  symptom: Symptom;
  monthsInARow: number;
}

// Finder symptomer, der er logget i mindst 3 på hinanden følgende kalendermåneder.
// Ren, faktuel optælling af egne data — ingen vurdering af, hvad det betyder.
export function detectRecurringSymptoms(logs: SymptomLog[], minMonths = 3): SymptomPattern[] {
  const monthsBySymptom = new Map<Symptom, Set<string>>();

  for (const log of logs) {
    const monthKey = log.date.slice(0, 7);
    for (const symptom of log.symptoms) {
      if (!monthsBySymptom.has(symptom)) monthsBySymptom.set(symptom, new Set());
      monthsBySymptom.get(symptom)!.add(monthKey);
    }
  }

  const patterns: SymptomPattern[] = [];
  for (const [symptom, months] of monthsBySymptom.entries()) {
    const sortedMonths = Array.from(months).sort();
    let streak = 1;
    let maxStreak = 1;
    for (let i = 1; i < sortedMonths.length; i++) {
      const prev = new Date(`${sortedMonths[i - 1]}-01`);
      const curr = new Date(`${sortedMonths[i]}-01`);
      const monthDiff = (curr.getFullYear() - prev.getFullYear()) * 12 + (curr.getMonth() - prev.getMonth());
      streak = monthDiff === 1 ? streak + 1 : 1;
      maxStreak = Math.max(maxStreak, streak);
    }
    if (maxStreak >= minMonths) patterns.push({ symptom, monthsInARow: maxStreak });
  }

  return patterns.sort((a, b) => b.monthsInARow - a.monthsInARow);
}