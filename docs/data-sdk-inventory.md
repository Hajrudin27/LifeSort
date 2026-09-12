# LifeSort — Data & SDK Inventory

**Story:** APP-002 (E0 · Architecture & inventory, P0)
**Status:** As-is inventory of the repository. Descriptive, not aspirational.
**Owner of this document:** Hajrudin Kardasevic
**Last verified:** by `__tests__/dataSdkInventory.test.ts` on every test run.
**Companion document:** [`docs/app-inventory.md`](./app-inventory.md) (APP-001) — routes, modules, stores and tables.

## Purpose

Know every data type the app holds and every SDK that ships in the bundle, so
the privacy policy, the Apple App Privacy answers, the Apple privacy manifest
and the Google Play Data Safety form can be derived from the code instead of
from memory. A mismatch between what the code does and what the store forms say
is a review rejection at best and a privacy incident at worst.

This document records **what the code does today**. Where the current
implementation contradicts a store disclosure or the master specification, the
contradiction is written down in §6 rather than silently corrected.

## Scope

| In scope (APP-002) | Out of scope (later story) |
| --- | --- |
| Which data types exist, their purpose, sensitivity, and where they live | Building the Privacy Center UI → **APP-096** |
| Which SDKs ship, from which vendor, touching which data | The formal retention register with legal exceptions → **APP-099** |
| Retention as observed: what deletion and logout actually do today | The vendor/subprocessor register with DPAs → **APP-100** |
| The mapping from each data type to its store-disclosure category | Filling in App Store Connect / Play Console / `PrivacyInfo.xcprivacy` → **APP-159 – APP-161** |

The store-disclosure columns are a **mapping**, not a submission. They say which
category each data type belongs to when the forms are filled in; §6 records
where today's shipped manifest disagrees with that mapping.

## How this stays true

`__tests__/dataSdkInventory.test.ts` parses this file and fails the test run when:

- a runtime dependency in `package.json` has no row in §3 (a **new SDK that has
  not been through privacy review**), or a §3 row names a package that is no
  longer a dependency,
- a data-type row is missing purpose, location, vendor, retention, sensitivity
  or either store-disclosure cell,
- a data type names a module that is not declared in `docs/app-inventory.md` §1,
- a sensitivity value falls outside the shared legend,
- a location value falls outside the vocabulary in §1.

Adding a dependency therefore requires a row here in the same change. That is
the point: the store forms must move when the code moves.

## §0 Vendors

Every party that data can reach. There are only two, plus the user's own device.

| Vendor | Role | What reaches them | Region / notes |
| --- | --- | --- | --- |
| **Supabase** | Backend processor: Postgres, Auth, Storage | All synced user data (§1), account email and password hash, uploaded files | Hosted project `d7591058-…` via `EXPO_PUBLIC_SUPABASE_URL`. DPA, region and retention terms are **not yet documented in this repo** — see §6-D6 / APP-100. |
| **Apple / Google** | Platform, app distribution | Nothing from the app's own data flows. OS-level: local notifications, keychain/keystore, calendar, photo library | Store billing is not implemented; there is no purchase data today. |
| **The device itself** | Local-first primary storage | Everything in §1 marked `local` | AsyncStorage (plaintext except encrypted cycle envelope), SecureStore (keychain/keystore), app document directory. |

**No analytics, attribution, advertising or crash-reporting SDK is present.**
Verified by the absence of Sentry, Firebase, Amplitude, Mixpanel and PostHog in
`package.json` and in the source. `NSPrivacyTracking` is `false`. There is no
device push token: notifications are scheduled locally and never leave the
device (§3, `expo-notifications`).

## §1 Data inventory

One row per data type the app holds.

- **Purpose** — why the app has it. If a purpose cannot be written in one clause,
  the data should not be collected.
- **Location** — one of `local` (device only), `local+cloud` (local-first, synced
  to Supabase), `cloud` (server only), `device-os` (handed to an OS service and
  no longer held by the app).
- **Retention** — what actually happens today on logout and on account deletion.
  `cascade` means the row is removed by `ON DELETE CASCADE` from `auth.users`
  when `delete_my_account` runs (`core/auth/deleteAccount.ts`).
- **Apple** — App Privacy category. **Google** — Play Data Safety category.

<!-- inventory:data:start -->

| Data type | Module | Purpose | Location | Vendor | Retention | Sensitivity | Apple App Privacy | Google Data Safety |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Email address | `account` | Account identity and sign-in; confirmed before the account can invite anyone (APP-018) | cloud | Supabase | Held in `auth.users` until account deletion; removed by `delete_my_account` | personal | Contact Info › Email Address | Personal info › Email address |
| Verification resend timestamp | `account` | Throttles how often the confirmation email can be re-sent | local | – | `lifesort-verification-last-sent` in AsyncStorage; cleared on sign-out | ordinary | Not collected (device-local) | Not collected (device-local) |
| Password | `account` | Authentication | cloud | Supabase | Stored only as a hash by Supabase Auth; never held by the app | personal | Identifiers (credential) — not stored by app | Personal info › Other info (credentials) |
| Auth session / refresh token | `account` | Keep the user signed in between launches | local | Supabase | Device keychain/keystore via `utils/auth/secureSessionStorage.ts`; cleared on sign-out. Signing out affects **this device only** unless the user explicitly chooses to sign out other devices or everywhere (APP-025) | personal | Not collected (device-local credential) | Not collected (device-local credential) |
| App-lock PIN | `account` | Optional local app lock | local | – | PBKDF2-SHA256 hash in SecureStore (`utils/auth/pinAuth.ts`); cleared by `clearLocalPin()` on logout and deletion | personal | Not collected (device-local) | Not collected (device-local) |
| App-lock failed-attempt counter | `account` | Lockout backoff after wrong PINs | local | – | SecureStore (`utils/auth/pinLockout.ts`); cleared with the PIN | ordinary | Not collected | Not collected |
| Display name | `account` | Greeting and personalisation. Optional — an account can be created and used without one | local+cloud | Supabase | `profiles` row; cascade on deletion; local copy cleared on logout | personal | Contact Info › Name | Personal info › Name |
| Onboarding completion | `account` | Records that the user finished onboarding, so they are not sent through it again | local+cloud | Supabase | `profiles.onboarded_at`; cascade. Replaces inferring it from age being set (APP-017) | ordinary | Not collected | Not collected |
| Age | `account` | **No longer collected** (APP-017). The column remains in `profiles` with values from before; nothing reads or writes it — see §6-D1 | cloud | Supabase | Existing values retained pending a deliberate purge decision; cascade on account deletion | personal | Contact Info › Other User Contact Info | Personal info › Other info |
| Gender | `account` | Optional profile field, editable in Settings only. **No longer decides which modules a user has** (APP-020); its remaining use is colour tints — see §6-D2 | local+cloud | Supabase | `profiles` row; cascade | personal | Sensitive Info | Personal info › Other info |
| Partner name | `home` | Rotating household-chore assignment | local+cloud | Supabase | `profiles` row; cascade | personal | Contact Info › Name (third party) | Personal info › Name |
| Language and theme preference | `core-shell` | Localisation and appearance | local+cloud | Supabase | `settings` row; cascade. Language is deliberately **not** cleared on logout (device preference, not user data) | ordinary | Not collected | App info and performance › Other |
| Expenses, income, budgets | `economy` | Household budgeting | local+cloud | Supabase | `expenses`, `expense_category_budgets`, `income`; cascade; local stores cleared on logout | financial | Financial Info › Other Financial Info | Financial info › Other financial info |
| Savings goals and contribution history | `economy` | Track progress towards savings targets | local+cloud | Supabase | `savings_goals`, `savings_history`, `savings_extra`; cascade | financial | Financial Info › Other Financial Info | Financial info › Other financial info |
| Expense categories | `economy` | User-defined budget categories | local+cloud | Supabase | `categories`; cascade | ordinary | Not collected | Not collected |
| Grocery budget, purchases and prices | `food` | Weekly meal and grocery budgeting | local+cloud | Supabase | `food_monthly_budget`, `food_purchases`, `food_standard_prices`; cascade | financial | Financial Info › Purchase History | Financial info › Purchase history |
| Pantry, shopping list, recipes, meal plans | `food` | Meal planning and waste reduction | local+cloud | Supabase | `food_pantry_items`, `food_shopping_items`, `food_recipes`, `food_saved_plans`; cascade. Seed recipes are not user data and survive logout | ordinary | User Content › Other User Content | App activity › Other user-generated content |
| Selected grocery stores | `food` | Price lookups for the stores the user shops at | local+cloud | Supabase | `food_selected_stores`; cascade | personal | User Content › Other User Content | App activity › Other actions |
| Household chores and maintenance tasks | `home` | Recurring chore scheduling | local+cloud | Supabase | `household_tasks`, `household_shopping_items`, `household_moving_items`; cascade | ordinary | User Content › Other User Content | App activity › Other user-generated content |
| To-dos | `tasks` | Personal task list | local+cloud | Supabase | `todos`; cascade | ordinary | User Content › Other User Content | App activity › Other user-generated content |
| Life goals and sub-goals | `goals` | Long-term goal tracking | local+cloud | Supabase | `life_goals`; cascade | personal | User Content › Other User Content | App activity › Other user-generated content |
| Habits and daily habit logs | `habits` | Habit streaks and history | local+cloud | Supabase | `habits`; cascade | ordinary | User Content › Other User Content | App activity › Other user-generated content |
| Trips, trip budgets and packing lists | `travel` | Trip planning | local+cloud | Supabase | `trips`, `trip_expenses`, `trip_packing_items`; cascade | financial | Financial Info › Other Financial Info | Financial info › Other financial info |
| Trip participant invitations | `travel` | Share a trip with another account | local+cloud | Supabase | `trip_participants`, keyed by the invitee's **email address** — a third party's identifier; cascade | personal | Contact Info › Email Address (third party) | Personal info › Email address |
| Warranties, receipts and insurance records | `warranties` | Expiry reminders for purchases | local+cloud | Supabase | `warranties`; cascade | document | User Content › Other User Content | App activity › Other user-generated content |
| Uploaded files (expense and warranty evidence) | shared | Receipts and documents attached to an expense or a warranty | local+cloud | Supabase | Storage bucket `attachments`; row in `attachments` cascades and files are removed before deletion, with a daily server sweep for orphans. Local persistent copies are encrypted in the app document directory and temporary decrypted cache copies are removed on cleanup — §6-D4 | document | User Content › Photos or Videos | Photos and videos › Photos; Files and docs |
| Trip attachments | `travel` | Boarding passes and booking documents attached to a trip | local | – | Encrypted local file in the app document directory only. **Never uploaded** — trips are absent from `AttachmentOwnerType`, so these files do not survive a reinstall and never reach the `attachments` table — §6-D15 | document | Not collected (device-local) | Not collected (device-local) |
| Job applications and skills | `career` | Job-search tracking | local+cloud | Supabase | `job_applications`, `skills`; cascade | personal | User Content › Other User Content | App activity › Other user-generated content |
| CV content (contact details, education, experience, languages) | `career` | Generate a CV document | local+cloud | Supabase | `cv_personal_info`, `cv_education`, `cv_experience`, `cv_languages`, `cv_versions`; cascade | personal | Contact Info › Name, Email Address, Phone Number, Physical Address | Personal info › Name, Email address, Phone number, Address |
| Generated CV PDF | `career` | Share or print a CV | device-os | – | Rendered by `expo-print` and handed to the OS share sheet; not retained by the app | document | Not collected (user-initiated share) | Not collected (user-initiated share) |
| Menstrual cycle dates | `cycle` | Cycle overview and predictions | local+cloud | Supabase | `cycles`; cascade; local Zustand payload encrypted in AsyncStorage with key material in SecureStore; cleared on logout | health | Health & Fitness › Health | Health and fitness › Health info |
| Symptom logs and free-text notes | `cycle` | Symptom history and patterns | local+cloud | Supabase | `symptom_logs`; cascade; local Zustand payload encrypted in AsyncStorage with key material in SecureStore; cleared on logout | health | Health & Fitness › Health | Health and fitness › Health info |
| Cycle settings and reminder preference | `cycle` | Prediction parameters and reminder timing | local+cloud | Supabase | `cycle_settings`; cascade; local Zustand payload encrypted in AsyncStorage with key material in SecureStore; cleared on logout | health | Health & Fitness › Health | Health and fitness › Health info |
| Reviewed health content | `cycle` | Reference articles about conditions and symptoms | local+cloud | Supabase | `health_conditions`, `symptom_glossary` — editorial content, shared read-only, not user data; cached inside the encrypted `lifesort-cycle` payload and cleared on logout with that store | ordinary | Not collected | Not collected |
| Shared price and offer catalogue | `food` | Grocery price estimates | cloud | Supabase | `global_standard_prices`, `global_offers` — shared read-only content, not user data | ordinary | Not collected | Not collected |
| Module kill-switch flags | `core-shell` | Let an operator close a broken module without a store release | cloud | Supabase | `module_flags` — operator configuration, not user data; the last answer is cached on device so a closed module stays closed offline | ordinary | Not collected | Not collected |
| Module choice | `core-shell` | Which areas the user wants LifeSort to help with | local+cloud | Supabase | `user_modules`; cascade on account deletion; local copy cleared on logout. Turning a module off never deletes that module's data | ordinary | Not collected | App activity › Other actions |
| Home layout and card privacy | `core-shell` | Which cards are pinned, hidden or masked, and when each module was last opened | local | – | `lifesort-home-layout` in AsyncStorage; never leaves the device and is not synced | ordinary | Not collected (device-local) | Not collected (device-local) |
| Monthly review preference | `core-shell` | Whether the review is offered on Home | local | – | `lifesort-monthly-review` in AsyncStorage; a single boolean, never synced. The review itself derives from existing records and stores nothing new | ordinary | Not collected (device-local) | Not collected (device-local) |
| Local notification schedule | shared | Reminders for cycle, income, trips and warranties | local | – | Held by the OS notification scheduler; cancelled per entity. **Not cancelled on logout — §6-D5** | personal | Not collected (no push token) | Not collected (no push token) |
| Calendar event created from a to-do | `tasks` | Put a to-do in the user's own calendar | device-os | – | Write-only; title and description are handed to the OS calendar and owned by it afterwards | personal | Not collected (write-only, user-confirmed) | Not collected (write-only, user-confirmed) |
| Local backup archive | `core-shell` | User-initiated export and restore | device-os | – | JSON written by `utils/shared/dataBackup.ts` and handed to the share sheet; the user owns the file. Excludes cycle data — §6-D7 | financial | Not collected (user-initiated export) | Not collected (user-initiated export) |
| Sync failure log | `core-shell` | Show the user what has not reached the cloud yet | local | – | `sync-status` in AsyncStorage: module name, operation, error message, timestamp. No record content | ordinary | Not collected | Not collected |

<!-- inventory:data:end -->

## §2 Sensitivity legend

Shared with [`docs/app-inventory.md`](./app-inventory.md) §7 and with
`DataSensitivity` in the master specification (§4.1): `ordinary`, `personal`,
`financial`, `health`, `document`. A row may carry more than one value.

## §3 SDK inventory

Every package in `dependencies` — that is, everything that ships in the app
bundle. `devDependencies` are excluded because they do not reach a user's
device.

"Data touched" is what the SDK can see at runtime, not what it transmits.
Only `@supabase/supabase-js` transmits anything off the device. NetInfo would be
the exception if left at its defaults — it polls a Google endpoint to test
reachability — so `core/sync/connectivity.ts` disables that probe and reads only
the link state the OS pushes (ADR-0032).

<!-- inventory:sdk:start -->

| Package | Version | Vendor | Purpose | Data touched | Transmits off device | Store disclosure impact |
| --- | --- | --- | --- | --- | --- | --- |
| `@supabase/supabase-js` | ^2.112.4 | Supabase | Auth, Postgres and Storage client — the only network client in the app | All synced data in §1, credentials, uploaded files | Yes — to the configured Supabase project | Drives every "collected" answer on both stores |
| `@react-native-async-storage/async-storage` | 2.2.0 | React Native Community | Local persistence for every Zustand store; the cycle store writes only an encrypted envelope | All `local` and `local+cloud` data in §1; cycle health is ciphertext, other stores remain plaintext | No | Apple required-reason API `UserDefaults` (CA92.1), already declared |
| `expo-secure-store` | ~57.0.3 | Expo | Keychain/keystore for the auth session, PIN hash, lockout counter and cycle-health encryption key | Session token, PIN hash, AES key material | No | None — device-local credential/key storage |
| `expo-crypto` | ~57.0.2 | Expo | CSPRNG salt for PIN derivation, AES-GCM encryption for cycle/document persistence, and UUID v4 client entity IDs | PIN salt; sensitive plaintext in memory during encryption/decryption; new opaque entity IDs | No | None |
| `@noble/hashes` | ^2.4.0 | Paul Miller (open source) | PBKDF2-SHA256 for the app-lock PIN | PIN, in memory only | No | None |
| `expo-local-authentication` | ~57.0.2 | Expo | Biometric unlock of the app lock | Biometric result only; no biometric data is readable by the app | No | Face ID usage string required on iOS — see §6-D8 |
| `expo-image-picker` | ~57.0.16 | Expo | Attach a photo to an expense, warranty or trip | Selected photos | No (upload happens via Supabase) | Photo library and camera permissions; Apple Photos/Videos, Play Photos |
| `expo-document-picker` | ~57.0.1 | Expo | Attach a file, and select a backup file to restore | Selected files | No | Play Files and docs |
| `expo-file-system` | ~57.0.6 | Expo | Copy attachments into the app document directory; write backup archives | Attachment files, backup JSON | No | Apple required-reason API `FileTimestamp` (C617.1), already declared |
| `expo-image-manipulator` | ~57.0.16 | Expo | Downscale and compress attachment images before upload | Attachment images | No | None beyond the photo permission |
| `expo-sharing` | ~57.0.18 | Expo | Hand a backup or attachment to the OS share sheet | The shared file | No — the user chooses the destination | None |
| `expo-print` | ~57.0.1 | Expo | Render the CV to PDF | CV content | No | None |
| `expo-calendar` | ~57.0.2 | Expo | Add a to-do to the user's calendar, write-only | To-do title and description | No | Calendar write permission; Play Calendar |
| `expo-notifications` | ~57.0.17 | Expo | Schedule local reminders. No push token is requested | Reminder title and body | No | Notification permission; no push identifier collected |
| `expo-image` | ~57.0.4 | Expo | Image rendering and caching | Attachment images | No | None |
| `expo-font` | ~57.0.3 | Expo | Font loading | None | No | None |
| `expo-splash-screen` | ~57.0.8 | Expo | Splash screen during hydration | None | No | None |
| `expo-router` | ~57.0.19 | Expo | File-based navigation | Route parameters, including entity ids | No | None |
| `expo-constants` | ~57.0.17 | Expo | Read the app version for the About screen | App manifest | No | None |
| `expo-symbols` | ~57.0.2 | Expo | SF Symbols / icon rendering | None | No | None |
| `expo` | ~57.0.20 | Expo | Core runtime | Host for the modules above | No | Ships the base privacy manifest |
| `expo-status-bar` | ~57.0.1 | Expo | Status bar styling | None | No | None |
| `expo-linking` | ~57.0.9 | Expo | Deep-link URL handling, and the password-reset link back into the app (APP-019) | Deep-link URLs, including recovery tokens | No | None |
| `expo-device` | ~57.0.1 | Expo | Declared but not imported by app code — see §6-D9 | None today | No | Apple required-reason API `SystemBootTime` (35F9.1), already declared |
| `expo-web-browser` | ~57.0.2 | Expo | Declared but not imported by app code — see §6-D9 | None today | No | None today |
| `expo-widgets` | ~57.0.17 | Expo | Home-screen widget support; configured as a plugin but no widget is implemented — see §6-D9 | None today | No | Widgets would expose data outside the app lock; review before use |
| `react-native-android-widget` | ^0.22.1 | Simon Bruce (open source) | Android widget rendering; not imported — see §6-D9 | None today | No | Same as above |
| `@expo/ui` | ~57.0.16 | Expo | Native UI primitives; not imported — see §6-D9 | None today | No | None |
| `expo-dev-client` | ~57.0.18 | Expo | Development build client | Development only | No | Must not be present in a production build — see §6-D10 |
| `react` | 19.2.3 | Meta | UI runtime | None | No | None |
| `react-dom` | 19.2.3 | Meta | Web renderer, for the Expo web target | None | No | None |
| `react-native` | 0.86.3 | Meta | Mobile runtime | Host for everything | No | None |
| `react-native-web` | ~0.21.0 | Necolas (open source) | Web target | None | No | Web build is not part of the mobile store release |
| `react-native-screens` | ~4.26.0 | Software Mansion | Native screen containers | None | No | None |
| `react-native-safe-area-context` | ~5.7.0 | Software Mansion | Safe-area insets | None | No | None |
| `react-native-gesture-handler` | ~2.32.0 | Software Mansion | Swipe gestures on list rows | Touch input | No | None |
| `react-native-reanimated` | 4.5.1 | Software Mansion | Animations | None | No | None |
| `react-native-worklets` | 0.10.1 | Software Mansion | Worklet runtime for Reanimated | None | No | None |
| `react-native-svg` | 15.15.4 | Software Mansion | Charts and progress rings | Values rendered in charts | No | None |
| `@react-native-community/netinfo` | 12.0.1 | React Native Community | Reports the OS network link state so the sync coordinator only sends while the device is actually connected (APP-037) | Connection state and type; the library can also read the Wi-Fi SSID, which LifeSort never requests | No — the library's own reachability probe is disabled, so it contacts nothing | Android `ACCESS_NETWORK_STATE` is added by the library's manifest; no data category is collected |
| `@react-native-picker/picker` | 2.11.4 | React Native Community | Date picker wheels | Selected dates | No | None |
| `react-native-url-polyfill` | ^4.0.0 | Charpeni (open source) | URL polyfill required by the Supabase client | None | No | None |
| `zustand` | ^5.0.14 | Poimandres (open source) | Client state management | All in-memory state | No | None |
| `i18next` | ^26.3.6 | i18next (open source) | Translation runtime | Interpolated values in strings | No | None |
| `react-i18next` | ^17.0.11 | i18next (open source) | React bindings for i18next | Interpolated values in strings | No | None |

<!-- inventory:sdk:end -->

## §4 Device permissions

| Permission | Requested by | When | Declared in | Necessary today |
| --- | --- | --- | --- | --- |
| Photo library | `expo-image-picker` | When the user attaches a photo | `NSPhotoLibraryUsageDescription` (generated) | Yes |
| Camera | `expo-image-picker` | When the user takes a photo for an attachment | `NSCameraUsageDescription` (generated) | Yes |
| Files | `expo-document-picker` | When the user attaches a document or restores a backup | OS document picker, no static declaration | Yes |
| Calendar (write-only) | `expo-calendar` | When the user chooses to add a to-do to the calendar | `app.json` plugin, Danish purpose string | Yes |
| Notifications | `expo-notifications` | On first use of a reminder feature | Runtime request | Yes |
| Biometrics | `expo-local-authentication` | When unlocking the app lock | Face ID usage string — see §6-D8 | Yes |
| Network state (Android) | `@react-native-community/netinfo` | Continuously while signed in, to know whether sync may run | `ACCESS_NETWORK_STATE` in the library's manifest; normal permission, no prompt | Yes |
| Microphone | – | Never | `NSMicrophoneUsageDescription` (generated) | **No — see §6-D8** |

Permissions are requested at the point of use rather than at startup, which
already matches APP-104.

## §5 Retention as implemented today

| Event | What happens | Code |
| --- | --- | --- |
| Sign out | Local domain stores are reset, the signed-URL cache is cleared and the PIN is deleted. Language, theme mode and seed recipes deliberately survive. Locally cached attachment files and pending notifications do **not** — §6-D4, §6-D5 | `core/auth/clearLocalUserData.ts` |
| Sign in as a different user | The same clean-up runs **before** the login call, so the previous user's data cannot bleed into the new session | `store/useAuthStore.ts` |
| Account deletion | Storage objects are removed first (while the session may still touch them), then `delete_my_account` removes the account and every table cascades from `auth.users`; a daily server sweep removes orphaned files. Each stage is reported to the user, and what is retained is disclosed on the screen — see [`docs/account-deletion.md`](./account-deletion.md) | `core/auth/deleteAccount.ts` |
| Signed download URL | Expires after 1 hour and is cached in memory only | `utils/shared/attachmentSync.ts` |

The server-side pieces — the `delete_my_account` function, the cascades and the
daily sweep — live in the Supabase project and are **not version-controlled in
this repo** (see `docs/app-inventory.md` §8-F10 / APP-141), so this table
documents intent verified from the client side only.

## §6 Findings — mismatches between code, disclosures and the master specification

Recorded as facts. **None are fixed by APP-002**; each belongs to a later story.

| # | Finding | Evidence | Owning story |
| --- | --- | --- | --- |
| D1 | ~~Age is collected at sign-up but no feature reads it.~~ **Closed by APP-017.** Age is no longer asked for anywhere, and `onboarded_at` replaced the accidental use of it as proof of onboarding. Values written before the change remain in `profiles.age`; purging them is a deliberate deletion, not a refactor. | APP-017 (client), APP-099 (purge) |
| D2 | Gender no longer gates any module, but still drives colour. | APP-017 took it out of sign-up; APP-020 removed the cycle gate and the to-do phase hint, migrating the old inference into an explicit module choice. What remains is four tint hooks choosing a palette from `gender === 'male'`. That is not module inference, but it is a thin purpose for collecting the field at all — worth revisiting. | APP-119 (design system) |
| D3 | ~~Health data is persisted unencrypted.~~ **Closed by APP-028.** | `store/useCycleStore.ts` persists through `core/storage/cycleHealthEncryptedStorage.ts`, which writes a versioned AES-GCM envelope to AsyncStorage under `lifesort-cycle` and stores the key under `lifesort-cycle-health-key` in SecureStore. | APP-028 |
| D4 | ~~Attachment files survive logout on disk.~~ **Closed by APP-021.** `clearAttachmentCache()` deletes the persistent attachment directory and APP-029's temporary decrypted cache on sign-out and before a different account signs in. ~~Encrypting the cache while it exists is still open.~~ **Closed by APP-029.** Persistent attachment cache files are encrypted `*.lsenc` files and attachment metadata stores use an encrypted AsyncStorage envelope. | APP-021, APP-029 |
| D5 | ~~Scheduled notifications are not cancelled on logout.~~ **Closed by APP-021.** Sign-out cancels every scheduled notification. What each reminder is allowed to say on a lock screen is still APP-073. | APP-073 |
| D6 | No vendor documentation for the only processor. | Supabase holds all synced user data including special-category health data. The repo records no DPA, data region, retention terms or subprocessor list. | APP-100, APP-101 |
| D7 | Local backup silently omits health data. | `utils/shared/dataBackup.ts` `STORE_REGISTRY` covers 15 stores but not `useCycleStore`. A user who exports a backup and reinstalls loses their cycle history without warning. Also carried as `docs/app-inventory.md` §8-F8. | APP-097 |
| D8 | Generated iOS permission strings are wrong for this app. | `ios/LifeSort/Info.plist` carries `NSMicrophoneUsageDescription` although no feature uses the microphone, and the camera and photo strings are English placeholders ("Allow LifeSort to access your camera") in a Danish-first app that never states a purpose. No Face ID usage string is present despite `expo-local-authentication`. | APP-104, APP-158 |
| D9 | Five dependencies ship without being used. | `expo-device`, `expo-web-browser`, `expo-widgets`, `react-native-android-widget` and `@expo/ui` have no import in `app/`, `store/`, `utils/`, `components/`, `hooks/`, `core/` or `lib/`. `expo-device` alone adds a required-reason API declaration to the privacy manifest for a capability the app does not use. (`expo-linking` left this list in APP-019.) | APP-115, APP-159 |
| D10 | `expo-dev-client` is a runtime dependency. | It is listed under `dependencies` rather than `devDependencies`. Verify it is excluded from production builds before submission. | APP-158 |
| D11 | The shipped privacy manifest declares no collected data. | `ios/LifeSort/PrivacyInfo.xcprivacy` has an empty `NSPrivacyCollectedDataTypes` while §1 lists email, name, age, gender, financial data, health data and photos. As it stands the manifest contradicts the app. | APP-159 |
| D12 | A third party's email address is stored. | `trip_participants` holds `invited_email` for someone who may not be a LifeSort user. Nothing today expires or removes a pending invitation. | APP-099, APP-136 |
| D13 | Bundle identifier is still the scaffold default. | `app.json` sets `com.anonymous.LifeSort`. It must be production-final before the first submission, and before any verified deep link. | APP-158 |
| D14 | Resolved: new opaque client entity IDs use `core/ids.newEntityId()` over Expo Crypto UUID v4. | APP-030 replaced weak entity generators, including attachment entities and recurrence instances. Legacy IDs and semantic keys remain unchanged; APP-029 cache filenames retain their separate CSPRNG contract. See `docs/app-030-id-audit.md`. | APP-030 |
| D15 | Trip attachments are local-only, unlike every other attachment. | `AttachmentOwnerType` in `utils/shared/attachmentSync.ts` is `'warranty' \| 'expense'`; `TripAttachmentGrid` calls `persistFile` and stops. A boarding pass attached to a trip does not survive a reinstall or a new device, and never appears in the `attachments` table. Found while writing `docs/shared-primitives.md`; the earlier version of this row wrongly implied trip files were uploaded. | APP-058 |
| D16 | The public deletion page is written but not deployed. | Google Play requires a web deletion route; `web/account-deletion/index.html` implements it and `core/config/publicUrls.ts` holds the URL, but the page must be published at that address and the domain confirmed before submission. Until then the Play Console field cannot be filled truthfully. | APP-023 (deploy), APP-163 |

## §7 What this inventory does not answer

- Whether Supabase's terms permit the health processing in §1 — needs the DPA
  review in APP-100 and the DPIA screening in APP-101.
- How long backups and logs retain deleted rows on the server — needs APP-099.
- Whether the App Store and Play forms are actually filled in to match §1 —
  needs APP-159, APP-160 and APP-161. This document only supplies the mapping.
