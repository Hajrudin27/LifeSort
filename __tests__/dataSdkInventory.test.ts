/// <reference types="node" />

import fs from 'fs';
import path from 'path';

/**
 * APP-002 — holder docs/data-sdk-inventory.md sand.
 *
 * Store-formularerne (App Privacy, Data Safety, privacy manifest) udledes af det
 * her dokument. Hvis en ny afhængighed kan snige sig ind uden en række, holder
 * formularerne op med at matche koden — og så er de i bedste fald forkerte og i
 * værste fald en afvisning i review. Fejler testen, er svaret at tilføje rækken
 * og tage stilling til dens privacy-konsekvens.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const DOC_PATH = path.join(REPO_ROOT, 'docs', 'data-sdk-inventory.md');
const DOC = fs.readFileSync(DOC_PATH, 'utf8');
const APP_INVENTORY = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'app-inventory.md'), 'utf8');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

/** Samme legende som docs/app-inventory.md §7 og specifikationens DataSensitivity. */
const SENSITIVITY_VALUES = ['ordinary', 'personal', 'financial', 'health', 'document'];

/** Hvor en datatype ligger. Fast vokabular, så "local-ish" ikke opstår. */
const LOCATION_VALUES = ['local', 'local+cloud', 'cloud', 'device-os'];

function tableRows(doc: string, section: string): string[][] {
  const start = `<!-- inventory:${section}:start -->`;
  const end = `<!-- inventory:${section}:end -->`;
  const from = doc.indexOf(start);
  const to = doc.indexOf(end);
  if (from === -1 || to === -1) throw new Error(`Dokumentet mangler afsnittet "${section}"`);

  return doc
    .slice(from + start.length, to)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map((line) => line.slice(1, line.lastIndexOf('|')).split('|').map((cell) => cell.trim()))
    .filter((cells) => !/^-+$/.test(cells[0].replace(/\s/g, '')))
    .slice(1); // header
}

const clean = (cell: string) => cell.replace(/`/g, '').trim();

const dataRows = tableRows(DOC, 'data');
const sdkRows = tableRows(DOC, 'sdk');

describe('docs/data-sdk-inventory.md — datatyper', () => {
  it('inventerer mindst én datatype', () => {
    expect(dataRows.length).toBeGreaterThan(0);
  });

  it('har purpose, location, vendor, retention og begge store-kategorier på hver række', () => {
    // Præcis de felter APP-002 kræver. En tom celle er en udokumenteret datatype.
    const required: [number, string][] = [
      [0, 'datatype'],
      [1, 'modul'],
      [2, 'purpose'],
      [3, 'location'],
      [4, 'vendor'],
      [5, 'retention'],
      [6, 'sensitivity'],
      [7, 'Apple App Privacy'],
      [8, 'Google Data Safety'],
    ];
    for (const cells of dataRows) {
      for (const [index, label] of required) {
        if (clean(cells[index] ?? '') === '') {
          throw new Error(`"${clean(cells[0])}": ${label} mangler`);
        }
      }
    }
  });

  it('bruger kun kendte location-værdier', () => {
    for (const cells of dataRows) {
      const location = clean(cells[3]);
      if (!LOCATION_VALUES.includes(location)) {
        throw new Error(`"${clean(cells[0])}": ukendt location "${location}" (tilladt: ${LOCATION_VALUES.join(', ')})`);
      }
    }
  });

  it('bruger kun sensitivity-værdier fra den fælles legende', () => {
    for (const cells of dataRows) {
      const values = clean(cells[6]).split(',').map((value) => value.trim()).filter(Boolean);
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        if (!SENSITIVITY_VALUES.includes(value)) {
          throw new Error(`"${clean(cells[0])}": ukendt sensitivity "${value}"`);
        }
      }
    }
  });

  it('henviser kun til moduler der er erklæret i docs/app-inventory.md', () => {
    const declaredModules = new Set(tableRows(APP_INVENTORY, 'modules').map((cells) => clean(cells[0])));
    for (const cells of dataRows) {
      const moduleId = clean(cells[1]);
      if (moduleId === 'shared') continue; // data der deles af flere moduler, fx vedhæftninger
      if (!declaredModules.has(moduleId)) {
        throw new Error(`"${clean(cells[0])}": ukendt modul "${moduleId}" — se docs/app-inventory.md §1`);
      }
    }
  });
});

describe('docs/data-sdk-inventory.md — SDK-inventar', () => {
  const documented = sdkRows.map((cells) => clean(cells[0]));
  const dependencies = Object.keys(PACKAGE_JSON.dependencies).sort();

  it('dækker præcis de afhængigheder der ryger med i app-bundtet', () => {
    // Ny dependency uden en række = en SDK der aldrig er blevet privacy-vurderet.
    expect(documented.slice().sort()).toEqual(dependencies);
  });

  it('har ingen dubletter', () => {
    expect(new Set(documented).size).toBe(documented.length);
  });

  it('angiver den version der faktisk står i package.json', () => {
    for (const cells of sdkRows) {
      const pkg = clean(cells[0]);
      expect(clean(cells[1])).toBe(PACKAGE_JSON.dependencies[pkg]);
    }
  });

  it('har vendor, purpose og et eksplicit ja/nej for transmission', () => {
    for (const cells of sdkRows) {
      expect(clean(cells[2])).not.toBe(''); // vendor
      expect(clean(cells[3])).not.toBe(''); // purpose
      expect(clean(cells[4])).not.toBe(''); // data touched
      expect(['Yes', 'No']).toContain(clean(cells[5]).split(' ')[0].replace(/[—-].*/, ''));
      expect(clean(cells[6])).not.toBe(''); // store disclosure impact
    }
  });
});
