/// <reference types="node" />

import fs from 'fs';
import path from 'path';

/**
 * APP-020 — appen gætter ikke længere, hvilke moduler nogen har brug for.
 *
 * Cyklus-modulet blev vist, hvis profilens køn var 'female'. Det var en
 * udledning fra et demografisk felt, og den slags rammer altid nogen forkert:
 * kvinden der ikke ønsker modulet, og alle andre der gør. Nu er det et valg.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

function sourceFiles(dirs: string[]): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full)) found.push(path.relative(REPO_ROOT, full));
    }
  };
  for (const dir of dirs) walk(path.join(REPO_ROOT, dir));
  return found.sort();
}

/**
 * De eneste steder køn stadig må læses: hvor brugeren selv redigerer feltet, og
 * farvetonerne. Tonerne er ikke modul-udledning, men de er heller ikke et
 * stærkt formål — noteret som D2 i docs/data-sdk-inventory.md.
 */
const ALLOWED_GENDER_READERS = [
  'app/settings/profile.tsx',
  'hooks/useAccentTints.ts',
  'hooks/useBrandTints.ts',
  'hooks/useLifeModuleTints.ts',
  'hooks/useModuleTints.ts',
  'store/useProfileStore.ts',
  'types/profile.ts',
];

describe('intet modul udledes af køn', () => {
  it('ingen skærm sammenligner køn for at afgøre, hvad der vises', () => {
    const offenders = sourceFiles(['app', 'components', 'core', 'features'])
      .filter((file) => /gender\s*===|===\s*['"]female['"]|===\s*['"]male['"]/.test(read(file)))
      .filter((file) => !ALLOWED_GENDER_READERS.includes(file));

    expect(offenders).toEqual([]);
  });

  it('cyklus-fanen følger modulvalget', () => {
    const layout = read('app/(tabs)/_layout.tsx');
    expect(layout).toContain("const showCycleTab = useModuleEnabled('cycle')");
    expect(layout).not.toMatch(/gender/);
  });

  it('faseoplysningen i gøremål følger også modulvalget', () => {
    const screen = read('app/todos/new.tsx');
    expect(screen).toContain("cycleEnabled && dueDate");
    expect(screen).not.toMatch(/gender/);
  });

  it('holder listen over tilladte læsere kort', () => {
    // Vokser den, er det værd at spørge hvorfor feltet overhovedet indsamles.
    for (const file of ALLOWED_GENDER_READERS) {
      expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(true);
    }
    expect(ALLOWED_GENDER_READERS.length).toBeLessThanOrEqual(7);
  });
});

describe('onboarding spørger om moduler', () => {
  it('slutter med modulvalget', () => {
    expect(read('app/onboarding-profile.tsx')).toContain('router.push("/onboarding-modules")');
    expect(read('app/onboarding-modules.tsx')).toContain('markOnboarded()');
  });

  it('spørger ikke om køn undervejs', () => {
    // Feltet afgør ingenting længere, så det hører ikke til i vejen ind.
    expect(read('app/onboarding-profile.tsx')).not.toMatch(/gender/i);
    expect(read('app/onboarding-modules.tsx')).not.toMatch(/gender/i);
  });

  it('viser samme liste som Indstillinger', () => {
    // Ét sted at beskrive et modul, så de to lister ikke kan sige forskelligt.
    for (const file of ['app/onboarding-modules.tsx', 'app/settings/modules.tsx']) {
      expect(read(file)).toContain('<ModuleChoiceList />');
    }
  });

  it('lader valget kunne ændres bagefter', () => {
    // Acceptkriteriets "selection editable later".
    expect(read('app/(tabs)/settings.tsx')).toContain('/settings/modules');
  });
});

describe('migrationen bevarer den nuværende oplevelse', () => {
  const migration = read('supabase/migrations/20260907150000_seed_cycle_module_choice.sql');

  it('oversætter den gamle udledning til et eksplicit valg', () => {
    expect(migration).toMatch(/insert into public\.user_modules/);
    expect(migration).toMatch(/'cycle'/);
    expect(migration).toMatch(/gender = 'female'/);
  });

  it('rører ikke et valg, brugeren allerede har truffet', () => {
    expect(migration).toMatch(/where not exists/);
  });
});
