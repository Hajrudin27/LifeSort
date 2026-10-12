/// <reference types="node" />

import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ts = require('typescript') as typeof import('typescript');

/**
 * APP-020 — appen gætter ikke længere, hvilke moduler nogen har brug for.
 *
 * Cyklus-modulet blev vist, hvis profilens køn var 'female'. Det var en
 * udledning fra et demografisk felt, og den slags rammer altid nogen forkert:
 * kvinden der ikke ønsker modulet, og alle andre der gør. Nu er det et valg.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

/** Finder en migration på dens navn uden tidsstempel — Supabase omdøber dem. */
function readMigration(suffix: string): string {
  const dir = path.join(REPO_ROOT, 'supabase', 'migrations');
  const file = fs.readdirSync(dir).find((name) => name.endsWith(suffix));
  if (!file) throw new Error(`Ingen migration der ender på "${suffix}"`);
  return fs.readFileSync(path.join(dir, file), 'utf8');
}


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
 *
 * Listen skal blive kortere eller blive ved med at være den samme. Den må ikke
 * vokse for at få en test til at bestå (APP-071, ADR-0059).
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

/**
 * Køn og de ord, der står for det. Matcher på træets knuder, ikke på tekst: en kommentar, en
 * oversættelsesfil eller et ord i en JSX-tekst er ikke en læsning, mens `!==`, `switch`,
 * destrukturering, `includes()`, `profile['gender']` og en hjælpefunktion er — fordi de alle nævner
 * feltet ved navn. Én ting kan en syntaktisk vagt ikke se: at en tilladt fil sender feltet videre.
 * Det er derfor listen ovenfor skal være kort.
 */
const GENDER_IDENTIFIER = /gender|^sex$|^is(fe)?male$|^isWom[ae]n$|^is(fe)?malePerson$/i;
// En streng tæller, når den ER en kønsværdi eller en sti til feltet — ikke når et ord optræder i en beskrivelse
// (fx dataprofilregistrets "Display name, optional gender, …", som beskriver data og ikke læser dem).
const GENDER_LITERAL = /^\s*(gender|(fe)?male|wom[ae]n)\s*$|(^|[.[])gender([.\]]|$)/i;

function genderReads(source: string, fileName = 'file.tsx'): string[] {
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];

  const visit = (node: import('typescript').Node) => {
    if (ts.isIdentifier(node) && GENDER_IDENTIFIER.test(node.text)) found.push(node.getText(tree));
    else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && GENDER_LITERAL.test(node.text)
    ) found.push(node.getText(tree));
    ts.forEachChild(node, visit);
  };
  visit(tree);

  return found;
}

const SCANNED_DIRS = ['app', 'components', 'constants', 'core', 'data', 'features', 'hooks', 'lib', 'store', 'types', 'utils'];
const productionFiles = sourceFiles(SCANNED_DIRS);
const readersOf = (files: string[]) => files.filter((file) => genderReads(read(file), file).length > 0);

describe('intet modul udledes af køn', () => {
  it('ingen produktionskode uden for den korte liste nævner køn overhovedet', () => {
    // Hårdere end de tidligere `gender ===`-mønstre: ENHVER læsning tæller — også !==, switch,
    // destrukturering, includes() og en hjælpefunktion.
    expect(productionFiles.length).toBeGreaterThan(100);
    expect(readersOf(productionFiles).filter((file) => !ALLOWED_GENDER_READERS.includes(file))).toEqual([]);
  });

  it('listen over tilladte læsere er præcis dem, der faktisk læser køn', () => {
    // En udgået post er også en fejl: en tilladelse, ingen bruger, er en åben dør.
    expect(readersOf(productionFiles).sort()).toEqual([...ALLOWED_GENDER_READERS].sort());
  });

  it('holder listen over tilladte læsere kort', () => {
    // Vokser den, er det værd at spørge hvorfor feltet overhovedet indsamles.
    for (const file of ALLOWED_GENDER_READERS) {
      expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(true);
    }
    expect(ALLOWED_GENDER_READERS.length).toBeLessThanOrEqual(7);
  });

  it('de tilladte tone-hooks bruger kun køn til farver', () => {
    for (const file of ALLOWED_GENDER_READERS.filter((name) => name.startsWith('hooks/'))) {
      const source = read(file);
      expect(source).toMatch(/Tints/);
      // Ingen modul-, rute- eller tilgængelighedsord: de returnerer en palet og intet andet.
      expect(source).not.toMatch(/useModule(Enabled|Access)|isModuleEnabled|getModule|MODULE_|router|href|notification/);
    }
  });

  it('Cyklus-fanen følger modulvalget', () => {
    const layout = read('app/(tabs)/_layout.tsx');
    expect(layout).toContain("const showCycleTab = useModuleEnabled('cycle')");
    expect(layout).not.toMatch(/gender/);
  });

  it('faseoplysningen i gøremål følger også modulvalget', () => {
    const screen = read('app/todos/new.tsx');
    expect(screen).toContain("cycleEnabled && dueDate");
    expect(screen).not.toMatch(/gender/);
  });

  it('modulvalg, launcher og Cyklus-kode importerer hverken profil-store eller profiltyper', () => {
    // Det er den korte vej til køn: først importeres profilen, så læses feltet. Ingen af disse har brug for den.
    const moduleSurface = [
      ...sourceFiles(['core/modules', 'core/feature-flags', 'features/cycle', 'app/cycle']),
      'app/modules.tsx',
      'app/(tabs)/_layout.tsx',
      'app/(tabs)/cycle.tsx',
      'components/ModuleChoiceList.tsx',
      'components/ModuleGate.tsx',
      'store/useEnabledModulesStore.ts',
      'store/useCycleStore.ts',
    ];
    const importers = moduleSurface.filter((file) => /@\/store\/useProfileStore|@\/types\/profile/.test(read(file)));
    expect(importers).toEqual([]);
  });
});

describe('vagten kan faktisk se læsningerne', () => {
  // Vagten skal selv testes: en regex der ikke fanger varianten, er et falsk billede af tryghed.
  const variants: Record<string, string> = {
    'ulighed': "const x = profile.gender !== 'female';",
    'strikt lighed': "const x = profile.gender === 'female';",
    'switch': "switch (profile.gender) { case 'other': break; }",
    'destrukturering': 'const { gender } = profile;',
    'omdøbt destrukturering': 'const { gender: g } = profile;',
    'includes()': "const x = ['female', 'other'].includes(p.gender);",
    'parentes-opslag': "const x = profile['gender'];",
    'selector': 'const g = useProfileStore((s) => s.profile.gender);',
    'hjælpefunktion': 'function isFemale(p: P) { return p.x; }',
    'kald af hjælpefunktion': 'if (isFemale(profile)) show();',
    'bogstav alene': "const label = 'female';",
    'typeimport': "import { Gender } from '@/types/profile';",
    'skabelonstreng': 'const k = `profile.gender.${value}`;',
    'conditional': "const tab = profile.gender === 'female' ? 'cycle' : null;",
  };

  for (const [name, source] of Object.entries(variants)) {
    it(`fanger ${name}`, () => {
      expect(genderReads(source).length).toBeGreaterThan(0);
    });
  }

  it('ignorerer kommentarer, JSX-tekst og beslægtede ord', () => {
    const quiet = [
      '// køn og gender afgør ikke noget',
      '/* profile.gender === "female" */',
      "const label = t('profile.genderHint');",
      'const x = <Text>Gender</Text>;',
      "const m = 'mail' + 'email' + 'maleficent' + 'engendered'.length;",
    ].join('\n');
    expect(genderReads(quiet)).toEqual([]);
  });
});

describe('serveren udleder heller ikke moduler af køn', () => {
  it('kun de historiske migrationer læser kolonnen, og den nye gør det ikke', () => {
    const dir = path.join(REPO_ROOT, 'supabase', 'migrations');
    const code = (file: string) => fs.readFileSync(path.join(dir, file), 'utf8')
      .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    const readers = fs.readdirSync(dir).filter((file) => /\bgender\b/i.test(code(file)));
    // Skemaet, to versioner af handle_new_user og engangs-oversættelsen fra APP-020. Ingen nye.
    expect(readers).toEqual([
      '20260902112000_remote_schema.sql',
      '20260907120000_lock_handle_new_user_search_path.sql',
      '20260908233300_seed_cycle_module_choice.sql',
    ]);
  });
});

describe('onboarding spørger om moduler', () => {
  it('slutter med modulvalget', () => {
    // `replace`, ikke `push`: trinnet skal ikke blive liggende i historikken
    // under appen bagefter. Se onboardingGuard.test.ts.
    expect(read('app/onboarding-profile.tsx')).toContain('router.replace("/onboarding-modules")');
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
  const migration = readMigration('_seed_cycle_module_choice.sql');

  it('oversætter den gamle udledning til et eksplicit valg', () => {
    expect(migration).toMatch(/insert into public\.user_modules/);
    expect(migration).toMatch(/'cycle'/);
    expect(migration).toMatch(/gender = 'female'/);
  });

  it('rører ikke et valg, brugeren allerede har truffet', () => {
    expect(migration).toMatch(/where not exists/);
  });
});
