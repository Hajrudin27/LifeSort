import {
  EMPTY_HOME_LAYOUT,
  hiddenModuleIds,
  type HomeLayoutPreferences,
  rankHomeSnapshots,
} from '@/core/modules/homeRanking';
import type { HomeSnapshot, ModuleId } from '@/core/modules/moduleRegistry';

/**
 * APP-012 — rækkefølgen skal kunne forudsiges.
 *
 * "Deterministic tests" i acceptkriteriet betyder ikke bare at testene består:
 * det betyder at samme input ALTID giver samme rækkefølge. Derfor kører flere
 * af testene den samme sortering på blandede input.
 */

const card = (moduleId: ModuleId, priority: HomeSnapshot['priority'] = 'normal'): HomeSnapshot => ({
  moduleId,
  titleKey: `test.${moduleId}`,
  priority,
  sensitivity: 'ordinary',
  route: `/${moduleId}`,
});

const order = (snapshots: HomeSnapshot[], prefs?: HomeLayoutPreferences) =>
  rankHomeSnapshots(snapshots, prefs).map((snapshot) => snapshot.moduleId);

const prefs = (partial: Partial<HomeLayoutPreferences>): HomeLayoutPreferences => ({
  ...EMPTY_HOME_LAYOUT,
  ...partial,
});

describe('fastgjort > presserende > senest brugt', () => {
  it('sætter fastgjorte øverst, i brugerens rækkefølge', () => {
    const cards = [card('economy'), card('food'), card('travel'), card('cycle')];
    expect(order(cards, prefs({ pinned: ['travel', 'food'] }))).toEqual([
      'travel',
      'food',
      'economy',
      'cycle',
    ]);
  });

  it('lader fastgjort slå presserende', () => {
    // Brugerens eget valg må ikke kunne overtrumfes af appens vurdering af,
    // hvad der haster.
    const cards = [card('economy', 'urgent'), card('travel')];
    expect(order(cards, prefs({ pinned: ['travel'] }))).toEqual(['travel', 'economy']);
  });

  it('sorterer presserende før vigtigt før normalt', () => {
    const cards = [card('cycle'), card('food', 'important'), card('travel', 'urgent')];
    expect(order(cards)).toEqual(['travel', 'food', 'cycle']);
  });

  it('bruger senest brugt, når alt andet er lige', () => {
    const cards = [card('economy'), card('food'), card('travel')];
    const ranked = order(
      cards,
      prefs({
        lastOpenedAt: {
          food: '2026-09-05T10:00:00.000Z',
          travel: '2026-09-07T10:00:00.000Z',
        },
      }),
    );
    // travel er nyest, så food, og economy er aldrig åbnet.
    expect(ranked).toEqual(['travel', 'food', 'economy']);
  });

  it('lader presserende slå senest brugt', () => {
    const cards = [card('economy', 'urgent'), card('travel')];
    const ranked = order(cards, prefs({ lastOpenedAt: { travel: '2026-09-07T10:00:00.000Z' } }));
    expect(ranked).toEqual(['economy', 'travel']);
  });
});

describe('determinisme', () => {
  it('giver samme rækkefølge uanset hvordan input er blandet', () => {
    const cards = [card('economy'), card('food', 'urgent'), card('travel'), card('cycle', 'important')];
    const preferences = prefs({ lastOpenedAt: { economy: '2026-09-06T00:00:00.000Z' } });
    const expected = order(cards, preferences);

    // Alle permutationer af fire kort.
    const permute = <T,>(items: T[]): T[][] =>
      items.length <= 1
        ? [items]
        : items.flatMap((item, index) =>
            permute([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
          );

    for (const shuffled of permute(cards)) {
      expect(order(shuffled, preferences)).toEqual(expected);
    }
  });

  it('efterlader aldrig to kort uafgjort', () => {
    // Uden et sidste stik ville rækkefølgen kunne skifte mellem to renders.
    const cards = [card('economy'), card('food'), card('travel'), card('cycle')];
    const ranked = order(cards);
    expect(ranked).toEqual([...ranked]);
    expect(new Set(ranked).size).toBe(cards.length);
    // Registerrækkefølge er sidste stik.
    expect(ranked).toEqual(['economy', 'food', 'travel', 'cycle']);
  });

  it('ændrer ikke det array den får ind', () => {
    const cards = [card('travel'), card('economy')];
    const before = cards.map((c) => c.moduleId);
    rankHomeSnapshots(cards, prefs({ pinned: ['economy'] }));
    expect(cards.map((c) => c.moduleId)).toEqual(before);
  });
});

describe('skjul og hent tilbage', () => {
  it('tager skjulte kort ud af listen', () => {
    const cards = [card('economy'), card('food'), card('travel')];
    expect(order(cards, prefs({ hidden: ['food'] }))).toEqual(['economy', 'travel']);
  });

  it('kan skjule alt uden at fejle', () => {
    const cards = [card('economy'), card('food')];
    expect(order(cards, prefs({ hidden: ['economy', 'food'] }))).toEqual([]);
  });

  it('viser de skjulte i registerrækkefølge, så listen står stille', () => {
    expect(hiddenModuleIds(prefs({ hidden: ['travel', 'economy'] }))).toEqual(['economy', 'travel']);
  });

  it('gør et skjult kort synligt igen præcis som før', () => {
    // At skjule må ikke efterlade spor — ellers er det ikke et filter.
    const cards = [card('economy'), card('food'), card('travel')];
    const untouched = order(cards);
    expect(order(cards, prefs({ hidden: [] }))).toEqual(untouched);
  });
});

describe('ingen feed-mekanik', () => {
  it('rangerer ikke efter noget appen selv finder på', () => {
    // Rækkefølgen må kun afhænge af de tre erklærede signaler. Samme kort med
    // samme præferencer, kaldt igen: samme svar, uanset hvor mange gange.
    const cards = [card('economy'), card('food'), card('travel'), card('cycle')];
    const first = order(cards);
    for (let i = 0; i < 20; i++) expect(order(cards)).toEqual(first);
  });

  it('belønner ikke et kort for at have været vist', () => {
    // Der findes ingen visnings-tæller at rangere efter — kun brugerens egne
    // handlinger. Testen står som en påmindelse, hvis nogen tilføjer en.
    const cards = [card('economy'), card('food')];
    expect(order(cards, EMPTY_HOME_LAYOUT)).toEqual(order(cards, EMPTY_HOME_LAYOUT));
  });
});
