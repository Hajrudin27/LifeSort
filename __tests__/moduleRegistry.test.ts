/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import { MODULE_AVAILABILITY_STATES, evaluateModuleAccess } from '@/core/modules/moduleAvailability';
import {
  getModule,
  listModules,
  MODULE_IDS,
  MODULE_REGISTRY,
  type ModuleId,
  moduleAccess,
  PLATFORM_MODULE_IDS,
} from '@/core/modules/moduleRegistry';
import { moduleForPath } from '@/core/modules/moduleRoutes';

/**
 * APP-009 — registret er kun ét sted at slå op, hvis det er DET sted.
 *
 * Testen holder det i sync med docs/app-inventory.md og med de moduler der
 * faktisk har ruter og påmindelser, så et modul ikke kan eksistere i koden uden
 * at være registreret — eller stå i registret uden at findes.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const INVENTORY = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'app-inventory.md'), 'utf8');
const SENSITIVITY_VALUES = ['ordinary', 'personal', 'financial', 'health', 'document'];
const NOTIFICATION_CATEGORIES = ['ordinary', 'personal', 'financial', 'health', 'security'];

function inventoryRows(section: string): string[][] {
  const start = INVENTORY.indexOf(`<!-- inventory:${section}:start -->`);
  const end = INVENTORY.indexOf(`<!-- inventory:${section}:end -->`);
  return INVENTORY.slice(start, end)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map((line) => line.slice(1, line.lastIndexOf('|')).split('|').map((cell) => cell.replace(/`/g, '').trim()))
    .filter((cells) => !/^-+$/.test(cells[0].replace(/\s/g, '')))
    .slice(1);
}

const parseList = (cell: string) => cell.split(',').map((value) => value.trim()).filter(Boolean).sort();

describe('kontrakten', () => {
  it('registrerer hvert modul under sit eget id', () => {
    for (const moduleId of MODULE_IDS) {
      expect(MODULE_REGISTRY[moduleId].id).toBe(moduleId);
    }
    expect(Object.keys(MODULE_REGISTRY).sort()).toEqual([...MODULE_IDS].sort());
    expect(listModules()).toHaveLength(MODULE_IDS.length);
  });

  it('giver hvert modul en gyldig tilstand og mindst én sensitivity', () => {
    for (const module of listModules()) {
      expect(MODULE_AVAILABILITY_STATES).toContain(module.availability);
      expect(module.sensitivity.length).toBeGreaterThan(0);
      for (const value of module.sensitivity) expect(SENSITIVITY_VALUES).toContain(value);
    }
  });

  it('bruger kun kendte notifikationsklasser', () => {
    for (const module of listModules()) {
      if (!module.notificationCategory) continue;
      expect(NOTIFICATION_CATEGORIES).toContain(module.notificationCategory);
    }
  });

  it('lader ikke selve appen blive slået fra', () => {
    for (const moduleId of PLATFORM_MODULE_IDS) {
      expect(getModule(moduleId).availability).toBe('available');
      expect(moduleAccess(moduleId).canOpenModule).toBe(true);
    }
  });

  it('slår op gennem den samme evaluator som alt andet', () => {
    // Ellers ville registret kunne svare noget andet end kill switchen gør.
    for (const moduleId of MODULE_IDS) {
      expect(moduleAccess(moduleId)).toEqual(evaluateModuleAccess(getModule(moduleId).availability));
    }
  });
});

describe('registret mod docs/app-inventory.md §1', () => {
  const rows = inventoryRows('modules');

  it('kender præcis de moduler inventaret erklærer', () => {
    expect(rows.map((cells) => cells[0]).sort()).toEqual([...MODULE_IDS].sort());
  });

  it('er enig med inventaret om tilstand og sensitivity', () => {
    for (const cells of rows) {
      const module = getModule(cells[0] as ModuleId);
      expect(module.availability).toBe(cells[2].split('—')[0].trim());
      expect(module.sensitivity.slice().sort()).toEqual(parseList(cells[5]));
    }
  });
});

describe('rute-rødder', () => {
  it('ejes af præcis ét modul', () => {
    const seen = new Map<string, ModuleId>();
    for (const module of listModules()) {
      for (const root of module.routeRoots) {
        expect(seen.has(root)).toBe(false);
        seen.set(root, module.id);
      }
    }
  });

  it('slår op i det modul der ejer dem', () => {
    for (const module of listModules()) {
      for (const root of module.routeRoots) {
        expect(moduleForPath(root)).toBe(module.id);
        expect(moduleForPath(`${root}/noget/dybere`)).toBe(module.id);
      }
    }
  });

  it('giver skallen ingen rute-rødder — den er fallback', () => {
    expect(getModule('core-shell').routeRoots).toEqual([]);
    expect(moduleForPath('/en-helt-ukendt-sti')).toBe('core-shell');
  });

  it('dækker hver rute inventaret kender', () => {
    // Uden det her kunne et modul få en ny rute-rod uden at registret vidste
    // det — og så ville kill switchen ikke gælde den rute.
    const wrong = inventoryRows('routes')
      .filter((cells) => !/(_layout|\+html|\+not-found)/.test(cells[1]))
      .filter((cells) => moduleForPath(cells[0]) !== cells[2])
      .map((cells) => `${cells[0]} → ${moduleForPath(cells[0])}, inventaret siger ${cells[2]}`);
    expect(wrong).toEqual([]);
  });
});

describe('notifikationsklasser', () => {
  it('er sat på hvert modul der rent faktisk planlægger påmindelser', () => {
    // Modulerne med en *Reminder.ts sender noget til låseskærmen, og så skal
    // registret vide hvor privat det er. Se docs/shared-primitives.md §4.
    const modulesWithReminders: ModuleId[] = ['cycle', 'economy', 'travel', 'warranties'];
    for (const moduleId of modulesWithReminders) {
      expect(getModule(moduleId).notificationCategory).toBeTruthy();
    }
  });

  it('holder helbred i sin egen klasse', () => {
    // En cyklus-påmindelse må aldrig arve almindelig låseskærms-tekst.
    expect(getModule('cycle').notificationCategory).toBe('health');
  });
});

describe('valgfrie handlers', () => {
  it('er endnu ikke implementeret nogen steder', () => {
    // Registret erklærer formen; APP-011, APP-077 og APP-097/098 fylder den ud.
    // Fejler den her, er en handler landet — og så skal forventningen opdateres
    // sammen med den story der leverede den.
    for (const module of listModules()) {
      expect(module.homeSnapshot).toBeUndefined();
      expect(module.searchEntries).toBeUndefined();
      expect(module.exportHandler).toBeUndefined();
      expect(module.deleteHandler).toBeUndefined();
    }
  });
});

describe('visningsnøgler', () => {
  it('kan slås op på både dansk og engelsk', () => {
    // Et modul uden navn kan ikke vises i "Mine moduler" eller i en launcher.
    // Manglende nøgler viser sig ellers først som rå nøgletekst på skærmen.
    for (const locale of ['da', 'en']) {
      const copy = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'localization', 'locales', locale, 'modules.json'), 'utf8'),
      );
      for (const module of listModules()) {
        for (const key of [module.titleKey, module.descriptionKey]) {
          const value = key.replace(/^modules\./, '').split('.').reduce<any>((node, part) => node?.[part], copy);
          if (typeof value !== 'string' || value.trim() === '') {
            throw new Error(`${locale}: mangler oversættelse for "${key}"`);
          }
        }
      }
    }
  });
});
