# APP-038 persistence audit and migration contract

Audit baseline: clean `main`, HEAD and origin/main
`d417466d1fea66959b49a783cbe65a1599579514`. The audit preceded implementation.
The source specification is the supplied Mobile Master Production Specification
v1.0, page 21, APP-038. Its contents were treated as source material; the pasted
story request controls scope. Expo SDK v57 documentation was read before code.

This document explains existing entries in `core/storage/dataProfileRegistry.ts`;
it is not a second runtime inventory. There are **35 device surfaces**, including
**23 persisted Zustand stores**, plus 51 remote surfaces and one bundled surface
in the existing 87-surface registry. Runtime coverage is derived from that registry.

## Zustand surfaces

Each row's store ID is `async-storage:` plus its exact key. All use AsyncStorage;
expense/trip/warranty/cycle adapters encrypt their entire serialized value.
`Z0` means raw JSON `{state: <listed fields>, version: 0}`; functions are omitted by
JSON serialization. `E1/Z0` means AES-GCM v1 outer envelope with inner Z0.
All hydrate in their named `store/use…Store.ts` through `createJSONStorage` and
`persist` at import time. APP-038 intercepts reads before parsing; Home is the
only changed domain schema. `external` means the listed store/secure adapter
retains schema ownership, not a claim of full nested-record validation.

`User sweep` means the existing `features/localStores.ts` reset followed by
`clearLocalUserData`'s owned AsyncStorage sweep. Built-ins/seed content are retained
in memory where that registry says so. Settings and module flags remain device
scoped. Encrypted stores also lose their shared secure key and attachment caches
on logout. APP-038 adds delayed-write invalidation around this existing cleanup.

| Key / store ID suffix | Profile | Backend / current format | Persisted state fields | Historical schema evidence | Hydration owner | Migration policy | Logout |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `lifesort-profile` | A | AsyncStorage / Z0 | profile {gender, optional name/partnerName}; hasOnboarded | 49c4355: optional age inside profile; 6c36d1a removed age writes and uses explicit onboarding. Existing bytes are not scrubbed by APP-038. | `store/useProfileStore.ts` | external; store/useProfileStore.ts | User sweep |
| `lifesort-app-lock` | B | AsyncStorage / Z0 | lockEnabled only (isLocked is never persisted) | d417466 baseline; no incompatible schema evolution identified in available history (old entity IDs remain strings). | `store/useAppLockStore.ts` | external; store/useAppLockStore.ts | User sweep |
| `lifesort-settings` | A | AsyncStorage / Z0 | language; hasHydrated | d417466 baseline; no incompatible schema evolution identified in available history (old entity IDs remain strings). | `store/useSettingsStore.ts` | external; store/useSettingsStore.ts | Retained (device scoped) |
| `lifesort-theme` | A | AsyncStorage / Z0 | mode (light/dark/system) | d417466 baseline; no incompatible schema evolution identified in available history (old entity IDs remain strings). | `store/useThemeStore.ts` | external; store/useThemeStore.ts | User sweep |
| `lifesort-module-flags` | D | AsyncStorage / Z0 | overrides map; lastFetchedAt | d417466 baseline; no incompatible schema evolution identified in available history (old entity IDs remain strings). | `store/useModuleFlagsStore.ts` | external; store/useModuleFlagsStore.ts | Retained (device scoped) |
| `lifesort-enabled-modules` | A | AsyncStorage / Z0 | enablement map | d417466 baseline; no incompatible schema evolution identified in available history (old entity IDs remain strings). | `store/useEnabledModulesStore.ts` | external; store/useEnabledModulesStore.ts | User sweep |
| `lifesort-home-layout` | A | AsyncStorage / Z1 | pinned[]; hidden[]; detail map; lastOpenedAt map | c4715e6: v0 without detail; 5898ce5 and d417466: v0 with detail | `store/useHomeLayoutStore.ts` | versioned; core/storage/migrations/homeLayout.ts | User sweep |
| `lifesort-monthly-review` | A | AsyncStorage / Z0 | showOnHome only | d417466 baseline; no incompatible schema evolution identified in available history (old entity IDs remain strings). | `store/useReviewStore.ts` | external; store/useReviewStore.ts | User sweep |
| `lifesort-expenses` | A,B | AsyncStorage + secure AES-GCM / E1/Z2 (APP-042; was E1/Z1) | expenses[] including attachments, recurrenceFrequency and recurrenceAnchorDay; seriesStoppedAt map; categoryBudgets map; money in DKK MinorUnits | f00dd0d attachments; c1c1c29/pre-0746c50 plaintext Zustand; 0746c50 encrypted metadata/files; APP-040 inner v0→v1 money; APP-042 inner v1→v2 recurrence (adds the cadence and day anchor, and repairs legacy impossible dates such as 2026-02-31 by clamping the date and keeping the intended day as the anchor) | `store/useExpensesStore.ts` | external; core/storage/documentCacheStorage.ts (inner v2 via core/storage/migrations/economyMoney.ts) | User sweep |
| `lifesort-income-v2` | A | AsyncStorage / Z1 (APP-040; was Z0) | incomeByMonth map in DKK MinorUnits | 49c4355 through c73bf68 Z0 major-unit floats; APP-040 v0→v1 | `store/useIncomeStore.ts` | versioned; core/storage/migrations/economyMoney.ts | User sweep |
| `lifesort-savings-goals` | A | AsyncStorage / Z1 (APP-040; was Z0) | goals[]; history[]; extraSavings; money in DKK MinorUnits | 49c4355 through c73bf68 Z0 major-unit floats; APP-040 v0→v1 | `store/useSavingsGoalsStore.ts` | versioned; core/storage/migrations/economyMoney.ts | User sweep |
| `lifesort-categories` | A | AsyncStorage / Z0 | categories[] including built-ins | d417466 baseline; no incompatible schema evolution identified in available history (old entity IDs remain strings). | `store/useCategoriesStore.ts` | external; store/useCategoriesStore.ts | User sweep |
| `lifesort-food-v2` | A,D | AsyncStorage / Z3 (APP-052; was Z2) | monthlyBudgetByMonth, purchases[], pantryItems[] (structured/legacy), shoppingItems[] (manual or meal-plan artifact with immutable recipe provenance), offers[], recipes[] (typed ingredients), standardPrices[], globalStandardPrices[], globalOffers[], savedPlans, selectedStores[] | APP-047 v0→v1 keeps historical recipe amounts verbatim; APP-050 v1→v2 keeps historical Pantry text verbatim; APP-052 v2→v3 makes all historical shopping rows explicit manual items without inferring identity, amount or provenance (see [app-052-shopping-list-derivation.md](./app-052-shopping-list-derivation.md)) | `store/useFoodStore.ts` | versioned; core/storage/migrations/foodIngredients.ts | User sweep |
| `lifesort-household` | A | AsyncStorage / Z0 | tasks[]; shoppingItems[]; movingItems[] | 49c4355 pre-rotation tasks; f00dd0d adds assignedTo/rotates with existing hydration defaults | `store/useHouseholdStore.ts` | external; store/useHouseholdStore.ts | User sweep |
| `lifesort-life-goals` | A | AsyncStorage / Z0 | goals[] | d417466 baseline; no incompatible schema evolution identified in available history (old entity IDs remain strings). | `store/useLifeGoalsStore.ts` | external; store/useLifeGoalsStore.ts | User sweep |
| `lifesort-habits` | A | AsyncStorage / Z0 | habits[] (including logs) | d417466 baseline; no incompatible schema evolution identified in available history (old entity IDs remain strings). | `store/useHabitsStore.ts` | external; store/useHabitsStore.ts | User sweep |
| `lifesort-todos` | A | AsyncStorage / Z0 | todos[] | d417466 baseline; no incompatible schema evolution identified in available history (old entity IDs remain strings). | `store/useTodoStore.ts` | external; store/useTodoStore.ts | User sweep |
| `lifesort-trips` | A,B | AsyncStorage + secure AES-GCM / E1/Z0 | trips[] (documents), expenses[] (attachments), packingItems[], participants[], myUserId | pre-0746c50 plaintext Zustand; 0746c50 encrypted metadata/files | `store/useTripsStore.ts` | external; core/storage/documentCacheStorage.ts | User sweep |
| `lifesort-warranties` | A,B | AsyncStorage + secure AES-GCM / E1/Z0 | warranties[] including attachments | pre-0746c50 plaintext Zustand; 0746c50 encrypted metadata/files | `store/useWarrantiesStore.ts` | external; core/storage/documentCacheStorage.ts | User sweep |
| `lifesort-career` | A | AsyncStorage / Z0 | applications[]; skills[] | d417466 baseline; no incompatible schema evolution identified in available history (old entity IDs remain strings). | `store/useCareerStore.ts` | external; store/useCareerStore.ts | User sweep |
| `lifesort-cv` | A | AsyncStorage / Z0 | personalInfo; education[]; experience[]; languages[]; versions[] | d417466 baseline; no incompatible schema evolution identified in available history (old entity IDs remain strings). | `store/useCVStore.ts` | external; store/useCVStore.ts | User sweep |
| `lifesort-skill-categories` | A | AsyncStorage / Z0 | categories[] including built-ins | d417466 baseline; no incompatible schema evolution identified in available history (old entity IDs remain strings). | `store/useSkillCategoriesStore.ts` | external; store/useSkillCategoriesStore.ts | User sweep |
| `lifesort-cycle` | B,D | AsyncStorage + secure AES-GCM / E1/Z0 | cycles[]; symptomLogs[]; avgCycleLength; lutealPhaseLength; reminderEnabled; reminderDaysBefore; healthConditions[]; symptomGlossary[] | c1c1c29 reference arrays; 94f39eb plaintext v0; 0711414 encrypted v1 around inner v0 | `store/useCycleStore.ts` | external; core/storage/cycleHealthEncryptedStorage.ts | User sweep |

The `-v2` key suffixes for income and food predate the earliest available commit
49c4355; they are not Zustand schema version 2. No earlier `lifesort-income` or
`lifesort-food` bytes can be reconstructed from this history. Those obsolete keys,
if present, are only covered by the existing owned-key logout sweep. No invented
v1-to-v2 feature migration or fixture was added.

## Other device surfaces

| Registered store ID | Key/path and backend | Profiles | Current/historical form | Read/hydration owner | Migration ownership | Cleanup |
| --- | --- | --- | --- | --- | --- | --- |
| async-storage:lifesort-outbox | `lifesort-outbox`, AsyncStorage | A | `{version:1,state:{accountId,mutations[]}}`; 08bd660 through d417466 same format, no known v0 | `core/sync/outbox.ts`, every operation in one serialization lane | Versioned v1; current no-op and strict validation | Serialized outbox cleanup + user sweep |
| async-storage:lifesort-verification-last-sent | `lifesort-verification-last-sent`, AsyncStorage | A | Decimal timestamp string; no structured schema evolution | `core/auth/emailVerification.ts` throttle reads | Immutable/no-schema scalar | `clearResendThrottle` and user sweep |
| async-storage:sync-status | `sync-status`, AsyncStorage | A | Historical Zustand timestamp map; 33760c8 removed persistence | No active reads or writes | Cleanup-only legacy key | Owned extra-key user sweep |
| async-storage:supabase-session-web-or-legacy | SDK-derived `sb-<project-ref>-auth-token` and possible SDK auxiliary keys, AsyncStorage | C | SDK session JSON; web fallback or native legacy source | `utils/auth/secureSessionStorage.ts` via Supabase SDK | External SDK/auth adapter | SDK sign-out removes session; native remove also clears legacy source |
| secure-store:supabase-session | SDK-derived key plus `.0`, `.1`, etc., SecureStore | C | Session JSON or `__lifesort_chunked__:<count>`; chunks 1024 characters; native legacy AsyncStorage move existed at 49c4355 | `utils/auth/secureSessionStorage.ts` | External chunking/legacy move | SDK sign-out calls adapter removal for header/chunks |
| secure-store:lifesort-app-pin-hash | `lifesort-app-pin-hash`, SecureStore | B | Legacy SHA-256 hex; current `{v:2,salt,hash,iterations}` PBKDF2 (ad6430c) | `utils/auth/pinAuth.ts`, on verification | External; requires entered PIN and fresh salt | `clearLocalPin` |
| secure-store:lifesort-pin-lockout | `lifesort-pin-lockout`, SecureStore | B | Unversioned `{failedAttempts,lockedAt,durationMs}` (ad6430c) | `utils/auth/pinLockout.ts` | External lockout policy | Reset with valid unlock/clearLocalPin |
| secure-store:lifesort-cycle-health-key | `lifesort-cycle-health-key`, SecureStore | B | Base64 AES key bytes since 0711414 | `core/storage/cycleHealthEncryptedStorage.ts` | Immutable/no-schema key material | Key-epoch-aware deletion on logout |
| secure-store:lifesort-document-cache-key | `lifesort-document-cache-key`, SecureStore | B | Base64 AES key bytes since 0746c50 | `core/storage/documentCacheStorage.ts` | Immutable/no-schema key material | Key-epoch-aware deletion on logout |
| filesystem:document-directory/attachments | `documentDirectory/attachments/*`, filesystem | B | `LSATTACH` binary header + version 1 + IV/tag metadata + AES-GCM bytes in `.lsenc`; legacy plaintext files pre-0746c50 | `documentCacheStorage` on metadata migration/view/cache use | External specialized migration, encrypted pending-cleanup records | Parent attachment cleanup / persistent cache clear on logout |
| filesystem:cache-directory/lifesort-decrypted-attachments | `cacheDirectory/lifesort-decrypted-attachments/*`, filesystem | B | Temporary plaintext interoperability copies, never canonical persisted schema | `documentCacheStorage` viewer/share/upload | Cleanup-only, not migration staging | Viewer/temp lifecycle and logout |
| filesystem:document-directory/lifesort-backup-json | `documentDirectory/lifesort-backup-<date>.json`, filesystem | B | `{version:1,exportedAt,data}` since 49c4355; `version:2` since APP-040 (Economy money in MinorUnits); `version:3` since APP-042 (explicit expense recurrence cadence and day anchor); `version:4` since APP-047 (typed recipe ingredients); `version:5` since APP-050 (typed Pantry and explicit dates); `version:6` since APP-052 (typed shopping items and recipe provenance); user-triggered archive | `utils/shared/dataBackup.ts` / `backupValidation.ts`; never startup hydrated | External export/import contract; APP-097 | Existing logout does not sweep these exports; unchanged audit finding |

Remote Supabase tables/auth/buckets remain server persistence, not locally
hydrated keys. Cached remote data appears only within the local rows above.
Bundled seed recipes are immutable app source. Notification scheduling, OS
calendar export and share-sheet operations are integrations outside the existing
persistence inventory; no migration work was added to them.

## Existing migration and failure behavior

- Health: APP-028 validates known legacy state, encrypts in memory and commits
  to the same key. Failed writes preserve legacy bytes; protected failures block
  ordinary writes. APP-038 retains this adapter, adds raw-fixture coverage and
  requires inner `version === 0` before plaintext conversion or decrypted hydration.
- Documents: APP-029 migrates referenced files to ciphertext, commits encrypted
  metadata, removes legacy plaintext and keeps encrypted retry records when
  cleanup fails. This existing specialized operation is not advertised as a
  generic single-write/multi-key transaction. APP-038 only guards unsupported
  inner schemas and tests preservation; no new plaintext staging exists.
- Household: hydration fills assignedTo/rotates defaults and seeds moving items.
  Food hydration seeds recipes for the existing language and, since APP-047,
  refreshes persisted seed copies from the bundle (removed seeds stay removed). Expense hydration
  deduplicates IDs and adds missing attachment arrays; warranty hydration adds
  attachment arrays. These remain feature-owned compatibility callbacks.
- Home/Settings/EnabledModules/Review callbacks previously marked hydration
  complete even after an error, triggering persisted writes of defaults.
  Relevant callbacks now require successful state, preventing that reset path.
- Session adapter: legacy move preserves the source on write failure, but ordinary
  chunked replacement deletes the previous secure record before replacing it;
  missing chunks read as absent. This pre-existing multi-key auth behavior is
  external, not covered by generic rollback guarantees. Redesign is deferred.
- PIN lockout treats unreadable data as no lockout; a later failed attempt may
  replace it. This existing security-policy behavior is external and unchanged.
- Deliberate logout deletes keys; encryption-key invalidation can remove a newly
  written value after logout races. Those are authorized cleanup, not destructive
  migration failure handling. No generic remove/reset-on-failure is introduced.

## Historical fixtures and provenance

| Raw fixture | Store | Source commit | Source version | Target | Privacy |
| --- | --- | --- | --- | --- | --- |
| `home-layout/c4715e6-v0.json` | Home | c4715e6 | Zustand 0, before detail map | Zustand 1 | Synthetic preferences only |
| `home-layout/d417466-v0.json` | Home | d417466 | Zustand 0, with detail map | Zustand 1 | Synthetic preferences only |
| `outbox/d417466-v1.json` | Outbox | d417466 | Envelope 1 | Envelope 1, exact bytes unchanged | Synthetic account/IDs and module booleans only |
| `cycle/94f39eb-plaintext-v0.json` | Cycle | 94f39eb, before 0711414 encryption | Plaintext Zustand 0 | AES-GCM envelope 1, inner Zustand 0 | Synthetic defaults and empty arrays; no health records |
| `expenses/49c4355-plaintext-v0.json` | Expenses | 49c4355, before attachments and encryption | Plaintext Zustand 0, major-unit floats | AES-GCM envelope 1, inner Zustand 2 (APP-040 money, APP-042 recurrence) | Synthetic names and amounts |
| `expenses/c73bf68-inner-v0.json` | Expenses | c73bf68 | Inner Zustand 0 of the envelope (tests encrypt it) | Inner Zustand 2 (APP-040 money, APP-042 recurrence) | Synthetic amounts and attachment references |
| `expenses/22bbf3a-inner-v1.json` | Expenses | 22bbf3a, the APP-040 build | Inner Zustand 1 of the envelope: øre amounts, no recurrence fields | Inner Zustand 2 (APP-042 cadence and day anchor) | Synthetic amounts and attachment references |
| `income/c73bf68-v0.json` | Income | c73bf68 | Zustand 0, major-unit floats | Zustand 1 (APP-040) | Synthetic amounts |
| `savings-goals/c73bf68-v0.json` | Savings | c73bf68 | Zustand 0, major-unit floats | Zustand 1 (APP-040) | Synthetic goals and history |
| `food/5c85adc-v0.json` | Food | 5c85adc, the last pre-APP-047 build | Zustand 0, `{name, amount}` ingredients: two seed copies, a user recipe, a fetched recipe | Zustand 3 (APP-047 typed ingredients, APP-050 Pantry legacy text, APP-052 manual shopping migration) | Synthetic recipes, Pantry, prices and plans; seed text is bundled app content |

All files are under `__tests__/fixtures/local-migrations`, containing raw UTF-8
serialized JSON rather than parsed fixtures. The manifest records sensitivity,
source/target versions and synthetic status. No device dump, real name, email,
token, key, document content, transaction description or personal record was used.
Crypto tests generate test-only key material with the existing native API mocks.
Versionless Home recognition and multi-step protocol tests are contract probes,
not fabricated past release files. Keep all historical fixtures until an explicit
supported-upgrade policy authorizes their removal; keep the source commits
available in CI checkout history.

## Runtime contract and limits

See ADR-0033 for the per-store sequential engine, one-write rule, failure codes,
startup/Supabase gate and rollback limitations. Outbox IDs, account binding,
array order, payload, operation, baseRevision, status, attempts and nextRetryAt
are neither regenerated nor normalized. Both a retryable failed entry and a
permanent failed entry remain in the fixture, in the original entity chain.

The migration engine has no network imports or runtime service access. The
startup integration test holds an actual Home commit and verifies a real
coordinator cannot send until it completes. Separate testing exercises the
actual Supabase configuration's storage seam during a blocked secure adapter
read. Root effects remain unmounted until the adapter barrier succeeds.
The root also waits for Home's complete Zustand hydration; other compatible
feature owners retain their original hydration behavior.

External feature stores receive envelope/version protection; comprehensive
nested-record validation and feature-schema upgrades are deliberately deferred.
A future external owner can declare its own payload version independently.
Encryption nonce randomness remains inside specialized secure adapters.
There is no arbitrary down-migration, DB migration, backup/DR platform,
multi-key transaction framework, deployment or network-dependent transform.
(APP-038 itself converted no money; APP-040 later added the Economy money
definitions described in [app-040-money.md](./app-040-money.md).) Old pre-harness binaries cannot be retroactively made downgrade-safe.
The failed-startup screen gives restart/newer-version guidance without a reset.


## APP-038 review correction: sensitive versions, startup, and failure UI

The history audit found no supported versionless sensitive Zustand format.
Every revision of the four stores uses `persist` with `createJSONStorage` and
Zustand's default version 0, serialized as an explicit `version: 0` field:

| Store | All store-changing snapshots through d417466 |
| --- | --- |
| Cycle | 49c4355, c1c1c29, 0711414, 3101a7e |
| Expenses | 49c4355, f00dd0d, 0746c50, 3101a7e |
| Trips | 49c4355, b3d4be2, 134b13d, 0746c50, 3101a7e |
| Warranties | 49c4355, f00dd0d, 134b13d, dd16507, 0746c50, 3101a7e |

APP-028's tests at 0711414 contain four explicit v0 payloads; APP-029's tests at
0746c50 contain two. Neither records a versionless supported format. The retained
94f39eb health fixture is explicit v0. No historical versionless fixture was
invented. Structurally plausible versionless inputs are rejection probes only.

Both specialized validators therefore require inner `version === 0`, matching
the production generic envelope guard. Plaintext validation precedes encryption,
key creation, metadata writes, and attachment migration. Decrypted-inner
validation precedes rewrite or pending attachment cleanup. Actual wrapped adapter
tests cover versionless and future payloads, plaintext and encrypted, for Cycle
and all three document keys: original bytes, files, and keys remain unchanged.
The retained health v0 fixture and known document v0 shapes still hydrate through
the wrapper and preserve their existing encrypted migration behavior.

Root alone calls `finalizeStartupStorage()` after module imports establish their
reads. Supabase's eager storage read only calls passive `waitForStartupStorage()`.
One shared finalization promise drains the monotonically growing read registry
until a stable generation, then seals without an intervening await. Registrations
while waiting are included; concurrent finalizers cannot clear the registry
prematurely. A late failure rejects every waiter. Post-seal lazy reads keep their
individual guards without reopening startup. Deterministic controlled-promise
tests exercise A pending, late B, A completing first, B success/failure, and auth
waiting before any import-time feature read or Root finalization. Home hydration,
coordinator gating, and logout write invalidation remain intact.

The failed-startup surface uses React Native system appearance and existing
static light/dark color tokens, without importing the persisted theme store.
SafeArea, scrollable content, wrapping/scalable text, DA/EN copy and alert semantics
are covered by renderer tests. It displays no error codes, sensitive details or
reset action. This is a small pre-hydration message, not a recovery workflow.

CI audit: this repository has no checked-in CI checkout configuration (.github
is absent, and no tracked CI YAML/Jenkins configuration exists).
`scripts/check-adr.js` explicitly records CI as future APP-139/APP-141 work.
The current checkout is not shallow and the unchanged git-show provenance tests
pass against the referenced commits. No CI infrastructure was added. Future CI
must fetch those source commits/full history before running the fixture tests.
