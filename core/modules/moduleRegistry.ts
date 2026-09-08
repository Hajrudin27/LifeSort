/**
 * Modul-registret (APP-009).
 *
 * Ét sted der ved hvilke moduler der findes, og hvad de er. Home, søgning,
 * privatlivscenteret, notifikationer og feature flags spørger her frem for hver
 * især at kende hvert domænes indre — og et nyt modul kræver derfor ikke
 * ændringer seks urelaterede steder.
 *
 * Kontrakten følger specifikationens §4.1. De valgfrie handlers er bevidst
 * udefinerede endnu: hver af dem hører til den story der giver dem mening
 * (homeSnapshot i APP-011, searchEntries i APP-077, export/delete i
 * APP-097/098). Registret erklærer formen; det opfinder ikke indholdet.
 */

import type { ModuleAccess, ModuleAvailability, ModuleViewer } from './moduleAvailability';
import { evaluateModuleAccess, PUBLIC_VIEWER } from './moduleAvailability';

export const MODULE_IDS = [
  'core-shell',
  'account',
  'economy',
  'food',
  'home',
  'goals',
  'habits',
  'tasks',
  'travel',
  'warranties',
  'career',
  'cycle',
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

/**
 * Moduler der udgør selve appen. De kan ikke slås fra — uden dem er der ingen
 * app tilbage at slå til.
 */
export const PLATFORM_MODULE_IDS = ['core-shell', 'account'] as const satisfies readonly ModuleId[];

/** Specifikationens §4.1. Klassificeringen følger data, ikke skærmens navn. */
export type DataSensitivity = 'ordinary' | 'personal' | 'financial' | 'health' | 'document';

/** Specifikationens §9.2 — bestemmer hvor meget der må stå på låseskærmen. */
export type NotificationCategory = 'ordinary' | 'personal' | 'financial' | 'health' | 'security';

/** Specifikationens §11.1. Der findes ingen entitlement-model endnu (APP-131). */
export type EntitlementKey = 'bank_sync' | 'advanced_insights' | 'ai_monthly_quota' | 'cloud_document_limit';

/** Specifikationens Bilag A. Små, privacy-sikre kort — ikke domæne-objekter. */
export interface HomeSnapshot {
  moduleId: ModuleId;
  titleKey: string;
  /**
   * Færdigformateret værdi — til tal og beløb, der ser ens ud på alle sprog.
   * Skal værdien oversættes ("Om 5 dage"), bruges `valueKey` i stedet: et modul
   * må ikke gætte brugerens sprog, og skallen skal ikke parse strenge.
   * Højst ét af de to felter må være sat.
   */
  value?: string;
  valueKey?: string;
  valueParams?: Record<string, string | number>;
  helperKey?: string;
  /**
   * Værdier til hjælpeteksten. Nødvendig fordi hjælpeteksten er en i18n-nøgle:
   * uden den kunne et modul kun sende færdigoversat tekst, og så ville det
   * skulle kende brugerens sprog for at lave et kort.
   *
   * Bemærk: her kan brugerindhold havne (fx et rejsenavn). Se
   * docs/home-snapshots.md §3 — det er derfor kortet også bærer sensitivity.
   */
  helperParams?: Record<string, string | number>;
  priority: 'normal' | 'important' | 'urgent';
  sensitivity: DataSensitivity;
  route: string;
}

/**
 * Foreløbig form. Specifikationen navngiver typen, men beskriver den ikke, og
 * APP-077 ejer indekset — herunder hvilke felter der overhovedet må indekseres.
 */
export interface SearchEntry {
  moduleId: ModuleId;
  titleKey: string;
  route: string;
  keywords?: string[];
}

export type ExportHandler = () => Promise<unknown>;
export type DeleteHandler = () => Promise<void>;

export interface ModuleDefinition {
  id: ModuleId;
  availability: ModuleAvailability;
  /** i18n-nøgler. Modulets navn skal kunne vises uden at skærmen kender modulet. */
  titleKey: string;
  descriptionKey: string;
  /** Alle klasser af data modulet selv ejer — ikke dem det viser for andre. */
  sensitivity: DataSensitivity[];
  /**
   * Stier modulet ejer. Skallen bruger dem til at slå en rute op i et modul, så
   * en kill switch virker uanset om brugeren kom fra et tab, en hub eller et
   * deep link. Tom for skallen selv, som er fallback.
   */
  routeRoots: string[];
  requiredEntitlements?: EntitlementKey[];
  notificationCategory?: NotificationCategory;
  homeSnapshot?: () => Promise<HomeSnapshot | null>;
  searchEntries?: () => Promise<SearchEntry[]>;
  exportHandler?: ExportHandler;
  deleteHandler?: DeleteHandler;
}

/**
 * De moduler der findes i dag. Holdes i sync med docs/app-inventory.md §1 af
 * __tests__/moduleRegistry.test.ts.
 *
 * Bemærk `core-shell`: den ejer kun ordinary data (indstillinger, tema,
 * synkstatus, flag). At Home VISER økonomi og helbred gør ikke skallen til
 * ejer af dem — det er en visnings-bekymring, som APP-013 tager sig af.
 */
export const MODULE_REGISTRY: Record<ModuleId, ModuleDefinition> = {
  'core-shell': {
    id: 'core-shell',
    availability: 'available',
    titleKey: 'modules.names.core-shell',
    descriptionKey: 'modules.descriptions.core-shell',
    sensitivity: ['ordinary'],
    routeRoots: [],
  },
  account: {
    id: 'account',
    availability: 'available',
    titleKey: 'modules.names.account',
    descriptionKey: 'modules.descriptions.account',
    sensitivity: ['personal'],
    routeRoots: ['/settings', '/auth', '/language', '/onboarding-profile', '/onboarding-pin', '/onboarding-modules', '/new-password'],
    notificationCategory: 'security',
  },
  economy: {
    id: 'economy',
    availability: 'available',
    titleKey: 'modules.names.economy',
    descriptionKey: 'modules.descriptions.economy',
    sensitivity: ['ordinary', 'financial', 'document'],
    routeRoots: ['/economy', '/expenses', '/savings'],
    notificationCategory: 'financial',
  },
  food: {
    id: 'food',
    availability: 'available',
    titleKey: 'modules.names.food',
    descriptionKey: 'modules.descriptions.food',
    sensitivity: ['ordinary', 'financial'],
    routeRoots: ['/food'],
  },
  home: {
    id: 'home',
    availability: 'available',
    titleKey: 'modules.names.home',
    descriptionKey: 'modules.descriptions.home',
    sensitivity: ['ordinary'],
    routeRoots: ['/household'],
  },
  goals: {
    id: 'goals',
    availability: 'available',
    titleKey: 'modules.names.goals',
    descriptionKey: 'modules.descriptions.goals',
    sensitivity: ['personal'],
    routeRoots: ['/life-goals'],
  },
  habits: {
    id: 'habits',
    availability: 'available',
    titleKey: 'modules.names.habits',
    descriptionKey: 'modules.descriptions.habits',
    sensitivity: ['ordinary'],
    routeRoots: ['/habits'],
  },
  tasks: {
    id: 'tasks',
    availability: 'available',
    titleKey: 'modules.names.tasks',
    descriptionKey: 'modules.descriptions.tasks',
    sensitivity: ['ordinary'],
    routeRoots: ['/todos'],
  },
  travel: {
    id: 'travel',
    availability: 'available',
    titleKey: 'modules.names.travel',
    descriptionKey: 'modules.descriptions.travel',
    sensitivity: ['personal', 'financial', 'document'],
    routeRoots: ['/travel'],
    notificationCategory: 'personal',
  },
  warranties: {
    id: 'warranties',
    availability: 'available',
    titleKey: 'modules.names.warranties',
    descriptionKey: 'modules.descriptions.warranties',
    sensitivity: ['document', 'financial'],
    routeRoots: ['/warranties'],
    notificationCategory: 'personal',
  },
  career: {
    id: 'career',
    availability: 'available',
    titleKey: 'modules.names.career',
    descriptionKey: 'modules.descriptions.career',
    sensitivity: ['ordinary', 'personal', 'document'],
    routeRoots: ['/career'],
  },
  cycle: {
    id: 'cycle',
    availability: 'available',
    titleKey: 'modules.names.cycle',
    descriptionKey: 'modules.descriptions.cycle',
    sensitivity: ['health'],
    routeRoots: ['/cycle'],
    // Generisk som standard — en påmindelse må ikke afsløre en cyklus på
    // låseskærmen. Se specifikationen §9.2 og APP-073.
    notificationCategory: 'health',
  },
};

export function getModule(moduleId: ModuleId): ModuleDefinition {
  return MODULE_REGISTRY[moduleId];
}

export function listModules(): ModuleDefinition[] {
  return MODULE_IDS.map((moduleId) => MODULE_REGISTRY[moduleId]);
}

/** Modulets erklærede tilstand, oversat til hvad brugeren må. */
export function moduleAccess(moduleId: ModuleId, viewer: ModuleViewer = PUBLIC_VIEWER): ModuleAccess {
  return evaluateModuleAccess(MODULE_REGISTRY[moduleId].availability, viewer);
}
