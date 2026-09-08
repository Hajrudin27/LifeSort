import type { DataSensitivity, HomeSnapshot, ModuleId } from './moduleRegistry';

/**
 * Hvor meget et kort må vise (APP-013).
 *
 * Home er den skærm, man tilfældigvis holder op, viser en kollega eller lægger
 * på bordet. Et kort skal derfor kunne skrues ned uden at forsvinde — for
 * forsvinder det, mister brugeren overblikket, og så slår hun det bare til igen
 * og er lige vidt.
 *
 * Tre niveauer: fuldt, maskeret (kortet står der, tallet gør ikke), skjult.
 */

export type HomeCardDetail = 'full' | 'masked' | 'hidden';

export type HomePrivacyPreferences = {
  /** Kort brugeren har taget helt af Home (APP-012). */
  hidden: ModuleId[];
  /** Brugerens eget valg pr. modul. Fravær betyder standarden nedenfor. */
  detail: Partial<Record<ModuleId, 'full' | 'masked'>>;
};

export const EMPTY_HOME_PRIVACY: HomePrivacyPreferences = { hidden: [], detail: {} };

/** Det tegn et maskeret tal erstattes af. Ikke oversat — det er ikke tekst. */
export const MASKED_VALUE = '•••';

/**
 * Kan kortet overhovedet maskeres? Alt der ikke er 'ordinary' kan: et beløb, et
 * rejsenavn, en cyklusdag. En indkøbsliste behøver ingen maske.
 */
export function isMaskable(sensitivity: DataSensitivity): boolean {
  return sensitivity !== 'ordinary';
}

/**
 * Standarden, når brugeren ikke har valgt.
 *
 * Helbred starter maskeret. Det er den ene kategori, hvor et enkelt blik er
 * nok til at afsløre noget, man ikke selv har valgt at fortælle — og
 * specifikationen §8.7 siger det samme om Home-widgets: privacy-safe som
 * udgangspunkt. Resten starter synligt; et beløb på ens egen telefon er ikke
 * den samme slags oplysning, og at maskere alt ville gøre Home ubrugelig og
 * dermed maskeringen meningsløs.
 */
export function defaultDetail(sensitivity: DataSensitivity): 'full' | 'masked' {
  return sensitivity === 'health' ? 'masked' : 'full';
}

/**
 * Hvad kortet viser lige nu.
 *
 * `hasHydrated` er ikke en detalje. Før brugerens indstillinger er læst fra
 * disk, ved vi ikke, hvad hun har valgt — og at gætte "fuldt" ville vise
 * cyklusdagen i et glimt, netop mens telefonen bliver rakt til nogen. Så længe
 * vi er i tvivl, holdes alt følsomt tilbage. Tvivl skal falde ud til det
 * sikre, ikke det bekvemme.
 */
export function resolveCardDetail(
  snapshot: Pick<HomeSnapshot, 'moduleId' | 'sensitivity'>,
  preferences: HomePrivacyPreferences,
  hasHydrated: boolean,
): HomeCardDetail {
  if (!isMaskable(snapshot.sensitivity)) {
    // Ufølsomt indhold behøver ikke vente på noget. Home står ikke tom, mens
    // disken læses.
    return preferences.hidden.includes(snapshot.moduleId) && hasHydrated ? 'hidden' : 'full';
  }

  // Ikke bare maskeret: holdt helt tilbage. Havde brugeren skjult kortet, ville
  // en maskeret udgave stadig røbe, at hun overhovedet bruger modulet — og det
  // kan være præcis dét, hun skjulte. Et par millisekunders forsinkelse er en
  // billigere pris.
  if (!hasHydrated) return 'hidden';

  if (preferences.hidden.includes(snapshot.moduleId)) return 'hidden';
  return preferences.detail[snapshot.moduleId] ?? defaultDetail(snapshot.sensitivity);
}

/** Er kortet maskeret af brugerens eget valg frem for af standarden? */
export function isExplicitlyMasked(moduleId: ModuleId, preferences: HomePrivacyPreferences): boolean {
  return preferences.detail[moduleId] === 'masked';
}
