import { EMPTY_HOME_LAYOUT, type HomeLayoutPreferences, rankModuleIds } from '@/core/modules/homeRanking';
import { TOGGLEABLE_MODULE_IDS } from '@/core/modules/moduleEnablement';
import { MODULE_IDS, type ModuleId, PLATFORM_MODULE_IDS } from '@/core/modules/moduleRegistry';
import { matchesModuleQuery, normalizeForSearch } from '@/core/modules/moduleSearch';

/**
 * APP-015 — launcheren er alternativet til tyve tabs.
 */

const prefs = (partial: Partial<HomeLayoutPreferences>): HomeLayoutPreferences => ({
  ...EMPTY_HOME_LAYOUT,
  ...partial,
});

describe('hvad launcheren kan vise', () => {
  it('tilbyder aldrig skallen som noget, man åbner', () => {
    // "Konto" og selve appen er ikke moduler, man navigerer til fra en hub.
    for (const moduleId of PLATFORM_MODULE_IDS) {
      expect(TOGGLEABLE_MODULE_IDS).not.toContain(moduleId);
    }
  });

  it('dækker alle domænemoduler, så ingen bliver uden en vej ind', () => {
    // Det er hele pointen med en launcher: et modul uden tab og uden Home-kort
    // skal stadig kunne findes.
    expect(TOGGLEABLE_MODULE_IDS.length).toBe(MODULE_IDS.length - PLATFORM_MODULE_IDS.length);
  });
});

describe('rækkefølge', () => {
  it('sætter fastgjorte først, i brugerens rækkefølge', () => {
    const ids: ModuleId[] = ['economy', 'food', 'travel', 'cycle'];
    expect(rankModuleIds(ids, prefs({ pinned: ['cycle', 'food'] }))).toEqual([
      'cycle',
      'food',
      'economy',
      'travel',
    ]);
  });

  it('bruger senest brugt derefter', () => {
    const ids: ModuleId[] = ['economy', 'food', 'travel'];
    expect(
      rankModuleIds(ids, prefs({ lastOpenedAt: { travel: '2026-09-07T10:00:00.000Z', economy: '2026-09-01T10:00:00.000Z' } })),
    ).toEqual(['travel', 'economy', 'food']);
  });

  it('deler samme fastgørelse som Home', () => {
    // Fastgør man et modul ét sted, flytter det sig begge steder — ellers har
    // brugeren to lister at holde styr på.
    const ids: ModuleId[] = ['economy', 'travel'];
    expect(rankModuleIds(ids, prefs({ pinned: ['travel'] }))[0]).toBe('travel');
  });

  it('viser stadig moduler, hvis Home-kortet er skjult', () => {
    // At tage et kort af Home er ikke det samme som ikke at ville bruge modulet.
    const ids: ModuleId[] = ['economy', 'travel'];
    expect(rankModuleIds(ids, prefs({ hidden: ['travel'] }))).toContain('travel');
  });

  it('er deterministisk uanset rækkefølgen ind', () => {
    const preferences = prefs({ lastOpenedAt: { food: '2026-09-05T00:00:00.000Z' } });
    const expected = rankModuleIds(['economy', 'food', 'travel', 'cycle'], preferences);
    expect(rankModuleIds(['cycle', 'travel', 'food', 'economy'], preferences)).toEqual(expected);
    expect(rankModuleIds(['food', 'economy', 'cycle', 'travel'], preferences)).toEqual(expected);
  });
});

describe('søgning', () => {
  it('finder på tværs af store og små bogstaver', () => {
    expect(matchesModuleQuery(['Økonomi'], 'ØKONOMI')).toBe(true);
    expect(matchesModuleQuery(['Rejser'], 'rejs')).toBe(true);
  });

  it('finder danske ord uden danske tegn', () => {
    // På et tastatur uden æ, ø og å skal "okonomi" stadig finde Økonomi.
    expect(matchesModuleQuery(['Økonomi'], 'okonomi')).toBe(true);
    expect(matchesModuleQuery(['Måltider'], 'maltider')).toBe(true);
    expect(matchesModuleQuery(['Værktøj'], 'vaerktoj')).toBe(true);
  });

  it('søger også i beskrivelsen', () => {
    expect(matchesModuleQuery(['Garantier', 'Kvitteringer og forsikringer'], 'kvittering')).toBe(true);
  });

  it('viser alt, når feltet er tomt', () => {
    expect(matchesModuleQuery(['Økonomi'], '')).toBe(true);
    expect(matchesModuleQuery(['Økonomi'], '   ')).toBe(true);
  });

  it('siger fra, når intet passer', () => {
    expect(matchesModuleQuery(['Økonomi', 'Udgifter og indtægter'], 'bryllup')).toBe(false);
  });

  it('normaliserer forudsigeligt', () => {
    expect(normalizeForSearch('  Å BÆK Ø  ')).toBe('a baek o');
  });
});
