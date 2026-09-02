import { CycleEntry } from "@/types/cycle";

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

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
  const diffMs = today.getTime() - toDate(latest.startDate).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return days >= 0 ? days + 1 : null;
}

export function getPredictedNextPeriod(
  cycles: CycleEntry[],
  avgCycleLength: number,
): string | null {
  const latest = getLatestCycle(cycles);
  if (!latest) return null;
  return toIso(addDays(toDate(latest.startDate), avgCycleLength));
}

export function getDaysUntilNextPeriod(
  cycles: CycleEntry[],
  avgCycleLength: number,
  today: Date,
): number | null {
  const predicted = getPredictedNextPeriod(cycles, avgCycleLength);
  if (!predicted) return null;
  const diffMs = toDate(predicted).getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
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
  const ovulation = addDays(toDate(predicted), -lutealPhaseLength);
  return {
    start: toIso(addDays(ovulation, -5)),
    end: toIso(addDays(ovulation, 1)),
    ovulation: toIso(ovulation),
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
  const todayIso = toIso(today);
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
    const diffMs =
      toDate(sorted[i].startDate).getTime() -
      toDate(sorted[i - 1].startDate).getTime();
    diffs.push(Math.round(diffMs / (1000 * 60 * 60 * 24)));
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
    const days = daysBetween(c.startDate, c.endDate!) + 1;
    return sum + days;
  }, 0);

  return Math.round(total / completed.length);
}
function daysBetween(a: string, b: string): number {
  const diffMs = toDate(b).getTime() - toDate(a).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
