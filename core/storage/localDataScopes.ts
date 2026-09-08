/**
 * Hvad der hører til brugeren, og hvad der hører til enheden (APP-021).
 *
 * Ved log ud skal alt brugerens forsvinde, så den næste, der logger ind på
 * telefonen, ikke ser rester af den forrige. Den svære del er ikke at rydde —
 * det er at rydde ALT, også det nogen tilføjer i næste uge.
 *
 * Derfor er reglen vendt om: alt, der ligger under vores nøgler, regnes for
 * brugerdata og bliver ryddet. Vil man beholde noget, skal det stå udtrykkeligt
 * på listen herunder, med en grund. En glemt store bliver dermed ryddet ved et
 * uheld i stedet for glemt ved et uheld — og af de to fejl er den første langt
 * den bedste.
 */

/** Nøgler appen selv ejer. Alt andet i AsyncStorage rører vi ikke. */
export const OWNED_KEY_PREFIXES = ['lifesort-'];

/** Nøgler uden vores præfiks, som vi alligevel ejer. Historisk navngivning. */
export const OWNED_EXTRA_KEYS = ['sync-status'];

/**
 * Det, der bliver liggende ved log ud — og hvorfor.
 *
 * Kort liste med vilje. Hver linje er en påstand om, at noget IKKE er
 * personligt, og den påstand skal kunne forsvares.
 */
export const DEVICE_SCOPED_KEYS: Record<string, string> = {
  // Sproget er valgt for telefonen, ikke for kontoen. At nulstille det ville
  // kaste den næste bruger ud på et sprog, hun måske ikke læser.
  'lifesort-settings': 'Sprogvalg hører til enheden, ikke til kontoen.',

  // Operatørens kill switches gælder alle brugere. Et modul, der er lukket ned,
  // skal blive ved med at være lukket for den næste, der logger ind (APP-006).
  'lifesort-module-flags': 'Operatørkonfiguration, fælles for alle brugere.',
};

export function isOwnedKey(key: string): boolean {
  return OWNED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) || OWNED_EXTRA_KEYS.includes(key);
}

export function isDeviceScoped(key: string): boolean {
  return key in DEVICE_SCOPED_KEYS;
}

/**
 * Nøglerne der skal væk ved log ud: vores egne, minus dem der udtrykkeligt
 * hører til enheden.
 */
export function userDataKeys(allKeys: readonly string[]): string[] {
  return allKeys.filter((key) => isOwnedKey(key) && !isDeviceScoped(key));
}
