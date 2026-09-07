import type { ModuleId } from './moduleRegistry';
import { listModules } from './moduleRegistry';

/**
 * Hvilket modul en rute hører til (APP-006).
 *
 * Kill switchen skal virke uanset hvordan brugeren kom frem: fra et tab, fra en
 * hub, fra en notifikation eller fra et deep link. Derfor slås modulet op ud fra
 * selve stien ét sted, frem for at hver skærm skal huske at spørge.
 *
 * Præfikserne kommer fra registret (APP-009), så en rute-rod kun står ét sted.
 * De sorteres efter længde, så det mest specifikke match vinder uanset hvilken
 * rækkefølge modulerne står i registret — rækkefølgen i en tabel er en dårlig
 * ting at lade korrekthed afhænge af.
 */
const ROUTE_PREFIXES: ReadonlyArray<readonly [string, ModuleId]> = listModules()
  .flatMap((module) => module.routeRoots.map((root) => [root, module.id] as const))
  .sort((a, b) => b[0].length - a[0].length);

/**
 * Alt der ikke matcher, er skallen: Home, søgning, livs-hubben, modal og
 * 404-siden. At falde tilbage til core-shell er det sikre valg — skallen kan
 * ikke slås fra, så en ukendt sti kan aldrig blive spærret ved et uheld.
 */
export function moduleForPath(pathname: string): ModuleId {
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  for (const [prefix, moduleId] of ROUTE_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return moduleId;
  }
  return 'core-shell';
}

/**
 * Er ruten en skærm der opretter eller retter noget?
 *
 * Bruges når et modul er i maintenance: modulet er åbent og læsbart, men skal
 * ikke tage imod nyt. Repoet navngiver konsekvent opret-skærme `new` og de to
 * rette-skærme `edit`, så det kan afgøres ét sted ud fra stien.
 *
 * Grænsen for hvad det fanger: en `[id]`-skærm der BÅDE viser og retter — fx
 * /habits/abc — bliver ikke fanget her, for den er også den eneste vej til at
 * læse posten. At spærre den ville tage læseadgangen med. Den slags skal hvert
 * modul selv skrue ned via canCreate/canEdit. Se docs/kill-switches.md.
 */
export function isWriteRoute(pathname: string): boolean {
  const segments = pathname.split('?')[0].split('/').filter(Boolean);
  return segments.includes('new') || segments.includes('edit');
}
