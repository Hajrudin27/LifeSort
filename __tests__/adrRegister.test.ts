/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import { ADR_GOVERNED_PATHS, isGoverned, needsAdr } from '../scripts/check-adr';

/**
 * APP-007 — holder ADR-registret brugbart.
 *
 * Et register med huller, døde links eller en "superseded"-ADR der ikke siger
 * af hvad, er værre end ingenting: man tror man kan slå beslutningen op.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const ADR_DIR = path.join(REPO_ROOT, 'docs', 'adr');
const STATUSES = ['Proposed', 'Accepted', 'Superseded', 'Deprecated'];

type Adr = {
  file: string;
  id: number;
  title: string;
  fields: Record<string, string>;
};

function readAdrs(): Adr[] {
  return fs
    .readdirSync(ADR_DIR)
    .filter((file) => /^\d{4}-.+\.md$/.test(file))
    .sort()
    .map((file) => {
      const source = fs.readFileSync(path.join(ADR_DIR, file), 'utf8');
      const heading = source.match(/^#\s+ADR-(\d{4}):\s*(.+)$/m);
      if (!heading) throw new Error(`${file}: mangler en "# ADR-NNNN: titel"-overskrift`);

      const fields: Record<string, string> = {};
      for (const match of source.matchAll(/^\|\s*\*\*(.+?)\*\*\s*\|\s*(.*?)\s*\|$/gm)) {
        fields[match[1]] = match[2];
      }

      return { file, id: Number(heading[1]), title: heading[2].trim(), fields };
    });
}

const adrs = readAdrs();
const readme = fs.readFileSync(path.join(ADR_DIR, 'README.md'), 'utf8');

describe('docs/adr — registrets form', () => {
  it('indeholder ADR\'er', () => {
    expect(adrs.length).toBeGreaterThan(0);
  });

  it('har status, dato, ejer og story på hver ADR', () => {
    for (const adr of adrs) {
      for (const field of ['Status', 'Date', 'Owner', 'Story']) {
        if (!adr.fields[field]) throw new Error(`${adr.file}: mangler feltet "${field}"`);
      }
    }
  });

  it('bruger kun kendte statusser', () => {
    for (const adr of adrs) {
      expect(STATUSES).toContain(adr.fields.Status);
    }
  });

  it('har en rigtig ISO-dato', () => {
    for (const adr of adrs) {
      expect(adr.fields.Date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(adr.fields.Date))).toBe(false);
    }
  });

  it('nummererer fortløbende fra 0001 uden huller', () => {
    // Et hul betyder som regel en ADR der er slettet i stedet for at blive
    // afløst — og så er begrundelsen væk.
    expect(adrs.map((adr) => adr.id)).toEqual(adrs.map((_, index) => index + 1));
  });

  it('har filnavn og overskrift der peger på samme nummer', () => {
    for (const adr of adrs) {
      expect(adr.file.startsWith(String(adr.id).padStart(4, '0'))).toBe(true);
    }
  });

  it('lader en afløst ADR sige af hvad', () => {
    for (const adr of adrs) {
      if (adr.fields.Status !== 'Superseded') continue;
      const successor = adr.fields['Superseded by'];
      expect(successor).toBeTruthy();
      expect(successor).not.toBe('–');
      // Efterfølgeren skal findes — ellers er sporet dødt.
      const id = successor.match(/ADR-(\d{4})/)?.[1];
      expect(id).toBeTruthy();
      expect(adrs.some((candidate) => candidate.id === Number(id))).toBe(true);
    }
  });
});

describe('docs/adr/README.md — indekset', () => {
  it('viser hver eneste ADR', () => {
    const missing = adrs.filter((adr) => !readme.includes(`(./${adr.file})`));
    expect(missing.map((adr) => adr.file)).toEqual([]);
  });

  it('linker ikke til ADR\'er der ikke findes', () => {
    const linked = [...readme.matchAll(/\(\.\/(\d{4}-[^)]+\.md)\)/g)].map((match) => match[1]);
    const dead = linked.filter((file) => !fs.existsSync(path.join(ADR_DIR, file)));
    expect(dead).toEqual([]);
  });

  it('gengiver status og dato som ADR\'en selv siger', () => {
    // Ellers siger indekset "Accepted" om noget der for længst er afløst.
    for (const adr of adrs) {
      const row = readme.split('\n').find((line) => line.includes(`(./${adr.file})`));
      expect(row).toBeTruthy();
      expect(row).toContain(adr.fields.Status);
      expect(row).toContain(adr.fields.Date);
    }
  });
});

describe('scripts/check-adr.js — reglen om storage/sync/auth', () => {
  it('peger kun på stier der findes', () => {
    // En regel der vogter en mappe som ikke eksisterer, vogter ingenting. Undtaget
    // er core/-mapperne, som først opstår efterhånden som filerne flytter (ADR-0003).
    const notYetMigrated = ['core/storage/', 'core/sync/', 'core/auth/'];
    const dead = ADR_GOVERNED_PATHS.filter(
      (pattern) => !notYetMigrated.includes(pattern) && !fs.existsSync(path.join(REPO_ROOT, pattern)),
    );
    expect(dead).toEqual([]);
  });

  it('dækker de tre områder acceptkriteriet nævner', () => {
    expect(isGoverned('store/useExpensesStore.ts')).toBe(true);
    expect(isGoverned('utils/auth/secureSessionStorage.ts')).toBe(true);
    expect(isGoverned('utils/shared/syncQueue.ts')).toBe(true);
    expect(isGoverned('lib/supabase.ts')).toBe(true);
    expect(isGoverned('supabase/migrations/20260907120000_module_flags.sql')).toBe(true);
  });

  it('lader almindelige ændringer være i fred', () => {
    for (const file of ['app/(tabs)/index.tsx', 'components/Button.tsx', 'utils/food/mealPlanning.ts']) {
      expect(isGoverned(file)).toBe(false);
    }
  });

  it('kræver en ADR når et styret område ændres', () => {
    expect(needsAdr(['store/useExpensesStore.ts']).ok).toBe(false);
    expect(needsAdr(['store/useExpensesStore.ts', 'docs/adr/0008-noget.md']).ok).toBe(true);
    expect(needsAdr(['components/Button.tsx']).ok).toBe(true);
    expect(needsAdr([]).ok).toBe(true);
  });
});
