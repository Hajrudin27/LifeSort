# APP-030: ID generation inventory and verification

Initial APP-030 baseline inspected before edits: `main`, `0746c50`
(`feat: encrypt sensitive document cache`), clean working tree. During human
review, the unrelated APP-029 viewer-handoff cleanup was isolated, committed and
pushed separately as `88b9b7e`; APP-030 itself remains uncommitted at this stage.

## Specification and interpretation

Master Production Specification v1.0, page 21, E3, APP-030 (P0), **Crypto UUIDs**:

- User story: “Som platform vil jeg have collision-resistant identifiers.”
- Acceptance: “crypto.randomUUID/CSPRNG; no Math.random entity IDs in new code.”

New opaque locally created persistent entity IDs use cryptographic UUID v4,
including embedded records and recurring instances. The specification does not
require existing IDs to be migrated or semantic identifiers to be randomized.
The user request explicitly requires preserving those contracts and excludes
APP-031 and later stories.

## Inventory method

Completed before implementation, then repeated after the changes. Searched the
repository globally, including hidden source files, and reviewed ID assignments
and creation actions in `store`, `components`, `app`, `utils/shared`, other utils,
`features`, `hooks`, `core`, `types`, `data`, tests, docs and SQL migrations.
Build outputs, `.git` and dependency trees were excluded from the application
inventory; the installed Expo Crypto implementation was inspected separately.

Search families included `Date.now()`, `Date.now().toString()`, template timestamp
strings, `new Date().getTime()`, all `getTime()` calls, `Math.random()` (including
floor/round and timestamp combinations), randomUUID/crypto.randomUUID,
expo-crypto, UUID libraries, nanoid, newId/generateId/createId, contribution
helpers, every `id:` assignment, reference assignments, counters, SQL defaults,
client Supabase insert/upsert mappers, ID parsing, path validation and reminders.
No direct UUID/nanoid dependency or additional weak runtime generator was found.

## Persistent entity creation sites (category A, changed)

All listed creation actions now call `core/ids.newEntityId()`.

| File | Entities / creation actions | Previous mechanism | Sites |
| --- | --- | --- | --- |
| `store/useCVStore.ts` | education, experience, languages, CV versions | local newId: timestamp + rounded Math.random | 4 |
| `store/useCareerStore.ts` | job applications, skills | same local newId | 2 |
| `store/useCycleStore.ts` | cycles, new symptom logs | same local newId | 2 |
| `store/useFoodStore.ts` | standard prices, grocery purchases, pantry items, shopping items, manual offers, recipes | same local newId | 6 |
| `store/useHabitsStore.ts` | habits, embedded logs | same local newId | 2 |
| `store/useHouseholdStore.ts` | custom tasks, shopping items, moving items | same local newId | 3 |
| `store/useLifeGoalsStore.ts` | goals, embedded subgoals | same local newId | 2 |
| `store/useTodoStore.ts` | todos | same local newId | 1 |
| `store/useTripsStore.ts` | trips, default/copied packing items, trip expenses, custom packing items | same local newId | 4 |
| `store/useSavingsGoalsStore.ts` | savings goals; add/distribute contributions and both transfer legs | timestamp-only goal; timestamp + weak random makeContributionId | 5 |
| `store/useExpensesStore.ts` | new expense, monthly recurring instance | timestamp-only; derived seriesId-monthKey | 2 |
| `store/useWarrantiesStore.ts` | warranties | timestamp-only | 1 |
| `components/AttachmentList.tsx` | camera, library, document attachment entities | timestamp-only | 3 |
| `components/TripAttachmentGrid.tsx` | image (camera/library), document attachment entities | timestamp-only | 2 |

Total: **39 call sites in 12 stores and 2 components**. Removed nine local
`newId` implementations and one `makeContributionId` implementation. There were
eight timestamp-only sites and one derived recurring-instance site.

## Relationship/reference IDs (category B)

- New expense root: mint once, reuse for `seriesId`. Concrete later instances
  mint a fresh entity UUID and copy the series reference. If a legacy root lacks
  `seriesId`, its existing `id` supplies the reference. Existing instances and
  `seriesStoppedAt` keys are preserved.
- Recurrence still checks series + payment month before generating a new ID;
  repeated calls do not duplicate a locally existing month. Editing future
  instances, stopping a series, and clearing inherited attachments stay intact.
- Trip `tripId` references in packing items/expenses and participant rows copy the
  parent ID. Copied packing items get distinct entity IDs, all referencing the
  new trip. Reminder identifiers derive from the exact parent ID.
- Savings contribution `goalId`, CV education/experience/language/skill selections,
  nested subgoals/logs, recipe selections, navigation IDs and attachment owner
  references retain the same values passed by the caller.
- Attachment entities now use UUIDs; stores and upload metadata preserve those
  same IDs. Existing attachment entities and Storage paths are never rewritten.

## Explicit exclusions (categories C, D and E)

| Mechanism / location | Category | Why unchanged |
| --- | --- | --- |
| `core/storage/documentCacheStorage.ts`: randomUUID for encrypted and decrypted filenames | C, internal cache | APP-029 contract already cryptographic; filenames are independent of entity IDs |
| `utils/shared/attachmentViewerSource.ts`: randomUUID for in-memory source token | C, ephemeral | Viewer lookup token, not persisted entity identity |
| React keys, search results, chart IDs, participant composite lookup keys, route params | C / references | Derived from authoritative data; must stay stable across renders |
| `useCategoriesStore`, `useSkillCategoriesStore`: trimmed category names, case-insensitive dedup | E, semantic | ID is also the user-visible label; no separate name field. UUID replacement would lose meaning and require a data-model change |
| Built-in categories, skill categories, module IDs, domain registry IDs, flags, routes, SVG IDs, enums, i18n keys, storage keys | E, fixed | Semantic contracts, not opaque user entity IDs |
| `data/seedRecipes.da.ts`, `.en.ts`: seed-1 through seed-35 | E, fixed | Shared seed identity supports language reseeding and existing references |
| `useHouseholdStore`: default-${key} moving checklist entries | E, fixed seed | Five named defaults intentionally share seed identity; custom items use UUIDs |
| Income/month budgets, food week plans, day/meal slots, selected stores, user settings | E / D | Natural/composite semantic keys plus authoritative user identity |
| Trip/warranty reminder names from parent IDs; fixed cycle/income reminder names | B / E | Stable notification replacement/cancellation contract |
| Supabase auth IDs; profile/settings identity; participant owner/user IDs | D, server-owned | Auth user identity, not generated by mobile |
| Fetched row IDs, global prices/offers/recipes, health reference content | D, server-owned | APP-027 data-profile boundaries; preserve server/seed identity |
| PostgreSQL gen_random_uuid defaults: catalogues, products, support tickets, waitlist IDs/tokens, timeline events, activity logs | D, server-owned | No mobile generator to replace |
| Test fixtures, mock UUIDs, SQL seed identities, historical ADR examples | Test / historical | Intentionally fixed data or documentation, not production generation |

## Runtime design and failure behavior

`newEntityId(): string` delegates to installed `expo-crypto` ~57.0.2
`randomUUID()`. SDK 57 documentation describes cryptographic UUID v4 generation:
[Expo Crypto versioned reference](https://docs.expo.dev/versions/v57.0.0/sdk/crypto/#cryptorandomuuid).
SDK 57 / React Native 0.86 compatibility was checked against
[the versioned SDK reference](https://docs.expo.dev/versions/v57.0.0/).

Installed source inspected: `src/Crypto.ts`, `src/ExpoCrypto.web.ts`,
`ios/CryptoModule.swift`, Android `CryptoModule.kt`. The UUID call delegates to
Foundation UUID, Java UUID.randomUUID, or Web Crypto randomUUID. It has no weak
fallback. Missing module/method or runtime errors propagate; the web UUID wrapper
has no special error normalization and can throw a JavaScript availability error.
Expo's getRandomBytes development fallback is not used by this helper.

No runtime fallback, new dependency, lockfile change or UUID-only entity validation
was added. The Jest Expo mock uses Node's cryptographic UUID API only in tests.

## Schema and Storage compatibility

Checked the checked-in remote schema and all subsequent migrations, client row
mappers, reference types, trip-sharing functions/policies and attachment validation.
No live database schema was queried or modified.

All affected top-level `id` columns are **text**:
`cv_education`, `cv_experience`, `cv_languages`, `cv_versions`, `job_applications`,
`skills`, `cycles`, `symptom_logs`, `food_standard_prices`, `food_purchases`,
`food_pantry_items`, `food_shopping_items`, `food_offers`, `food_recipes`, `habits`,
`household_tasks`, `household_shopping_items`, `household_moving_items`, `life_goals`,
`todos`, `trips`, `trip_expenses`, `trip_packing_items`, `savings_goals`,
`savings_history`, `expenses`, `warranties`, and `attachments`.

Reference columns are **text**: `expenses.series_id`, `savings_history.goal_id`,
`trip_expenses.trip_id`, `trip_packing_items.trip_id`, `trip_participants.trip_id`,
`attachments.owner_id`. Embedded habit logs/subgoals and CV reference arrays are
**jsonb**; entity/reference TypeScript types remain strings. Auth `user_id` and
participant `owner_id` are server UUIDs, unchanged. Trip sharing accepts text
trip IDs; the historical migration removed UUID assumptions to support legacy IDs.
No numeric/timestamp-format schema constraint requires a change.

Attachment paths remain `<userId>/<ownerType>/<ownerId>/<attachmentId>.<ext>`.
UUID hyphens/hex characters satisfy existing `SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/`.
No validator, extension rule, traversal protection or Storage policy was changed.
Trips still have the pre-existing local-only attachment sync limitation; adding
trip remote attachment support is not part of APP-030.

## Legacy compatibility

Hydration, fetching, updates, deletes, backup validation and navigation continue to
accept opaque string IDs. Tests exercise actual Zustand hydration through the
mock storage adapter with timestamp-shaped IDs and both explicit/missing series
references; attachments can mix legacy and new UUIDs. Real encryption remains
covered independently by APP-028/029 regression tests. No old ID is rewritten.

## Remaining clock/random audit

After replacement, there are **zero Math.random calls in application source** and
no timestamp-only or timestamp/random persistent entity generators.
Remaining runtime `Date.now()` sites (14 calls) are all legitimate time values:

| File / lines | Calls | Classification |
| --- | --- | --- |
| `utils/warranty/warrantyReminder.ts:33` | 1 | Skip reminders whose date has passed |
| `utils/trip/tripReminder.ts:21` | 1 | Same reminder date guard |
| `utils/cycle/cycleReminder.ts:11` | 1 | Same reminder date guard |
| `utils/shared/attachmentSync.ts:158,168` | 2 | Signed URL expiry/refresh timing |
| `components/VerifyEmailBanner.tsx:37,58` | 2 | Resend cooldown display |
| `components/LockScreen.tsx:127,130` | 2 | Lockout countdown timing |
| `utils/auth/pinLockout.ts:87,105` | 2 | Failed-attempt/lockout timing |
| `core/auth/emailVerification.ts:50` | 1 | Resend throttle timestamp |
| `core/auth/reauth.ts:50,62` | 2 | Recent-auth timestamp and age |

Other matches are explicit test spies/fixtures and forbidden-pattern assertions,
historical SQL migration commentary, and documentation describing former generators.
`getTime()` elsewhere is date math/sorting/reminder scheduling. `createdAt`, dates,
and due/payment times continue using Date APIs. No ID work is deferred because it
uses a weak generator; APP-033 timestamp/revision architecture remains separate.

## Documentation and verification

ADR-0025 records scope, exclusions, generator, failure semantics, legacy compatibility,
relationship integrity and deferred work; registered after ADR-0024. Updated
`shared-primitives.md`, `core-contract.md`, and stale D14/Expo Crypto entries in
`data-sdk-inventory.md`. Reviewed `app-inventory.md`; no ID contract was stale there.
APP-027 registry files are unchanged because no persistence surface/profile changed.

Added `entityIds.test.ts` and `entityCreationIds.test.ts`; extended attachment
picker and sync tests. Empty weak-generator allowlists now scan core/features/hooks
as well as existing source directories. The APP-028 suite's local Expo Crypto mock
now includes UUID generation. No deterministic behavior was added to runtime code.

Human-review follow-up: both TripAttachmentGrid creation paths mint the entity UUID
before calling persistFile, so UUID failure cannot orphan an encrypted cache file.
Camera, library and document regression cases failed against the previous ordering
and pass after the fix; they assert that neither persistFile nor onAdd is called
on UUID failure. Successful creation still persists and returns the file URI.
Encryption, persistFile itself and the no-fallback policy are unchanged.

| Verification | Result |
| --- | --- |
| `npm test -- --runInBand` | PASS: 41 suites, 531 tests |
| Focused entity helper/creation and attachment picker/sync suites | PASS: 4 suites, 33 tests |
| `npx tsc --noEmit` | PASS |
| `node scripts/check-adr.js` | PASS; the command compares committed main...HEAD |
| Same ADR `needsAdr` policy on actual working-tree diff plus untracked files | PASS: 12 governed stores, ADR present |
| `npx expo export --platform ios` | PASS: one Hermes iOS bundle exported to ignored `dist/` |
| `git diff --check` | PASS |
| Final repository-wide weak ID audit | PASS: no remaining weak opaque entity generators |

APP-028 encrypted cycle storage, APP-029 document cache/temporary lifecycle,
attachment sync, parent attachment cleanup, hydration, inventory and architecture
gates all passed. The export emits Node FORCE_COLOR/NO_COLOR warnings; bundling
completes successfully. No new dependency was installed.

Changed files (27 total):

- Runtime: `core/ids.ts`; the 12 stores and 2 components in the creation-site table.
- Tests: `__tests__/entityIds.test.ts`, `__tests__/entityCreationIds.test.ts`,
  `__tests__/attachmentSync.test.ts`, `__tests__/attachmentTempLifecycle.test.tsx`,
  `__tests__/cycleHealthEncryptedStorage.test.ts`, `__tests__/sharedPrimitives.test.ts`.
- Docs: this audit, `docs/adr/0025-new-client-entity-ids-are-cryptographic-uuids.md`,
  `docs/adr/README.md`, `docs/shared-primitives.md`, `docs/core-contract.md`,
  `docs/data-sdk-inventory.md`.

The only remaining timestamp/random search matches outside the runtime timing
sites are `__tests__/reauth.test.ts` (time tests), `__tests__/sharedPrimitives.test.ts`
(forbidden-pattern strings), test spies in the new ID/picker suites, this audit and
ADR-0025 (policy/history), and the comment at
`supabase/migrations/20260906090000_fix_trip_sharing_rls.sql:196` (historical schema
rationale, intentionally not rewritten). Crypto UUID mocks remain test-only in
`jest.setup.js` and `cycleHealthEncryptedStorage.test.ts`.

## Deferred work and review limits

APP-031 outbox, APP-032 server idempotency, APP-033 revisions/updated_at, APP-034
tombstones, APP-035 conflicts, APP-036 sync UX, APP-037 connectivity/backoff and
APP-038 migration harness are all untouched. No Supabase relink, database migration,
production/staging writes, Vercel deployment, commit or push was performed.

UUID uniqueness does not enforce series/month business uniqueness across two
independent offline devices. The local month check remains intact; server
reconciliation is deferred. Native randomness is established by the supported API
contract and inspected implementation; Jest uses a Node crypto substitute, and an
iOS export is not a physical-device runtime test. Live schema drift beyond the
repository migrations has not been checked. No blocking ambiguity was found.
