/**
 * Hvad Home viser, mens der ikke er noget at vise (APP-014).
 *
 * Den vigtige forskel er mellem "vi ved det ikke endnu" og "der er ingenting".
 * Siger man det sidste, mens det første er sandt, ser det ud som om brugerens
 * data er væk — og det er den værste besked, en app kan give ved et uheld.
 *
 * Ren funktion, så netop den forskel kan testes uden en enhed: langsom disk er
 * bare `preferencesHydrated: false`, og en langsom session er `isLoading: true`.
 */

export type HomeGridState =
  | 'loading' // vi ved det ikke endnu
  | 'ready' // der er kort at vise
  | 'empty-hidden' // brugeren har selv skjult dem
  | 'empty-no-modules' // brugeren har slået modulerne fra
  | 'empty-no-cards'; // modulerne havde intet at melde

export type HomeGridInput = {
  /** Modulernes kort er ikke hentet ind endnu. */
  isLoading: boolean;
  /** Brugerens indstillinger er ikke læst fra disk endnu. */
  preferencesHydrated: boolean;
  visibleCardCount: number;
  hiddenCardCount: number;
  /** Moduler der både er valgt til og har et kort at give. */
  availableProviderCount: number;
};

export function resolveHomeGridState(input: HomeGridInput): HomeGridState {
  // Så længe noget mangler, er svaret "vent" — aldrig "tomt". Følsomme kort
  // holdes tilbage indtil indstillingerne er læst (APP-013), så uden det her
  // ville Home kortvarigt påstå, at der ikke er noget.
  if (input.isLoading || !input.preferencesHydrated) return 'loading';

  if (input.visibleCardCount > 0) return 'ready';

  // Rækkefølgen er den, brugeren selv kan gøre noget ved først.
  if (input.hiddenCardCount > 0) return 'empty-hidden';
  if (input.availableProviderCount === 0) return 'empty-no-modules';
  return 'empty-no-cards';
}

/** Hvor mange pladsholdere skelettet skal vise. */
export function skeletonCardCount(availableProviderCount: number): number {
  // Mindst ét kort, så skelettet ikke er usynligt, og højst fire, så det ikke
  // lover mere, end der kommer.
  return Math.min(Math.max(availableProviderCount, 1), 4);
}
