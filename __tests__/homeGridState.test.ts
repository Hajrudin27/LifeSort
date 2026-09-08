import {
  type HomeGridInput,
  resolveHomeGridState,
  skeletonCardCount,
} from '@/core/modules/homeGridState';

/**
 * APP-014 — "vi ved det ikke endnu" må aldrig forveksles med "der er ingenting".
 *
 * Langsom disk er `preferencesHydrated: false`. Langsom session er
 * `isLoading: true`. Begge er almindelige på en ældre telefon, og begge er
 * præcis dér, hvor en app kommer til at ligne, at dataene er væk.
 */

const input = (partial: Partial<HomeGridInput> = {}): HomeGridInput => ({
  isLoading: false,
  preferencesHydrated: true,
  visibleCardCount: 0,
  hiddenCardCount: 0,
  availableProviderCount: 0,
  ...partial,
});

describe('langsom indlæsning', () => {
  it('venter, mens modulernes kort hentes', () => {
    expect(resolveHomeGridState(input({ isLoading: true }))).toBe('loading');
  });

  it('venter, mens indstillingerne læses fra disk', () => {
    // Følsomme kort holdes tilbage indtil da (APP-013). Uden den her regel
    // ville Home nå at sige "du har skjult alle kort" imens.
    expect(resolveHomeGridState(input({ preferencesHydrated: false }))).toBe('loading');
  });

  it('siger aldrig tomt, mens noget stadig mangler', () => {
    for (const isLoading of [true, false]) {
      for (const preferencesHydrated of [true, false]) {
        for (const hiddenCardCount of [0, 3]) {
          for (const availableProviderCount of [0, 4]) {
            const state = resolveHomeGridState(
              input({ isLoading, preferencesHydrated, hiddenCardCount, availableProviderCount }),
            );
            if (isLoading || !preferencesHydrated) expect(state).toBe('loading');
          }
        }
      }
    }
  });

  it('venter også, selvom der allerede er kort at vise', () => {
    // Der kan mangle følsomme kort, som endnu ikke må vises. At kalde det
    // "klar" ville få listen til at hoppe et øjeblik senere.
    expect(resolveHomeGridState(input({ visibleCardCount: 2, preferencesHydrated: false }))).toBe('loading');
  });
});

describe('når der faktisk er noget', () => {
  it('viser kortene', () => {
    expect(resolveHomeGridState(input({ visibleCardCount: 1, availableProviderCount: 4 }))).toBe('ready');
  });

  it('viser dem, uanset hvor mange der er skjult', () => {
    expect(
      resolveHomeGridState(input({ visibleCardCount: 1, hiddenCardCount: 3, availableProviderCount: 4 })),
    ).toBe('ready');
  });
});

describe('de tomme tilstande siger hvorfor', () => {
  it('skelner mellem selv at have skjult dem', () => {
    expect(resolveHomeGridState(input({ hiddenCardCount: 2, availableProviderCount: 2 }))).toBe('empty-hidden');
  });

  it('og at have slået modulerne fra', () => {
    expect(resolveHomeGridState(input({ availableProviderCount: 0 }))).toBe('empty-no-modules');
  });

  it('og at modulerne intet havde at melde', () => {
    expect(resolveHomeGridState(input({ availableProviderCount: 3 }))).toBe('empty-no-cards');
  });

  it('nævner det brugeren selv kan gøre noget ved først', () => {
    // Har hun skjult kort, er dét svaret — ikke "slå moduler til".
    expect(
      resolveHomeGridState(input({ hiddenCardCount: 1, availableProviderCount: 0 })),
    ).toBe('empty-hidden');
  });
});

describe('skelettet', () => {
  it('lover ikke flere kort, end der kommer', () => {
    expect(skeletonCardCount(2)).toBe(2);
    expect(skeletonCardCount(9)).toBe(4);
  });

  it('er aldrig usynligt', () => {
    // Ved første kørsel kendes antallet ikke endnu.
    expect(skeletonCardCount(0)).toBe(1);
    expect(skeletonCardCount(-1)).toBe(1);
  });
});
