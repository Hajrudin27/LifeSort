/**
 * Søgning i modul-launcheren (APP-015).
 *
 * Søger kun i modulernes navne og beskrivelser — aldrig i indholdet. Det er
 * ikke en begrænsning, det er hele pointen: en launcher skal finde "Cyklus",
 * ikke et symptom. Indholdssøgning har sin egen historie og sine egne regler
 * for hvad der må indekseres (APP-077/APP-078).
 */

/**
 * Gør tekst sammenlignelig: små bogstaver, og danske tegn foldet ud, så
 * "okonomi" finder "Økonomi". Uden det skal brugeren ramme æ, ø og å præcist
 * på et tastatur, hvor de ikke altid er lige ved hånden.
 */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Matcher en fritekst-forespørgsel mod et modules synlige tekst. */
export function matchesModuleQuery(haystacks: string[], query: string): boolean {
  const needle = normalizeForSearch(query);
  if (needle === '') return true;

  return haystacks.some((haystack) => normalizeForSearch(haystack).includes(needle));
}
