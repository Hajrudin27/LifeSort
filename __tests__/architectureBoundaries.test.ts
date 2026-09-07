/// <reference types="node" />

import fs from 'fs';
import path from 'path';

/**
 * APP-003 — arkitekturens afhængighedsregler.
 *
 * Formålet er ikke at rette den kobling der allerede findes, men at fryse den:
 * et modul der ikke kan isoleres, kan hverken slås fra, testes for sig eller
 * få sin egen storage-profil senere.
 *
 * Modulejerskabet slås op i docs/app-inventory.md (APP-001) frem for at blive
 * gentaget her — ét sted at rette, når et modul flytter sig.
 *
 * De kendte overtrædelser står i BASELINE nedenfor. Listen må kun blive
 * kortere: en ny overtrædelse fejler med det samme, og retter man en gammel,
 * fejler testen også, indtil linjen er fjernet herfra. Tilføj ALDRIG en ny
 * linje til BASELINE for at få en test til at blive grøn — så er reglen væk.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const INVENTORY = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'app-inventory.md'), 'utf8');

/** Moduler der udgør platformen. Deres stores må bruges fra hvor som helst. */
const PLATFORM_MODULES = ['core-shell', 'account'];

/**
 * utils-mapper der er platformservices frem for domænelogik. clearAllLocalData
 * (logout) og dataBackup (eksport) rører nødvendigvis alle domæner i dag; de
 * bliver til registry-opslag i APP-009/APP-021.
 */
const PLATFORM_UTILS_DIRS = ['shared', 'auth'];

/**
 * Kendt kobling pr. 2026-09-07. Må kun skrumpe.
 * Se docs/app-inventory.md §8-F4, §8-F5 og §8-F6.
 */
const BASELINE = [
  // Home læser elleve domæner direkte. Erstattes af homeSnapshot() i APP-011.
  'app/(tabs)/index.tsx -> useCycleStore',
  'app/(tabs)/index.tsx -> useExpensesStore',
  'app/(tabs)/index.tsx -> useFoodStore',
  'app/(tabs)/index.tsx -> useHabitsStore',
  'app/(tabs)/index.tsx -> useHouseholdStore',
  'app/(tabs)/index.tsx -> useIncomeStore',
  'app/(tabs)/index.tsx -> useSavingsGoalsStore',
  'app/(tabs)/index.tsx -> useTodoStore',
  'app/(tabs)/index.tsx -> useTripsStore',
  'app/(tabs)/index.tsx -> useWarrantiesStore',

  // Rod-layoutet henter alle domæner efter login. Erstattes af module registry i APP-009.
  'app/_layout.tsx -> useCVStore',
  'app/_layout.tsx -> useCareerStore',
  'app/_layout.tsx -> useCategoriesStore',
  'app/_layout.tsx -> useCycleStore',
  'app/_layout.tsx -> useExpensesStore',
  'app/_layout.tsx -> useFoodStore',
  'app/_layout.tsx -> useHabitsStore',
  'app/_layout.tsx -> useHouseholdStore',
  'app/_layout.tsx -> useIncomeStore',
  'app/_layout.tsx -> useLifeGoalsStore',
  'app/_layout.tsx -> useSavingsGoalsStore',
  'app/_layout.tsx -> useTodoStore',
  'app/_layout.tsx -> useTripsStore',
  'app/_layout.tsx -> useWarrantiesStore',

  // Livs-hubben samler fem domæner. Erstattes af module launcher i APP-015.
  'app/(tabs)/life.tsx -> useCareerStore',
  'app/(tabs)/life.tsx -> useHabitsStore',
  'app/(tabs)/life.tsx -> useHouseholdStore',
  'app/(tabs)/life.tsx -> useLifeGoalsStore',
  'app/(tabs)/life.tsx -> useTodoStore',

  // Søgning crawler fem stores direkte. Erstattes af searchEntries() i APP-077.
  'app/search.tsx -> useExpensesStore',
  'app/search.tsx -> useHabitsStore',
  'app/search.tsx -> useLifeGoalsStore',
  'app/search.tsx -> useTodoStore',
  'app/search.tsx -> useWarrantiesStore',

  // Økonomi-fanen samler tal fra tre andre moduler. Erstattes af det fælles
  // finansielle read model i APP-039.
  'app/(tabs)/economy.tsx -> useFoodStore',
  'app/(tabs)/economy.tsx -> useTripsStore',
  'app/(tabs)/economy.tsx -> useWarrantiesStore',

  // Sundhedsdata læst fra opgavemodulet. Værst i listen — se APP-071.
  'app/todos/new.tsx -> useCycleStore',

  // Cykelkortet viser data fra tre fremmede domæner.
  'components/CycleInsightsCard.tsx -> useFoodStore',
  'components/CycleInsightsCard.tsx -> useHabitsStore',
  'components/CycleInsightsCard.tsx -> useTodoStore',
];

function inventoryRows(section: string): string[][] {
  const start = `<!-- inventory:${section}:start -->`;
  const end = `<!-- inventory:${section}:end -->`;
  const from = INVENTORY.indexOf(start);
  const to = INVENTORY.indexOf(end);
  if (from === -1 || to === -1) throw new Error(`docs/app-inventory.md mangler afsnittet "${section}"`);

  return INVENTORY.slice(from + start.length, to)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map((line) => line.slice(1, line.lastIndexOf('|')).split('|').map((cell) => cell.replace(/`/g, '').trim()))
    .filter((cells) => !/^-+$/.test(cells[0].replace(/\s/g, '')))
    .slice(1);
}

function listFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full)) found.push(path.relative(REPO_ROOT, full));
    }
  };
  walk(path.join(REPO_ROOT, dir));
  return found.sort();
}

function importsOf(file: string): string[] {
  const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

/** Stores en fil importerer, uanset om de bruges som hook eller getState(). */
function storesUsedBy(file: string): string[] {
  const used = importsOf(file)
    .map((specifier) => specifier.match(/^@\/store\/(use[A-Za-z]+Store)$/)?.[1])
    .filter((store): store is string => Boolean(store));
  return [...new Set(used)].sort();
}

const storeModule = new Map(inventoryRows('stores').map((cells) => [cells[0], cells[2]]));
const routeModule = new Map(inventoryRows('routes').map((cells) => [cells[1], cells[2]]));
const componentModule = new Map(inventoryRows('components').map((cells) => [cells[1], cells[2]]));

const platformStores = new Set(
  [...storeModule.entries()].filter(([, module]) => PLATFORM_MODULES.includes(module)).map(([store]) => store),
);

/** Alle overtrædelser af R1 og R4, som "fil -> store". */
function crossModuleStoreUse(): string[] {
  const found: string[] = [];

  const check = (file: string, owningModule: string | null) => {
    for (const store of storesUsedBy(file)) {
      if (platformStores.has(store)) continue;
      if (owningModule && storeModule.get(store) === owningModule) continue;
      found.push(`${file} -> ${store}`);
    }
  };

  for (const [file, module] of routeModule) check(file, module);
  for (const [file, module] of componentModule) {
    // "shared" og "shared (…)" er fælles design system — kun platform-stores.
    check(file, module.startsWith('shared') ? null : module);
  }
  for (const file of listFiles('hooks')) check(file, null);

  return found.sort();
}

describe('R1+R4 — moduler forbliver isolerbare', () => {
  const violations = crossModuleStoreUse();
  const baseline = new Set(BASELINE);

  it('ingen ny kobling til et fremmed moduls store', () => {
    const added = violations.filter((violation) => !baseline.has(violation));
    if (added.length > 0) {
      throw new Error(
        'Ny cross-module store-import:\n' +
          added.map((line) => `  ${line}`).join('\n') +
          '\n\nBrug modulets eget read contract i stedet — se docs/architecture-rules.md.',
      );
    }
    expect(added).toEqual([]);
  });

  it('BASELINE indeholder ingen forældede undtagelser', () => {
    // Retter man en kobling, skal linjen væk herfra — ellers skrumper listen aldrig.
    const stale = BASELINE.filter((entry) => !violations.includes(entry));
    expect(stale).toEqual([]);
  });

  it('BASELINE har ingen dubletter', () => {
    expect(baseline.size).toBe(BASELINE.length);
  });
});

describe('R2 — stores kender ikke til UI', () => {
  it('ingen store importerer fra app/, components/ eller hooks/', () => {
    const violations: string[] = [];
    for (const file of listFiles('store')) {
      for (const specifier of importsOf(file)) {
        if (/^@\/(app|components|hooks)\//.test(specifier)) violations.push(`${file} -> ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('R3 — stores kobler ikke domæner sammen', () => {
  it('en store importerer kun platform-stores', () => {
    const violations: string[] = [];
    for (const file of listFiles('store')) {
      const self = path.basename(file, '.ts');
      for (const store of storesUsedBy(file)) {
        if (store === self || platformStores.has(store)) continue;
        violations.push(`${file} -> ${store}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('R5 — domænelogik er fri for state', () => {
  it('utils/<domæne>/ importerer ingen store', () => {
    const violations: string[] = [];
    for (const file of listFiles('utils')) {
      const domain = file.split(path.sep)[1];
      if (PLATFORM_UTILS_DIRS.includes(domain)) continue;
      for (const store of storesUsedBy(file)) violations.push(`${file} -> ${store}`);
    }
    expect(violations).toEqual([]);
  });
});
