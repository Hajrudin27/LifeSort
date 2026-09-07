/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import {
  evaluateModuleAccess,
  MODULE_AVAILABILITY,
  MODULE_AVAILABILITY_STATES,
  MODULE_IDS,
  moduleAccess,
  type ModuleAvailability,
  type ModuleViewer,
  PLATFORM_MODULE_IDS,
  PUBLIC_VIEWER,
} from '@/core/modules/moduleAvailability';

const INTERNAL: ModuleViewer = { isInternalUser: true, isBetaTester: false };
const BETA: ModuleViewer = { isInternalUser: false, isBetaTester: true };

describe('evaluateModuleAccess — datarettigheder overlever alle tilstande', () => {
  // Specifikationen §1.2: et flag må aldrig gøre eksisterende brugerdata
  // utilgængelige. Testen er udtømmende, så en ny tilstand ikke kan smutte
  // udenom ved at glemme netop de to felter.
  it.each(MODULE_AVAILABILITY_STATES)('%s tillader stadig eksport og sletning', (state) => {
    for (const viewer of [PUBLIC_VIEWER, INTERNAL, BETA]) {
      const access = evaluateModuleAccess(state, viewer);
      expect(access.canExportData).toBe(true);
      expect(access.canDeleteData).toBe(true);
    }
  });

  it('kan aldrig oprette uden også at kunne åbne modulet', () => {
    for (const state of MODULE_AVAILABILITY_STATES) {
      const access = evaluateModuleAccess(state, INTERNAL);
      if (access.canCreate) expect(access.canOpenModule).toBe(true);
    }
  });

  it('viser aldrig et modul i navigationen som ikke kan åbnes', () => {
    for (const state of MODULE_AVAILABILITY_STATES) {
      for (const viewer of [PUBLIC_VIEWER, INTERNAL, BETA]) {
        const access = evaluateModuleAccess(state, viewer);
        if (access.showInNavigation) expect(access.canOpenModule).toBe(true);
      }
    }
  });
});

describe('evaluateModuleAccess — maintenance', () => {
  const access = evaluateModuleAccess('maintenance');

  it('bevarer adgang til det brugeren allerede har lavet', () => {
    expect(access.canOpenModule).toBe(true);
    expect(access.canViewExistingData).toBe(true);
    expect(access.showInNavigation).toBe(true);
  });

  it('sætter nye handlinger på pause', () => {
    expect(access.canCreate).toBe(false);
    expect(access.canEdit).toBe(false);
  });

  it('siger hvorfor, så UI kan vise en tilstand frem for en tom skærm', () => {
    expect(access.status).toBe('maintenance');
  });
});

describe('evaluateModuleAccess — retired', () => {
  const access = evaluateModuleAccess('retired');

  it('fjerner modulets skærme', () => {
    expect(access.showInNavigation).toBe(false);
    expect(access.canOpenModule).toBe(false);
    expect(access.canViewExistingData).toBe(false);
  });

  it('efterlader en vej ud for dataene', () => {
    expect(access.canExportData).toBe(true);
    expect(access.canDeleteData).toBe(true);
    expect(access.status).toBe('retired');
  });
});

describe('evaluateModuleAccess — ikke-frigivne tilstande', () => {
  it('hidden er usynlig for alle, også interne', () => {
    for (const viewer of [PUBLIC_VIEWER, INTERNAL, BETA]) {
      expect(evaluateModuleAccess('hidden', viewer).showInNavigation).toBe(false);
    }
    expect(evaluateModuleAccess('hidden').status).toBe('unreleased');
  });

  it('internal er kun åben for interne brugere', () => {
    expect(evaluateModuleAccess('internal', INTERNAL).canOpenModule).toBe(true);
    expect(evaluateModuleAccess('internal', BETA).canOpenModule).toBe(false);
    expect(evaluateModuleAccess('internal', PUBLIC_VIEWER).status).toBe('internal-only');
  });

  it('beta er åben for beta-testere og interne', () => {
    expect(evaluateModuleAccess('beta', BETA).canOpenModule).toBe(true);
    expect(evaluateModuleAccess('beta', INTERNAL).canOpenModule).toBe(true);
    expect(evaluateModuleAccess('beta', PUBLIC_VIEWER).canOpenModule).toBe(false);
    expect(evaluateModuleAccess('beta', PUBLIC_VIEWER).status).toBe('beta-only');
  });

  it('behandler en ukendt bruger som en helt almindelig bruger', () => {
    // Standardværdien må aldrig give mere adgang end den mindst privilegerede.
    expect(evaluateModuleAccess('beta')).toEqual(evaluateModuleAccess('beta', PUBLIC_VIEWER));
    expect(evaluateModuleAccess('internal')).toEqual(evaluateModuleAccess('internal', PUBLIC_VIEWER));
  });
});

describe('MODULE_AVAILABILITY', () => {
  it('erklærer en tilstand for hvert modul', () => {
    for (const moduleId of MODULE_IDS) {
      expect(MODULE_AVAILABILITY_STATES).toContain(MODULE_AVAILABILITY[moduleId]);
    }
    expect(Object.keys(MODULE_AVAILABILITY).sort()).toEqual([...MODULE_IDS].sort());
  });

  it('lader ikke selve appen blive slået fra', () => {
    // core-shell og account ER appen; et flag på dem ville låse brugeren ude.
    for (const moduleId of PLATFORM_MODULE_IDS) {
      expect(MODULE_AVAILABILITY[moduleId]).toBe('available');
    }
  });

  it('matcher modulerne i docs/app-inventory.md §1', () => {
    const inventory = fs.readFileSync(path.resolve(__dirname, '..', 'docs', 'app-inventory.md'), 'utf8');
    const start = inventory.indexOf('<!-- inventory:modules:start -->');
    const end = inventory.indexOf('<!-- inventory:modules:end -->');
    const rows = inventory
      .slice(start, end)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('|'))
      .map((line) => line.slice(1, line.lastIndexOf('|')).split('|').map((cell) => cell.replace(/`/g, '').trim()))
      .filter((cells) => !/^-+$/.test(cells[0].replace(/\s/g, '')))
      .slice(1);

    expect(rows.map((cells) => cells[0]).sort()).toEqual([...MODULE_IDS].sort());

    // Inventarets "observed availability" er prosa; første ord er tilstanden.
    for (const cells of rows) {
      const observed = cells[2].split('—')[0].trim() as ModuleAvailability;
      expect(MODULE_AVAILABILITY[cells[0] as (typeof MODULE_IDS)[number]]).toBe(observed);
    }
  });
});

describe('moduleAccess', () => {
  it('slår modulets egen tilstand op', () => {
    expect(moduleAccess('economy')).toEqual(evaluateModuleAccess(MODULE_AVAILABILITY.economy));
    expect(moduleAccess('cycle', INTERNAL)).toEqual(evaluateModuleAccess(MODULE_AVAILABILITY.cycle, INTERNAL));
  });
});
