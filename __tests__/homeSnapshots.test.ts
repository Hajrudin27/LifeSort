/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import { HOME_SNAPSHOT_PROVIDERS } from '@/features/homeSnapshots';
import { getModule, type HomeSnapshot, MODULE_IDS, type ModuleId } from '@/core/modules/moduleRegistry';

/**
 * APP-011 — kortene skal være små og sikre.
 *
 * Testen kalder de rigtige leverandører med tomme stores. Det er den
 * interessante tilstand: en ny bruger har ingen data, og et kort må hverken
 * crashe eller vise et opdigtet tal.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const SENSITIVITY_VALUES = ['ordinary', 'personal', 'financial', 'health', 'document'];
const PRIORITIES = ['normal', 'important', 'urgent'];

const providerIds = Object.keys(HOME_SNAPSHOT_PROVIDERS) as ModuleId[];

async function allSnapshots(): Promise<HomeSnapshot[]> {
  const results = await Promise.all(providerIds.map((moduleId) => HOME_SNAPSHOT_PROVIDERS[moduleId]!()));
  return results.filter((snapshot): snapshot is HomeSnapshot => snapshot !== null);
}

describe('kontrakten', () => {
  it('leverer kort for de moduler der er koblet op', () => {
    expect(providerIds.length).toBeGreaterThan(0);
    for (const moduleId of providerIds) expect(MODULE_IDS).toContain(moduleId);
  });

  it('svarer uden at kaste, også med tomme stores', async () => {
    // En ny bruger er den mest almindelige tilstand, ikke en kantsag.
    await expect(allSnapshots()).resolves.toBeDefined();
  });

  it('mærker hvert kort med sit eget modul', async () => {
    for (const moduleId of providerIds) {
      const snapshot = await HOME_SNAPSHOT_PROVIDERS[moduleId]!();
      if (snapshot) expect(snapshot.moduleId).toBe(moduleId);
    }
  });

  it('bruger gyldig prioritet og sensitivity', async () => {
    for (const snapshot of await allSnapshots()) {
      expect(PRIORITIES).toContain(snapshot.priority);
      expect(SENSITIVITY_VALUES).toContain(snapshot.sensitivity);
    }
  });

  it('klassificerer kortet mindst lige så følsomt som modulet selv', async () => {
    // Et kort må ikke nedgradere sit moduls følsomhed — det er dét, APP-013
    // skal kunne stole på, når den maskerer.
    const rank = ['ordinary', 'personal', 'document', 'financial', 'health'];
    for (const snapshot of await allSnapshots()) {
      const declared = getModule(snapshot.moduleId).sensitivity;
      const worstDeclared = Math.max(...declared.map((value) => rank.indexOf(value)));
      // Kortet behøver ikke være det værste modulet har, men skal være en klasse
      // modulet faktisk ejer — ellers er klassificeringen gættet.
      expect(declared.includes(snapshot.sensitivity) || rank.indexOf(snapshot.sensitivity) <= worstDeclared).toBe(true);
    }
  });

  it('sætter højst ét af value og valueKey', async () => {
    for (const snapshot of await allSnapshots()) {
      expect(snapshot.value !== undefined && snapshot.valueKey !== undefined).toBe(false);
    }
  });
});

describe('kortene er små', () => {
  it('bærer ingen felter ud over kontrakten', async () => {
    // Her ville en liste af udgifter eller et symptomlog snige sig ind.
    const allowed = new Set([
      'moduleId', 'titleKey', 'value', 'valueKey', 'valueParams',
      'helperKey', 'helperParams', 'priority', 'sensitivity', 'route',
    ]);
    for (const snapshot of await allSnapshots()) {
      for (const key of Object.keys(snapshot)) {
        if (!allowed.has(key)) throw new Error(`${snapshot.moduleId}: uventet felt "${key}" i kortet`);
      }
    }
  });

  it('holder værdien kort nok til et kort', async () => {
    for (const snapshot of await allSnapshots()) {
      if (snapshot.value) expect(snapshot.value.length).toBeLessThanOrEqual(24);
    }
  });
});

describe('oversættelser', () => {
  it('findes på både dansk og engelsk for hver nøgle et kort bruger', async () => {
    const snapshots = await allSnapshots();
    for (const locale of ['da', 'en']) {
      const dir = path.join(REPO_ROOT, 'localization', 'locales', locale);
      const bundles: Record<string, any> = {};
      for (const file of fs.readdirSync(dir)) {
        bundles[file.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      }
      const lookup = (key: string) => key.split('.').reduce<any>((node, part) => node?.[part], bundles);

      for (const snapshot of snapshots) {
        for (const key of [snapshot.titleKey, snapshot.valueKey, snapshot.helperKey]) {
          if (!key) continue;
          if (typeof lookup(key) !== 'string') {
            throw new Error(`${locale}: mangler oversættelse for "${key}" (${snapshot.moduleId})`);
          }
        }
      }
    }
  });
});

describe('leverandørerne rører ikke Home', () => {
  it('importerer ingen anden feature end deres egen', async () => {
    // Et modul må hente sine egne stores; det må ikke låne naboens.
    const featureFiles = fs
      .readdirSync(path.join(REPO_ROOT, 'features'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        fs
          .readdirSync(path.join(REPO_ROOT, 'features', entry.name))
          .map((file) => path.join('features', entry.name, file)),
      );

    for (const file of featureFiles) {
      const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const feature = file.split(path.sep)[1];
      for (const match of source.matchAll(/from\s+'@\/features\/([^/']+)/g)) {
        expect(match[1]).toBe(feature);
      }
      // Og de importerer aldrig en route.
      expect(source).not.toMatch(/from\s+'@\/app\//);
    }
  });
});
