import type { HomeSnapshotProviders } from '@/core/modules/homeSnapshots';

import { cycleHomeSnapshot } from './cycle/homeSnapshot';
import { economyHomeSnapshot } from './economy/homeSnapshot';
import { foodHomeSnapshot } from './food/homeSnapshot';
import { travelHomeSnapshot } from './travel/homeSnapshot';

/**
 * Hvor modulerne rækkes ind til skallen (APP-011).
 *
 * Kernen må ikke kende et modul (ADR-0003), og Home må ikke kende et moduls
 * store (ADR-0002). Sammensætningen sker derfor her, ét sted, med typede
 * funktioner som eneste berøringsflade.
 *
 * Modulerne uden et kort har ikke glemt det: hvad Home ellers skal vise, er en
 * beslutning om Home selv — rangering hører til APP-012, launcheren til
 * APP-015. Se docs/home-snapshots.md.
 */
export const HOME_SNAPSHOT_PROVIDERS: HomeSnapshotProviders = {
  economy: economyHomeSnapshot,
  food: foodHomeSnapshot,
  travel: travelHomeSnapshot,
  cycle: cycleHomeSnapshot,
};
