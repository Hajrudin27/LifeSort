import {
  absMinorUnits,
  subtractMinorUnits,
  sumMinorUnits,
  type MinorUnits,
} from "@/core/money/minorUnits";
import { SavingsContribution } from "@/types/savingsGoal";

/**
 * APP-043: the facts the savings history chart draws, as text for everyone who
 * cannot read the line (screen readers, and anyone else). Counts and sums of
 * the recorded history only — no trend words, no judgement.
 */
export type SavingsHistorySummary = {
  readonly count: number;
  /** ISO timestamps of the earliest and latest movement. */
  readonly firstDate: string;
  readonly lastDate: string;
  /** Sum of positive movements: deposits, allocations and transfers in. */
  readonly added: MinorUnits;
  /** Magnitude of negative movements: withdrawals and transfers out. */
  readonly takenOut: MinorUnits;
  readonly net: MinorUnits;
};

export function summarizeSavingsHistory(
  contributions: readonly SavingsContribution[],
): SavingsHistorySummary | null {
  if (contributions.length === 0) return null;
  // Same order the chart draws in.
  const sorted = [...contributions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const added = sumMinorUnits(sorted.filter((c) => c.amount > 0).map((c) => c.amount));
  const takenOut = absMinorUnits(sumMinorUnits(sorted.filter((c) => c.amount < 0).map((c) => c.amount)));
  return {
    count: sorted.length,
    firstDate: sorted[0].date,
    lastDate: sorted[sorted.length - 1].date,
    added,
    takenOut,
    net: subtractMinorUnits(added, takenOut),
  };
}
