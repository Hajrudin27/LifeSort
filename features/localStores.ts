import type { LocalStoreReset } from '@/core/auth/clearLocalUserData';
import { useAppLockStore } from '@/store/useAppLockStore';
import { useCVStore } from '@/store/useCVStore';
import { useCareerStore } from '@/store/useCareerStore';
import { useCategoriesStore } from '@/store/useCategoriesStore';
import { useCycleStore } from '@/store/useCycleStore';
import { useEnabledModulesStore } from '@/store/useEnabledModulesStore';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useFoodStore } from '@/store/useFoodStore';
import { useHabitsStore } from '@/store/useHabitsStore';
import { useHomeLayoutStore } from '@/store/useHomeLayoutStore';
import { useHouseholdStore } from '@/store/useHouseholdStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';
import { useProfileStore } from '@/store/useProfileStore';
import { useReviewStore } from '@/store/useReviewStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import { useSkillCategoriesStore } from '@/store/useSkillCategoriesStore';
import { useSyncStatusStore } from '@/store/useSyncStatusStore';
import { useThemeStore } from '@/store/useThemeStore';
import { useTodoStore } from '@/store/useTodoStore';
import { useTripsStore } from '@/store/useTripsStore';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';

/**
 * Hvordan hver store nulstilles ved log ud (APP-021).
 *
 * Kernen må ikke kende et modul (ADR-0003), så listen ligger her, hvor tingene
 * sættes sammen — samme mønster som Home-kortene.
 *
 * At tømme en store er ikke altid det samme som at sætte den til tom: nogle
 * indeholder også indhold, der ikke tilhører brugeren — indbyggede kategorier,
 * seed-opskrifter. Den slags viden hører til modulet, ikke til
 * oprydningsrutinen, og det er derfor nulstillingen står her og ikke i kernen.
 *
 * Listen skal dække hver eneste persisterede store. Det tjekker
 * __tests__/logoutCleanup.test.ts — og skulle en alligevel mangle, fejer
 * clearLocalUserData dens nøgle fra disken uanset.
 */
export const LOCAL_STORE_RESETS: readonly LocalStoreReset[] = [
  { key: 'lifesort-profile', reset: () => useProfileStore.getState().clearLocal() },

  // Kun brugerens egne kategorier. De indbyggede hører til appen.
  {
    key: 'lifesort-categories',
    reset: () =>
      useCategoriesStore.setState({
        categories: useCategoriesStore.getState().categories.filter((category) => category.isBuiltIn),
      }),
  },

  { key: 'lifesort-income-v2', reset: () => useIncomeStore.setState({ incomeByMonth: {} }) },
  {
    key: 'lifesort-expenses',
    reset: () => useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} }),
  },
  {
    key: 'lifesort-savings-goals',
    reset: () => useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: 0 }),
  },
  { key: 'lifesort-warranties', reset: () => useWarrantiesStore.setState({ warranties: [] }) },
  {
    key: 'lifesort-trips',
    reset: () =>
      useTripsStore.setState({ trips: [], expenses: [], packingItems: [], participants: [], myUserId: null }),
  },
  { key: 'lifesort-todos', reset: () => useTodoStore.setState({ todos: [] }) },
  { key: 'lifesort-life-goals', reset: () => useLifeGoalsStore.setState({ goals: [] }) },
  { key: 'lifesort-habits', reset: () => useHabitsStore.setState({ habits: [] }) },
  {
    key: 'lifesort-household',
    reset: () => useHouseholdStore.setState({ tasks: [], shoppingItems: [], movingItems: [] }),
  },
  { key: 'lifesort-career', reset: () => useCareerStore.setState({ applications: [], skills: [] }) },
  { key: 'lifesort-skill-categories', reset: () => useSkillCategoriesStore.setState({ categories: [] }) },
  {
    key: 'lifesort-cv',
    reset: () =>
      useCVStore.setState({
        personalInfo: {} as never,
        education: [],
        experience: [],
        languages: [],
        versions: [],
      }),
  },

  // Seed-opskrifterne er appens indhold, ikke brugerens.
  {
    key: 'lifesort-food-v2',
    reset: () =>
      useFoodStore.setState({
        monthlyBudgetByMonth: {},
        purchases: [],
        pantryItems: [],
        shoppingItems: [],
        offers: [],
        standardPrices: [],
        savedPlans: {},
        selectedStores: [],
        recipes: useFoodStore.getState().recipes.filter((recipe) => recipe.id.startsWith('seed-')),
      }),
  },

  {
    key: 'lifesort-cycle',
    reset: () =>
      useCycleStore.setState({
        cycles: [],
        symptomLogs: [],
        avgCycleLength: 28,
        lutealPhaseLength: 14,
        reminderEnabled: false,
        reminderDaysBefore: 1,
      }),
  },

  { key: 'lifesort-enabled-modules', reset: () => useEnabledModulesStore.getState().clearLocal() },

  // Fastgjorte kort, skjulte kort og hvornår hvert modul sidst blev åbnet er
  // brugerens adfærd, ikke enhedens indstilling.
  {
    key: 'lifesort-home-layout',
    reset: () => useHomeLayoutStore.setState({ pinned: [], hidden: [], detail: {}, lastOpenedAt: {} }),
  },
  { key: 'lifesort-monthly-review', reset: () => useReviewStore.setState({ showOnHome: true }) },

  // Clear ephemeral sync presentation; the sweep also removes the legacy disk key.
  { key: 'sync-status', reset: () => useSyncStatusStore.getState().clearLocal() },

  { key: 'lifesort-theme', reset: () => useThemeStore.setState({ mode: 'system' }) },
  { key: 'lifesort-app-lock', reset: () => useAppLockStore.setState({ lockEnabled: false, isLocked: false }) },
];
