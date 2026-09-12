/**
 * Brugerens valg af moduler (APP-010).
 *
 * Adskilt fra modenhed med vilje. Om et modul er UDGIVET er en platform-
 * beslutning (APP-005/006); om brugeren har VALGT det, er hendes egen. Et modul
 * kan være udgivet og fravalgt, eller valgt og lukket ned af en kill switch —
 * og de to spørgsmål skal kunne besvares hver for sig.
 *
 * Den vigtigste regel: at slå et modul fra skjuler det. Det sletter ingenting.
 * Data bliver liggende både lokalt og i skyen, og et modul der slås til igen,
 * har alt med sig. Se ADR-0004 og ADR-0010.
 */

import { MODULE_IDS, type ModuleId, PLATFORM_MODULE_IDS } from './moduleRegistry';

/** Brugerens valg pr. modul. Et modul der ikke står her, har standardværdien. */
export type ModuleEnablement = Partial<Record<ModuleId, boolean>>;

const KNOWN_MODULE_IDS = new Set<string>(MODULE_IDS);
const PLATFORM = new Set<string>(PLATFORM_MODULE_IDS);

/**
 * Kan modulet overhovedet fravælges? Skallen og kontoen kan ikke — uden dem er
 * der ingen app, og ingen vej til eksport eller sletning af egne data.
 */
export function canToggleModule(moduleId: ModuleId): boolean {
  return !PLATFORM.has(moduleId);
}

/** Moduler brugeren kan vælge mellem. */
export const TOGGLEABLE_MODULE_IDS = MODULE_IDS.filter(canToggleModule);

/**
 * Standarden er "slået til".
 *
 * Valget er bevidst: en eksisterende bruger må ikke miste adgang til noget, hun
 * allerede bruger, fordi en ny funktion blev udrullet. Onboarding må gerne
 * spørge og indsnævre bagefter (APP-020) — men fraværet af et svar må aldrig
 * skjule data, brugeren har lagt ind.
 */
export function isModuleEnabled(moduleId: ModuleId, enablement: ModuleEnablement): boolean {
  if (!canToggleModule(moduleId)) return true;
  return enablement[moduleId] ?? true;
}

export function enabledModuleIds(enablement: ModuleEnablement): ModuleId[] {
  return MODULE_IDS.filter((moduleId) => isModuleEnabled(moduleId, enablement));
}

/**
 * Oversætter serverens rækker til et valg. Som med kill switches droppes alt
 * uforståeligt i stilhed — men bemærk at tvivlen her falder den anden vej:
 * en række vi ikke forstår, efterlader modulet slået TIL. Et ødelagt svar må
 * ikke kunne skjule brugerens data.
 */
/**
 * Et valg der stadig ligger i den holdbare kø, er nyere end enhver række
 * serveren kan svare med — den har jo ikke fået det at vide endnu. En hentning
 * må derfor ikke rulle det tilbage foran brugeren. Se ADR-0032.
 */
export function mergeQueuedModuleEnablement(
  remote: ModuleEnablement,
  local: ModuleEnablement,
  queuedModuleIds: readonly string[],
): ModuleEnablement {
  const merged: ModuleEnablement = { ...remote };

  for (const moduleId of queuedModuleIds) {
    if (!KNOWN_MODULE_IDS.has(moduleId)) continue;
    if (!canToggleModule(moduleId as ModuleId)) continue;

    const choice = local[moduleId as ModuleId];
    // Intet lokalt svar betyder standardværdien, ikke serverens gamle række.
    if (choice === undefined) delete merged[moduleId as ModuleId];
    else merged[moduleId as ModuleId] = choice;
  }

  return merged;
}

export function parseModuleEnablementRows(rows: unknown): ModuleEnablement {
  if (!Array.isArray(rows)) return {};

  const enablement: ModuleEnablement = {};

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;

    const { module_id: moduleId, enabled } = row as Record<string, unknown>;
    if (typeof moduleId !== 'string' || typeof enabled !== 'boolean') continue;
    if (!KNOWN_MODULE_IDS.has(moduleId)) continue;
    if (!canToggleModule(moduleId as ModuleId)) continue;

    enablement[moduleId as ModuleId] = enabled;
  }

  return enablement;
}
