import { useFonts } from "expo-font";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import {
  DarkTheme,
  DefaultTheme,
  Redirect,
  router,
  Stack,
  ThemeProvider,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState, AppStateStatus } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";

import LockScreen from "@/components/LockScreen";
import ModuleGate from "@/components/ModuleGate";
import PrivacyOverlay from "@/components/PrivacyOverlay";
import Toast from "@/components/Toast";
import { parseRecoveryLink } from "@/core/auth/recoveryLink";
import { useColorScheme } from "@/components/useColorScheme";
import { useRecordModuleVisit } from "@/core/modules/useModuleVisit";
import Colors from "@/constants/Colors";
import "@/localization/i18n";
import i18n from "@/localization/i18n";
import { useAppLockStore } from "@/store/useAppLockStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useCareerStore } from "@/store/useCareerStore";
import { useCategoriesStore } from "@/store/useCategoriesStore";
import { useCVStore } from "@/store/useCVStore";
import { useCycleStore } from "@/store/useCycleStore";
import { useEnabledModulesStore } from "@/store/useEnabledModulesStore";
import { useExpensesStore } from "@/store/useExpensesStore";
import { useFoodStore } from "@/store/useFoodStore";
import { useHabitsStore } from "@/store/useHabitsStore";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { useIncomeStore } from "@/store/useIncomeStore";
import { useLifeGoalsStore } from "@/store/useLifeGoalsStore";
import { useModuleFlagsStore } from "@/store/useModuleFlagsStore";
import { useProfileStore } from "@/store/useProfileStore";
import { useSavingsGoalsStore } from "@/store/useSavingsGoalsStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useThemeStore } from "@/store/useThemeStore";
import { useTodoStore } from "@/store/useTodoStore";
import { useTripsStore } from "@/store/useTripsStore";
import { useWarrantiesStore } from "@/store/useWarrantiesStore";
import { scheduleIncomeReminder } from "@/utils/expense/incomeReminder";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

SplashScreen.preventAutoHideAsync();

const LightNavTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Colors.light.tint,
    background: Colors.light.background,
    card: Colors.light.surface,
    text: Colors.light.text,
    border: Colors.light.border,
    notification: Colors.light.tint,
  },
};

const DarkNavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.dark.tint,
    background: Colors.dark.background,
    card: Colors.dark.surface,
    text: Colors.dark.text,
    border: Colors.dark.border,
    notification: Colors.dark.tint,
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });
  const hasHydrated = useSettingsStore((s) => s.hasHydrated);
  const language = useSettingsStore((s) => s.language);
  const authIsLoading = useAuthStore((s) => s.isLoading);
  const initAuth = useAuthStore((s) => s.init);
  const session = useAuthStore((s) => s.session);
  const profileFetchAttempted = useProfileStore((s) => s.profileFetchAttempted);
  const fetchProfile = useProfileStore((s) => s.fetchFromSupabase);
  const fetchSettings = useSettingsStore((s) => s.fetchFromSupabase);
  const fetchTheme = useThemeStore((s) => s.fetchFromSupabase);
  const fetchCategories = useCategoriesStore((s) => s.fetchFromSupabase);
  const fetchIncome = useIncomeStore((s) => s.fetchFromSupabase);
  const fetchExpenses = useExpensesStore((s) => s.fetchFromSupabase);
  const fetchSavingsGoals = useSavingsGoalsStore((s) => s.fetchFromSupabase);
  const fetchWarranties = useWarrantiesStore((s) => s.fetchFromSupabase);
  const fetchTrips = useTripsStore((s) => s.fetchFromSupabase);
  const fetchTodos = useTodoStore((s) => s.fetchFromSupabase);
  const fetchLifeGoals = useLifeGoalsStore((s) => s.fetchFromSupabase);
  const fetchHabits = useHabitsStore((s) => s.fetchFromSupabase);
  const fetchHousehold = useHouseholdStore((s) => s.fetchFromSupabase);
  const fetchCareer = useCareerStore((s) => s.fetchFromSupabase);
  const fetchCV = useCVStore((s) => s.fetchFromSupabase);
  const fetchFood = useFoodStore((s) => s.fetchFromSupabase);
  const fetchCycle = useCycleStore((s) => s.fetchFromSupabase);
  const fetchModuleFlags = useModuleFlagsStore((s) => s.fetchFromSupabase);
  const beginPasswordRecovery = useAuthStore((s) => s.beginPasswordRecovery);
  const fetchEnabledModules = useEnabledModulesStore((s) => s.fetchFromSupabase);

  const appLockHasHydrated = useAppLockStore((s) => s.hasHydrated);
  const lockEnabled = useAppLockStore((s) => s.lockEnabled);
  const lock = useAppLockStore((s) => s.lock);
  const appState = useRef(AppState.currentState);
  const [lockCheckDone, setLockCheckDone] = useState(false);

  useEffect(() => {
    initAuth();
  }, []);

  // Kill switches hentes ved opstart, ikke ved login: et lukket modul skal også
  // være lukket for en bruger der ikke er logget ind endnu. Fejler kaldet,
  // beholder store'en det sidst kendte svar fra disk.
  useEffect(() => {
    fetchModuleFlags();
  }, []);

  // Nulstillingslinket fra mailen. Klienten er sat op uden automatisk
  // URL-håndtering (den hører til på web), så appen bytter selv linkets tokens
  // til en session og sender brugeren videre til at vælge et nyt kodeord.
  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url) return;
      const tokens = parseRecoveryLink(url);
      if (!tokens) return;

      const { error: recoveryError } = await beginPasswordRecovery(tokens);
      if (!recoveryError) router.push("/new-password");
    };

    // Appen kan være startet AF linket, eller allerede have kørt.
    Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener("url", (event) => handleUrl(event.url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (session) {
      fetchProfile();
      fetchSettings();
      fetchTheme();
      fetchCategories();
      fetchIncome();
      fetchExpenses();
      fetchSavingsGoals();
      fetchWarranties();
      fetchTrips();
      fetchTodos();
      fetchLifeGoals();
      fetchHabits();
      fetchHousehold();
      fetchCareer();
      fetchCV();
      fetchFood();
      fetchCycle();
      fetchEnabledModules();
    }
  }, [session?.user.id]);

  // Afgør ÉN GANG, med det samme al nødvendig data er kendt (auth afsluttet,
  // app-lås-indstillingen genindlæst fra disk), om appen skal starte låst.
  // Appen viser INTET af sit rigtige indhold, før dette er afgjort — det er
  // det, der forhindrer en kort, utilsigtet visning af ulåst indhold.
  useEffect(() => {
    if (authIsLoading || !appLockHasHydrated) return;
    if (lockEnabled && session) {
      lock();
    }
    setLockCheckDone(true);
  }, [authIsLoading, appLockHasHydrated, lockEnabled, session?.user.id]);

  // Lås appen igen, når den vender tilbage fra baggrunden (fx efter at have
  // været minimeret) — ikke ved almindelige, interne skærmskift i appen.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === "active") {
        if (lockEnabled && session) {
          lock();
        }
      }
      appState.current = nextState;
    });
    return () => subscription.remove();
  }, [lockEnabled, session?.user.id]);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  useEffect(() => {
    if (loaded && hasHydrated) {
      SplashScreen.hideAsync();
    }
  }, [loaded, hasHydrated]);

  useEffect(() => {
    if (loaded && hasHydrated) {
      scheduleIncomeReminder(
        i18n.t("expenses.incomeReminderTitle"),
        i18n.t("expenses.incomeReminderBody"),
      );
    }
  }, [loaded, hasHydrated]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      () => {
        router.push("/expenses/income");
      },
    );
    return () => subscription.remove();
  }, []);

  const waitingForProfile = !!session && !profileFetchAttempted;

  if (!loaded || !hasHydrated || authIsLoading || waitingForProfile || !lockCheckDone) {
    return null;
  }

  return <RootLayoutNav language={language} />;
}

function RootLayoutNav({ language }: { language: string | null }) {
  const colorScheme = useColorScheme();

  // "Senest brugt" til rækkefølgen på Home (APP-012). Registreres her, hvor alle
  // ruter kommer forbi, uanset hvordan brugeren nåede frem.
  useRecordModuleVisit();

  const { t } = useTranslation();
  const hasOnboarded = useProfileStore((s) => s.hasOnboarded);
  const session = useAuthStore((s) => s.session);
  const isLocked = useAppLockStore((s) => s.isLocked);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider
        value={colorScheme === "dark" ? DarkNavTheme : LightNavTheme}
      >
        {!language && <Redirect href="/language" />}
        {language && !session && <Redirect href="/auth" />}
        {language && session && !hasOnboarded && (
          <Redirect href="/onboarding-profile" />
        )}
        <Stack
          screenOptions={{ headerShadowVisible: false, headerBackTitle: "" }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="language"
            options={{ headerShown: false, presentation: "fullScreenModal" }}
          />
          <Stack.Screen
            name="auth"
            options={{ headerShown: false, presentation: "fullScreenModal" }}
          />
          <Stack.Screen
            name="onboarding-profile"
            options={{ headerShown: false, presentation: "fullScreenModal" }}
          />
          <Stack.Screen
            name="onboarding-pin"
            options={{ headerShown: false, presentation: "fullScreenModal" }}
          />
          <Stack.Screen
            name="onboarding-modules"
            options={{ headerShown: false, presentation: "fullScreenModal" }}
          />
          <Stack.Screen
            name="expenses/index"
            options={{
              title: t("expenses.screenTitle"),
              headerBackTitle: t("economy.title"),
            }}
          />
          <Stack.Screen
            name="expenses/new"
            options={{
              presentation: "modal",
              title: t("expenses.newScreenTitle"),
            }}
          />
          <Stack.Screen name="modal" options={{ presentation: "modal", title: t("about.title") }} />
          <Stack.Screen
            name="expenses/edit/[id]"
            options={{ title: t("expenses.edit") }}
          />
          <Stack.Screen
            name="expenses/income"
            options={{
              presentation: "modal",
              title: t("expenses.incomeLabel"),
            }}
          />
          <Stack.Screen
            name="savings/index"
            options={{
              title: t("savings.screenTitle"),
              headerBackTitle: t("economy.title"),
            }}
          />
          <Stack.Screen
            name="savings/new"
            options={{
              presentation: "modal",
              title: t("savings.newScreenTitle"),
            }}
          />
          <Stack.Screen
            name="savings/[id]"
            options={{ title: t("savings.screenTitle") }}
          />
          <Stack.Screen
            name="savings/allocate"
            options={{
              presentation: "modal",
              title: t("savings.allocateScreenTitle"),
            }}
          />
          <Stack.Screen
            name="warranties/index"
            options={{
              title: t("warranties.screenTitle"),
              headerBackTitle: t("economy.title"),
            }}
          />
          <Stack.Screen
            name="warranties/new"
            options={{
              presentation: "modal",
              title: t("warranties.newScreenTitle"),
            }}
          />
          <Stack.Screen
            name="warranties/[id]"
            options={{ title: t("warranties.screenTitle") }}
          />
          <Stack.Screen
            name="warranties/view-image"
            options={{ presentation: "fullScreenModal", headerShown: false }}
          />
          <Stack.Screen
            name="expenses/search"
            options={{
              presentation: "modal",
              title: t("expenses.searchTitle"),
            }}
          />
          <Stack.Screen
            name="travel/index"
            options={{
              title: t("economy.travel"),
              headerBackTitle: t("economy.title"),
            }}
          />
          <Stack.Screen
            name="travel/new"
            options={{ presentation: "modal", title: t("travel.addButton") }}
          />
          <Stack.Screen
            name="travel/[id]/index"
            options={{ title: t("travel.expensesLabel") }}
          />
          <Stack.Screen
            name="travel/[id]/expenses/index"
            options={{ title: t("travel.expensesLabel") }}
          />
          <Stack.Screen
            name="travel/[id]/expenses/new"
            options={{ presentation: "modal", title: t("expenses.addButton") }}
          />
          <Stack.Screen
            name="travel/[id]/expenses/edit/[expenseId]"
            options={{ title: t("expenses.edit") }}
          />
          <Stack.Screen
            name="travel/[id]/packing"
            options={{ title: t("travel.packingLabel") }}
          />
          <Stack.Screen
            name="food/index"
            options={{
              title: t("food.screenTitle"),
              headerBackTitle: t("economy.title"),
            }}
          />
          <Stack.Screen
            name="food/budget"
            options={{ presentation: "modal", title: t("food.budgetLabel") }}
          />
          <Stack.Screen
            name="food/pantry"
            options={{ title: t("food.pantryLabel") }}
          />
          <Stack.Screen
            name="food/shopping-list"
            options={{ title: t("food.shoppingListLabel") }}
          />
          <Stack.Screen
            name="food/offers"
            options={{ title: t("food.offersLabel") }}
          />
          <Stack.Screen
            name="food/recipes/index"
            options={{ title: t("food.recipesLabel") }}
          />
          <Stack.Screen
            name="food/recipes/new"
            options={{ presentation: "modal", title: t("food.recipesLabel") }}
          />
          <Stack.Screen
            name="food/recipes/[id]"
            options={{ title: t("food.recipesLabel") }}
          />

          <Stack.Screen
            name="food/select-stores"
            options={{ title: t("food.selectStoresLabel") }}
          />
          <Stack.Screen
            name="food/weekly-plan"
            options={{ title: t("food.weeklyPlanLabel") }}
          />
          <Stack.Screen
            name="todos/index"
            options={{
              title: t("todos.screenTitle"),
              headerBackTitle: t("life.title"),
            }}
          />
          <Stack.Screen
            name="todos/new"
            options={{
              presentation: "modal",
              title: t("todos.newScreenTitle"),
            }}
          />
          <Stack.Screen
            name="todos/[id]"
            options={{ title: t("todos.screenTitle") }}
          />
          <Stack.Screen
            name="life-goals/index"
            options={{
              title: t("lifeGoals.screenTitle"),
              headerBackTitle: t("life.title"),
            }}
          />
          <Stack.Screen
            name="life-goals/new"
            options={{
              presentation: "modal",
              title: t("lifeGoals.newScreenTitle"),
            }}
          />
          <Stack.Screen
            name="life-goals/[id]"
            options={{ title: t("lifeGoals.screenTitle") }}
          />
          <Stack.Screen
            name="habits/index"
            options={{
              title: t("habits.screenTitle"),
              headerBackTitle: t("life.title"),
            }}
          />
          <Stack.Screen
            name="habits/new"
            options={{
              presentation: "modal",
              title: t("habits.newScreenTitle"),
            }}
          />
          <Stack.Screen
            name="habits/[id]"
            options={{ title: t("habits.screenTitle") }}
          />
          <Stack.Screen
            name="household/index"
            options={{
              title: t("household.title"),
              headerBackTitle: t("life.title"),
            }}
          />
          <Stack.Screen
            name="household/tasks/index"
            options={{ title: t("household.title") }}
          />
          <Stack.Screen
            name="household/tasks/new"
            options={{
              presentation: "modal",
              title: t("household.newTaskScreenTitle"),
            }}
          />
          <Stack.Screen
            name="household/tasks/[id]"
            options={{ title: t("household.title") }}
          />
          <Stack.Screen
            name="household/shopping-list"
            options={{ title: t("household.shoppingListLabel") }}
          />
          <Stack.Screen
            name="household/moving"
            options={{ title: t("household.movingLabel") }}
          />
          <Stack.Screen
            name="career/index"
            options={{
              title: t("career.title"),
              headerBackTitle: t("life.title"),
            }}
          />
          <Stack.Screen
            name="career/applications/index"
            options={{ title: t("career.applicationsLabel") }}
          />
          <Stack.Screen
            name="career/applications/new"
            options={{
              presentation: "modal",
              title: t("career.newScreenTitle"),
            }}
          />
          <Stack.Screen
            name="career/applications/[id]"
            options={{ title: t("career.applicationsLabel") }}
          />
          <Stack.Screen
            name="career/skills/index"
            options={{ title: t("career.skillsScreenTitle") }}
          />
          <Stack.Screen
            name="career/cv/index"
            options={{ title: t("cv.title") }}
          />
          <Stack.Screen
            name="career/cv/personal-info"
            options={{
              presentation: "modal",
              title: t("cv.personalInfoLabel"),
            }}
          />
          <Stack.Screen
            name="career/cv/experience/index"
            options={{ title: t("cv.experienceLabel") }}
          />
          <Stack.Screen
            name="career/cv/experience/new"
            options={{ presentation: "modal", title: t("cv.addExperience") }}
          />
          <Stack.Screen
            name="career/cv/experience/[id]"
            options={{ title: t("cv.experienceLabel") }}
          />
          <Stack.Screen
            name="career/cv/education/index"
            options={{ title: t("cv.educationLabel") }}
          />
          <Stack.Screen
            name="career/cv/education/new"
            options={{ presentation: "modal", title: t("cv.addEducation") }}
          />
          <Stack.Screen
            name="career/cv/education/[id]"
            options={{ title: t("cv.educationLabel") }}
          />
          <Stack.Screen
            name="career/cv/languages"
            options={{ title: t("cv.languagesLabel") }}
          />
          <Stack.Screen
            name="career/cv/generate"
            options={{ title: t("cv.selectionTitle") }}
          />
          <Stack.Screen
            name="savings/icon/[icon]"
            options={{ title: t("savings.screenTitle") }}
          />
          <Stack.Screen
            name="settings/backup"
            options={{
              title: t("backup.title"),
              headerBackTitle: t("settings.title"),
            }}
          />
          <Stack.Screen
            name="economy/insights"
            options={{
              title: t("economy.insightsTitle"),
              headerBackTitle: t("economy.title"),
            }}
          />
          <Stack.Screen
            name="settings/profile"
            options={{
              title: t("profile.title"),
              headerBackTitle: t("settings.title"),
            }}
          />
          <Stack.Screen
            name="settings/pin"
            options={{
              title: t("appLock.pinSettingsTitle"),
              headerBackTitle: t("settings.title"),
            }}
          />
          <Stack.Screen
            name="settings/modules"
            options={{ title: t("modules.settingsTitle"), headerBackTitle: t("settings.title") }}
          />
          <Stack.Screen
            name="modules"
            options={{ title: t("modules.launcherTitle"), headerBackTitle: t("life.title") }}
          />
          <Stack.Screen
            name="review"
            options={{ title: t("review.title"), headerBackTitle: t("settings.title") }}
          />
          <Stack.Screen
            name="new-password"
            options={{ title: t("auth.newPasswordTitle"), presentation: "fullScreenModal" }}
          />
          <Stack.Screen
            name="cycle/history"
            options={{
              title: t("cycle.historyLabel"),
              headerBackTitle: t("cycle.title"),
            }}
          />
          <Stack.Screen
            name="cycle/[id]"
            options={{ title: t("cycle.editCycleTitle") }}
          />
          <Stack.Screen
            name="cycle/settings"
            options={{
              title: t("cycle.settingsLabel"),
              headerBackTitle: t("cycle.title"),
            }}
          />
          <Stack.Screen
            name="cycle/new"
            options={{
              presentation: "modal",
              title: t("cycle.addPastCycleTitle"),
            }}
          />
          <Stack.Screen
            name="cycle/symptoms"
            options={{
              title: t("cycle.symptomHistoryLabel"),
              headerBackTitle: t("cycle.title"),
            }}
          />
          <Stack.Screen
            name="cycle/health-info/index"
            options={{
              title: t("healthInfo.title"),
              headerBackTitle: t("cycle.title"),
            }}
          />
          <Stack.Screen
            name="cycle/health-info/[id]"
            options={{ title: t("healthInfo.title") }}
          />
          <Stack.Screen name="expenses/upcoming" options={{ title: t("expenses.upcomingLabel"), headerBackTitle: t("expenses.screenTitle") }} />
          <Stack.Screen name="cycle/log-day" options={{ presentation: 'modal', title: t('cycle.logAnotherDayLabel') }} />
        </Stack>
        <Toast />
        <ModuleGate />
        {isLocked && <LockScreen />}

        {/* Skjuler indholdet i app-skifteren. Kun relevant når nogen er logget
            ind — der er intet følsomt at dække på login-skærmen. */}
        {session && <PrivacyOverlay />}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}