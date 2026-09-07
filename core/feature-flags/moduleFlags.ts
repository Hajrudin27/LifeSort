/**
 * Kill switches for moduler (APP-006).
 *
 * Et fejlramt modul skal kunne stoppes uden en ny store-udgivelse. Serveren
 * leverer en tilstand pr. modul, som lægges oven på den kompilerede default fra
 * core/modules/moduleAvailability.ts.
 *
 * Alt herinde er rent — parsing og sammenlægning, ingen netværk. Selve hentningen
 * ligger i store/useModuleFlagsStore.ts, så reglerne kan testes uden en server,
 * og så et svar fra serveren behandles som det, det er: input udefra.
 *
 * To ting må et flag aldrig kunne:
 *   1. Låse brugeren ude af appen. core-shell og account afvises altid.
 *   2. Gøre eksisterende data utilgængelige. Det håndhæves af evaluatoren i
 *      APP-005, som er den eneste vej fra tilstand til rettigheder.
 */

import { MODULE_AVAILABILITY_STATES, type ModuleAvailability } from '@/core/modules/moduleAvailability';
import {
  getModule,
  MODULE_IDS,
  type ModuleId,
  PLATFORM_MODULE_IDS,
} from '@/core/modules/moduleRegistry';

/** Rækker fra serveren, oversat til de flag appen tør bruge. */
export type ModuleFlagOverrides = Partial<Record<ModuleId, ModuleAvailability>>;

const KNOWN_MODULE_IDS = new Set<string>(MODULE_IDS);
const KNOWN_STATES = new Set<string>(MODULE_AVAILABILITY_STATES);
const PLATFORM = new Set<string>(PLATFORM_MODULE_IDS);

/** Ét modul må ikke kunne slås fra, hvis det er selve appen. */
export function isKillable(moduleId: string): boolean {
  return KNOWN_MODULE_IDS.has(moduleId) && !PLATFORM.has(moduleId);
}

/**
 * Oversætter serverens svar til flag. Alt der ikke er genkendeligt, droppes i
 * stilhed frem for at kaste: en enkelt dårlig række må ikke koste appen alle de
 * andre flag — og slet ikke få den til at crashe ved opstart.
 *
 * Bemærk retningen på tvivlen: ukendt input giver INGEN ændring, altså den
 * kompilerede default. Et flag kan derfor kun få effekt, hvis det er forstået.
 */
export function parseModuleFlags(rows: unknown): ModuleFlagOverrides {
  if (!Array.isArray(rows)) return {};

  const overrides: ModuleFlagOverrides = {};

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;

    const { module_id: moduleId, availability } = row as Record<string, unknown>;
    if (typeof moduleId !== 'string' || typeof availability !== 'string') continue;

    // Ukendt modul: sandsynligvis en nyere app-version end den her. Ignorér.
    if (!KNOWN_MODULE_IDS.has(moduleId)) continue;
    // Ukendt tilstand: samme. Må ALDRIG falde tilbage til 'available'.
    if (!KNOWN_STATES.has(availability)) continue;
    // Platformen kan ikke slukkes, uanset hvad serveren påstår.
    if (!isKillable(moduleId)) continue;

    overrides[moduleId as ModuleId] = availability as ModuleAvailability;
  }

  return overrides;
}

/**
 * Den tilstand der gælder lige nu: serverens flag, ellers den kompilerede
 * default. Er der ingen forbindelse, er `overrides` det sidst kendte svar fra
 * disk — et lukket modul bliver altså ved med at være lukket offline.
 */
export function resolveModuleAvailability(
  moduleId: ModuleId,
  overrides: ModuleFlagOverrides,
): ModuleAvailability {
  return overrides[moduleId] ?? getModule(moduleId).availability;
}
