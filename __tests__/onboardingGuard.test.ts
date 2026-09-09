/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import {
  isOnboardingRoute,
  isPasswordRecoveryRoute,
  ONBOARDING_ENTRY_ROUTE,
  ONBOARDING_ROUTES,
  type OnboardingGuardState,
  PASSWORD_RECOVERY_ROUTE,
  shouldRedirectToOnboarding,
} from '@/core/auth/onboardingRoutes';

/**
 * Regressionstest for onboarding-baglåsen.
 *
 * Vagten sendte alle uden fuldført onboarding til /onboarding-profile, uanset
 * hvor de var. På profilskærmen var det en uskadelig omdirigering til der, hvor
 * man allerede stod — så flowet så ud til at virke. Trykkede man Fortsæt,
 * rendrede layoutet igen, hasOnboarded var stadig false, og brugeren blev
 * sendt tilbage. Fuldførelsen lå bag den skærm, vagten ikke ville lade nogen nå.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

const state = (partial: Partial<OnboardingGuardState> = {}): OnboardingGuardState => ({
  hasLanguage: true,
  hasSession: true,
  hasOnboarded: false,
  isRecoveringPassword: false,
  pathname: '/',
  ...partial,
});

describe('en bruger uden fuldført onboarding tvinges derhen', () => {
  it('fra forsiden', () => {
    expect(shouldRedirectToOnboarding(state({ pathname: '/' }))).toBe(true);
  });

  it('fra en hvilken som helst almindelig rute', () => {
    for (const pathname of ['/economy', '/food/budget', '/settings', '/travel/abc-123', '/modules']) {
      expect(shouldRedirectToOnboarding(state({ pathname }))).toBe(true);
    }
  });

  it('og kan altså ikke smutte udenom', () => {
    // Selve kravet: onboarding kan ikke springes over ved at navigere direkte.
    expect(shouldRedirectToOnboarding(state({ pathname: '/settings/modules' }))).toBe(true);
  });
});

describe('men må komme igennem flowet', () => {
  it('bliver på profilskærmen', () => {
    expect(shouldRedirectToOnboarding(state({ pathname: '/onboarding-profile' }))).toBe(false);
  });

  it('må nå modulvalget — det var fejlen', () => {
    // Præcis den her linje fejlede før: efter router.push til modulskærmen
    // rendrede layoutet igen, og vagten sendte brugeren tilbage til profilen.
    expect(shouldRedirectToOnboarding(state({ pathname: '/onboarding-modules' }))).toBe(false);
  });

  it('må nå PIN-trinnet, som auth-skærmen sender nyoprettede brugere til', () => {
    // Samme baglås ramte det her trin, uden at nogen havde bemærket det.
    expect(shouldRedirectToOnboarding(state({ pathname: '/onboarding-pin' }))).toBe(false);
  });

  it('profil → moduler sender ikke tilbage til profilen', () => {
    // Rejsen, ikke bare de to endepunkter.
    const steps = ['/onboarding-profile', '/onboarding-modules'];
    for (const pathname of steps) {
      expect(shouldRedirectToOnboarding(state({ pathname }))).toBe(false);
    }
  });
});

describe('en bruger der ER igennem', () => {
  it('sendes ikke tilbage til onboarding', () => {
    for (const pathname of ['/', '/economy', '/settings']) {
      expect(shouldRedirectToOnboarding(state({ hasOnboarded: true, pathname }))).toBe(false);
    }
  });

  it('heller ikke hvis hun tilfældigvis står på en onboarding-rute', () => {
    expect(
      shouldRedirectToOnboarding(state({ hasOnboarded: true, pathname: '/onboarding-modules' })),
    ).toBe(false);
  });
});

describe('vagten blander sig ikke i sprog og login', () => {
  it('gør ingenting uden et valgt sprog', () => {
    // Sprogvagten kommer først; to omdirigeringer på én gang ville slås.
    expect(shouldRedirectToOnboarding(state({ hasLanguage: false }))).toBe(false);
  });

  it('gør ingenting uden en session', () => {
    expect(shouldRedirectToOnboarding(state({ hasSession: false }))).toBe(false);
  });

  it('gør ingenting for en udlogget bruger på en onboarding-rute', () => {
    expect(
      shouldRedirectToOnboarding(state({ hasSession: false, pathname: '/onboarding-profile' })),
    ).toBe(false);
  });
});

describe('hvilke ruter der tæller som onboarding', () => {
  it('kun dem på listen', () => {
    for (const route of ONBOARDING_ROUTES) expect(isOnboardingRoute(route)).toBe(true);
  });

  it('ikke noget, der bare ligner', () => {
    // Udtrykkelig liste frem for et præfiks-gæt: '/onboarding-noget-andet' er
    // ikke en del af flowet, bare fordi navnet starter ens.
    for (const pathname of ['/onboarding-noget-andet', '/onboarding', '/settings/modules', '/']) {
      expect(isOnboardingRoute(pathname)).toBe(false);
    }
  });

  it('lader sig ikke narre af skråstreg eller query', () => {
    expect(isOnboardingRoute('/onboarding-modules/')).toBe(true);
    expect(isOnboardingRoute('/onboarding-modules?from=profile')).toBe(true);
  });

  it('indgangen er en af flowets egne ruter', () => {
    // Ellers ville vagten sende brugeren et sted hen, den selv ville afvise.
    expect(isOnboardingRoute(ONBOARDING_ENTRY_ROUTE)).toBe(true);
  });
});

describe('fuldførelse måles stadig på onboarded_at', () => {
  it('afledes af kolonnen, ikke af et udfyldt navn', () => {
    const store = read('store/useProfileStore.ts');
    expect(store).toContain('data.onboarded_at !== null');
    expect(store).not.toMatch(/hasOnboarded\s*=\s*!!data\.name/);
  });

  it('sættes af det sidste onboarding-trin', () => {
    expect(read('app/onboarding-modules.tsx')).toContain('markOnboarded()');
    expect(read('store/useProfileStore.ts')).toContain('onboarded_at: new Date().toISOString()');
  });
});

describe('layoutet bruger vagten frem for sin egen betingelse', () => {
  const layout = read('app/_layout.tsx');

  it('kalder den fælles beslutning', () => {
    expect(layout).toContain('shouldRedirectToOnboarding({');
    expect(layout).toContain('ONBOARDING_ENTRY_ROUTE');
  });

  it('har ikke længere en rute-blind omdirigering', () => {
    // Den gamle betingelse tog ikke hensyn til, hvor brugeren var.
    expect(layout).not.toMatch(/session\s*&&\s*!hasOnboarded\s*&&\s*\(\s*<Redirect/);
  });

  it('gætter ikke på rutenavnet med et præfiks', () => {
    expect(layout).not.toContain('startsWith("/onboarding-")');
  });
});

/**
 * Anden runde: vagten lod brugeren komme igennem, men flowet ryddede ikke op
 * efter sig.
 *
 * `router.replace` bytter kun det ØVERSTE punkt i stakken ud — alt under det
 * bliver liggende (se REPLACE i expo-routers StackRouter). Profilskærmen lagde
 * modulskærmen ovenpå med `push`, og modulskærmen erstattede så kun sig selv
 * med appen. Tilbage stod profilskærmen under Home: synlig som en overlejring,
 * og til at komme tilbage til. Rettelsen er navigationens semantik, ikke
 * hvordan skærmen præsenteres.
 */
describe('onboarding efterlader ingenting i historikken', () => {
  const profile = read('app/onboarding-profile.tsx');
  const modules = read('app/onboarding-modules.tsx');
  const pin = read('app/onboarding-pin.tsx');

  it('profil → moduler lægger sig ikke ovenpå', () => {
    expect(profile).toContain('router.replace("/onboarding-modules")');
    expect(profile).not.toContain('router.push');
  });

  it('intet trin i flowet bruger push', () => {
    // Et eneste push er nok til at efterlade et trin under appen bagefter.
    for (const source of [profile, modules, pin]) {
      expect(source).not.toMatch(/router\.push\s*\(/);
    }
  });

  it('fuldførelsen forlader hele flowet, ikke kun det øverste trin', () => {
    expect(modules).toContain("router.dismissTo('/(tabs)')");
    // Netop den her linje var fejlen: den efterlod alt under sig.
    expect(modules).not.toMatch(/router\.replace\s*\(\s*['"]\/\(tabs\)['"]/);
  });

  it('PIN-trinnet efterlader heller ikke /auth under appen', () => {
    expect(pin).toContain('router.dismissTo("/(tabs)")');
    expect(pin).not.toMatch(/router\.replace\s*\(\s*['"]\/\(tabs\)['"]/);
  });

  it('løses ikke ved at skjule overlejringen', () => {
    // Præsentationen er uændret. Var problemet blevet "løst" ved at fjerne
    // fullScreenModal, ville skærmen stadig ligge i historikken.
    const layout = read('app/_layout.tsx');
    for (const route of ['onboarding-profile', 'onboarding-pin', 'onboarding-modules']) {
      const screen = layout.slice(layout.indexOf(`name="${route}"`));
      expect(screen.slice(0, 200)).toContain('presentation: "fullScreenModal"');
    }
  });

  it('venter ikke på et tilfældigt tidspunkt', () => {
    // Fuldførelsen skrives til state før navigationen, så vagten allerede ser
    // hasOnboarded === true. Ingen setTimeout skal holde de to sammen.
    expect(modules.indexOf('markOnboarded()')).toBeLessThan(modules.indexOf('router.dismissTo'));
    for (const source of [profile, modules, pin]) {
      expect(source).not.toMatch(/setTimeout|requestAnimationFrame|InteractionManager/);
    }
  });
});

/**
 * Knappen på modulskærmen viste sin egen nøgle, `profile.onboardingSaveButton`,
 * fordi nøglen aldrig blev tilføjet. i18n var i orden — teksten manglede.
 */
describe('onboardings tekster findes på begge sprog', () => {
  const LOCALES = ['da', 'en'] as const;

  const bundle = (locale: string, namespace: string): Record<string, unknown> =>
    JSON.parse(read(path.join('localization', 'locales', locale, `${namespace}.json`)));

  it('knappen der afslutter onboarding har en tekst', () => {
    for (const locale of LOCALES) {
      expect(typeof bundle(locale, 'profile').onboardingSaveButton).toBe('string');
    }
  });

  it('hver nøgle onboarding-skærmene slår op findes i hvert sprog', () => {
    const screens = [
      'app/onboarding-profile.tsx',
      'app/onboarding-modules.tsx',
      'app/onboarding-pin.tsx',
    ];

    const missing: string[] = [];
    for (const screen of screens) {
      const keys = [...read(screen).matchAll(/\bt\(\s*['"]([\w.]+)['"]/g)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(0);

      for (const key of keys) {
        const [namespace, ...rest] = key.split('.');
        for (const locale of LOCALES) {
          const value = rest.reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            bundle(locale, namespace),
          );
          if (typeof value !== 'string') missing.push(`${locale}: ${key}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

/**
 * Tredje runde: den bruger, der har glemt sit kodeord UDEN at have gennemført
 * onboarding.
 *
 * Vagten sendte hende væk fra /new-password, fordi ruten ikke står på
 * onboarding-listen. Linket fra mailen blev brugt op, kodeordet aldrig sat, og
 * kontoen var reelt låst inde bag et trin, hun ikke kunne nå uden netop det
 * kodeord, hun manglede.
 *
 * Rettelsen er IKKE at sætte ruten på listen. Alt på den liste er åbent, fordi
 * det hedder det, det hedder — og så kunne man springe onboarding over ved at
 * navigere hertil. Adgangen hænger på en tilstand: er der en gendannelse i
 * gang? Se ADR-0021.
 */
describe('kodeordsgendannelse uden fuldført onboarding', () => {
  it('må sætte et nyt kodeord, mens gendannelsen står på', () => {
    expect(
      shouldRedirectToOnboarding(
        state({ isRecoveringPassword: true, pathname: PASSWORD_RECOVERY_ROUTE }),
      ),
    ).toBe(false);
  });

  it('men kan ikke bruge ruten til at snige sig uden om onboarding', () => {
    // Ingen gendannelse i gang: ruten er lige så lukket som resten af appen.
    expect(
      shouldRedirectToOnboarding(state({ pathname: PASSWORD_RECOVERY_ROUTE })),
    ).toBe(true);
  });

  it('og tilstanden alene åbner ikke resten af appen', () => {
    // Undtagelsen er en konjunktion. Var den det ikke, ville et gyldigt link
    // være en generalnøgle til hele appen uden onboarding.
    for (const pathname of ['/', '/economy', '/settings', '/settings/modules']) {
      expect(
        shouldRedirectToOnboarding(state({ isRecoveringPassword: true, pathname })),
      ).toBe(true);
    }
  });

  it('holder ruten ude af onboarding-listen', () => {
    // Står den dér, gælder undtagelsen på navnet alene — præcis hullet.
    expect(ONBOARDING_ROUTES).not.toContain(PASSWORD_RECOVERY_ROUTE);
    expect(isOnboardingRoute(PASSWORD_RECOVERY_ROUTE)).toBe(false);
  });

  it('genkender ruten trods skråstreg og query', () => {
    expect(isPasswordRecoveryRoute('/new-password')).toBe(true);
    expect(isPasswordRecoveryRoute('/new-password/')).toBe(true);
    expect(isPasswordRecoveryRoute('/new-password?type=recovery')).toBe(true);
    for (const pathname of ['/new-password-x', '/newpassword', '/onboarding-profile', '/']) {
      expect(isPasswordRecoveryRoute(pathname)).toBe(false);
    }
  });

  it('rører ikke en bruger, der er igennem onboarding', () => {
    for (const isRecoveringPassword of [true, false]) {
      for (const pathname of ['/', '/settings', PASSWORD_RECOVERY_ROUTE]) {
        expect(
          shouldRedirectToOnboarding(state({ hasOnboarded: true, isRecoveringPassword, pathname })),
        ).toBe(false);
      }
    }
  });

  it('gør stadig ingenting uden sprog eller session', () => {
    expect(
      shouldRedirectToOnboarding(
        state({ hasSession: false, isRecoveringPassword: true, pathname: PASSWORD_RECOVERY_ROUTE }),
      ),
    ).toBe(false);
  });
});

/**
 * Tilstanden er kun værd at stole på, hvis den ikke kan sættes andre steder end
 * dér, hvor serveren har godkendt linkets tokens.
 */
describe('hvornår en gendannelse regnes for i gang', () => {
  const store = read('store/useAuthStore.ts');

  it('sættes kun efter at serveren har accepteret linkets tokens', () => {
    const occurrences = store.match(/isRecoveringPassword: true/g) ?? [];
    expect(occurrences).toHaveLength(1);

    const begin = store.slice(store.indexOf('beginPasswordRecovery: async'));
    const body = begin.slice(0, begin.indexOf('setNewPassword: async'));
    expect(body).toContain('isRecoveringPassword: true');
    // Efter fejl-returneringen — ellers ville et afvist link tælle som adgang.
    expect(body.indexOf('if (error) return')).toBeLessThan(
      body.indexOf('isRecoveringPassword: true'),
    );
  });

  it('lukker igen, når kodeordet er sat', () => {
    const setNew = store.slice(store.indexOf('setNewPassword: async'));
    const body = setNew.slice(0, setNew.indexOf('signIn: async'));
    expect(body).toContain('isRecoveringPassword: false');
    expect(body.indexOf('if (error) return')).toBeLessThan(
      body.indexOf('isRecoveringPassword: false'),
    );
  });

  it('lukker også ved log ud og ved almindeligt login', () => {
    expect(store).toMatch(/if \(!session\) set\(\{ isRecoveringPassword: false \}\)/);
    const signIn = store.slice(store.indexOf('signIn: async'));
    expect(signIn.slice(0, signIn.indexOf('signOut:'))).toContain('isRecoveringPassword: false');
  });

  it('overlever ikke en genstart', () => {
    // Ingen persist på auth-store'en: flaget dør med processen, så en genstart
    // ikke kan genoplive adgangen til skærmen.
    expect(store).not.toMatch(/persist\(/);
  });
});

describe('layoutet giver vagten den rigtige tilstand', () => {
  const layout = read('app/_layout.tsx');

  it('læser gendannelsestilstanden fra auth-store\'en', () => {
    expect(layout).toContain('useAuthStore((s) => s.isRecoveringPassword)');
    expect(layout).toContain('isRecoveringPassword,');
  });

  it('åbner ikke skærmen på rutenavnet alene', () => {
    expect(layout).not.toMatch(/pathname\s*===\s*["']\/new-password["']/);
  });

  it('efterlader ikke gendannelsen i historikken', () => {
    // Samme grund som i onboarding: replace bytter kun det øverste punkt ud.
    expect(layout).toContain('router.replace("/new-password")');
    expect(read('app/new-password.tsx')).toContain("router.dismissTo('/')");
    expect(read('app/new-password.tsx')).not.toContain("router.replace('/')");
  });

  it('bruger ingen timere til at holde tilstand og navigation sammen', () => {
    const handler = layout.slice(layout.indexOf('const handleUrl'));
    expect(handler.slice(0, 600)).not.toMatch(/setTimeout|requestAnimationFrame/);
  });
});
