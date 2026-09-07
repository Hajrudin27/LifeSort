import { CycleEntry } from "@/types/cycle";
import {
  addDaysIso,
  daysBetweenIso,
  toLocalIsoDate,
} from "@/utils/shared/localDate";

export function getLatestCycle(cycles: CycleEntry[]): CycleEntry | null {
  if (cycles.length === 0) return null;
  return [...cycles].sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
}

export function isCurrentlyOnPeriod(cycles: CycleEntry[]): boolean {
  const latest = getLatestCycle(cycles);
  return !!latest && !latest.endDate;
}

export function getCurrentCycleDay(
  cycles: CycleEntry[],
  today: Date,
): number | null {
  const latest = getLatestCycle(cycles);
  if (!latest) return null;
  const days = daysBetweenIso(latest.startDate, toLocalIsoDate(today));
  return days >= 0 ? days + 1 : null;
}

export function getPredictedNextPeriod(
  cycles: CycleEntry[],
  avgCycleLength: number,
): string | null {
  const latest = getLatestCycle(cycles);
  if (!latest) return null;
  return addDaysIso(latest.startDate, avgCycleLength);
}

export function getDaysUntilNextPeriod(
  cycles: CycleEntry[],
  avgCycleLength: number,
  today: Date,
): number | null {
  const predicted = getPredictedNextPeriod(cycles, avgCycleLength);
  if (!predicted) return null;
  return daysBetweenIso(toLocalIsoDate(today), predicted);
}

export interface FertileWindow {
  start: string;
  end: string;
  ovulation: string;
}

export function getFertileWindow(
  cycles: CycleEntry[],
  avgCycleLength: number,
  lutealPhaseLength: number,
): FertileWindow | null {
  const predicted = getPredictedNextPeriod(cycles, avgCycleLength);
  if (!predicted) return null;
  const ovulation = addDaysIso(predicted, -lutealPhaseLength);
  return {
    start: addDaysIso(ovulation, -5),
    end: addDaysIso(ovulation, 1),
    ovulation,
  };
}

export type CyclePhase = "menstrual" | "follicular" | "fertile" | "luteal";

export function getCurrentPhase(
  cycles: CycleEntry[],
  avgCycleLength: number,
  lutealPhaseLength: number,
  today: Date,
): CyclePhase | null {
  if (isCurrentlyOnPeriod(cycles)) return "menstrual";
  const fertile = getFertileWindow(cycles, avgCycleLength, lutealPhaseLength);
  const todayIso = toLocalIsoDate(today);
  if (fertile && todayIso >= fertile.start && todayIso <= fertile.end)
    return "fertile";
  if (fertile && todayIso > fertile.end) return "luteal";
  return "follicular";
}

export function getAverageCycleLength(cycles: CycleEntry[]): number | null {
  const sorted = [...cycles].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
  if (sorted.length < 2) return null;
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    diffs.push(daysBetweenIso(sorted[i - 1].startDate, sorted[i].startDate));
  }
  return Math.round(diffs.reduce((sum, d) => sum + d, 0) / diffs.length);
}

export function getPhaseForCycleDay(
  cycleDayNumber: number,
  avgCycleLength: number,
  periodLength: number,
  lutealPhaseLength: number,
): CyclePhase {
  const normalizedDay =
    ((((cycleDayNumber - 1) % avgCycleLength) + avgCycleLength) %
      avgCycleLength) +
    1;
  if (normalizedDay <= periodLength) return "menstrual";
  const ovulationDay = avgCycleLength - lutealPhaseLength;
  const fertileStart = ovulationDay - 5;
  const fertileEnd = ovulationDay + 1;
  if (normalizedDay >= fertileStart && normalizedDay <= fertileEnd)
    return "fertile";
  if (normalizedDay > fertileEnd) return "luteal";
  return "follicular";
}

export function getAveragePeriodLength(
  cycles: CycleEntry[],
  fallback = 5,
): number {
  const completed = cycles.filter((c) => c.endDate);
  if (completed.length === 0) return fallback;

  const total = completed.reduce((sum, c) => {
    const days = daysBetweenIso(c.startDate, c.endDate!) + 1;
    return sum + days;
  }, 0);

  return Math.round(total / completed.length);
}
