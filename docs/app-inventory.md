# LifeSort — Route / Module Inventory

**Story:** APP-001 (E0 · Architecture & inventory, P0)
**Status:** As-is inventory of the repository. Descriptive, not aspirational.
**Owner of this document:** Hajrudin Kardasevic
**Last verified:** by `__tests__/appInventory.test.ts` on every test run.
**Companion document:** [`docs/data-sdk-inventory.md`](./data-sdk-inventory.md) (APP-002) — data types, SDKs, vendors, retention and store disclosure mapping.

## Purpose

Map every user-reachable route to the module that owns it, the Zustand stores it
reads or writes, the Supabase tables behind those stores, the sensitivity of the
data involved and the responsible owner — so that later refactors (module
registry, storage profiles, sync engine) happen on facts instead of guesses.

This document records **what the code does today**. Where the current
implementation conflicts with the master specification, the conflict is written
down in §8 rather than silently corrected.

## How to read the mapping

The inventory is normalised over two tables to avoid duplicating the
store→table edge 91 times:

```
route  ──(§2 Route inventory)──►  module
route  ──(§2 Route inventory)──►  store(s)
store  ──(§3 Store inventory)──►  supabase table(s)
```

So the full `route → module → store → table → sensitivity → owner` chain for any
route is read by looking the route up in §2 and joining its stores into §3.
§4 gives the reverse view (table → module).

## How this stays true

`__tests__/appInventory.test.ts` parses this file and fails the test run when:

- a route file exists under `app/` that has no row in §2 (an **unknown module**),
- a row in §2 or §3 or §5 points at a file that no longer exists (a stale row),
- a route row names a module that is not declared in §1,
- a store file exists under `store/` with no row in §3,
- a component file exists under `components/` with no row in §5,
- a Supabase table is referenced by `.from('…')` in the app code but is missing
  from §4,
- any row has an empty owner or a sensitivity outside the legend in §7.

Adding a route, store, component or table therefore requires updating this file
in the same change. Do not weaken the test to make a new file pass — add the row.

## §0 Sources of truth

| Concern | Location |
| --- | --- |
| Routes | `app/` (Expo Router, file-based) |
| Platform layer | `core/` — see [`docs/core-contract.md`](./core-contract.md) |
| Module-side code | `features/<module>/` — new code follows the target structure (ADR-0003) |
| Client state | `store/` (Zustand, mostly `persist` + AsyncStorage) |
| Domain logic | `utils/<domain>/` |
| Domain types | `types/` |
| Shared UI | `components/`, `constants/`, `hooks/` |
| Backend client | `lib/supabase.ts` (publishable/anon key from `EXPO_PUBLIC_*`) |
| Database migrations | `supabase/migrations/` — only `module_flags` so far; see §8-F10 |
| File storage | Supabase Storage bucket `attachments` |
| Copy | `localization/locales/{da,en}/*.json` |
| Seed content | `data/seedRecipes*.ts` |

## §1 Module register

Every route in §2 belongs to exactly one of these modules. There is no other
production module — that is the "no unknown production modules" criterion, and
it is enforced by the test.

`Spec ModuleId` is the identifier this module maps to in the master
specification (Bilag A). "Observed availability" describes the module's actual
state in a production build today; the typed `ModuleAvailability` state machine
itself is APP-005 and is **not** implemented here.

<!-- inventory:modules:start -->

| Module | Spec `ModuleId` | Observed availability | Route root(s) | Primary stores | Sensitivity | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| `core-shell` | – (core platform, not a module in the spec) | available | `/`, `/life`, `/search`, `/modal`, `/modules`, `/review`, `_layout` | `useSettingsStore`, `useThemeStore`, `useSyncStatusStore`, `useTabBarStore`, `useToastStore`, `useModuleFlagsStore`, `useEnabledModulesStore`, `useHomeLayoutStore`, `useReviewStore` | ordinary | Hajrudin Kardasevic |
| `account` | – (auth/profile shell) | available | `/auth`, `/language`, `/onboarding-*`, `/new-password`, `/settings`, `/settings/*` | `useAuthStore`, `useProfileStore`, `useAppLockStore` | personal | Hajrudin Kardasevic |
| `economy` | `economy` | available | `/economy`, `/economy/*`, `/expenses/*`, `/savings/*` | `useExpensesStore`, `useIncomeStore`, `useSavingsGoalsStore`, `useCategoriesStore` | ordinary, financial, document | Hajrudin Kardasevic |
| `food` | `food` | available | `/food/*` | `useFoodStore` | ordinary, financial | Hajrudin Kardasevic |
| `home` | `home` | available | `/household/*` | `useHouseholdStore` | ordinary | Hajrudin Kardasevic |
| `goals` | `goals` | available | `/life-goals/*` | `useLifeGoalsStore` | personal | Hajrudin Kardasevic |
| `habits` | `habits` | available | `/habits/*` | `useHabitsStore` | ordinary | Hajrudin Kardasevic |
| `tasks` | – (spec has no `tasks` id; see §8-F3) | available | `/todos/*` | `useTodoStore` | ordinary | Hajrudin Kardasevic |
| `travel` | `travel` | available | `/travel/*` | `useTripsStore` | personal, financial, document | Hajrudin Kardasevic |
| `warranties` | `warranties` | available | `/warranties/*` | `useWarrantiesStore` | document, financial | Hajrudin Kardasevic |
| `career` | `career` | available | `/career/*` | `useCareerStore`, `useCVStore`, `useSkillCategoriesStore` | ordinary, personal, document | Hajrudin Kardasevic |
| `cycle` | `cycle` | available — but tab visibility is gated on `profile.gender === 'female'` (see §8-F2) | `/cycle`, `/cycle/*` | `useCycleStore` | health | Hajrudin Kardasevic |

<!-- inventory:modules:end -->

**On `core-shell`'s sensitivity.** It owns only ordinary data — settings, theme,
sync status, module flags. Home *renders* financial and health values belonging
to other modules, but rendering is not ownership; that is a display concern,
handled by the privacy-safe Home in APP-013. `core/modules/moduleRegistry.ts`
carries the same classification, and a test keeps the two in step.

### Spec modules with no implementation in this repo

| Spec `ModuleId` | State in repo |
| --- | --- |
| `documents` | No dedicated module. Document/receipt files exist as *attachments* owned by `economy`, `warranties` and `travel` (`utils/shared/attachmentStorage.ts`, `utils/shared/attachmentSync.ts`, Storage bucket `attachments`). |
| `pregnancy` | Not implemented. |
| `gifts` | Not implemented. |

## §2 Route inventory

All 91 route files under `app/`. `Route` is the Expo Router URL path; the
`(tabs)` group segment is not part of the URL. `_layout`, `+html` and
`+not-found` are framework files rather than navigable screens and are listed so
the inventory is complete.

The `Stores` column lists every store the file references directly. Stores map
to Supabase tables in §3.

<!-- inventory:routes:start -->

| Route | File | Module | Stores | Sensitivity | Owner |
| --- | --- | --- | --- | --- | --- |
| `/_layout` | `app/(tabs)/_layout.tsx` | `core-shell` | `useProfileStore` | ordinary | Hajrudin Kardasevic |
| `/cycle` | `app/(tabs)/cycle.tsx` | `cycle` | `useCycleStore` | health | Hajrudin Kardasevic |
| `/economy` | `app/(tabs)/economy.tsx` | `economy` | `useExpensesStore`<br>`useFoodStore`<br>`useIncomeStore`<br>`useSavingsGoalsStore`<br>`useTripsStore`<br>`useWarrantiesStore` | financial | Hajrudin Kardasevic |
| `/` | `app/(tabs)/index.tsx` | `core-shell` | `useCycleStore`<br>`useExpensesStore`<br>`useFoodStore`<br>`useHabitsStore`<br>`useHouseholdStore`<br>`useIncomeStore`<br>`useProfileStore`<br>`useSavingsGoalsStore`<br>`useTodoStore`<br>`useTripsStore`<br>`useWarrantiesStore` | personal, financial, health | Hajrudin Kardasevic |
| `/life` | `app/(tabs)/life.tsx` | `core-shell` | `useCareerStore`<br>`useHabitsStore`<br>`useHouseholdStore`<br>`useLifeGoalsStore`<br>`useTodoStore` | personal | Hajrudin Kardasevic |
| `/settings` | `app/(tabs)/settings.tsx` | `account` | `useAppLockStore`<br>`useAuthStore`<br>`useProfileStore`<br>`useSettingsStore`<br>`useSyncStatusStore`<br>`useThemeStore` | personal | Hajrudin Kardasevic |
| `/+html` | `app/+html.tsx` | `core-shell` | – | ordinary | Hajrudin Kardasevic |
| `/+not-found` | `app/+not-found.tsx` | `core-shell` | – | ordinary | Hajrudin Kardasevic |
| `/_layout` | `app/_layout.tsx` | `core-shell` | `useAppLockStore`<br>`useAuthStore`<br>`useCVStore`<br>`useCareerStore`<br>`useCategoriesStore`<br>`useCycleStore`<br>`useExpensesStore`<br>`useFoodStore`<br>`useHabitsStore`<br>`useHouseholdStore`<br>`useIncomeStore`<br>`useLifeGoalsStore`<br>`useProfileStore`<br>`useSavingsGoalsStore`<br>`useSettingsStore`<br>`useThemeStore`<br>`useTodoStore`<br>`useTripsStore`<br>`useWarrantiesStore` | personal, financial, health | Hajrudin Kardasevic |
| `/auth` | `app/auth.tsx` | `account` | `useAuthStore` | personal | Hajrudin Kardasevic |
| `/career/applications/[id]` | `app/career/applications/[id].tsx` | `career` | `useCareerStore` | personal | Hajrudin Kardasevic |
| `/career/applications` | `app/career/applications/index.tsx` | `career` | `useCareerStore` | personal | Hajrudin Kardasevic |
| `/career/applications/new` | `app/career/applications/new.tsx` | `career` | `useCareerStore` | personal | Hajrudin Kardasevic |
| `/career/cv/education/[id]` | `app/career/cv/education/[id].tsx` | `career` | `useCVStore` | personal, document | Hajrudin Kardasevic |
| `/career/cv/education` | `app/career/cv/education/index.tsx` | `career` | `useCVStore` | personal, document | Hajrudin Kardasevic |
| `/career/cv/education/new` | `app/career/cv/education/new.tsx` | `career` | `useCVStore` | personal, document | Hajrudin Kardasevic |
| `/career/cv/experience/[id]` | `app/career/cv/experience/[id].tsx` | `career` | `useCVStore` | personal, document | Hajrudin Kardasevic |
| `/career/cv/experience` | `app/career/cv/experience/index.tsx` | `career` | `useCVStore` | personal, document | Hajrudin Kardasevic |
| `/career/cv/experience/new` | `app/career/cv/experience/new.tsx` | `career` | `useCVStore` | personal, document | Hajrudin Kardasevic |
| `/career/cv/generate` | `app/career/cv/generate.tsx` | `career` | `useCVStore`<br>`useCareerStore` | personal, document | Hajrudin Kardasevic |
| `/career/cv` | `app/career/cv/index.tsx` | `career` | `useCVStore`<br>`useCareerStore` | personal, document | Hajrudin Kardasevic |
| `/career/cv/languages` | `app/career/cv/languages.tsx` | `career` | `useCVStore`<br>`useToastStore` | personal, document | Hajrudin Kardasevic |
| `/career/cv/personal-info` | `app/career/cv/personal-info.tsx` | `career` | `useCVStore` | personal, document | Hajrudin Kardasevic |
| `/career` | `app/career/index.tsx` | `career` | `useCareerStore` | personal | Hajrudin Kardasevic |
| `/career/skills` | `app/career/skills/index.tsx` | `career` | `useCareerStore`<br>`useToastStore` | personal | Hajrudin Kardasevic |
| `/cycle/[id]` | `app/cycle/[id].tsx` | `cycle` | `useCycleStore` | health | Hajrudin Kardasevic |
| `/cycle/health-info/[id]` | `app/cycle/health-info/[id].tsx` | `cycle` | `useCycleStore` | health | Hajrudin Kardasevic |
| `/cycle/health-info` | `app/cycle/health-info/index.tsx` | `cycle` | `useCycleStore` | health | Hajrudin Kardasevic |
| `/cycle/history` | `app/cycle/history.tsx` | `cycle` | `useCycleStore` | health | Hajrudin Kardasevic |
| `/cycle/log-day` | `app/cycle/log-day.tsx` | `cycle` | `useCycleStore` | health | Hajrudin Kardasevic |
| `/cycle/new` | `app/cycle/new.tsx` | `cycle` | `useCycleStore` | health | Hajrudin Kardasevic |
| `/cycle/settings` | `app/cycle/settings.tsx` | `cycle` | `useCycleStore`<br>`useToastStore` | health | Hajrudin Kardasevic |
| `/cycle/symptoms` | `app/cycle/symptoms.tsx` | `cycle` | `useCycleStore` | health | Hajrudin Kardasevic |
| `/economy/insights` | `app/economy/insights.tsx` | `economy` | `useExpensesStore`<br>`useIncomeStore`<br>`useSavingsGoalsStore` | financial | Hajrudin Kardasevic |
| `/expenses/[category]` | `app/expenses/[category].tsx` | `economy` | `useExpensesStore` | financial | Hajrudin Kardasevic |
| `/expenses/edit/[id]` | `app/expenses/edit/[id].tsx` | `economy` | `useExpensesStore` | financial, document | Hajrudin Kardasevic |
| `/expenses/income` | `app/expenses/income.tsx` | `economy` | `useIncomeStore` | financial | Hajrudin Kardasevic |
| `/expenses` | `app/expenses/index.tsx` | `economy` | `useExpensesStore`<br>`useIncomeStore` | financial | Hajrudin Kardasevic |
| `/expenses/new` | `app/expenses/new.tsx` | `economy` | `useExpensesStore`<br>`useToastStore` | financial, document | Hajrudin Kardasevic |
| `/expenses/search` | `app/expenses/search.tsx` | `economy` | `useExpensesStore` | financial | Hajrudin Kardasevic |
| `/expenses/upcoming` | `app/expenses/upcoming.tsx` | `economy` | `useExpensesStore` | financial | Hajrudin Kardasevic |
| `/food/budget` | `app/food/budget.tsx` | `food` | `useFoodStore` | financial | Hajrudin Kardasevic |
| `/food` | `app/food/index.tsx` | `food` | `useFoodStore` | ordinary | Hajrudin Kardasevic |
| `/food/offers` | `app/food/offers.tsx` | `food` | `useFoodStore` | ordinary | Hajrudin Kardasevic |
| `/food/pantry` | `app/food/pantry.tsx` | `food` | `useFoodStore`<br>`useToastStore` | ordinary | Hajrudin Kardasevic |
| `/food/recipes/[id]` | `app/food/recipes/[id].tsx` | `food` | `useFoodStore` | ordinary | Hajrudin Kardasevic |
| `/food/recipes` | `app/food/recipes/index.tsx` | `food` | `useFoodStore` | ordinary | Hajrudin Kardasevic |
| `/food/recipes/new` | `app/food/recipes/new.tsx` | `food` | `useFoodStore` | ordinary | Hajrudin Kardasevic |
| `/food/select-stores` | `app/food/select-stores.tsx` | `food` | `useFoodStore` | ordinary | Hajrudin Kardasevic |
| `/food/shopping-list` | `app/food/shopping-list.tsx` | `food` | `useFoodStore`<br>`useToastStore` | ordinary | Hajrudin Kardasevic |
| `/food/weekly-plan` | `app/food/weekly-plan.tsx` | `food` | `useFoodStore`<br>`useToastStore` | ordinary | Hajrudin Kardasevic |
| `/habits/[id]` | `app/habits/[id].tsx` | `habits` | `useHabitsStore` | ordinary | Hajrudin Kardasevic |
| `/habits` | `app/habits/index.tsx` | `habits` | `useHabitsStore` | ordinary | Hajrudin Kardasevic |
| `/habits/new` | `app/habits/new.tsx` | `habits` | `useHabitsStore` | ordinary | Hajrudin Kardasevic |
| `/household` | `app/household/index.tsx` | `home` | `useHouseholdStore` | ordinary | Hajrudin Kardasevic |
| `/household/moving` | `app/household/moving.tsx` | `home` | `useHouseholdStore`<br>`useToastStore` | ordinary | Hajrudin Kardasevic |
| `/household/shopping-list` | `app/household/shopping-list.tsx` | `home` | `useHouseholdStore`<br>`useToastStore` | ordinary | Hajrudin Kardasevic |
| `/household/tasks/[id]` | `app/household/tasks/[id].tsx` | `home` | `useHouseholdStore`<br>`useProfileStore` | ordinary, personal | Hajrudin Kardasevic |
| `/household/tasks` | `app/household/tasks/index.tsx` | `home` | `useHouseholdStore` | ordinary | Hajrudin Kardasevic |
| `/household/tasks/new` | `app/household/tasks/new.tsx` | `home` | `useHouseholdStore` | ordinary | Hajrudin Kardasevic |
| `/language` | `app/language.tsx` | `account` | `useSettingsStore` | personal | Hajrudin Kardasevic |
| `/life-goals/[id]` | `app/life-goals/[id].tsx` | `goals` | `useLifeGoalsStore` | personal | Hajrudin Kardasevic |
| `/life-goals` | `app/life-goals/index.tsx` | `goals` | `useLifeGoalsStore` | personal | Hajrudin Kardasevic |
| `/life-goals/new` | `app/life-goals/new.tsx` | `goals` | `useLifeGoalsStore` | personal | Hajrudin Kardasevic |
| `/modal` | `app/modal.tsx` | `core-shell` | `useAppLockStore` | ordinary | Hajrudin Kardasevic |
| `/modules` | `app/modules.tsx` | `core-shell` | `useEnabledModulesStore`<br>`useHomeLayoutStore`<br>`useModuleFlagsStore` | ordinary | Hajrudin Kardasevic |
| `/review` | `app/review.tsx` | `core-shell` | `useEnabledModulesStore`<br>`useReviewStore` | financial | Hajrudin Kardasevic |
| `/onboarding-pin` | `app/onboarding-pin.tsx` | `account` | `useProfileStore` | personal | Hajrudin Kardasevic |
| `/onboarding-modules` | `app/onboarding-modules.tsx` | `account` | `useProfileStore` | ordinary | Hajrudin Kardasevic |
| `/new-password` | `app/new-password.tsx` | `account` | `useAuthStore`<br>`useToastStore` | personal | Hajrudin Kardasevic |
| `/onboarding-profile` | `app/onboarding-profile.tsx` | `account` | `useProfileStore` | personal | Hajrudin Kardasevic |
| `/savings/[id]` | `app/savings/[id].tsx` | `economy` | `useSavingsGoalsStore` | financial | Hajrudin Kardasevic |
| `/savings/allocate` | `app/savings/allocate.tsx` | `economy` | `useExpensesStore`<br>`useIncomeStore`<br>`useSavingsGoalsStore` | financial | Hajrudin Kardasevic |
| `/savings/icon/[icon]` | `app/savings/icon/[icon].tsx` | `economy` | `useSavingsGoalsStore` | financial | Hajrudin Kardasevic |
| `/savings` | `app/savings/index.tsx` | `economy` | `useExpensesStore`<br>`useIncomeStore`<br>`useSavingsGoalsStore` | financial | Hajrudin Kardasevic |
| `/savings/new` | `app/savings/new.tsx` | `economy` | `useSavingsGoalsStore` | financial | Hajrudin Kardasevic |
| `/search` | `app/search.tsx` | `core-shell` | `useExpensesStore`<br>`useHabitsStore`<br>`useLifeGoalsStore`<br>`useTodoStore`<br>`useWarrantiesStore` | personal, financial | Hajrudin Kardasevic |
| `/settings/backup` | `app/settings/backup.tsx` | `account` | `useToastStore` | personal, financial, document | Hajrudin Kardasevic |
| `/settings/delete-account` | `app/settings/delete-account.tsx` | `account` | `useToastStore` | personal | Hajrudin Kardasevic |
| `/settings/pin` | `app/settings/pin.tsx` | `account` | `useProfileStore`<br>`useToastStore` | personal | Hajrudin Kardasevic |
| `/settings/profile` | `app/settings/profile.tsx` | `account` | `useProfileStore`<br>`useToastStore` | personal | Hajrudin Kardasevic |
| `/settings/modules` | `app/settings/modules.tsx` | `account` | `useEnabledModulesStore` | ordinary | Hajrudin Kardasevic |
| `/todos/[id]` | `app/todos/[id].tsx` | `tasks` | `useTodoStore` | ordinary | Hajrudin Kardasevic |
| `/todos` | `app/todos/index.tsx` | `tasks` | `useToastStore`<br>`useTodoStore` | ordinary | Hajrudin Kardasevic |
| `/todos/new` | `app/todos/new.tsx` | `tasks` | `useCycleStore`<br>`useProfileStore`<br>`useToastStore`<br>`useTodoStore` | ordinary, health | Hajrudin Kardasevic |
| `/travel/[id]/expenses/edit/[expenseId]` | `app/travel/[id]/expenses/edit/[expenseId].tsx` | `travel` | `useTripsStore` | financial, document | Hajrudin Kardasevic |
| `/travel/[id]/expenses` | `app/travel/[id]/expenses/index.tsx` | `travel` | `useTripsStore` | personal, financial | Hajrudin Kardasevic |
| `/travel/[id]/expenses/new` | `app/travel/[id]/expenses/new.tsx` | `travel` | `useTripsStore` | personal, financial | Hajrudin Kardasevic |
| `/travel/[id]` | `app/travel/[id]/index.tsx` | `travel` | `useTripsStore` | personal, financial, document | Hajrudin Kardasevic |
| `/travel/[id]/packing` | `app/travel/[id]/packing.tsx` | `travel` | `useTripsStore` | personal, financial | Hajrudin Kardasevic |
| `/travel` | `app/travel/index.tsx` | `travel` | `useTripsStore` | personal, financial | Hajrudin Kardasevic |
| `/travel/new` | `app/travel/new.tsx` | `travel` | `useTripsStore` | personal, financial | Hajrudin Kardasevic |
| `/warranties/[id]` | `app/warranties/[id].tsx` | `warranties` | `useWarrantiesStore` | document, financial | Hajrudin Kardasevic |
| `/warranties` | `app/warranties/index.tsx` | `warranties` | `useWarrantiesStore` | document, financial | Hajrudin Kardasevic |
| `/warranties/new` | `app/warranties/new.tsx` | `warranties` | `useToastStore`<br>`useWarrantiesStore` | document, financial | Hajrudin Kardasevic |
| `/warranties/view-image` | `app/warranties/view-image.tsx` | `warranties` | – | document | Hajrudin Kardasevic |

<!-- inventory:routes:end -->

## §3 Store inventory

Every file in `store/`. "Local storage" is where the Zustand state is persisted
today; "Supabase tables" are the tables the store itself reads or writes.

All persisted stores currently use plain (unencrypted) AsyncStorage, including
`useCycleStore` — see §8-F1.

<!-- inventory:stores:start -->

| Store | File | Module | Persist key | Local storage | Supabase tables | Sensitivity | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `useAuthStore` | `store/useAuthStore.ts` | `account` | – | memory only; session in device keychain via `utils/auth/secureSessionStorage.ts` | – (Supabase Auth) | personal | Hajrudin Kardasevic |
| `useProfileStore` | `store/useProfileStore.ts` | `account` | `lifesort-profile` | AsyncStorage (plain) | `profiles` | personal | Hajrudin Kardasevic |
| `useAppLockStore` | `store/useAppLockStore.ts` | `account` | `lifesort-app-lock` | AsyncStorage (plain); PIN hash in SecureStore via `utils/auth/pinAuth.ts` | – | personal | Hajrudin Kardasevic |
| `useSettingsStore` | `store/useSettingsStore.ts` | `core-shell` | `lifesort-settings` | AsyncStorage (plain) | `settings` | ordinary | Hajrudin Kardasevic |
| `useThemeStore` | `store/useThemeStore.ts` | `core-shell` | `lifesort-theme` | AsyncStorage (plain) | `settings` | ordinary | Hajrudin Kardasevic |
| `useSyncStatusStore` | `store/useSyncStatusStore.ts` | `core-shell` | `sync-status` | AsyncStorage (plain) | – | ordinary | Hajrudin Kardasevic |
| `useTabBarStore` | `store/useTabBarStore.ts` | `core-shell` | – | memory only | – | ordinary | Hajrudin Kardasevic |
| `useModuleFlagsStore` | `store/useModuleFlagsStore.ts` | `core-shell` | `lifesort-module-flags` | AsyncStorage (plain) | `module_flags` | ordinary | Hajrudin Kardasevic |
| `useEnabledModulesStore` | `store/useEnabledModulesStore.ts` | `core-shell` | `lifesort-enabled-modules` | AsyncStorage (plain) | `user_modules` | ordinary | Hajrudin Kardasevic |
| `useHomeLayoutStore` | `store/useHomeLayoutStore.ts` | `core-shell` | `lifesort-home-layout` | AsyncStorage (plain) | – (kun lokalt) | ordinary | Hajrudin Kardasevic |
| `useReviewStore` | `store/useReviewStore.ts` | `core-shell` | `lifesort-monthly-review` | AsyncStorage (plain) | – (kun lokalt) | ordinary | Hajrudin Kardasevic |
| `useToastStore` | `store/useToastStore.ts` | `core-shell` | – | memory only | – | ordinary | Hajrudin Kardasevic |
| `useExpensesStore` | `store/useExpensesStore.ts` | `economy` | `lifesort-expenses` | AsyncStorage (plain) | `expenses`, `expense_category_budgets` | financial, document | Hajrudin Kardasevic |
| `useIncomeStore` | `store/useIncomeStore.ts` | `economy` | `lifesort-income-v2` | AsyncStorage (plain) | `income` | financial | Hajrudin Kardasevic |
| `useSavingsGoalsStore` | `store/useSavingsGoalsStore.ts` | `economy` | `lifesort-savings-goals` | AsyncStorage (plain) | `savings_goals`, `savings_history`, `savings_extra` | financial | Hajrudin Kardasevic |
| `useCategoriesStore` | `store/useCategoriesStore.ts` | `economy` | `lifesort-categories` | AsyncStorage (plain) | `categories` | ordinary | Hajrudin Kardasevic |
| `useFoodStore` | `store/useFoodStore.ts` | `food` | `lifesort-food-v2` | AsyncStorage (plain) | `food_standard_prices`, `food_monthly_budget`, `food_saved_plans`, `food_purchases`, `food_pantry_items`, `food_shopping_items`, `food_recipes`, `food_offers`, `food_selected_stores`, `global_offers`, `global_standard_prices` | ordinary, financial | Hajrudin Kardasevic |
| `useHouseholdStore` | `store/useHouseholdStore.ts` | `home` | `lifesort-household` | AsyncStorage (plain) | `household_tasks`, `household_shopping_items`, `household_moving_items` | ordinary | Hajrudin Kardasevic |
| `useLifeGoalsStore` | `store/useLifeGoalsStore.ts` | `goals` | `lifesort-life-goals` | AsyncStorage (plain) | `life_goals` | personal | Hajrudin Kardasevic |
| `useHabitsStore` | `store/useHabitsStore.ts` | `habits` | `lifesort-habits` | AsyncStorage (plain) | `habits` | ordinary | Hajrudin Kardasevic |
| `useTodoStore` | `store/useTodoStore.ts` | `tasks` | `lifesort-todos` | AsyncStorage (plain) | `todos` | ordinary | Hajrudin Kardasevic |
| `useTripsStore` | `store/useTripsStore.ts` | `travel` | `lifesort-trips` | AsyncStorage (plain) | `trips`, `trip_expenses`, `trip_packing_items`, `trip_participants` | personal, financial, document | Hajrudin Kardasevic |
| `useWarrantiesStore` | `store/useWarrantiesStore.ts` | `warranties` | `lifesort-warranties` | AsyncStorage (plain) | `warranties` | document, financial | Hajrudin Kardasevic |
| `useCareerStore` | `store/useCareerStore.ts` | `career` | `lifesort-career` | AsyncStorage (plain) | `job_applications`, `skills` | personal | Hajrudin Kardasevic |
| `useCVStore` | `store/useCVStore.ts` | `career` | `lifesort-cv` | AsyncStorage (plain) | `cv_personal_info`, `cv_education`, `cv_experience`, `cv_languages`, `cv_versions` | personal, document | Hajrudin Kardasevic |
| `useSkillCategoriesStore` | `store/useSkillCategoriesStore.ts` | `career` | `lifesort-skill-categories` | AsyncStorage (plain) | – | ordinary | Hajrudin Kardasevic |
| `useCycleStore` | `store/useCycleStore.ts` | `cycle` | `lifesort-cycle` | AsyncStorage (plain) — see §8-F1 | `cycles`, `symptom_logs`, `cycle_settings`, `health_conditions`, `symptom_glossary` | health | Hajrudin Kardasevic |

<!-- inventory:stores:end -->

## §4 Supabase table inventory

Reverse view: which module owns each table, and which client file talks to it.
Every table referenced by a `.from('…')` call in `app/`, `store/`, `utils/`,
`hooks/` or `components/` appears here.

`shared read-only` marks global content that is read by all users rather than
owned per user; it must be protected by grants rather than by user-scoped RLS.

<!-- inventory:tables:start -->

| Table | Module | Client access point | Sensitivity | Owner |
| --- | --- | --- | --- | --- |
| `profiles` | `account` | `store/useProfileStore.ts` | personal | Hajrudin Kardasevic |
| `settings` | `core-shell` | `store/useSettingsStore.ts`, `store/useThemeStore.ts` | ordinary | Hajrudin Kardasevic |
| `module_flags` | `core-shell` (shared read-only; operator kill switches) | `store/useModuleFlagsStore.ts` | ordinary | Hajrudin Kardasevic |
| `user_modules` | `core-shell` (per-user module choice) | `store/useEnabledModulesStore.ts` | ordinary | Hajrudin Kardasevic |
| `expenses` | `economy` | `store/useExpensesStore.ts` | financial | Hajrudin Kardasevic |
| `expense_category_budgets` | `economy` | `store/useExpensesStore.ts` | financial | Hajrudin Kardasevic |
| `income` | `economy` | `store/useIncomeStore.ts` | financial | Hajrudin Kardasevic |
| `categories` | `economy` | `store/useCategoriesStore.ts` | ordinary | Hajrudin Kardasevic |
| `savings_goals` | `economy` | `store/useSavingsGoalsStore.ts` | financial | Hajrudin Kardasevic |
| `savings_history` | `economy` | `store/useSavingsGoalsStore.ts` | financial | Hajrudin Kardasevic |
| `savings_extra` | `economy` | `store/useSavingsGoalsStore.ts` | financial | Hajrudin Kardasevic |
| `food_standard_prices` | `food` | `store/useFoodStore.ts` | ordinary | Hajrudin Kardasevic |
| `food_monthly_budget` | `food` | `store/useFoodStore.ts` | financial | Hajrudin Kardasevic |
| `food_saved_plans` | `food` | `store/useFoodStore.ts` | ordinary | Hajrudin Kardasevic |
| `food_purchases` | `food` | `store/useFoodStore.ts` | financial | Hajrudin Kardasevic |
| `food_pantry_items` | `food` | `store/useFoodStore.ts` | ordinary | Hajrudin Kardasevic |
| `food_shopping_items` | `food` | `store/useFoodStore.ts` | ordinary | Hajrudin Kardasevic |
| `food_recipes` | `food` | `store/useFoodStore.ts` | ordinary | Hajrudin Kardasevic |
| `food_offers` | `food` | `store/useFoodStore.ts` | ordinary | Hajrudin Kardasevic |
| `food_selected_stores` | `food` | `store/useFoodStore.ts` | personal | Hajrudin Kardasevic |
| `global_offers` | `food` (shared read-only) | `store/useFoodStore.ts` | ordinary | Hajrudin Kardasevic |
| `global_standard_prices` | `food` (shared read-only) | `store/useFoodStore.ts` | ordinary | Hajrudin Kardasevic |
| `household_tasks` | `home` | `store/useHouseholdStore.ts` | ordinary | Hajrudin Kardasevic |
| `household_shopping_items` | `home` | `store/useHouseholdStore.ts` | ordinary | Hajrudin Kardasevic |
| `household_moving_items` | `home` | `store/useHouseholdStore.ts` | ordinary | Hajrudin Kardasevic |
| `life_goals` | `goals` | `store/useLifeGoalsStore.ts` | personal | Hajrudin Kardasevic |
| `habits` | `habits` | `store/useHabitsStore.ts` | ordinary | Hajrudin Kardasevic |
| `todos` | `tasks` | `store/useTodoStore.ts` | ordinary | Hajrudin Kardasevic |
| `trips` | `travel` | `store/useTripsStore.ts` | personal | Hajrudin Kardasevic |
| `trip_expenses` | `travel` | `store/useTripsStore.ts` | financial | Hajrudin Kardasevic |
| `trip_packing_items` | `travel` | `store/useTripsStore.ts` | ordinary | Hajrudin Kardasevic |
| `trip_participants` | `travel` | `store/useTripsStore.ts` | personal | Hajrudin Kardasevic |
| `warranties` | `warranties` | `store/useWarrantiesStore.ts` | document, financial | Hajrudin Kardasevic |
| `attachments` | shared (`economy`, `warranties`, `travel`) | `utils/shared/attachmentSync.ts`, `core/auth/deleteAccount.ts` | document | Hajrudin Kardasevic |
| `job_applications` | `career` | `store/useCareerStore.ts` | personal | Hajrudin Kardasevic |
| `skills` | `career` | `store/useCareerStore.ts` | personal | Hajrudin Kardasevic |
| `cv_personal_info` | `career` | `store/useCVStore.ts` | personal | Hajrudin Kardasevic |
| `cv_education` | `career` | `store/useCVStore.ts` | personal | Hajrudin Kardasevic |
| `cv_experience` | `career` | `store/useCVStore.ts` | personal | Hajrudin Kardasevic |
| `cv_languages` | `career` | `store/useCVStore.ts` | personal | Hajrudin Kardasevic |
| `cv_versions` | `career` | `store/useCVStore.ts` | personal, document | Hajrudin Kardasevic |
| `cycles` | `cycle` | `store/useCycleStore.ts` | health | Hajrudin Kardasevic |
| `symptom_logs` | `cycle` | `store/useCycleStore.ts` | health | Hajrudin Kardasevic |
| `cycle_settings` | `cycle` | `store/useCycleStore.ts` | health | Hajrudin Kardasevic |
| `health_conditions` | `cycle` (shared read-only content) | `store/useCycleStore.ts` | ordinary | Hajrudin Kardasevic |
| `symptom_glossary` | `cycle` (shared read-only content) | `store/useCycleStore.ts` | ordinary | Hajrudin Kardasevic |

<!-- inventory:tables:end -->

### Storage buckets

| Bucket | Module | Access point | Sensitivity | Owner |
| --- | --- | --- | --- | --- |
| `attachments` | shared (`economy`, `warranties`, `travel`) | `utils/shared/attachmentSync.ts` (upload / remove / short-lived signed URL), `core/auth/deleteAccount.ts` (delete on account deletion) | document | Hajrudin Kardasevic |

## §5 Shared component inventory

Every file in `components/`. `shared` means the component is part of the common
design system and may be used by any module; anything else names the single
module that owns it.

<!-- inventory:components:start -->

| Component | File | Module | Owner |
| --- | --- | --- | --- |
| `Button` | `components/Button.tsx` | shared | Hajrudin Kardasevic |
| `Card` | `components/Card.tsx` | shared | Hajrudin Kardasevic |
| `Chip` | `components/Chip.tsx` | shared | Hajrudin Kardasevic |
| `CollapsibleSection` | `components/CollapsibleSection.tsx` | shared | Hajrudin Kardasevic |
| `DatePickerField` | `components/DatePickerField.tsx` | shared | Hajrudin Kardasevic |
| `EmptyState` | `components/EmptyState.tsx` | shared | Hajrudin Kardasevic |
| `Hero` | `components/Hero.tsx` | shared | Hajrudin Kardasevic |
| `IconGlowCircle` | `components/IconGlowCircle.tsx` | shared | Hajrudin Kardasevic |
| `Kicker` | `components/Kicker.tsx` | shared | Hajrudin Kardasevic |
| `MetricCard` | `components/MetricCard.tsx` | shared | Hajrudin Kardasevic |
| `MetricCardSkeleton` | `components/MetricCardSkeleton.tsx` | shared | Hajrudin Kardasevic |
| `ProgressBar` | `components/ProgressBar.tsx` | shared | Hajrudin Kardasevic |
| `QuickActionCard` | `components/QuickActionCard.tsx` | shared | Hajrudin Kardasevic |
| `RingProgress` | `components/RingProgress.tsx` | shared | Hajrudin Kardasevic |
| `Screen` | `components/Screen.tsx` | shared | Hajrudin Kardasevic |
| `SectionHeader` | `components/SectionHeader.tsx` | shared | Hajrudin Kardasevic |
| `SelectField` | `components/SelectField.tsx` | shared | Hajrudin Kardasevic |
| `SwipeableRow` | `components/SwipeableRow.tsx` | shared | Hajrudin Kardasevic |
| `Themed` | `components/Themed.tsx` | shared | Hajrudin Kardasevic |
| `Toast` | `components/Toast.tsx` | shared | Hajrudin Kardasevic |
| `FloatingTabBar` | `components/FloatingTabBar.tsx` | `core-shell` | Hajrudin Kardasevic |
| `ModuleGate` | `components/ModuleGate.tsx` | `core-shell` | Hajrudin Kardasevic |
| `ModuleChoiceList` | `components/ModuleChoiceList.tsx` | `core-shell` | Hajrudin Kardasevic |
| `useClientOnlyValue` | `components/useClientOnlyValue.ts` | `core-shell` | Hajrudin Kardasevic |
| `useClientOnlyValue` (web) | `components/useClientOnlyValue.web.ts` | `core-shell` | Hajrudin Kardasevic |
| `useColorScheme` | `components/useColorScheme.ts` | `core-shell` | Hajrudin Kardasevic |
| `useColorScheme` (web) | `components/useColorScheme.web.ts` | `core-shell` | Hajrudin Kardasevic |
| `LockScreen` | `components/LockScreen.tsx` | `account` | Hajrudin Kardasevic |
| `PrivacyOverlay` | `components/PrivacyOverlay.tsx` | `account` | Hajrudin Kardasevic |
| `VerifyEmailBanner` | `components/VerifyEmailBanner.tsx` | `account` | Hajrudin Kardasevic |
| `AttachmentList` | `components/AttachmentList.tsx` | shared (attachments: `economy`, `warranties`) | Hajrudin Kardasevic |
| `CategoryPicker` | `components/CategoryPicker.tsx` | `economy` | Hajrudin Kardasevic |
| `ExpensePieChart` | `components/ExpensePieChart.tsx` | `economy` | Hajrudin Kardasevic |
| `TrendLineChart` | `components/TrendLineChart.tsx` | `economy` | Hajrudin Kardasevic |
| `SavingsHistoryChart` | `components/SavingsHistoryChart.tsx` | `economy` | Hajrudin Kardasevic |
| `SavingsIconPicker` | `components/SavingsIconPicker.tsx` | `economy` | Hajrudin Kardasevic |
| `AssigneeSelector` | `components/AssigneeSelector.tsx` | `home` | Hajrudin Kardasevic |
| `HabitMonthCalendar` | `components/HabitMonthCalendar.tsx` | `habits` | Hajrudin Kardasevic |
| `HabitWeekRow` | `components/HabitWeekRow.tsx` | `habits` | Hajrudin Kardasevic |
| `TripAttachmentGrid` | `components/TripAttachmentGrid.tsx` | `travel` | Hajrudin Kardasevic |
| `SkillCategoryPicker` | `components/SkillCategoryPicker.tsx` | `career` | Hajrudin Kardasevic |
| `CycleInsightsCard` | `components/CycleInsightsCard.tsx` | `cycle` | Hajrudin Kardasevic |
| `CycleMonthCalendar` | `components/CycleMonthCalendar.tsx` | `cycle` | Hajrudin Kardasevic |
| `CycleWheel` | `components/CycleWheel.tsx` | `cycle` | Hajrudin Kardasevic |
| `HealthDisclaimer` | `components/HealthDisclaimer.tsx` | `cycle` | Hajrudin Kardasevic |

<!-- inventory:components:end -->

## §6 Supporting code by module

Directory-level map of the remaining shared code. Not enforced by the test.

| Module | Domain logic | Types | Localization namespaces |
| --- | --- | --- | --- |
| `core-shell` | `utils/shared/` (`localDate`, `monthKey`, `dateDays`, `greeting`, `pieChartMath`, `lastWeekdayOfMonth`, `syncQueue`, `dataBackup`, `backupValidation`, `imageCompression`, `attachmentStorage`, `attachmentSync`), `hooks/` | `types/attachment.ts` | `common`, `home`, `life`, `search`, `about`, `datePicker` |
| `account` | `utils/auth/` (`pinAuth`, `pinLockout`, `secureSessionStorage`, `clearLocalUserData`, `deleteAccount`) | `types/profile.ts` | `auth`, `profile`, `settings`, `appLock`, `deleteAccount`, `backup`, `language` |
| `economy` | `utils/expense/`, `utils/savings/` | `types/expense.ts`, `types/savingsGoal.ts` | `expenses`, `economy`, `savings` |
| `food` | `utils/food/`, `data/seedRecipes*.ts` | `types/food.ts` | `food` |
| `home` | `utils/household/` | `types/household.ts` | `household` |
| `goals` | – | `types/life.ts` | `lifeGoals` |
| `habits` | `utils/habit/` | `types/life.ts` | `habits` |
| `tasks` | `utils/todo/` (`calendarSync`) | `types/life.ts` | `todos` |
| `travel` | `utils/trip/` | `types/trip.ts` | `travel` |
| `warranties` | `utils/warranty/` | `types/warranty.ts` | `warranties` |
| `career` | `utils/cv/` | `types/career.ts`, `types/cv.ts` | `career`, `cv` |
| `cycle` | `utils/cycle/` | `types/cycle.ts`, `types/healthInfo.ts` | `cycle`, `healthInfo` |

## §7 Sensitivity legend

Values follow `DataSensitivity` in the master specification (§4.1). A row may
carry more than one value. Classification follows the entity, not the screen
name.

| Value | Meaning in LifeSort |
| --- | --- |
| `ordinary` | Low-risk personal productivity data (chores, shopping list, habits, recipes). |
| `personal` | Identifies or profiles the user (profile, trips, job applications, CV content). |
| `financial` | Amounts, budgets, income, savings, purchase prices. |
| `health` | Cycle, symptoms and reproductive-health settings. Special category under GDPR. |
| `document` | Uploaded files and their metadata (receipts, warranty photos, generated CVs). |

## §8 Findings — conflicts between this repo and the master specification

Recorded here as facts. **None of these are fixed by APP-001**; each belongs to a
later story.

| # | Finding | Evidence | Owning story |
| --- | --- | --- | --- |
| F1 | Health data is persisted in plain AsyncStorage. | `store/useCycleStore.ts` uses `createJSONStorage(() => AsyncStorage)` with key `lifesort-cycle`. | APP-028 |
| F2 | Reproductive-health visibility is gated on gender. | `app/(tabs)/_layout.tsx`: `showCycleTab = gender === 'female'`. The `/cycle` routes stay reachable directly regardless. | APP-071 |
| F3 | Module ids in the repo do not match the spec `ModuleId` union. | Repo uses `tasks` (todos) and the platform-level `core-shell` / `account`; the spec union has no `tasks` and omits shell/account. `documents`, `pregnancy` and `gifts` have no implementation. | APP-009 |
| F4 | Home imports eleven domain stores directly. | `app/(tabs)/index.tsx` references `useCycleStore`, `useExpensesStore`, `useFoodStore`, `useHabitsStore`, `useHouseholdStore`, `useIncomeStore`, `useProfileStore`, `useSavingsGoalsStore`, `useTodoStore`, `useTripsStore`, `useWarrantiesStore`. | APP-011 |
| F5 | Cross-module store import outside Home. | `app/todos/new.tsx` reads `useCycleStore` (health data) inside the `tasks` module; `app/(tabs)/economy.tsx` reads `useFoodStore`, `useTripsStore` and `useWarrantiesStore`. | APP-003, APP-039 |
| F6 | Search reads five domain stores directly. | `app/search.tsx` references `useExpensesStore`, `useHabitsStore`, `useLifeGoalsStore`, `useTodoStore`, `useWarrantiesStore`. | APP-077 |
| F7 | Sync is best-effort per store, with no outbox, revisions or tombstones. | `utils/shared/syncQueue.ts` swallows flush failures by design; stores upsert optimistically and report failures to `useSyncStatusStore`. | APP-031 – APP-035 |
| F8 | Local backup export omits the health domain. | `utils/shared/dataBackup.ts` `STORE_REGISTRY` covers 15 stores but not `useCycleStore`; `core/auth/clearLocalUserData.ts` does clear it. Intentional or not, it is undocumented behaviour. | APP-097 |
| F9 | Two stores write the same table. | `store/useSettingsStore.ts` and `store/useThemeStore.ts` both upsert `settings`. | APP-009 |
| F10 | The schema is almost entirely unversioned. | `supabase/migrations/` now exists but holds only `module_flags` (added by APP-006). Every other table in §4 is inferred from client calls and lives only in the Supabase project. A baseline migration is still missing. | APP-141 |

## §9 Out of scope for APP-001

Deliberately **not** covered by this document, to keep the story minimal:

- Data type / SDK / vendor / retention inventory → **APP-002**.
- Enforcement of import boundaries (ESLint rule) → **APP-003**.
- Typed `ModuleAvailability` state and evaluator → **APP-005**.
- The `ModuleDefinition` registry itself → **APP-009**.
