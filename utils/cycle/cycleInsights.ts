import { CycleEntry } from "@/types/cycle";
import { CyclePhase, getPhaseForCycleDay } from "@/utils/cycle/cyclePredictions";

function daysBetween(a: string, b: string): number {
  const diffMs =
    new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Finder hvilken cyklusfase en given dato faldt i, baseret på den nærmeste
// forudgående registrerede cyklusstart — virker for enhver historisk dato,
// ikke kun "i dag" (i modsætning til getCurrentPhase).
export function getPhaseForDate(
  dateKey: string,
  cycles: CycleEntry[],
  avgCycleLength: number,
  periodLength: number,
  lutealPhaseLength: number,
): CyclePhase | null {
  const priorCycles = cycles
    .filter((c) => c.startDate <= dateKey)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const latest = priorCycles[0];
  if (!latest) return null;

  const dayNumber = daysBetween(latest.startDate, dateKey) + 1;
  return getPhaseForCycleDay(
    dayNumber,
    avgCycleLength,
    periodLength,
    lutealPhaseLength,
  );
}

export interface PhaseStat {
  total: number;
  count: number;
  average: number;
}

const EMPTY_PHASE_STATS = (): Record<CyclePhase, PhaseStat> => ({
  menstrual: { total: 0, count: 0, average: 0 },
  follicular: { total: 0, count: 0, average: 0 },
  fertile: { total: 0, count: 0, average: 0 },
  luteal: { total: 0, count: 0, average: 0 },
});

// Grupperer beløb (fx madindkøb) efter hvilken cyklusfase de faldt i.
export function computeAmountsByPhase(
  entries: { date: string; amount: number }[],
  cycles: CycleEntry[],
  avgCycleLength: number,
  periodLength: number,
  lutealPhaseLength: number,
): Record<CyclePhase, PhaseStat> {
  const result = EMPTY_PHASE_STATS();

  for (const entry of entries) {
    const phase = getPhaseForDate(
      entry.date.slice(0, 10),
      cycles,
      avgCycleLength,
      periodLength,
      lutealPhaseLength,
    );
    if (!phase) continue;
    result[phase].total += entry.amount;
    result[phase].count += 1;
  }

  for (const phase of Object.keys(result) as CyclePhase[]) {
    result[phase].average =
      result[phase].count > 0 ? result[phase].total / result[phase].count : 0;
  }

  return result;
}

export interface HabitPhaseStat {
  logged: number;
  possible: number;
  rate: number;
}

// For hver dag, en vane har eksisteret, tjekker vi hvilken fase dagen faldt i,
// og om vanen blev logget den dag — giver en reel gennemførselsrate per fase,
// ikke kun et øjebliksbillede.
export function computeHabitRateByPhase(
  habits: { createdAt: string; logs: { date: string }[] }[],
  cycles: CycleEntry[],
  avgCycleLength: number,
  periodLength: number,
  lutealPhaseLength: number,
  today: Date,
): Record<CyclePhase, HabitPhaseStat> {
  const result: Record<CyclePhase, HabitPhaseStat> = {
    menstrual: { logged: 0, possible: 0, rate: 0 },
    follicular: { logged: 0, possible: 0, rate: 0 },
    fertile: { logged: 0, possible: 0, rate: 0 },
    luteal: { logged: 0, possible: 0, rate: 0 },
  };

  const todayKey = today.toISOString().slice(0, 10);

  for (const habit of habits) {
    const loggedDates = new Set(habit.logs.map((l) => l.date.slice(0, 10)));
    const cursor = new Date(habit.createdAt);

    while (cursor.toISOString().slice(0, 10) <= todayKey) {
      const dateKey = cursor.toISOString().slice(0, 10);
      const phase = getPhaseForDate(
        dateKey,
        cycles,
        avgCycleLength,
        periodLength,
        lutealPhaseLength,
      );
      if (phase) {
        result[phase].possible += 1;
        if (loggedDates.has(dateKey)) result[phase].logged += 1;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  for (const phase of Object.keys(result) as CyclePhase[]) {
    result[phase].rate =
      result[phase].possible > 0
        ? result[phase].logged / result[phase].possible
        : 0;
  }

  return result;
}

export interface CycleInsight {
  key:
    | "foodSpendingHigher"
    | "foodSpendingLower"
    | "habitRateHigher"
    | "habitRateLower"
    | "todoOverdueHigher"
    | "todoOverdueLower";
  phase: CyclePhase;
  percent: number;
}

const MIN_CYCLES = 2;
const MIN_SPEND_SAMPLES = 5;
const MIN_HABIT_SAMPLES = 10;
const MIN_PERCENT_DIFF = 15;

// Sammenligner menstruations- og luteal-fasen mod et "normalt" gennemsnit
// (follikulær + fertil), og returnerer kun mønstre, der er store nok (≥15%)
// og bygger på nok data til at være reelt meningsfulde, ikke støj.
export function generateCycleInsights(
  spendingByPhase: Record<CyclePhase, PhaseStat>,
  habitRateByPhase: Record<CyclePhase, HabitPhaseStat>,
  todoOverdueByPhase: Record<CyclePhase, TodoPhaseStat>,
  cycles: CycleEntry[],
): CycleInsight[] {
  if (cycles.length < MIN_CYCLES) return [];

  const insights: CycleInsight[] = [];
  const comparePhases: CyclePhase[] = ["menstrual", "luteal"];
  const MIN_TODO_SAMPLES = 8;

  const baselineSpend =
    (spendingByPhase.follicular.average + spendingByPhase.fertile.average) / 2;
  if (baselineSpend > 0) {
    for (const phase of comparePhases) {
      const stat = spendingByPhase[phase];
      if (stat.count < MIN_SPEND_SAMPLES) continue;
      const percent = Math.round(
        ((stat.average - baselineSpend) / baselineSpend) * 100,
      );
      if (Math.abs(percent) >= MIN_PERCENT_DIFF) {
        insights.push({
          key: percent > 0 ? "foodSpendingHigher" : "foodSpendingLower",
          phase,
          percent: Math.abs(percent),
        });
      }
    }
  }

  const baselineHabitRate =
    (habitRateByPhase.follicular.rate + habitRateByPhase.fertile.rate) / 2;
  if (baselineHabitRate > 0) {
    for (const phase of comparePhases) {
      const stat = habitRateByPhase[phase];
      if (stat.possible < MIN_HABIT_SAMPLES) continue;
      const percent = Math.round(
        ((stat.rate - baselineHabitRate) / baselineHabitRate) * 100,
      );
      if (Math.abs(percent) >= MIN_PERCENT_DIFF) {
        insights.push({
          key: percent > 0 ? "habitRateHigher" : "habitRateLower",
          phase,
          percent: Math.abs(percent),
        });
      }
    }
  }
  const baselineOverdueRate =
    (todoOverdueByPhase.follicular.rate + todoOverdueByPhase.fertile.rate) / 2;
  if (baselineOverdueRate > 0) {
    for (const phase of comparePhases) {
      const stat = todoOverdueByPhase[phase];
      if (stat.total < MIN_TODO_SAMPLES) continue;
      const percent = Math.round(
        ((stat.rate - baselineOverdueRate) / baselineOverdueRate) * 100,
      );
      if (Math.abs(percent) >= MIN_PERCENT_DIFF) {
        insights.push({
          key: percent > 0 ? "todoOverdueHigher" : "todoOverdueLower",
          phase,
          percent: Math.abs(percent),
        });
      }
    }
  }

  return insights.sort((a, b) => b.percent - a.percent).slice(0, 3);
}

export interface TodoPhaseStat {
  overdue: number;
  total: number;
  rate: number;
}

// For hver opgave med en due date, tjekker vi hvilken fase datoen faldt i,
// og om opgaven endte med at blive overskredet (ikke fuldført, og datoen er passeret).
export function computeTodoOverdueRateByPhase(
  todos: { dueDate?: string; completed: boolean }[],
  cycles: CycleEntry[],
  avgCycleLength: number,
  periodLength: number,
  lutealPhaseLength: number,
  today: Date,
): Record<CyclePhase, TodoPhaseStat> {
  const result: Record<CyclePhase, TodoPhaseStat> = {
    menstrual: { overdue: 0, total: 0, rate: 0 },
    follicular: { overdue: 0, total: 0, rate: 0 },
    fertile: { overdue: 0, total: 0, rate: 0 },
    luteal: { overdue: 0, total: 0, rate: 0 },
  };
  const todayKey = today.toISOString().slice(0, 10);

  for (const todo of todos) {
    if (!todo.dueDate) continue;
    const phase = getPhaseForDate(
      todo.dueDate.slice(0, 10),
      cycles,
      avgCycleLength,
      periodLength,
      lutealPhaseLength,
    );
    if (!phase) continue;
    result[phase].total += 1;
    const isOverdue = !todo.completed && todo.dueDate.slice(0, 10) < todayKey;
    if (isOverdue) result[phase].overdue += 1;
  }

  for (const phase of Object.keys(result) as CyclePhase[]) {
    result[phase].rate =
      result[phase].total > 0 ? result[phase].overdue / result[phase].total : 0;
  }

  return result;
}
