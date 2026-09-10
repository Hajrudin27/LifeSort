/**
 * APP-027 - Data Profile Registry.
 *
 * This is deliberately declarative. It classifies logical datasets and the
 * physical places that currently contain them; it does not encrypt, sync,
 * migrate, reconcile or split existing stores.
 */

export type DataProfile = 'A' | 'B' | 'C' | 'D';

export type LocalCopyExpectation = 'expected' | 'none' | 'minimal-cache' | 'versioned-cache';
export type CanonicalAuthority = 'client' | 'server' | 'admin-pipeline';
export type LocalStorageProtection = 'plaintext-allowed' | 'encrypted-required' | 'no-plaintext-cache';

type ProfileAContract = {
  profile: 'A';
  expectsLocalCopy: 'expected';
  expectsServerSync: boolean;
  plaintextLocalPersistenceAllowed: true;
  encryptedLocalPersistenceRequired: false;
  clientAuthoritative: true;
  normalClientWritable: true;
  globallyReadableReference: false;
  userOwned: true;
  canonicalAuthority: 'client';
};

type ProfileBContract = {
  profile: 'B';
  expectsLocalCopy: 'expected';
  expectsServerSync: boolean;
  plaintextLocalPersistenceAllowed: false;
  encryptedLocalPersistenceRequired: true;
  clientAuthoritative: true;
  normalClientWritable: true;
  globallyReadableReference: false;
  userOwned: true;
  canonicalAuthority: 'client';
};

type ProfileCContract = {
  profile: 'C';
  expectsLocalCopy: 'none' | 'minimal-cache';
  expectsServerSync: false;
  plaintextLocalPersistenceAllowed: false;
  encryptedLocalPersistenceRequired: false;
  clientAuthoritative: false;
  normalClientWritable: false;
  globallyReadableReference: false;
  userOwned: false;
  canonicalAuthority: 'server';
};

type ProfileDContract = {
  profile: 'D';
  expectsLocalCopy: 'none' | 'versioned-cache';
  expectsServerSync: false;
  plaintextLocalPersistenceAllowed: true;
  encryptedLocalPersistenceRequired: false;
  clientAuthoritative: false;
  normalClientWritable: false;
  globallyReadableReference: true;
  userOwned: false;
  canonicalAuthority: 'admin-pipeline';
};

export type DataProfileContract = ProfileAContract | ProfileBContract | ProfileCContract | ProfileDContract;

export type DomainModule =
  | 'account'
  | 'core-shell'
  | 'economy'
  | 'food'
  | 'home'
  | 'goals'
  | 'habits'
  | 'tasks'
  | 'travel'
  | 'warranties'
  | 'career'
  | 'cycle'
  | 'shared';

export type DomainRecord = {
  id: string;
  title: string;
  module: DomainModule;
  description: string;
  storageSurfaces: readonly string[];
  evidence: readonly string[];
  ambiguous?: string;
} & DataProfileContract;

const profileA = (overrides: {
  expectsServerSync: boolean;
}): ProfileAContract => ({
  profile: 'A',
  expectsLocalCopy: 'expected',
  expectsServerSync: overrides.expectsServerSync,
  plaintextLocalPersistenceAllowed: true,
  encryptedLocalPersistenceRequired: false,
  clientAuthoritative: true,
  normalClientWritable: true,
  globallyReadableReference: false,
  userOwned: true,
  canonicalAuthority: 'client',
});

const profileB = (overrides: {
  expectsServerSync: boolean;
}): ProfileBContract => ({
  profile: 'B',
  expectsLocalCopy: 'expected',
  expectsServerSync: overrides.expectsServerSync,
  plaintextLocalPersistenceAllowed: false,
  encryptedLocalPersistenceRequired: true,
  clientAuthoritative: true,
  normalClientWritable: true,
  globallyReadableReference: false,
  userOwned: true,
  canonicalAuthority: 'client',
});

const profileC = (overrides: {
  expectsLocalCopy?: 'none' | 'minimal-cache';
} = {}): ProfileCContract => ({
  profile: 'C',
  expectsLocalCopy: overrides.expectsLocalCopy ?? 'none',
  expectsServerSync: false,
  plaintextLocalPersistenceAllowed: false,
  encryptedLocalPersistenceRequired: false,
  clientAuthoritative: false,
  normalClientWritable: false,
  globallyReadableReference: false,
  userOwned: false,
  canonicalAuthority: 'server',
});

const profileD = (overrides: {
  expectsLocalCopy?: 'none' | 'versioned-cache';
} = {}): ProfileDContract => ({
  profile: 'D',
  expectsLocalCopy: overrides.expectsLocalCopy ?? 'versioned-cache',
  expectsServerSync: false,
  plaintextLocalPersistenceAllowed: true,
  encryptedLocalPersistenceRequired: false,
  clientAuthoritative: false,
  normalClientWritable: false,
  globallyReadableReference: true,
  userOwned: false,
  canonicalAuthority: 'admin-pipeline',
});

export const DATA_DOMAINS = [
  {
    id: 'account.auth-identity',
    title: 'Supabase Auth identity and credentials',
    module: 'account',
    description: 'Email, password hash and verification state owned by Supabase Auth.',
    storageSurfaces: ['supabase-auth:auth.users'],
    evidence: ['lib/supabase.ts', 'store/useAuthStore.ts'],
    ...profileC(),
  },
  {
    id: 'account.auth-session',
    title: 'Device auth session',
    module: 'account',
    description: 'Access and refresh token cache for the current device session.',
    storageSurfaces: ['secure-store:supabase-session', 'async-storage:supabase-session-web-or-legacy'],
    evidence: ['lib/supabase.ts', 'utils/auth/secureSessionStorage.ts'],
    ...profileC({ expectsLocalCopy: 'minimal-cache' }),
  },
  {
    id: 'account.profile',
    title: 'Profile fields',
    module: 'account',
    description: 'Display name, optional gender, partner name and remaining profile preferences.',
    storageSurfaces: ['async-storage:lifesort-profile', 'supabase-table:profiles'],
    evidence: ['store/useProfileStore.ts', 'docs/data-sdk-inventory.md'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'account.onboarding',
    title: 'Onboarding completion',
    module: 'account',
    description: 'Whether the signed-in user completed onboarding.',
    storageSurfaces: ['async-storage:lifesort-profile', 'supabase-table:profiles'],
    evidence: ['store/useProfileStore.ts', 'supabase/migrations/20260908233200_profiles_onboarded_at.sql'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'account.password-recovery-throttle',
    title: 'Verification and recovery resend throttle',
    module: 'account',
    description: 'Device-local timestamp limiting resend attempts.',
    storageSurfaces: ['async-storage:lifesort-verification-last-sent'],
    evidence: ['core/auth/emailVerification.ts', 'docs/data-sdk-inventory.md'],
    ...profileA({ expectsServerSync: false }),
  },
  {
    id: 'account.app-lock',
    title: 'Local app-lock secret and state',
    module: 'account',
    description: 'App-lock enabled flag, PIN hash and PIN lockout state. It protects this phone only.',
    storageSurfaces: [
      'async-storage:lifesort-app-lock',
      'secure-store:lifesort-app-pin-hash',
      'secure-store:lifesort-pin-lockout',
    ],
    evidence: ['store/useAppLockStore.ts', 'utils/auth/pinAuth.ts', 'utils/auth/pinLockout.ts'],
    ...profileB({ expectsServerSync: false }),
  },
  {
    id: 'core.preferences',
    title: 'Language and theme preferences',
    module: 'core-shell',
    description: 'Ordinary app preferences, currently split across settings and theme stores.',
    storageSurfaces: ['async-storage:lifesort-settings', 'async-storage:lifesort-theme', 'supabase-table:settings'],
    evidence: ['store/useSettingsStore.ts', 'store/useThemeStore.ts'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'core.module-choice',
    title: 'Chosen modules',
    module: 'core-shell',
    description: 'User-selected module enablement. Turning a module off never deletes data.',
    storageSurfaces: ['async-storage:lifesort-enabled-modules', 'supabase-table:user_modules'],
    evidence: ['store/useEnabledModulesStore.ts', 'supabase/migrations/20260908233100_user_modules.sql'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'core.home-layout',
    title: 'Home layout and privacy state',
    module: 'core-shell',
    description: 'Pinned, hidden and masked Home cards plus module recency.',
    storageSurfaces: ['async-storage:lifesort-home-layout'],
    evidence: ['store/useHomeLayoutStore.ts'],
    ...profileA({ expectsServerSync: false }),
  },
  {
    id: 'core.monthly-review-preference',
    title: 'Monthly review preference',
    module: 'core-shell',
    description: 'Whether the deterministic monthly review is shown on Home.',
    storageSurfaces: ['async-storage:lifesort-monthly-review'],
    evidence: ['store/useReviewStore.ts'],
    ...profileA({ expectsServerSync: false }),
  },
  {
    id: 'core.sync-status',
    title: 'Sync failure status',
    module: 'core-shell',
    description: 'Local sync failure bookkeeping with operation names and no record payloads.',
    storageSurfaces: ['async-storage:sync-status'],
    evidence: ['store/useSyncStatusStore.ts'],
    ...profileA({ expectsServerSync: false }),
  },
  {
    id: 'core.module-flags',
    title: 'Module kill switches',
    module: 'core-shell',
    description: 'Operator-controlled module availability cached on device so closed modules stay closed offline.',
    storageSurfaces: ['async-storage:lifesort-module-flags', 'supabase-table:module_flags'],
    evidence: ['store/useModuleFlagsStore.ts', 'supabase/migrations/20260908233000_module_flags.sql'],
    ...profileD({ expectsLocalCopy: 'versioned-cache' }),
  },
  {
    id: 'core.local-backup-archive',
    title: 'User-created local backup archive',
    module: 'core-shell',
    description: 'JSON backup written to the document directory and handed to the OS share sheet.',
    storageSurfaces: ['filesystem:document-directory/lifesort-backup-json'],
    evidence: ['utils/shared/dataBackup.ts', 'utils/shared/backupValidation.ts'],
    ambiguous: 'The current backup excludes cycle data but includes stores that may contain attachment metadata; APP-097 owns the export policy.',
    ...profileB({ expectsServerSync: false }),
  },
  {
    id: 'economy.expenses',
    title: 'Expenses and category budgets',
    module: 'economy',
    description: 'User-created expense records and budget limits.',
    storageSurfaces: ['async-storage:lifesort-expenses', 'supabase-table:expenses', 'supabase-table:expense_category_budgets'],
    evidence: ['store/useExpensesStore.ts'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'economy.income',
    title: 'Income entries',
    module: 'economy',
    description: 'User-created monthly income values.',
    storageSurfaces: ['async-storage:lifesort-income-v2', 'supabase-table:income'],
    evidence: ['store/useIncomeStore.ts'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'economy.savings',
    title: 'Savings goals and history',
    module: 'economy',
    description: 'User-created savings goals, contributions and extra savings.',
    storageSurfaces: [
      'async-storage:lifesort-savings-goals',
      'supabase-table:savings_goals',
      'supabase-table:savings_history',
      'supabase-table:savings_extra',
    ],
    evidence: ['store/useSavingsGoalsStore.ts'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'economy.categories',
    title: 'Expense categories',
    module: 'economy',
    description: 'Built-in and user-created budget category names.',
    storageSurfaces: ['async-storage:lifesort-categories', 'supabase-table:categories'],
    evidence: ['store/useCategoriesStore.ts'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'economy.attachments',
    title: 'Expense receipt attachments',
    module: 'economy',
    description: 'Receipt files and metadata attached to expense records.',
    storageSurfaces: [
      'async-storage:lifesort-expenses',
      'supabase-table:attachments',
      'supabase-storage-bucket:attachments',
      'filesystem:document-directory/attachments',
      'filesystem:cache-directory/lifesort-decrypted-attachments',
      'secure-store:lifesort-document-cache-key',
    ],
    evidence: ['store/useExpensesStore.ts', 'utils/shared/attachmentStorage.ts', 'utils/shared/attachmentSync.ts'],
    ...profileB({ expectsServerSync: true }),
  },
  {
    id: 'food.user-grocery-finance',
    title: 'User grocery budgets, purchases and prices',
    module: 'food',
    description: 'User-created grocery budget, purchase log, store offers and standard prices.',
    storageSurfaces: [
      'async-storage:lifesort-food-v2',
      'supabase-table:food_monthly_budget',
      'supabase-table:food_purchases',
      'supabase-table:food_offers',
      'supabase-table:food_standard_prices',
    ],
    evidence: ['store/useFoodStore.ts'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'food.user-planning',
    title: 'User food planning data',
    module: 'food',
    description: 'Pantry items, shopping items, user recipes, saved plans and selected stores.',
    storageSurfaces: [
      'async-storage:lifesort-food-v2',
      'supabase-table:food_pantry_items',
      'supabase-table:food_shopping_items',
      'supabase-table:food_recipes',
      'supabase-table:food_saved_plans',
      'supabase-table:food_selected_stores',
    ],
    evidence: ['store/useFoodStore.ts'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'food.seed-recipes',
    title: 'Bundled seed recipes',
    module: 'food',
    description: 'Recipe content bundled with the app and reseeded by locale.',
    storageSurfaces: ['async-storage:lifesort-food-v2', 'bundled-source:data/seedRecipes'],
    evidence: ['data/seedRecipes.ts', 'features/localStores.ts'],
    ...profileD({ expectsLocalCopy: 'versioned-cache' }),
  },
  {
    id: 'food.global-catalogue',
    title: 'Global food catalogue and prices',
    module: 'food',
    description: 'Admin-reviewed product, recipe, price and offer reference data.',
    storageSurfaces: [
      'async-storage:lifesort-food-v2',
      'supabase-table:products',
      'supabase-table:global_recipes',
      'supabase-table:global_standard_prices',
      'supabase-table:global_offers',
      'supabase-storage-bucket:recipe-images',
    ],
    evidence: ['store/useFoodStore.ts', 'supabase/migrations/20260902112000_remote_schema.sql', 'supabase/migrations/20260905140726_add_products_table.sql'],
    ...profileD({ expectsLocalCopy: 'versioned-cache' }),
  },
  {
    id: 'home.household',
    title: 'Household tasks, shopping and moving lists',
    module: 'home',
    description: 'User-created chores, household shopping items and moving checklist items.',
    storageSurfaces: [
      'async-storage:lifesort-household',
      'supabase-table:household_tasks',
      'supabase-table:household_shopping_items',
      'supabase-table:household_moving_items',
    ],
    evidence: ['store/useHouseholdStore.ts'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'goals.life-goals',
    title: 'Life goals and sub-goals',
    module: 'goals',
    description: 'User-created long-term goals and progress.',
    storageSurfaces: ['async-storage:lifesort-life-goals', 'supabase-table:life_goals'],
    evidence: ['store/useLifeGoalsStore.ts'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'habits.habits',
    title: 'Habits and daily logs',
    module: 'habits',
    description: 'User-created habit definitions and completion history.',
    storageSurfaces: ['async-storage:lifesort-habits', 'supabase-table:habits'],
    evidence: ['store/useHabitsStore.ts'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'tasks.todos',
    title: 'To-dos',
    module: 'tasks',
    description: 'User-created task list.',
    storageSurfaces: ['async-storage:lifesort-todos', 'supabase-table:todos'],
    evidence: ['store/useTodoStore.ts'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'travel.trips',
    title: 'Trips, budgets, packing and participants',
    module: 'travel',
    description: 'Trip records, budget, packing items, trip expenses and participant invite state.',
    storageSurfaces: [
      'async-storage:lifesort-trips',
      'supabase-table:trips',
      'supabase-table:trip_expenses',
      'supabase-table:trip_packing_items',
      'supabase-table:trip_participants',
    ],
    evidence: ['store/useTripsStore.ts'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'travel.attachments',
    title: 'Trip attachment cache',
    module: 'travel',
    description: 'Boarding pass, booking document and trip-expense attachment files and metadata.',
    storageSurfaces: [
      'async-storage:lifesort-trips',
      'filesystem:document-directory/attachments',
      'filesystem:cache-directory/lifesort-decrypted-attachments',
      'secure-store:lifesort-document-cache-key',
    ],
    evidence: ['store/useTripsStore.ts', 'components/TripAttachmentGrid.tsx', 'utils/shared/attachmentStorage.ts'],
    ...profileB({ expectsServerSync: false }),
  },
  {
    id: 'warranties.records',
    title: 'Warranty and insurance records',
    module: 'warranties',
    description: 'User-created warranty, receipt and insurance reminders, excluding attached files.',
    storageSurfaces: ['async-storage:lifesort-warranties', 'supabase-table:warranties'],
    evidence: ['store/useWarrantiesStore.ts'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'warranties.attachments',
    title: 'Warranty receipt attachments',
    module: 'warranties',
    description: 'Receipt, warranty and insurance files plus their metadata.',
    storageSurfaces: [
      'async-storage:lifesort-warranties',
      'supabase-table:attachments',
      'supabase-storage-bucket:attachments',
      'filesystem:document-directory/attachments',
      'filesystem:cache-directory/lifesort-decrypted-attachments',
      'secure-store:lifesort-document-cache-key',
    ],
    evidence: ['store/useWarrantiesStore.ts', 'utils/shared/attachmentStorage.ts', 'utils/shared/attachmentSync.ts'],
    ...profileB({ expectsServerSync: true }),
  },
  {
    id: 'career.applications',
    title: 'Job applications',
    module: 'career',
    description: 'User-created application tracker entries and notes.',
    storageSurfaces: ['async-storage:lifesort-career', 'supabase-table:job_applications'],
    evidence: ['store/useCareerStore.ts'],
    ambiguous: 'Application notes can become private notes; human review should decide whether APP-028/029 should later raise this domain to Profile B.',
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'career.skills',
    title: 'Skills and skill categories',
    module: 'career',
    description: 'User-created skills and local category labels.',
    storageSurfaces: ['async-storage:lifesort-career', 'async-storage:lifesort-skill-categories', 'supabase-table:skills'],
    evidence: ['store/useCareerStore.ts', 'store/useSkillCategoriesStore.ts'],
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'career.cv',
    title: 'CV content and versions',
    module: 'career',
    description: 'CV personal information, education, experience, languages and generated-version metadata.',
    storageSurfaces: [
      'async-storage:lifesort-cv',
      'supabase-table:cv_personal_info',
      'supabase-table:cv_education',
      'supabase-table:cv_experience',
      'supabase-table:cv_languages',
      'supabase-table:cv_versions',
    ],
    evidence: ['store/useCVStore.ts', 'utils/cv/generateCvPdf.ts'],
    ambiguous: 'CV content is document-like personal data. The current registry keeps it Profile A because it is user-authored career data, not cached sensitive documents; review before APP-029.',
    ...profileA({ expectsServerSync: true }),
  },
  {
    id: 'cycle.user-health',
    title: 'Cycle health data',
    module: 'cycle',
    description: 'Cycle dates, symptom logs, free-text notes, prediction settings and reminder preferences.',
    storageSurfaces: [
      'async-storage:lifesort-cycle',
      'secure-store:lifesort-cycle-health-key',
      'supabase-table:cycles',
      'supabase-table:symptom_logs',
      'supabase-table:cycle_settings',
    ],
    evidence: ['store/useCycleStore.ts'],
    ...profileB({ expectsServerSync: true }),
  },
  {
    id: 'cycle.reference-content',
    title: 'Reviewed health reference content',
    module: 'cycle',
    description: 'Admin-reviewed conditions and symptom glossary content shared by all users.',
    storageSurfaces: [
      'async-storage:lifesort-cycle',
      'supabase-table:health_conditions',
      'supabase-table:symptom_glossary',
    ],
    evidence: ['store/useCycleStore.ts', 'supabase/migrations/20260904091630_add_health_info_content.sql'],
    ...profileD({ expectsLocalCopy: 'versioned-cache' }),
  },
] as const satisfies readonly DomainRecord[];

export type DataDomain = (typeof DATA_DOMAINS)[number];
export type DataDomainId = DataDomain['id'];

export type PersistenceSurfaceKind =
  | 'async-storage'
  | 'secure-store'
  | 'supabase-auth'
  | 'supabase-table'
  | 'supabase-storage-bucket'
  | 'filesystem'
  | 'bundled-source';

export interface PersistenceSurface {
  id: string;
  kind: PersistenceSurfaceKind;
  label: string;
  location: 'device' | 'supabase' | 'bundle';
  containsDomains: readonly DataDomainId[];
  evidence: readonly string[];
}

function surface(
  id: string,
  kind: PersistenceSurfaceKind,
  label: string,
  location: PersistenceSurface['location'],
  containsDomains: readonly DataDomainId[],
  evidence: readonly string[],
): PersistenceSurface {
  return { id, kind, label, location, containsDomains, evidence };
}

export const PERSISTENCE_SURFACES = [
  surface('async-storage:lifesort-profile', 'async-storage', 'Zustand key lifesort-profile', 'device', ['account.profile', 'account.onboarding'], ['store/useProfileStore.ts']),
  surface('async-storage:lifesort-verification-last-sent', 'async-storage', 'AsyncStorage key lifesort-verification-last-sent', 'device', ['account.password-recovery-throttle'], ['core/auth/emailVerification.ts']),
  surface('async-storage:lifesort-app-lock', 'async-storage', 'Zustand key lifesort-app-lock', 'device', ['account.app-lock'], ['store/useAppLockStore.ts']),
  surface('async-storage:lifesort-settings', 'async-storage', 'Zustand key lifesort-settings', 'device', ['core.preferences'], ['store/useSettingsStore.ts']),
  surface('async-storage:lifesort-theme', 'async-storage', 'Zustand key lifesort-theme', 'device', ['core.preferences'], ['store/useThemeStore.ts']),
  surface('async-storage:sync-status', 'async-storage', 'Zustand key sync-status', 'device', ['core.sync-status'], ['store/useSyncStatusStore.ts']),
  surface('async-storage:lifesort-module-flags', 'async-storage', 'Zustand key lifesort-module-flags', 'device', ['core.module-flags'], ['store/useModuleFlagsStore.ts']),
  surface('async-storage:lifesort-enabled-modules', 'async-storage', 'Zustand key lifesort-enabled-modules', 'device', ['core.module-choice'], ['store/useEnabledModulesStore.ts']),
  surface('async-storage:lifesort-home-layout', 'async-storage', 'Zustand key lifesort-home-layout', 'device', ['core.home-layout'], ['store/useHomeLayoutStore.ts']),
  surface('async-storage:lifesort-monthly-review', 'async-storage', 'Zustand key lifesort-monthly-review', 'device', ['core.monthly-review-preference'], ['store/useReviewStore.ts']),
  surface('async-storage:lifesort-expenses', 'async-storage', 'Encrypted Zustand key lifesort-expenses', 'device', ['economy.expenses', 'economy.attachments'], ['store/useExpensesStore.ts', 'core/storage/documentCacheStorage.ts']),
  surface('async-storage:lifesort-income-v2', 'async-storage', 'Zustand key lifesort-income-v2', 'device', ['economy.income'], ['store/useIncomeStore.ts']),
  surface('async-storage:lifesort-savings-goals', 'async-storage', 'Zustand key lifesort-savings-goals', 'device', ['economy.savings'], ['store/useSavingsGoalsStore.ts']),
  surface('async-storage:lifesort-categories', 'async-storage', 'Zustand key lifesort-categories', 'device', ['economy.categories'], ['store/useCategoriesStore.ts']),
  surface('async-storage:lifesort-food-v2', 'async-storage', 'Zustand key lifesort-food-v2', 'device', ['food.user-grocery-finance', 'food.user-planning', 'food.seed-recipes', 'food.global-catalogue'], ['store/useFoodStore.ts']),
  surface('async-storage:lifesort-household', 'async-storage', 'Zustand key lifesort-household', 'device', ['home.household'], ['store/useHouseholdStore.ts']),
  surface('async-storage:lifesort-life-goals', 'async-storage', 'Zustand key lifesort-life-goals', 'device', ['goals.life-goals'], ['store/useLifeGoalsStore.ts']),
  surface('async-storage:lifesort-habits', 'async-storage', 'Zustand key lifesort-habits', 'device', ['habits.habits'], ['store/useHabitsStore.ts']),
  surface('async-storage:lifesort-todos', 'async-storage', 'Zustand key lifesort-todos', 'device', ['tasks.todos'], ['store/useTodoStore.ts']),
  surface('async-storage:lifesort-trips', 'async-storage', 'Encrypted Zustand key lifesort-trips', 'device', ['travel.trips', 'travel.attachments'], ['store/useTripsStore.ts', 'core/storage/documentCacheStorage.ts']),
  surface('async-storage:lifesort-warranties', 'async-storage', 'Encrypted Zustand key lifesort-warranties', 'device', ['warranties.records', 'warranties.attachments'], ['store/useWarrantiesStore.ts', 'core/storage/documentCacheStorage.ts']),
  surface('async-storage:lifesort-career', 'async-storage', 'Zustand key lifesort-career', 'device', ['career.applications', 'career.skills'], ['store/useCareerStore.ts']),
  surface('async-storage:lifesort-cv', 'async-storage', 'Zustand key lifesort-cv', 'device', ['career.cv'], ['store/useCVStore.ts']),
  surface('async-storage:lifesort-skill-categories', 'async-storage', 'Zustand key lifesort-skill-categories', 'device', ['career.skills'], ['store/useSkillCategoriesStore.ts']),
  surface('async-storage:lifesort-cycle', 'async-storage', 'Encrypted Zustand key lifesort-cycle', 'device', ['cycle.user-health', 'cycle.reference-content'], ['store/useCycleStore.ts', 'core/storage/cycleHealthEncryptedStorage.ts']),
  surface('async-storage:supabase-session-web-or-legacy', 'async-storage', 'Supabase session web fallback and legacy migration source', 'device', ['account.auth-session'], ['utils/auth/secureSessionStorage.ts']),
  surface('secure-store:supabase-session', 'secure-store', 'Supabase auth session in SecureStore', 'device', ['account.auth-session'], ['utils/auth/secureSessionStorage.ts']),
  surface('secure-store:lifesort-app-pin-hash', 'secure-store', 'App-lock PIN hash', 'device', ['account.app-lock'], ['utils/auth/pinAuth.ts']),
  surface('secure-store:lifesort-pin-lockout', 'secure-store', 'App-lock failed-attempt lockout counter', 'device', ['account.app-lock'], ['utils/auth/pinLockout.ts']),
  surface('secure-store:lifesort-cycle-health-key', 'secure-store', 'AES-GCM key for encrypted cycle health persistence', 'device', ['cycle.user-health'], ['core/storage/cycleHealthEncryptedStorage.ts']),
  surface('secure-store:lifesort-document-cache-key', 'secure-store', 'AES-GCM key for encrypted document cache files and metadata', 'device', ['economy.attachments', 'travel.attachments', 'warranties.attachments'], ['core/storage/documentCacheStorage.ts']),
  surface('filesystem:document-directory/attachments', 'filesystem', 'Encrypted local attachment directory', 'device', ['economy.attachments', 'travel.attachments', 'warranties.attachments'], ['utils/shared/attachmentStorage.ts', 'core/storage/documentCacheStorage.ts']),
  surface('filesystem:cache-directory/lifesort-decrypted-attachments', 'filesystem', 'Temporary decrypted attachment interoperability cache', 'device', ['economy.attachments', 'travel.attachments', 'warranties.attachments'], ['core/storage/documentCacheStorage.ts']),
  surface('filesystem:document-directory/lifesort-backup-json', 'filesystem', 'Local backup export JSON', 'device', ['core.local-backup-archive'], ['utils/shared/dataBackup.ts']),
  surface('supabase-auth:auth.users', 'supabase-auth', 'Supabase Auth users', 'supabase', ['account.auth-identity'], ['store/useAuthStore.ts']),
  surface('supabase-table:profiles', 'supabase-table', 'public.profiles', 'supabase', ['account.profile', 'account.onboarding'], ['store/useProfileStore.ts']),
  surface('supabase-table:settings', 'supabase-table', 'public.settings', 'supabase', ['core.preferences'], ['store/useSettingsStore.ts', 'store/useThemeStore.ts']),
  surface('supabase-table:module_flags', 'supabase-table', 'public.module_flags', 'supabase', ['core.module-flags'], ['store/useModuleFlagsStore.ts']),
  surface('supabase-table:user_modules', 'supabase-table', 'public.user_modules', 'supabase', ['core.module-choice'], ['store/useEnabledModulesStore.ts']),
  surface('supabase-table:expenses', 'supabase-table', 'public.expenses', 'supabase', ['economy.expenses'], ['store/useExpensesStore.ts']),
  surface('supabase-table:expense_category_budgets', 'supabase-table', 'public.expense_category_budgets', 'supabase', ['economy.expenses'], ['store/useExpensesStore.ts']),
  surface('supabase-table:income', 'supabase-table', 'public.income', 'supabase', ['economy.income'], ['store/useIncomeStore.ts']),
  surface('supabase-table:categories', 'supabase-table', 'public.categories', 'supabase', ['economy.categories'], ['store/useCategoriesStore.ts']),
  surface('supabase-table:savings_goals', 'supabase-table', 'public.savings_goals', 'supabase', ['economy.savings'], ['store/useSavingsGoalsStore.ts']),
  surface('supabase-table:savings_history', 'supabase-table', 'public.savings_history', 'supabase', ['economy.savings'], ['store/useSavingsGoalsStore.ts']),
  surface('supabase-table:savings_extra', 'supabase-table', 'public.savings_extra', 'supabase', ['economy.savings'], ['store/useSavingsGoalsStore.ts']),
  surface('supabase-table:attachments', 'supabase-table', 'public.attachments', 'supabase', ['economy.attachments', 'warranties.attachments'], ['utils/shared/attachmentSync.ts']),
  surface('supabase-table:food_monthly_budget', 'supabase-table', 'public.food_monthly_budget', 'supabase', ['food.user-grocery-finance'], ['store/useFoodStore.ts']),
  surface('supabase-table:food_purchases', 'supabase-table', 'public.food_purchases', 'supabase', ['food.user-grocery-finance'], ['store/useFoodStore.ts']),
  surface('supabase-table:food_offers', 'supabase-table', 'public.food_offers', 'supabase', ['food.user-grocery-finance'], ['store/useFoodStore.ts']),
  surface('supabase-table:food_standard_prices', 'supabase-table', 'public.food_standard_prices', 'supabase', ['food.user-grocery-finance'], ['store/useFoodStore.ts']),
  surface('supabase-table:food_pantry_items', 'supabase-table', 'public.food_pantry_items', 'supabase', ['food.user-planning'], ['store/useFoodStore.ts']),
  surface('supabase-table:food_shopping_items', 'supabase-table', 'public.food_shopping_items', 'supabase', ['food.user-planning'], ['store/useFoodStore.ts']),
  surface('supabase-table:food_recipes', 'supabase-table', 'public.food_recipes', 'supabase', ['food.user-planning'], ['store/useFoodStore.ts']),
  surface('supabase-table:food_saved_plans', 'supabase-table', 'public.food_saved_plans', 'supabase', ['food.user-planning'], ['store/useFoodStore.ts']),
  surface('supabase-table:food_selected_stores', 'supabase-table', 'public.food_selected_stores', 'supabase', ['food.user-planning'], ['store/useFoodStore.ts']),
  surface('supabase-table:products', 'supabase-table', 'public.products', 'supabase', ['food.global-catalogue'], ['supabase/migrations/20260905140726_add_products_table.sql']),
  surface('supabase-table:global_recipes', 'supabase-table', 'public.global_recipes', 'supabase', ['food.global-catalogue'], ['supabase/migrations/20260902112000_remote_schema.sql']),
  surface('supabase-table:global_standard_prices', 'supabase-table', 'public.global_standard_prices', 'supabase', ['food.global-catalogue'], ['store/useFoodStore.ts']),
  surface('supabase-table:global_offers', 'supabase-table', 'public.global_offers', 'supabase', ['food.global-catalogue'], ['store/useFoodStore.ts']),
  surface('supabase-table:household_tasks', 'supabase-table', 'public.household_tasks', 'supabase', ['home.household'], ['store/useHouseholdStore.ts']),
  surface('supabase-table:household_shopping_items', 'supabase-table', 'public.household_shopping_items', 'supabase', ['home.household'], ['store/useHouseholdStore.ts']),
  surface('supabase-table:household_moving_items', 'supabase-table', 'public.household_moving_items', 'supabase', ['home.household'], ['store/useHouseholdStore.ts']),
  surface('supabase-table:life_goals', 'supabase-table', 'public.life_goals', 'supabase', ['goals.life-goals'], ['store/useLifeGoalsStore.ts']),
  surface('supabase-table:habits', 'supabase-table', 'public.habits', 'supabase', ['habits.habits'], ['store/useHabitsStore.ts']),
  surface('supabase-table:todos', 'supabase-table', 'public.todos', 'supabase', ['tasks.todos'], ['store/useTodoStore.ts']),
  surface('supabase-table:trips', 'supabase-table', 'public.trips', 'supabase', ['travel.trips'], ['store/useTripsStore.ts']),
  surface('supabase-table:trip_expenses', 'supabase-table', 'public.trip_expenses', 'supabase', ['travel.trips'], ['store/useTripsStore.ts']),
  surface('supabase-table:trip_packing_items', 'supabase-table', 'public.trip_packing_items', 'supabase', ['travel.trips'], ['store/useTripsStore.ts']),
  surface('supabase-table:trip_participants', 'supabase-table', 'public.trip_participants', 'supabase', ['travel.trips'], ['store/useTripsStore.ts']),
  surface('supabase-table:warranties', 'supabase-table', 'public.warranties', 'supabase', ['warranties.records'], ['store/useWarrantiesStore.ts']),
  surface('supabase-table:job_applications', 'supabase-table', 'public.job_applications', 'supabase', ['career.applications'], ['store/useCareerStore.ts']),
  surface('supabase-table:skills', 'supabase-table', 'public.skills', 'supabase', ['career.skills'], ['store/useCareerStore.ts']),
  surface('supabase-table:cv_personal_info', 'supabase-table', 'public.cv_personal_info', 'supabase', ['career.cv'], ['store/useCVStore.ts']),
  surface('supabase-table:cv_education', 'supabase-table', 'public.cv_education', 'supabase', ['career.cv'], ['store/useCVStore.ts']),
  surface('supabase-table:cv_experience', 'supabase-table', 'public.cv_experience', 'supabase', ['career.cv'], ['store/useCVStore.ts']),
  surface('supabase-table:cv_languages', 'supabase-table', 'public.cv_languages', 'supabase', ['career.cv'], ['store/useCVStore.ts']),
  surface('supabase-table:cv_versions', 'supabase-table', 'public.cv_versions', 'supabase', ['career.cv'], ['store/useCVStore.ts']),
  surface('supabase-table:cycles', 'supabase-table', 'public.cycles', 'supabase', ['cycle.user-health'], ['store/useCycleStore.ts']),
  surface('supabase-table:symptom_logs', 'supabase-table', 'public.symptom_logs', 'supabase', ['cycle.user-health'], ['store/useCycleStore.ts']),
  surface('supabase-table:cycle_settings', 'supabase-table', 'public.cycle_settings', 'supabase', ['cycle.user-health'], ['store/useCycleStore.ts']),
  surface('supabase-table:health_conditions', 'supabase-table', 'public.health_conditions', 'supabase', ['cycle.reference-content'], ['store/useCycleStore.ts']),
  surface('supabase-table:symptom_glossary', 'supabase-table', 'public.symptom_glossary', 'supabase', ['cycle.reference-content'], ['store/useCycleStore.ts']),
  surface('supabase-storage-bucket:attachments', 'supabase-storage-bucket', 'Storage bucket attachments', 'supabase', ['economy.attachments', 'warranties.attachments'], ['utils/shared/attachmentSync.ts', 'supabase/migrations/20260903075914_add_attachments_storage.sql']),
  surface('supabase-storage-bucket:recipe-images', 'supabase-storage-bucket', 'Storage bucket recipe-images', 'supabase', ['food.global-catalogue'], ['supabase/migrations/20260903002859_add_activity_log_and_recipe_images.sql']),
  surface('bundled-source:data/seedRecipes', 'bundled-source', 'Bundled seed recipe source files', 'bundle', ['food.seed-recipes'], ['data/seedRecipes.ts']),
] as const satisfies readonly PersistenceSurface[];

export type PersistenceSurfaceId = (typeof PERSISTENCE_SURFACES)[number]['id'];

const DOMAIN_BY_ID = new Map<string, DataDomain>(DATA_DOMAINS.map((domain) => [domain.id, domain]));
const SURFACE_BY_ID = new Map<string, PersistenceSurface>(PERSISTENCE_SURFACES.map((surface) => [surface.id, surface]));

export function getDataDomain(domainId: string): DataDomain | null {
  return DOMAIN_BY_ID.get(domainId) ?? null;
}

export function requireDataDomain(domainId: DataDomainId): DataDomain {
  return DATA_DOMAINS.find((domain) => domain.id === domainId)!;
}

export function getPersistenceSurface(surfaceId: string): PersistenceSurface | null {
  return SURFACE_BY_ID.get(surfaceId) ?? null;
}

export function domainsForPersistenceSurface(surfaceId: string): DataDomain[] {
  const surface = getPersistenceSurface(surfaceId);
  if (!surface) {
    throw new Error(`Unknown persistence surface: ${surfaceId}`);
  }
  return surface.containsDomains.map((domainId) => requireDataDomain(domainId));
}

export function profilesForPersistenceSurface(surfaceId: string): DataProfile[] {
  return [...new Set(domainsForPersistenceSurface(surfaceId).map((domain) => domain.profile))].sort();
}

export function isMixedProfilePersistenceSurface(surfaceId: string): boolean {
  const surface = getPersistenceSurface(surfaceId);
  if (!surface) return true;
  return profilesForPersistenceSurface(surface.id).length > 1;
}

export function persistenceSurfaceContainsProfileB(surfaceId: string): boolean {
  const surface = getPersistenceSurface(surfaceId);
  if (!surface) return true;
  return domainsForPersistenceSurface(surface.id).some((domain) => domain.profile === 'B');
}

export function localPlaintextPersistenceAllowedForSurface(surfaceId: string): boolean {
  const surface = getPersistenceSurface(surfaceId);
  if (!surface) return false;
  return domainsForPersistenceSurface(surface.id).every((domain) => domain.plaintextLocalPersistenceAllowed);
}

export function localStorageProtectionForSurface(surfaceId: string): LocalStorageProtection {
  const surface = getPersistenceSurface(surfaceId);
  if (!surface) return 'no-plaintext-cache';
  const domains = domainsForPersistenceSurface(surface.id);
  if (domains.some((domain) => domain.encryptedLocalPersistenceRequired)) return 'encrypted-required';
  if (domains.some((domain) => !domain.plaintextLocalPersistenceAllowed)) return 'no-plaintext-cache';
  return 'plaintext-allowed';
}

export function domainsByProfile(profile: DataProfile): DataDomain[] {
  return DATA_DOMAINS.filter((domain) => domain.profile === profile);
}

export function mixedProfilePersistenceSurfaces(): PersistenceSurface[] {
  return PERSISTENCE_SURFACES.filter((surface) => isMixedProfilePersistenceSurface(surface.id));
}

export function profileForDomain(domainId: DataDomainId): DataProfile {
  return requireDataDomain(domainId).profile;
}
