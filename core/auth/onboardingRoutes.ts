/**
 * Hvilke ruter der hører til onboarding, og hvornår brugeren skal sendes derhen.
 *
 * Vagten i rod-layoutet sendte tidligere alle uden fuldført onboarding til
 * /onboarding-profile — uanset hvor de var. På selve profilskærmen var det en
 * uskadelig omdirigering til der, hvor man allerede stod, så flowet så ud til
 * at virke. Men i samme øjeblik man gik videre til næste trin, rendrede
 * layoutet igen, `hasOnboarded` var stadig false, og vagten sendte brugeren
 * tilbage. Fuldførelsen lå bag den skærm, vagten ikke ville lade nogen nå: en
 * baglås.
 *
 * Derfor skal vagten kende forskel på "uden for onboarding" og "på vej gennem
 * onboarding". Listen er udtrykkelig frem for et præfiks-gæt: en rute er kun
 * en del af flowet, hvis den står her.
 */

/** Første skærm i flowet — dér sendes man hen, når man mangler at komme igennem. */
export const ONBOARDING_ENTRY_ROUTE = '/onboarding-profile';

/**
 * Ruterne der udgør onboarding.
 *
 * `/onboarding-pin` er med, fordi auth-skærmen sender brugeren derhen lige
 * efter oprettelse, når serveren ikke kræver e-mailbekræftelse. Uden den på
 * listen ramte den samme baglås dét trin.
 */
export const ONBOARDING_ROUTES = [
  '/onboarding-profile',
  '/onboarding-modules',
  '/onboarding-pin',
] as const;

/**
 * Skærmen hvor et nyt kodeord sættes.
 *
 * Den står MED VILJE ikke på ONBOARDING_ROUTES. En rute på den liste er åben,
 * fordi den hedder det den hedder — og så ville enhver kunne springe onboarding
 * over ved at navigere hertil. Adgangen hertil afgøres af, om der faktisk er en
 * gendannelse i gang; se `shouldRedirectToOnboarding`.
 */
export const PASSWORD_RECOVERY_ROUTE = '/new-password';

/** Uden query-streng og uden afsluttende skråstreg. */
function normalisePath(pathname: string): string {
  return pathname.split('?')[0].replace(/\/+$/, '') || '/';
}

export function isOnboardingRoute(pathname: string): boolean {
  // Så '/onboarding-modules/' og '/onboarding-modules?x=1' behandles som den
  // rute, de er.
  return (ONBOARDING_ROUTES as readonly string[]).includes(normalisePath(pathname));
}

export function isPasswordRecoveryRoute(pathname: string): boolean {
  return normalisePath(pathname) === PASSWORD_RECOVERY_ROUTE;
}

export type OnboardingGuardState = {
  /** Sprog er valgt. Er det ikke, hører brugeren til på sprogskærmen først. */
  hasLanguage: boolean;
  hasSession: boolean;
  /** Kommer fra profiles.onboarded_at — aldrig udledt af et udfyldt felt. */
  hasOnboarded: boolean;
  /**
   * Er der en kodeordsgendannelse i gang lige nu?
   *
   * Sandt kun mens appen har byttet et gyldigt `type=recovery`-link til en
   * session, og kodeordet endnu ikke er sat. Det er en tilstand, ikke et
   * rutenavn — og det er hele pointen: se kommentaren i funktionen nedenfor.
   */
  isRecoveringPassword: boolean;
  pathname: string;
};

/**
 * Skal brugeren sendes til onboarding lige nu?
 *
 * Ren funktion, så beslutningen kan afprøves uden en renderer: det er selve
 * beslutningen, der var forkert, ikke måden den blev vist på.
 */
export function shouldRedirectToOnboarding({
  hasLanguage,
  hasSession,
  hasOnboarded,
  isRecoveringPassword,
  pathname,
}: OnboardingGuardState): boolean {
  // Sprog og login har deres egne vagter og kommer før den her.
  if (!hasLanguage || !hasSession) return false;

  if (hasOnboarded) return false;

  // Er brugeren allerede i gang med flowet, skal hun have lov at komme videre
  // i det. Det er hele rettelsen af baglåsen.
  if (isOnboardingRoute(pathname)) return false;

  // En bruger, der har glemt sit kodeord uden at have gennemført onboarding,
  // skal kunne sætte et nyt. Ellers er kontoen låst inde bag et trin, hun ikke
  // kan nå uden netop det kodeord, hun mangler.
  //
  // Undtagelsen er en KONJUNKTION: både en gendannelse i gang OG den rute, der
  // sætter kodeordet. Rutenavnet alene giver ingenting, og tilstanden alene
  // åbner ikke resten af appen. `isRecoveringPassword` kan kun blive sand
  // inde i beginPasswordRecovery — altså efter et link med `type=recovery` og
  // to tokens, som serveren har accepteret. Det kan man ikke navigere sig til.
  if (isRecoveringPassword && isPasswordRecoveryRoute(pathname)) return false;

  return true;
}
