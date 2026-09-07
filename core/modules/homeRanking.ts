import type { HomeSnapshot, ModuleId } from './moduleRegistry';
import { MODULE_IDS } from './moduleRegistry';

/**
 * Rækkefølgen på Home (APP-012).
 *
 * Reglen er specifikationens §6.1: fastgjort > presserende > senest brugt. Og
 * lige så vigtigt, hvad reglen IKKE er. Der er ingen engagement-score, ingen
 * tilfældighed, ingen kunstig hastværk og ingen belønning for at åbne appen
 * ofte. Home skal være et overblik, brugeren kan forudsige — ikke et feed, der
 * prøver at holde på hende. Se ADR-0011.
 *
 * Funktionen er ren og totalt ordnet: samme input giver altid samme
 * rækkefølge, helt ned til sidste plads.
 */

export type HomeLayoutPreferences = {
  /** Fastgjorte moduler, i brugerens egen rækkefølge. Det er "reorder". */
  pinned: ModuleId[];
  /** Moduler brugeren har taget af Home. Skjuler kortet — ikke modulet. */
  hidden: ModuleId[];
  /** Hvornår brugeren sidst åbnede modulet. ISO-tid. */
  lastOpenedAt: Partial<Record<ModuleId, string>>;
};

export const EMPTY_HOME_LAYOUT: HomeLayoutPreferences = {
  pinned: [],
  hidden: [],
  lastOpenedAt: {},
};

const PRIORITY_ORDER: Record<HomeSnapshot['priority'], number> = {
  urgent: 0,
  important: 1,
  normal: 2,
};

/** Registret afgør sidste stik, så to ens kort aldrig bytter plads tilfældigt. */
const registryIndex = (moduleId: ModuleId) => MODULE_IDS.indexOf(moduleId);

export function rankHomeSnapshots(
  snapshots: HomeSnapshot[],
  preferences: HomeLayoutPreferences = EMPTY_HOME_LAYOUT,
): HomeSnapshot[] {
  const hidden = new Set(preferences.hidden);
  const visible = snapshots.filter((snapshot) => !hidden.has(snapshot.moduleId));

  const pinnedRank = new Map(preferences.pinned.map((moduleId, index) => [moduleId, index]));

  return [...visible].sort((a, b) => {
    // 1. Fastgjort, i brugerens rækkefølge. Brugerens valg slår alt andet —
    //    ellers er det ikke rigtigt hendes.
    const pinnedA = pinnedRank.get(a.moduleId);
    const pinnedB = pinnedRank.get(b.moduleId);
    if (pinnedA !== undefined || pinnedB !== undefined) {
      if (pinnedA === undefined) return 1;
      if (pinnedB === undefined) return -1;
      if (pinnedA !== pinnedB) return pinnedA - pinnedB;
    }

    // 2. Presserende. Kommer fra data — en overtrukket konto — ikke fra en
    //    beslutning om at gøre noget mere iøjnefaldende.
    const priority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priority !== 0) return priority;

    // 3. Senest brugt. Aldrig åbnet sorterer sidst blandt ligemænd.
    const openedA = preferences.lastOpenedAt[a.moduleId] ?? '';
    const openedB = preferences.lastOpenedAt[b.moduleId] ?? '';
    if (openedA !== openedB) return openedA < openedB ? 1 : -1;

    // 4. Registerrækkefølge. Gør resultatet totalt ordnet.
    return registryIndex(a.moduleId) - registryIndex(b.moduleId);
  });
}

/** Modulerne der er taget af Home, i registerrækkefølge — så listen er stabil. */
export function hiddenModuleIds(preferences: HomeLayoutPreferences): ModuleId[] {
  return MODULE_IDS.filter((moduleId) => preferences.hidden.includes(moduleId));
}
