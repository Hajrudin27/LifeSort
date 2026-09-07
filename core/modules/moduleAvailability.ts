/**
 * Modulernes modenhedstilstand og den centrale evaluator (APP-005).
 *
 * Filen kender ikke til hvilke moduler der findes — kun til tilstandene og hvad
 * de betyder. Selve modul-listen og hvert moduls tilstand ligger i
 * moduleRegistry.ts (APP-009), så metadata kun står ét sted.
 *
 * Et halvfærdigt modul må ikke ligne et færdigt. Uden én fælles tilstand ender
 * hver skærm med sin egen halve variant — en `if` her, et skjult tab der — og
 * så er der ingen, der kan svare på, hvad brugeren egentlig kan lige nu.
 *
 * Den vigtigste regel står i specifikationen §1.2: et flag må ALDRIG gøre
 * eksisterende brugerdata utilgængelige. Uanset tilstand kan brugeren derfor
 * altid eksportere og slette sine egne data — det er en rettighed, ikke en
 * feature der kan slås fra. Evaluatoren håndhæver det for alle tilstande.
 *
 * Hvor tilstanden KOMMER fra (remote flags, kill switches) er APP-006. Her
 * erklæres den lokalt, så der er ét sted at rette, indtil den kommer udefra.
 */

export const MODULE_AVAILABILITY_STATES = [
  'hidden', // findes i koden, men ikke for brugeren
  'internal', // kun for udvikling/founder
  'beta', // for brugere der udtrykkeligt er med i beta
  'available', // i produktion
  'maintenance', // læsning bevaret, nye handlinger sat på pause
  'retired', // udfaset; kun eksport/sletning tilbage
] as const;

export type ModuleAvailability = (typeof MODULE_AVAILABILITY_STATES)[number];

/**
 * Hvem der kigger. Kilden til de her flag findes ikke endnu (der er ingen
 * rolle- eller beta-model i appen), så de er false som standard — en bruger
 * uden bevis er ikke intern.
 */
export type ModuleViewer = {
  isInternalUser: boolean;
  isBetaTester: boolean;
};

export const PUBLIC_VIEWER: ModuleViewer = {
  isInternalUser: false,
  isBetaTester: false,
};

/** Hvorfor et modul ser ud som det gør — så UI kan sige det, i stedet for at vise en tom skærm. */
export type ModuleAccessStatus =
  | 'active'
  | 'unreleased'
  | 'internal-only'
  | 'beta-only'
  | 'maintenance'
  | 'retired';

export type ModuleAccess = {
  /** Må modulet optræde i navigation, launcher og Home? */
  showInNavigation: boolean;
  /** Må modulets egne skærme åbnes? */
  canOpenModule: boolean;
  /** Må eksisterende indhold vises inde i modulet? */
  canViewExistingData: boolean;
  /** Må brugeren oprette nyt indhold? */
  canCreate: boolean;
  /** Må brugeren ændre eksisterende indhold? */
  canEdit: boolean;
  /** Datarettighed — altid true. */
  canExportData: boolean;
  /** Datarettighed — altid true. */
  canDeleteData: boolean;
  status: ModuleAccessStatus;
};

/** Fuld adgang — det et modul i produktion giver. */
function activeAccess(status: ModuleAccessStatus): ModuleAccess {
  return {
    showInNavigation: true,
    canOpenModule: true,
    canViewExistingData: true,
    canCreate: true,
    canEdit: true,
    canExportData: true,
    canDeleteData: true,
    status,
  };
}

/**
 * Modulet findes ikke for den her bruger. Bemærk at eksport og sletning stadig
 * er tilladt: har brugeren data fra dengang modulet var åbent, er de hans.
 */
function invisibleAccess(status: ModuleAccessStatus): ModuleAccess {
  return {
    showInNavigation: false,
    canOpenModule: false,
    canViewExistingData: false,
    canCreate: false,
    canEdit: false,
    canExportData: true,
    canDeleteData: true,
    status,
  };
}

/**
 * Den centrale evaluator. Ét sted der oversætter modenhed til "hvad kan
 * brugeren gøre" — resten af appen spørger her frem for at gætte.
 */
export function evaluateModuleAccess(
  availability: ModuleAvailability,
  viewer: ModuleViewer = PUBLIC_VIEWER,
): ModuleAccess {
  switch (availability) {
    case 'available':
      return activeAccess('active');

    case 'internal':
      return viewer.isInternalUser ? activeAccess('active') : invisibleAccess('internal-only');

    case 'beta':
      // Interne brugere kan se beta-moduler; ellers ville de ikke kunne teste dem.
      return viewer.isBetaTester || viewer.isInternalUser
        ? activeAccess('active')
        : invisibleAccess('beta-only');

    case 'hidden':
      return invisibleAccess('unreleased');

    case 'maintenance':
      // Kernen i APP-005: modulet er åbent og læsbart, men tager ikke imod nyt.
      return {
        showInNavigation: true,
        canOpenModule: true,
        canViewExistingData: true,
        canCreate: false,
        canEdit: false,
        canExportData: true,
        canDeleteData: true,
        status: 'maintenance',
      };

    case 'retired':
      // Modulets skærme er væk, men dataene er der stadig og kan hentes ud.
      return invisibleAccess('retired');
  }
}
