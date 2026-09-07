import { useAppLockStore } from '@/store/useAppLockStore';
import { useCareerStore } from '@/store/useCareerStore';
import { useCategoriesStore } from '@/store/useCategoriesStore';
import { useCVStore } from '@/store/useCVStore';
import { useCycleStore } from '@/store/useCycleStore';
import { useEnabledModulesStore } from '@/store/useEnabledModulesStore';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useFoodStore } from '@/store/useFoodStore';
import { useHabitsStore } from '@/store/useHabitsStore';
import { useHouseholdStore } from '@/store/useHouseholdStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';
import { useProfileStore } from '@/store/useProfileStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import { useThemeStore } from '@/store/useThemeStore';
import { useTodoStore } from '@/store/useTodoStore';
import { useTripsStore } from '@/store/useTripsStore';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';
import { clearLocalPin } from '@/utils/auth/pinAuth';
import { clearSignedUrlCache } from '@/utils/shared/attachmentSync';

// Rydder al lokal, bruger-specifik data ved log ud — kaldes FØR en ny bruger
// logger ind, så ingen data fra den forrige bruger "lækker" ind i den nye session.
// Bemærk: useSettingsStore (sprog) og useToastStore (transient UI-state) rydes
// bevidst IKKE — ingen af dem er bruger-specifik, persisteret data.
export async function clearAllLocalData() {
  useProfileStore.getState().clearLocal();

  useCategoriesStore.setState({ categories: useCategoriesStore.getState().categories.filter((c) => c.isBuiltIn) });
  useIncomeStore.setState({ incomeByMonth: {} });
  useExpensesStore.setState({ expenses: [], seriesStoppedAt: {}, categoryBudgets: {} });
  useSavingsGoalsStore.setState({ goals: [], history: [], extraSavings: 0 });
  useWarrantiesStore.setState({ warranties: [] });
  useTripsStore.setState({ trips: [], expenses: [], packingItems: [], participants: [], myUserId: null });
  useTodoStore.setState({ todos: [] });
  useLifeGoalsStore.setState({ goals: [] });
  useHabitsStore.setState({ habits: [] });
  useHouseholdStore.setState({ tasks: [], shoppingItems: [], movingItems: [] });
  useCareerStore.setState({ applications: [], skills: [] });
  useCVStore.setState({
    personalInfo: {} as any,
    education: [],
    experience: [],
    languages: [],
    versions: [],
  });
  useFoodStore.setState({
    monthlyBudgetByMonth: {},
    purchases: [],
    pantryItems: [],
    shoppingItems: [],
    offers: [],
    standardPrices: [],
    savedPlans: {},
    selectedStores: [],
    // recipes rydes IKKE helt — kun brugeroprettede fjernes, seed-opskrifter beholdes
    recipes: useFoodStore.getState().recipes.filter((r) => r.id.startsWith('seed-')),
  });
  useCycleStore.setState({
    cycles: [],
    symptomLogs: [],
    avgCycleLength: 28,
    lutealPhaseLength: 14,
    reminderEnabled: false,
    reminderDaysBefore: 1,
  });

  // Modulvalget hører til brugeren, ikke til enheden — modsat kill switches,
  // der gælder alle og bliver liggende. Nulstilles til standarden (alt slået
  // til), så den næste bruger ikke arver et fravalg. Det sletter ingen data;
  // det rydder kun et valg.
  useEnabledModulesStore.getState().clearLocal();

  useThemeStore.setState({ mode: 'system' });
  useAppLockStore.setState({ lockEnabled: false, isLocked: false });

  // Signerede URL'er er kortlivede, men må under ingen omstændigheder følge med
  // over i den næste brugers session.
  clearSignedUrlCache();

  await clearLocalPin();
}