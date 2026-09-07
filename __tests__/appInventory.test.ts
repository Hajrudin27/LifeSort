/// <reference types="node" />

import fs from 'fs';
import path from 'path';

/**
 * APP-001 — holder docs/app-inventory.md sand.
 *
 * Inventaret er kun noget værd, hvis det matcher koden. Testen læser dokumentet
 * og sammenligner med filsystemet, så en ny route, store eller komponent ikke
 * kan snige sig ind uden en ejer og et modul ("ingen ukendte production
 * modules"). Fejler den, er svaret at tilføje rækken — ikke at slække testen.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(REPO_ROOT, 'docs', 'app-inventory.md');
const DOC = fs.readFileSync(DOC_PATH, 'utf8');

/** Værdier fra DataSensitivity i master-specifikationen (§4.1). */
const SENSITIVITY_VALUES = ['ordinary', 'personal', 'financial', 'health', 'document'];

/** Kildemapper der må tale med Supabase. */
const CODE_DIRS = ['app', 'store', 'utils', 'hooks', 'components', 'lib'];

function listFiles(dir: string, matches: (file: string) => boolean): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (matches(full)) found.push(path.relative(REPO_ROOT, full));
    }
  };
  walk(path.join(REPO_ROOT, dir));
  return found.sort();
}

/** Trækker rækkerne ud af én markeret tabel i dokumentet. */
function tableRows(section: string): string[][] {
  const start = `<!-- inventory:${section}:start -->`;
  const end = `<!-- inventory:${section}:end -->`;
  const from = DOC.indexOf(start);
  const to = DOC.indexOf(end);
  if (from === -1 || to === -1) throw new Error(`docs/app-inventory.md mangler afsnittet "${section}"`);

  return DOC.slice(from + start.length, to)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map((line) => line.slice(1, line.lastIndexOf('|')).split('|').map((cell) => cell.trim()))
    .filter((cells) => !/^-+$/.test(cells[0].replace(/\s/g, '')))
    .slice(1); // header
}

const clean = (cell: string) => cell.replace(/`/g, '').trim();

const moduleRows = tableRows('modules');
const routeRows = tableRows('routes');
const storeRows = tableRows('stores');
const tableInventoryRows = tableRows('tables');
const componentRows = tableRows('components');

const declaredModules = new Set(moduleRows.map((cells) => clean(cells[0])));

function expectValidSensitivity(cell: string, where: string) {
  const values = clean(cell).split(',').map((value) => value.trim()).filter(Boolean);
  expect(values.length).toBeGreaterThan(0);
  for (const value of values) {
    if (!SENSITIVITY_VALUES.includes(value)) {
      throw new Error(`${where}: ukendt sensitivity "${value}" (tilladt: ${SENSITIVITY_VALUES.join(', ')})`);
    }
  }
}

describe('docs/app-inventory.md — module register', () => {
  it('erklærer mindst ét modul, med sensitivity og ejer', () => {
    expect(moduleRows.length).toBeGreaterThan(0);
    for (const cells of moduleRows) {
      expectValidSensitivity(cells[5], `modul ${clean(cells[0])}`);
      expect(clean(cells[6])).not.toBe('');
    }
  });
});

describe('docs/app-inventory.md — routes', () => {
  const actualRoutes = listFiles('app', (file) => file.endsWith('.tsx'));
  const documentedRoutes = routeRows.map((cells) => clean(cells[1]));

  it('dækker alle route-filer under app/ og ingen andre', () => {
    // Nye routes uden en række = ukendt production module.
    expect(documentedRoutes.slice().sort()).toEqual(actualRoutes);
  });

  it('har ingen dubletter', () => {
    expect(new Set(documentedRoutes).size).toBe(documentedRoutes.length);
  });

  it('tilskriver hver route et modul fra §1', () => {
    for (const cells of routeRows) {
      const moduleId = clean(cells[2]);
      if (!declaredModules.has(moduleId)) {
        throw new Error(`${clean(cells[1])}: ukendt modul "${moduleId}" — tilføj det til §1 Module register`);
      }
    }
  });

  it('navngiver kun stores der findes og er inventeret i §3', () => {
    const documentedStores = new Set(storeRows.map((cells) => clean(cells[0])));
    for (const cells of routeRows) {
      const stores = clean(cells[3]).split('<br>').map((s) => s.trim()).filter((s) => s && s !== '–');
      for (const store of stores) {
        expect(fs.existsSync(path.join(REPO_ROOT, 'store', `${store}.ts`))).toBe(true);
        expect(documentedStores.has(store)).toBe(true);
      }
    }
  });

  it('har gyldig sensitivity og en ejer på hver route', () => {
    for (const cells of routeRows) {
      expectValidSensitivity(cells[4], clean(cells[1]));
      expect(clean(cells[5])).not.toBe('');
    }
  });
});

describe('docs/app-inventory.md — stores', () => {
  const actualStores = listFiles('store', (file) => file.endsWith('.ts'));
  const documentedStoreFiles = storeRows.map((cells) => clean(cells[1]));

  it('dækker alle filer i store/ og ingen andre', () => {
    expect(documentedStoreFiles.slice().sort()).toEqual(actualStores);
  });

  it('tilskriver hver store et modul fra §1, med sensitivity og ejer', () => {
    for (const cells of storeRows) {
      const moduleId = clean(cells[2]);
      if (!declaredModules.has(moduleId)) {
        throw new Error(`${clean(cells[1])}: ukendt modul "${moduleId}" — tilføj det til §1 Module register`);
      }
      expectValidSensitivity(cells[6], clean(cells[1]));
      expect(clean(cells[7])).not.toBe('');
    }
  });
});

describe('docs/app-inventory.md — Supabase tables', () => {
  const documentedTables = new Set(tableInventoryRows.map((cells) => clean(cells[0])));

  /** Tabeller koden faktisk rører. Array.from(...) rammes ikke af mønstret. */
  function tablesReferencedInCode(): string[] {
    const referenced = new Set<string>();
    for (const dir of CODE_DIRS) {
      for (const file of listFiles(dir, (f) => f.endsWith('.ts') || f.endsWith('.tsx'))) {
        const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
        for (const match of source.matchAll(/\.from\(['"]([a-z][a-z0-9_]*)['"]\)/g)) {
          referenced.add(match[1]);
        }
      }
    }
    return [...referenced].sort();
  }

  it('inventerer hver tabel som koden kalder .from() på', () => {
    const missing = tablesReferencedInCode().filter((table) => !documentedTables.has(table));
    expect(missing).toEqual([]);
  });

  it('har sensitivity og ejer på hver tabel', () => {
    for (const cells of tableInventoryRows) {
      expectValidSensitivity(cells[3], clean(cells[0]));
      expect(clean(cells[4])).not.toBe('');
    }
  });
});

describe('docs/app-inventory.md — shared components', () => {
  const actualComponents = listFiles('components', (file) => file.endsWith('.ts') || file.endsWith('.tsx'));
  const documentedComponents = componentRows.map((cells) => clean(cells[1]));

  it('dækker alle filer i components/ og ingen andre', () => {
    expect(documentedComponents.slice().sort()).toEqual(actualComponents);
  });

  it('har en ejer på hver komponent', () => {
    for (const cells of componentRows) {
      expect(clean(cells[3])).not.toBe('');
    }
  });
});
