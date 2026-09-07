import type { HomeSnapshot } from '@/core/modules/moduleRegistry';
import { useTripsStore } from '@/store/useTripsStore';
import { daysUntil } from '@/utils/shared/dateDays';
import { todayIso } from '@/utils/shared/localDate';

/** Rejse-modulets kort til Home (APP-011): hvor længe til næste tur. */
export async function travelHomeSnapshot(): Promise<HomeSnapshot | null> {
  const today = todayIso();
  const upcoming = [...useTripsStore.getState().trips]
    .filter((trip) => trip.startDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];

  if (!upcoming) {
    return {
      moduleId: 'travel',
      titleKey: 'home.tripSnapshotLabel',
      value: undefined,
      helperKey: 'home.tripSnapshotMissing',
      priority: 'normal',
      sensitivity: 'ordinary',
      route: '/travel',
    };
  }

  return {
    moduleId: 'travel',
    titleKey: 'home.tripSnapshotLabel',
    valueKey: 'home.tripSnapshotValueDays',
    valueParams: { days: daysUntil(upcoming.startDate) },
    // Rejsens navn er brugerens eget indhold. Det stod der også før, men nu er
    // det klassificeret, så APP-013 kan lade brugeren skjule det.
    helperKey: 'home.tripSnapshotHelperNamed',
    helperParams: { name: upcoming.name },
    priority: 'normal',
    sensitivity: 'personal',
    route: '/travel',
  };
}
