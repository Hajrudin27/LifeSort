/**
 * Oversætter fejl fra Supabase Auth til noget, det er sikkert at vise (APP-018).
 *
 * Providerens egen tekst må aldrig nå skærmen. To grunde, og den første er den
 * vigtige: "User already registered" fortæller enhver, der prøver, om en
 * bestemt mailadresse har en konto her. Det er kontooptælling, og det er gratis
 * at forhindre. Den anden er, at teksten er engelsk i en dansk app.
 *
 * Alt ukendt lander på én generisk besked. Det koster lidt præcision i
 * fejlsøgning og fjerner en hel klasse af utilsigtede afsløringer.
 */

export type AuthErrorKey =
  | 'auth.errorInvalidCredentials'
  | 'auth.errorRateLimited'
  | 'auth.errorNetwork'
  | 'auth.errorEmailNotConfirmed'
  | 'auth.errorGeneric';

const RATE_LIMIT_PATTERNS = [/rate limit/i, /too many requests/i, /security purposes/i, /after \d+ seconds/i];
const NETWORK_PATTERNS = [/network request failed/i, /fetch failed/i, /timeout/i];
const INVALID_CREDENTIAL_PATTERNS = [/invalid login credentials/i, /invalid email or password/i];
const UNCONFIRMED_PATTERNS = [/email not confirmed/i, /not confirmed/i];

/**
 * Fejl ved login. Forkert kodeord og ukendt bruger giver med vilje samme svar —
 * ellers kan man spørge sig frem til, hvilke adresser der findes.
 */
export function signInErrorKey(message: string | null): AuthErrorKey | null {
  if (!message) return null;

  if (UNCONFIRMED_PATTERNS.some((pattern) => pattern.test(message))) return 'auth.errorEmailNotConfirmed';
  if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message))) return 'auth.errorRateLimited';
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(message))) return 'auth.errorNetwork';
  if (INVALID_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(message))) return 'auth.errorInvalidCredentials';

  return 'auth.errorGeneric';
}

/**
 * Fejl ved oprettelse.
 *
 * Bemærk hvad der IKKE er her: en sag for "adressen findes allerede".
 * Oprettelse svarer det samme, uanset om adressen er kendt — se
 * `signUpOutcome`. Kun de fejl, der ikke afslører noget, får deres egen besked.
 */
export function signUpErrorKey(message: string | null): AuthErrorKey | null {
  if (!message) return null;

  if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message))) return 'auth.errorRateLimited';
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(message))) return 'auth.errorNetwork';

  return 'auth.errorGeneric';
}

/** Findes adressen allerede? Det svar skal aldrig ud af det her modul. */
function looksLikeExistingAccount(message: string): boolean {
  return /already registered/i.test(message) || /already exists/i.test(message) || /user already/i.test(message);
}

export type SignUpOutcome =
  | { kind: 'check-inbox' }
  | { kind: 'signed-in' }
  | { kind: 'error'; key: AuthErrorKey };

/**
 * Hvad brugeren får at vide efter et forsøg på oprettelse.
 *
 * "Adressen findes allerede" og "vi har sendt en mail" bliver til det SAMME
 * svar: tjek din indbakke. Den, der ejer adressen, får enten en bekræftelses-
 * eller en "du har allerede en konto"-mail fra serveren og kan komme videre.
 * Den, der ikke ejer den, får intet at vide.
 */
export function signUpOutcome(message: string | null, hasSession: boolean): SignUpOutcome {
  if (message && looksLikeExistingAccount(message)) return { kind: 'check-inbox' };

  const key = signUpErrorKey(message);
  if (key) return { kind: 'error', key };

  // Ingen session betyder at serveren venter på, at mailen bliver bekræftet.
  return hasSession ? { kind: 'signed-in' } : { kind: 'check-inbox' };
}
