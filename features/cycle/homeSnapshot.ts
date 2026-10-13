import type { HomeSnapshot } from '@/core/modules/moduleRegistry';
import { whenStoresHydrated } from '@/core/storage/storeHydration';
import { useCycleStore } from '@/store/useCycleStore';
import { getCurrentCycleDay, getDaysUntilNextPeriod, getPredictedNextPeriod } from '@/utils/cycle/cyclePredictions';
import { toLocalIsoDate } from '@/utils/shared/localDate';

/**
 * Cyklus-modulets kort til Home (APP-011).
 *
 * Det eneste helbredskort på Home. Det viser cyklusdag og dage til næste —
 * ingen symptomer, ingen noter. Klassificeringen 'health' er det, der lader
 * APP-013 give brugeren en maskeret udgave til når skærmen ses af andre.
 */
export async function cycleHomeSnapshot(): Promise<HomeSnapshot | null> {
  await whenStoresHydrated([useCycleStore]);

  const now = new Date();
  const state = useCycleStore.getState();

  const cycleDay = getCurrentCycleDay(state.cycles, now);
  if (cycleDay === null) {
    return {
      moduleId: 'cycle',
      titleKey: 'home.cycleSnapshotLabel',
      helperKey: 'home.cycleSnapshotMissing',
      priority: 'normal',
      sensitivity: 'health',
      route: '/cycle',
    };
  }

  const daysUntilNext = getDaysUntilNextPeriod(state.cycles, state.avgCycleLength, now);
  const predictedNext = getPredictedNextPeriod(state.cycles, state.avgCycleLength);
  const predictionIsStale = predictedNext !== null && predictedNext < toLocalIsoDate(now);

  return {
    moduleId: 'cycle',
    titleKey: 'home.cycleSnapshotLabel',
    value: `${cycleDay}`,
    helperKey: predictionIsStale ? 'home.cycleSnapshotStale' : daysUntilNext !== null ? 'home.cycleSnapshotHelper' : 'home.cycleSnapshotMissing',
    helperParams: !predictionIsStale && daysUntilNext !== null ? { days: daysUntilNext } : undefined,
    priority: 'normal',
    sensitivity: 'health',
    route: '/cycle',
  };
}
