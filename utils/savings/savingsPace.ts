import {
  MINOR_UNITS_PER_MAJOR_UNIT,
  minorUnits,
  subtractMinorUnits,
  sumMinorUnits,
  type MinorUnits,
} from "@/core/money/minorUnits";
import { SavingsContribution, SavingsGoal } from "@/types/savingsGoal";
import { parseCalendarDate, todayIso } from "@/utils/shared/localDate";

// Beregner det gennemsnitlige, positive bidrag per måned baseret på historik,
// og bruger det til at estimere, hvornår målet nås ved samme tempo.
// Udtræk og overførsler ud tæller ikke med i tempoet (uændret regel).
export function estimateMonthsToGoal(
  goal: SavingsGoal,
  history: SavingsContribution[],
): number | null {
  const remaining = subtractMinorUnits(goal.targetAmount, goal.savedAmount);
  if (remaining <= 0) return 0; // allerede nået

  const goalHistory = history.filter(
    (h) => h.goalId === goal.id && h.amount > 0,
  );
  if (goalHistory.length === 0) return null; // intet tempo at basere estimatet på

  const sorted = [...goalHistory].sort((a, b) => a.date.localeCompare(b.date));
  const firstDate = new Date(sorted[0].date);
  const now = new Date();
  const monthsElapsed = Math.max(
    1,
    (now.getFullYear() - firstDate.getFullYear()) * 12 +
      (now.getMonth() - firstDate.getMonth()) +
      1,
  );

  const totalContributed = sumMinorUnits(goalHistory.map((h) => h.amount));
  const avgPerMonth = totalContributed / monthsElapsed; // afledt tempo i øre/måned, ikke et kanonisk beløb

  if (avgPerMonth <= 0) return null;

  return Math.ceil(remaining / avgPerMonth);
}

/**
 * APP-043: en deadline der er passeret, uden at målet er nået. Datoerne er
 * kalenderdatoer ('YYYY-MM-DD'), så de sammenlignes som tekst — aldrig via
 * `new Date()`, der ville læse dem som UTC og kunne skubbe måneden.
 */
export function isDeadlineOverdue(goal: SavingsGoal, today: string = todayIso()): boolean {
  if (!goal.deadline || parseCalendarDate(goal.deadline) === null) return false;
  return goal.deadline < today && subtractMinorUnits(goal.targetAmount, goal.savedAmount) > 0;
}

/**
 * Hele kalendermåneder tilbage at spare i, hvor den indeværende måned tæller som
 * én. Null uden en læsbar deadline, og null når deadlinen er passeret: der er
 * ingen måneder tilbage, og det skal ikke se ud som om der er én.
 */
export function monthsUntilDeadline(goal: SavingsGoal, today: string = todayIso()): number | null {
  if (!goal.deadline || goal.deadline < today) return null;
  const deadline = parseCalendarDate(goal.deadline);
  const current = parseCalendarDate(today);
  if (!deadline || !current) return null;
  return Math.max(
    1,
    (deadline.year - current.year) * 12 + (deadline.month - current.month),
  );
}

// Hvis en deadline er sat: hvor meget skal der spares op per måned for at nå den?
// Returnerer en afledt rate i øre/måned (kan være brøkdel) — ikke et kanonisk beløb.
// 0 når målet er nået (også overfinansieret); null når deadlinen er passeret.
export function requiredMonthlyAmount(goal: SavingsGoal, today: string = todayIso()): number | null {
  if (!goal.deadline) return null;
  const remaining = subtractMinorUnits(goal.targetAmount, goal.savedAmount);
  if (remaining <= 0) return 0;

  const monthsLeft = monthsUntilDeadline(goal, today);
  if (monthsLeft === null) return null;

  return remaining / monthsLeft;
}

/** Visning af en afledt månedsrate: nærmeste hele krone, som skærmen viste før APP-040 (toFixed(0)). */
export function monthlyRateForDisplay(rateInMinorUnits: number): MinorUnits {
  return minorUnits(Math.round(rateInMinorUnits / MINOR_UNITS_PER_MAJOR_UNIT) * MINOR_UNITS_PER_MAJOR_UNIT);
}
