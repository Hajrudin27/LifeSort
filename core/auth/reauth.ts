/**
 * Bekræftelse før følsomme handlinger (APP-024).
 *
 * Truslen er ikke en fjern angriber — det er en ulåst telefon, der ligger på et
 * bord. Har man den i hånden, er man allerede "logget ind". Eksport af alt til
 * én fil, eller deling af en kvittering, er derfor de handlinger, hvor et
 * enkelt ekstra bevis er billigt for ejeren og dyrt for alle andre.
 *
 * Bemærk hvad der IKKE står her: at bekræftelsen erstatter serverens kontrol.
 * Den gør den ikke. Det lokale bevis dækker den lokale trussel (ADR-0007), og
 * sletning af konto bruger fortsat kontoens adgangskode, fordi den handling
 * sker på serveren.
 */

/**
 * Hvor længe en bekræftelse holder.
 *
 * Fem minutter, så en bruger, der eksporterer to gange i træk, ikke bliver
 * spurgt to gange — men så en telefon, der skifter hænder, ikke bærer beviset
 * med sig ret længe. Vinduet nulstilles også, når appen har været i baggrunden.
 */
export const REAUTH_WINDOW_MS = 5 * 60_000;

/** Handlinger der kræver et bevis, og hvorfor. */
export const SENSITIVE_ACTIONS = {
  'export-data': 'Lægger hele indholdet i én fil, brugeren derefter selv deler.',
  'share-file': 'Sender en kvittering eller et dokument ud af appen.',
} as const;

export type SensitiveAction = keyof typeof SENSITIVE_ACTIONS;

/** Hvilket bevis brugeren gav. Kun til fejlsøgning og tests. */
export type ReauthFactor = 'biometric' | 'pin' | 'password';

let lastVerifiedAt: number | null = null;

/**
 * Skal der spørges igen?
 *
 * Ren funktion, så vinduet kan testes uden at vente. Bemærk retningen på
 * tvivlen: ingen tidligere bekræftelse betyder JA, spørg — og et tidspunkt i
 * fremtiden, fra et ur, der er stillet, betyder også ja.
 */
export function needsReauth(verifiedAt: number | null, now: number): boolean {
  if (verifiedAt === null) return true;
  if (verifiedAt > now) return true;
  return now - verifiedAt >= REAUTH_WINDOW_MS;
}

export function markVerified(now: number = Date.now()): void {
  lastVerifiedAt = now;
}

/**
 * Glemmer beviset. Kaldes ved log ud og hver gang appen har været i baggrunden
 * — en telefon, der har været ude af syne, kan have skiftet hænder.
 */
export function clearVerification(): void {
  lastVerifiedAt = null;
}

export function requiresReauthNow(now: number = Date.now()): boolean {
  return needsReauth(lastVerifiedAt, now);
}
