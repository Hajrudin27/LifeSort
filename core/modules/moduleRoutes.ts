import type { ModuleId } from './moduleAvailability';

/**
 * Hvilket modul en rute hører til (APP-006).
 *
 * Kill switchen skal virke uanset hvordan brugeren kom frem: fra et tab, fra en
 * hub, fra en notifikation eller fra et deep link. Derfor slås modulet op ud fra
 * selve stien ét sted, frem for at hver skærm skal huske at spørge.
 *
 * Rækkefølgen betyder noget — første match vinder — så mere specifikke præfikser
 * står før de brede. Kortet holdes i sync med docs/app-inventory.md §2 af
 * __tests__/moduleRoutes.test.ts, som tjekker det mod alle ruter i repoet.
 */
const ROUTE_PREFIXES: ReadonlyArray<readonly [string, ModuleId]> = [
  ['/expenses', 'economy'],
  ['/savings', 'economy'],
  ['/economy', 'economy'],
  ['/food', 'food'],
  ['/household', 'home'],
  ['/life-goals', 'goals'],
  ['/habits', 'habits'],
  ['/todos', 'tasks'],
  ['/travel', 'travel'],
  ['/warranties', 'warranties'],
  ['/career', 'career'],
  ['/cycle', 'cycle'],
  ['/settings', 'account'],
  ['/auth', 'account'],
  ['/language', 'account'],
  ['/onboarding-profile', 'account'],
  ['/onboarding-pin', 'account'],
];

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
 * modul selv skrue ned via canCreate/canEdit, når registry'et er på plads
 * (APP-009). Se docs/kill-switches.md.
 */
export function isWriteRoute(pathname: string): boolean {
  const segments = pathname.split('?')[0].split('/').filter(Boolean);
  return segments.includes('new') || segments.includes('edit');
}
