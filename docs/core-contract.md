# LifeSort — Core Contract

**Story:** APP-004 (E0 · Architecture & inventory, P0)
**Owner:** Hajrudin Kardasevic
**Enforced by:** rule R6 in `__tests__/architectureBoundaries.test.ts`, on every `npm test`.
**Companion:** [`docs/architecture-rules.md`](./architecture-rules.md) (R1–R5), [`docs/app-inventory.md`](./app-inventory.md) (module ownership).

## What core is

Core is the platform every module stands on: the shared concerns that must exist
exactly once. Auth, storage, sync, privacy, notifications, search, feature flags,
entitlements, dates, money, the design system.

The defining property is direction. **Core does not know its consumers.** A
module may depend on core; core may never depend on a module. The moment core
imports a feature, the feature can no longer be removed, disabled or tested
alone — and core stops being a platform and becomes a hub.

That single rule is what APP-004 establishes and enforces.

## What belongs in core

| Belongs in core | Does not belong in core |
| --- | --- |
| A concern more than one module needs | Anything only one module needs — it belongs to that module |
| Primitives with no domain meaning: dates, money, ids, validation | Domain entities: `Expense`, `Cycle`, `Trip` |
| Platform services: auth, sync, storage, notifications, feature flags | A module's business rules, however reusable they look |
| The shared design system | A component that renders one module's data |
| Types shared across several modules | Types owned by a single domain |

The test is not "could this be reused?" — almost anything could. It is: **does
core still make sense without knowing which module calls it?**

## The core surface today

`core/` is deliberately close to empty. Specification §3.1 is explicit that
existing code moves gradually — "when it is being changed anyway" — rather than
in one large rename that carries risk without user or security value.

So the contract governs where the code **is**, not only where it will live. These
are core today and are already held to R6:

| Location today | Contents | Target location |
| --- | --- | --- |
| `lib/supabase.ts` | Supabase client construction | `services/supabase/` |
| `utils/auth/` | Session storage, PIN hashing and lockout, logout, account deletion | `core/auth/` |
| `utils/shared/localDate.ts`, `monthKey.ts`, `dateDays.ts`, `lastWeekdayOfMonth.ts` | Timezone- and DST-safe calendar maths | `core/dates/` |
| `utils/shared/syncQueue.ts` | Write batching | `core/sync/` |
| `utils/shared/attachmentStorage.ts`, `attachmentSync.ts`, `imageCompression.ts` | File persistence, upload, signed URLs | `core/storage/` |
| `utils/shared/dataBackup.ts`, `backupValidation.ts` | Export and restore | `core/privacy/` |
| `utils/shared/greeting.ts`, `pieChartMath.ts` | Presentation helpers | `core/design-system/` |
| `constants/`, `hooks/` | Colours, shared styles, theme tints | `core/design-system/` |
| `components/useColorScheme*.ts`, `useClientOnlyValue*.ts` | Framework primitives misfiled under `components/` | `core/design-system/` |
| `components/` shared design system | Buttons, cards, fields — core by nature, already governed by rule R4 | `core/design-system/` |

Areas the specification names that **do not exist yet**: `privacy/`,
`notifications/`, `search/`, `feature-flags/`, `entitlements/`, `analytics/`,
`ai/`, `observability/`, `money/`, `validation/`. They arrive with the stories
that need them. Creating empty folders for them now would be architecture
theatre.

## The rules

| # | Rule | Enforced |
| --- | --- | --- |
| **R6** | A core file must not import a domain store, a domain util, a route, or a feature component. | Yes — R6, with a frozen baseline |
| **C1** | A module imports core through core's own entry point, never by reaching into a neighbouring feature to get at something core-ish. | Covered by R1–R5 |
| **C2** | Core carries no domain types. If a core function needs to know what an `Expense` is, it is not core. | Review |
| **C3** | Core is the one implementation. A second copy of a shared concern is a bug, not a shortcut. | Review |
| **C4** | Moving a file into `core/` happens when that file is being changed anyway. No mass migration. | Review |

C2–C4 are review rules on purpose: they are judgements about meaning, and a
test that pretended to check them would only produce false confidence.

### On the acceptance criterion's wording

APP-004 reads "no feature imports from core". Read literally that would forbid
modules from using core at all, which is the opposite of the point. It means
*no feature-imports issued from core* — the dependency-inward rule of
specification §3.2. R6 implements that reading.

## The baseline

`CORE_BASELINE` in the boundary test holds the 28 edges where core reaches into
a domain today, all of them in two files:

- `core/auth/clearLocalUserData.ts` clears 14 domain stores by hand on logout.
- `utils/shared/dataBackup.ts` reads 14 domain stores by hand on export.

Both are the same missing abstraction: there is no registry to ask "which
modules hold data?", so each service keeps its own hard-coded list. That is
exactly the failure mode APP-009 exists to remove, and it is why
`dataBackup.ts` silently omits cycle data today
([`docs/app-inventory.md`](./app-inventory.md) §8-F8) — a hand-maintained list
drifted, and nothing noticed.

The baseline is a ratchet, like R1's: a new violation fails, and an entry that
is no longer a violation fails until it is deleted. **Never add a line to make a
test pass.**

## Entity IDs in core

APP-030 resolved the duplicated timestamp/random ID generators through
`core/ids.ts`: `newEntityId()` returns a cryptographic UUID v4 from Expo Crypto.
It has no domain dependencies and no weak fallback. New opaque persistent client
entities use it; references reuse the generated value. Existing IDs are preserved
as opaque strings, with no migration or UUID-only validation.

Semantic keys, external IDs and cache identifiers retain their own contracts.
See [ADR-0025](./adr/0025-new-client-entity-ids-are-cryptographic-uuids.md) and the
[APP-030 audit](./app-030-id-audit.md) for scope and legacy compatibility.
