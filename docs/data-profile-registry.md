# LifeSort - Data Profile Registry

**Story:** APP-027 (E3 - Storage & sync platform, P0)
**Status:** Declarative registry, updated through APP-031 for encrypted health/document storage and the ordinary durable outbox. Remote sync behavior and generic migrations remain deferred.
**Owner of this document:** Hajrudin Kardasevic
**Code source:** [`core/storage/dataProfileRegistry.ts`](../core/storage/dataProfileRegistry.ts)
**Verified by:** [`__tests__/dataProfileRegistry.test.ts`](../__tests__/dataProfileRegistry.test.ts)

## Purpose

The registry assigns one explicit A/B/C/D profile to each logical data domain so
storage, sync, privacy and future migration code can ask the same questions in
one place. A profile is a contract, not a descriptive label: it says whether
plaintext local persistence is allowed, whether encrypted local persistence is
required, who is authoritative, whether normal clients may write, and whether a
domain is global reference data.

APP-027 originally did not split stores, encrypt existing values or change
network behavior. APP-028 deliberately changed one recorded fact: the current
cycle store remains one physical `lifesort-cycle` key, but the value is now an
AES-GCM encrypted envelope whose key material lives in SecureStore. APP-029
adds the same at-rest protection to local document-cache bytes and to the
mixed expense/trip/warranty Zustand stores that carry attachment metadata.

APP-031 outbox entries keep `dataDomain: DataDomainId` separate from
`entityType: string`. The data domain determines sensitivity/storage policy;
the entity type is a stable, non-empty LifeSort-owned kind retained as the
durable mutation identity/routing key, never as authorization. For example,
`home.household` can classify both `household.task` and `household.shopping-item`.
The plaintext outbox validates dataDomain against the existing syncable Profile A
rule and rejects any domain with a Profile B surface. Sensitive integration remains
deferred. Entity types are stored without inferring kinds from payloads or adding
a dispatcher, server mapping or worker.

## Profiles

APP-035 adds a separate [conflict-policy contract](./adr/0030-conflict-policies-are-explicit-and-fail-closed.md)
keyed by canonical domain IDs and reviewed entity kinds. It covers language/theme
preferences, savings contribution history only, todo fields and conservative
warranty attachment reconciliation. Data profiles do not imply conflict policies;
unreviewed domain/kind pairs fail closed. No physical surface, profile assignment
or production CRUD flow changes. Runtime execution remains deferred.

| Profile | Contract |
| --- | --- |
| A - Ordinary local-first | Plain local persistence is allowed. The client is authoritative for normal user-owned records. Server sync is expected where the domain is cross-device. |
| B - Sensitive local-first | Encrypted local persistence is required. Plaintext fallback is not acceptable. The client owns the records and syncs where applicable. |
| C - Server-authoritative | The server owns canonical truth. The client may hold no local copy or only a minimal cache. Normal clients are not authoritative writers. |
| D - Global read-only/reference | Shared reference content. It may be version-cacheable. Canonical writes belong to trusted admin/content pipelines, not ordinary clients. |

## Logical Domains

Counts are enforced in tests: **A = 24, B = 6, C = 2, D = 4, total = 36**.

| Domain | Profile | Module | Current physical surfaces | Notes |
| --- | --- | --- | --- | --- |
| `account.auth-identity` | C | account | `supabase-auth:auth.users` | Supabase Auth identity, password hash and verification state. |
| `account.auth-session` | C | account | `secure-store:supabase-session`, `async-storage:supabase-session-web-or-legacy` | SecureStore on native; AsyncStorage only for web fallback or migration source. |
| `account.profile` | A | account | `async-storage:lifesort-profile`, `supabase-table:profiles` | Display name, optional gender, partner name and profile fields. |
| `account.onboarding` | A | account | `async-storage:lifesort-profile`, `supabase-table:profiles` | `onboarded_at` and local fetched/completion state. |
| `account.password-recovery-throttle` | A | account | `async-storage:lifesort-verification-last-sent` | Device-local resend throttle. |
| `account.app-lock` | B | account | `async-storage:lifesort-app-lock`, `secure-store:lifesort-app-pin-hash`, `secure-store:lifesort-pin-lockout` | Local phone lock; no server authority. |
| `core.preferences` | A | core-shell | `async-storage:lifesort-settings`, `async-storage:lifesort-theme`, `supabase-table:settings` | Language and theme. |
| `core.module-choice` | A | core-shell | `async-storage:lifesort-enabled-modules`, `supabase-table:user_modules` | User-selected modules; feature state never deletes data. |
| `core.home-layout` | A | core-shell | `async-storage:lifesort-home-layout` | Pinned, hidden and masked cards. |
| `core.monthly-review-preference` | A | core-shell | `async-storage:lifesort-monthly-review` | Boolean preference only. |
| `core.sync-status` | A | core-shell | `async-storage:sync-status` | Ephemeral account-scoped projection; legacy success timestamp key remains registered for cleanup only, with no reads or writes (APP-036). |
| `core.outbox` | A | core-shell | `async-storage:lifesort-outbox` | Account-bound durable mutation queue. Only syncable Profile A domains without any Profile B surface are accepted; sensitive integration remains deferred. |
| `core.module-flags` | D | core-shell | `async-storage:lifesort-module-flags`, `supabase-table:module_flags` | Operator kill switches; cached so closed modules stay closed offline. |
| `core.local-backup-archive` | B | core-shell | `filesystem:document-directory/lifesort-backup-json` | Current backup excludes cycle data but may include attachment metadata. APP-097 owns export policy. |
| `economy.expenses` | A | economy | `async-storage:lifesort-expenses`, `supabase-table:expenses`, `supabase-table:expense_category_budgets` | User-created finances are Profile A per APP-027 guidance. |
| `economy.income` | A | economy | `async-storage:lifesort-income-v2`, `supabase-table:income` | User-created income entries. |
| `economy.savings` | A | economy | `async-storage:lifesort-savings-goals`, `supabase-table:savings_goals`, `supabase-table:savings_history`, `supabase-table:savings_extra` | User-created savings goals and contributions. |
| `economy.categories` | A | economy | `async-storage:lifesort-categories`, `supabase-table:categories` | Built-in plus user-created categories. |
| `economy.attachments` | B | economy | `async-storage:lifesort-expenses`, `supabase-table:attachments`, `supabase-storage-bucket:attachments`, `filesystem:document-directory/attachments`, `filesystem:cache-directory/lifesort-decrypted-attachments`, `secure-store:lifesort-document-cache-key` | Receipt files and metadata attached to expenses. Local bytes and metadata are encrypted; temporary decrypted copies are cache-only interoperability files. |
| `food.user-grocery-finance` | A | food | `async-storage:lifesort-food-v2`, `supabase-table:food_monthly_budget`, `supabase-table:food_purchases`, `supabase-table:food_offers`, `supabase-table:food_standard_prices` | User-created grocery budgets, purchases, offers and prices. |
| `food.user-planning` | A | food | `async-storage:lifesort-food-v2`, `supabase-table:food_pantry_items`, `supabase-table:food_shopping_items`, `supabase-table:food_recipes`, `supabase-table:food_saved_plans`, `supabase-table:food_selected_stores` | Pantry, shopping list, recipes, plans and chosen stores. |
| `food.seed-recipes` | D | food | `async-storage:lifesort-food-v2`, `bundled-source:data/seedRecipes` | Bundled app content. |
| `food.global-catalogue` | D | food | `async-storage:lifesort-food-v2`, `supabase-table:products`, `supabase-table:global_recipes`, `supabase-table:global_standard_prices`, `supabase-table:global_offers`, `supabase-storage-bucket:recipe-images` | Admin/reference catalogue data. |
| `home.household` | A | home | `async-storage:lifesort-household`, `supabase-table:household_tasks`, `supabase-table:household_shopping_items`, `supabase-table:household_moving_items` | Chores, household shopping and moving lists. |
| `goals.life-goals` | A | goals | `async-storage:lifesort-life-goals`, `supabase-table:life_goals` | Long-term goals and progress. |
| `habits.habits` | A | habits | `async-storage:lifesort-habits`, `supabase-table:habits` | Habits and logs. |
| `tasks.todos` | A | tasks | `async-storage:lifesort-todos`, `supabase-table:todos` | To-do list. |
| `travel.trips` | A | travel | `async-storage:lifesort-trips`, `supabase-table:trips`, `supabase-table:trip_expenses`, `supabase-table:trip_packing_items`, `supabase-table:trip_participants` | Trip records, budgets, packing and participants. |
| `travel.attachments` | B | travel | `async-storage:lifesort-trips`, `filesystem:document-directory/attachments`, `filesystem:cache-directory/lifesort-decrypted-attachments`, `secure-store:lifesort-document-cache-key` | Trip documents are local-only today. Local bytes and metadata are encrypted; temporary decrypted copies are cache-only interoperability files. |
| `warranties.records` | A | warranties | `async-storage:lifesort-warranties`, `supabase-table:warranties` | Warranty/insurance records excluding attached files. |
| `warranties.attachments` | B | warranties | `async-storage:lifesort-warranties`, `supabase-table:attachments`, `supabase-storage-bucket:attachments`, `filesystem:document-directory/attachments`, `filesystem:cache-directory/lifesort-decrypted-attachments`, `secure-store:lifesort-document-cache-key` | Receipt, warranty and insurance files plus metadata. Local bytes and metadata are encrypted; temporary decrypted copies are cache-only interoperability files. |
| `career.applications` | A | career | `async-storage:lifesort-career`, `supabase-table:job_applications` | Ambiguous: application notes may later need Profile B review. |
| `career.skills` | A | career | `async-storage:lifesort-career`, `async-storage:lifesort-skill-categories`, `supabase-table:skills` | Skills and skill-category labels. |
| `career.cv` | A | career | `async-storage:lifesort-cv`, `supabase-table:cv_personal_info`, `supabase-table:cv_education`, `supabase-table:cv_experience`, `supabase-table:cv_languages`, `supabase-table:cv_versions` | Ambiguous: document-like career data; review before APP-029. |
| `cycle.user-health` | B | cycle | `async-storage:lifesort-cycle`, `secure-store:lifesort-cycle-health-key`, `supabase-table:cycles`, `supabase-table:symptom_logs`, `supabase-table:cycle_settings` | Health/cycle data encrypted at rest by APP-028. |
| `cycle.reference-content` | D | cycle | `async-storage:lifesort-cycle`, `supabase-table:health_conditions`, `supabase-table:symptom_glossary` | Reviewed global health reference content. |

## Physical Surfaces

The code-level registry is the exhaustive machine-readable mobile list: **87
physical persistence surfaces**. Its tests prove
that it covers every current Zustand persist key, every direct AsyncStorage key
outside Zustand that belongs to this app, every client-referenced Supabase table,
the explicitly mobile-adjacent global catalogue tables, every known mobile
Supabase Storage bucket, and the filesystem/SecureStore surfaces that exist in
source.

The important physical distinction for APP-027 is that surfaces can contain
several logical domains:

| Surface | Profiles | Strongest local-storage protection | Why it matters |
| --- | --- | --- | --- |
| `async-storage:lifesort-expenses` | A, B | encrypted-required | Expense rows are Profile A, but receipt metadata/local URIs are Profile B. |
| `async-storage:lifesort-food-v2` | A, D | plaintext-allowed | User food data and cached/reference catalogue data share one store. |
| `async-storage:lifesort-trips` | A, B | encrypted-required | Trip rows are Profile A, but trip documents and expense attachments are Profile B. |
| `async-storage:lifesort-warranties` | A, B | encrypted-required | Warranty records are Profile A, but attached receipt/document metadata is Profile B. |
| `async-storage:lifesort-cycle` | B, D | encrypted-required | User cycle data and reviewed health reference content still share one store, so the whole persisted payload is encrypted. |

Document-cache physical surfaces added by APP-029:

| Surface | Profiles | Strongest local-storage protection | Why it matters |
| --- | --- | --- | --- |
| `filesystem:document-directory/attachments` | B | encrypted-required | Persistent cached attachment bytes are AES-GCM encrypted `*.lsenc` files. Legacy plaintext files referenced by attachment metadata are encrypted during metadata migration, then removed after the encrypted metadata write succeeds. |
| `filesystem:cache-directory/lifesort-decrypted-attachments` | B | encrypted-required | Temporary plaintext copies exist only for native image/share/upload interoperability and are deleted on explicit cleanup/logout. This is not the canonical persistent cache. |
| `secure-store:lifesort-document-cache-key` | B | encrypted-required | Device-local AES-256-GCM key material for document-cache files and attachment metadata; separate from the cycle-health key. |

Unknown physical surfaces fail closed in the API: plaintext local persistence is
not allowed, Profile B is assumed possible, and the strongest protection result
is `no-plaintext-cache` unless the surface is registered.

## Outside The Mobile Registry

These migration-backed backend/platform-only schema surfaces are intentionally
outside APP-027 because the mobile client does not read, write, cache or sync
them:

| Schema surface | Why outside APP-027 |
| --- | --- |
| `public.admin_users` | Admin authorization state for trusted operators, not mobile app state. |
| `public.activity_log` | Server-side audit trail, not mobile persistence. |
| `public.timeline_events` | Backend event history not referenced by the mobile source tree. |
| `public.rate_limits` | Server throttling state, not client-owned data. |
| `public.mutation_receipts` | APP-032 server-owned replay evidence; no direct mobile access, cached payloads or response bodies. |
| `public.support_tickets` | Operational support records, not part of mobile storage/sync. |
| `public.waitlist_signups` | Public/backend waitlist state, not current mobile client data. |

OS integrations are also outside APP-027 unless LifeSort itself persists or
caches data for them. The local notification scheduler, calendar export, and
share sheet are side effects/integrations in the current code, not physical
storage surfaces for the mobile data-profile registry.

## Deferred By Design

APP-028 covers the `cycle.user-health` local persistence surface and
its narrow legacy plaintext migration. APP-029 covers encrypted persistent
document-cache files, encrypted attachment metadata in the mixed
expense/trip/warranty stores, APP-029-specific legacy plaintext cache
migration, encrypted retry records for required plaintext cleanup, and
temporary decrypted cache cleanup. APP-030 cryptographic UUID changes, APP-031
durable outbox, APP-032 idempotency, APP-033 revisions/`updated_at`, APP-034
tombstones, APP-035 conflict handling, APP-036 sync UX, APP-037
connectivity-aware sync and APP-038 migration harness remain deferred.

## Human Review Notes

- `career.applications` remains Profile A, but free-text notes may become private
  notes in practice.
- `career.cv` remains Profile A, but CV content is document-like personal data
  and should be reviewed before APP-029.
- `core.local-backup-archive` is Profile B because backup exports can include
  attachment metadata even though cycle data is currently excluded. APP-029 did
  not redesign backup/export encryption.
