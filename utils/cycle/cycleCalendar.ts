import { CycleEntry } from '@/types/cycle';
import { FertileWindow } from '@/utils/cycle/cyclePredictions';

export type CycleDayType = 'period' | 'fertile' | 'ovulation' | 'predicted' | 'normal';

export function getCycleDayType(
  dateKey: string,
  cycles: CycleEntry[],
  fertileWindow: FertileWindow | null,
  predictedNext: string | null
): CycleDayType {
  const inPeriod = cycles.some((c) => {
    const end = c.endDate ?? c.startDate;
    return dateKey >= c.startDate && dateKey <= end;
  });
  if (inPeriod) return 'period';

  if (fertileWindow?.ovulation === dateKey) return 'ovulation';
  if (fertileWindow && dateKey >= fertileWindow.start && dateKey <= fertileWindow.end) return 'fertile';

  if (predictedNext === dateKey) return 'predicted';

  return 'normal';
}