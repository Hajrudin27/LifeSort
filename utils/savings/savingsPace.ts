import { SavingsContribution, SavingsGoal } from "@/types/savingsGoal";

// Beregner det gennemsnitlige, positive bidrag per måned baseret på historik,
// og bruger det til at estimere, hvornår målet nås ved samme tempo.
export function estimateMonthsToGoal(
  goal: SavingsGoal,
  history: SavingsContribution[],
): number | null {
  const remaining = goal.targetAmount - goal.savedAmount;
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

  const totalContributed = goalHistory.reduce((sum, h) => sum + h.amount, 0);
  const avgPerMonth = totalContributed / monthsElapsed;

  if (avgPerMonth <= 0) return null;

  return Math.ceil(remaining / avgPerMonth);
}

// Hvis en deadline er sat: hvor meget skal der spares op per måned for at nå den?
export function requiredMonthlyAmount(goal: SavingsGoal): number | null {
  if (!goal.deadline) return null;
  const remaining = goal.targetAmount - goal.savedAmount;
  if (remaining <= 0) return 0;

  const now = new Date();
  const deadline = new Date(goal.deadline);
  const monthsLeft = Math.max(
    1,
    (deadline.getFullYear() - now.getFullYear()) * 12 +
      (deadline.getMonth() - now.getMonth()),
  );

  return remaining / monthsLeft;
}
