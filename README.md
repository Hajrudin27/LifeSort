# LifeSort

[![CI](https://github.com/Hajrudin27/LifeSort/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Hajrudin27/LifeSort/actions/workflows/ci.yml)

A modular personal-organisation app for everyday records and planning: finances, tasks, habits, food, travel and other life domains.

**TypeScript · React Native · Expo SDK 57 · Supabase / PostgreSQL · Zustand · Jest**

The engineering focus is managing shared infrastructure without letting every feature depend on every other feature: explicit module ownership, tested dependency boundaries, durable local state and careful handling of sensitive data.

**Status: under active development.** Working screens and platform services coexist with incomplete module capabilities and planned specification work. This repository is not a claim of production readiness or complete implementation of the product specification.

[Architecture](#architecture) · [Run locally](#local-development) · [Checks](#tests-and-engineering-gates) · [Decisions](docs/adr/README.md)

## Architecture

```text
app/                         Expo Router routes and screen composition
features/                    Module-facing selectors, snapshots and integration
store/                       Zustand feature and platform state
utils/<domain>/              Domain helpers
core/                        Shared auth, modules, storage, migrations and sync
lib/supabase.ts              Backend client and session-storage wiring
supabase/migrations/         PostgreSQL schema, policies and mutation functions
components/, hooks/          Shared and module-owned UI
localization/locales/        Danish and English copy
__tests__/                   Jest logic, lifecycle and architecture checks
tests/db/                    Isolated PostgreSQL regression harnesses
docs/adr/                    Decisions, consequences and rejected alternatives
```

The direction is **features → core**. Domain stores should not depend on screens or other domains' stores. Routes should use their own module's stores and shared platform state. The [boundary test](__tests__/architectureBoundaries.test.ts) checks those rules against the [application inventory](docs/app-inventory.md).

This is an incremental architecture. Existing cross-module dependencies are recorded in explicit baselines: new violations fail, and resolved entries must be removed. The gate checks selected static imports; it is not a proof of complete dependency isolation. Shared code still lives in `utils/` as well as `core/`, and some screens retain older coupling. See the [boundary rules](docs/architecture-rules.md) and [core contract](docs/core-contract.md).

## Selected engineering decisions

- **Module visibility is separate from user data ownership.** A typed registry and availability evaluator distinguish release state, maintenance and a user's module choices. The access policy keeps export/deletion capabilities independent of feature availability. This does not imply that every module has a finished export or maintenance UI. See [module maturity](docs/module-maturity.md).
- **Durable writes before sync.** The outbox acknowledges enqueue only after local persistence. Mutation receipts and domain changes share a database transaction, with tests for duplicate delivery, rollback and concurrent requests. The new server mutation dispatcher currently supports **module-choice mutations only**; other domains still use existing paths. See [ADR-0026](docs/adr/0026-outbox-writes-complete-after-local-persistence.md) and [ADR-0027](docs/adr/0027-server-mutations-claim-receipts-in-the-domain-transaction.md).
- **Explicit conflict and deletion semantics.** Module choices have server-owned revisions and retained deletion records. Unknown conflict policies fail closed. Automatic sync is foreground/event driven and bounded; it is not a general background-sync guarantee. See [ADR-0029](docs/adr/0029-module-choice-deletions-retain-an-immutable-version.md) and [ADR-0032](docs/adr/0032-automatic-sync-is-foreground-only-event-driven-and-bounded.md).
- **Migrations precede hydration and network work.** Registered local formats use deterministic migrations and historical synthetic fixtures. Invalid or future versions stop startup rather than silently resetting data. Individual stores can commit independently; there is no multi-key transaction or general downgrade support. See [local migrations](docs/local-migrations.md).
- **Financial views share a read model.** Economy totals and projections use a common read model with integration tests. That work does not yet replace all financial representations with integer minor units. See the [financial read-model audit](docs/app-039-financial-read-model.md).

## Privacy and data handling

The code includes concrete protections with deliberately limited scope:

- Native auth sessions use an Expo SecureStore adapter instead of ordinary AsyncStorage. The optional PIN/biometric app lock is an additional device interaction barrier, not server authorisation.
- Cycle-health persistence and document-related caches use encrypted storage adapters. Protected storage paths fail instead of falling back to plaintext when encryption is unavailable. Some other local stores intentionally remain plaintext according to the [data-profile registry](docs/data-profile-registry.md); the registry itself does not implement encryption.
- Document viewing/sharing can require temporary plaintext files. The cache lifecycle and cleanup are tested, but this is not end-to-end encryption or a guarantee against every OS-level recovery path.
- Logout/account-switch cleanup sweeps owned local storage and removes encryption keys. Account deletion has a dedicated client flow and SQL function; see [account deletion](docs/account-deletion.md).
- Migrations define row-level security and ownership checks. Source review and isolated tests do not establish that a hosted database has the same policies or migrations applied.

Use synthetic records for development and screenshots, especially for health, financial and document data. Client `EXPO_PUBLIC_*` values are bundled into the app: use a publishable/anon key, never a service-role key. The [data and SDK inventory](docs/data-sdk-inventory.md) records storage surfaces, vendors and known gaps.

## Local development

Use a Node.js version supported by [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) and npm. Install from the committed lockfile:

```bash
npm ci
```

Create an ignored `.env` file in the repository root:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-DEVELOPMENT-PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR-PUBLISHABLE-OR-ANON-KEY
```

Use a separate development Supabase project with the required schema. `lib/supabase.ts` reads both values when it creates the client. There is no credential-free demo mode or checked-in local `supabase/config.toml` in this repository. The migrations are available as source, but provisioning a fresh full Supabase environment and configuring auth redirects still require separate setup. Do not point a development build at production to try migration commands.

```bash
npm run ios       # local native build; requires macOS/Xcode
# or
npm run android   # local native build; requires Android SDK/emulator
```

For an already installed development build:

```bash
npm start
```

The project uses native integrations and `expo-dev-client`; a development build is the intended path. `npm run web` exists, but browser behaviour is not equivalent to native secure storage and is not a substitute for testing protected data paths on a device.

`app.config.js` defaults to staging app identifiers unless `APP_VARIANT=production`. That changes the app identity, **not the Supabase endpoint**: `.env`/build-environment values choose the backend. `eas.json` defines development, preview and production build profiles; their presence does not verify a published app.

## Tests and engineering gates

Run from the repository root (commands below use a POSIX shell):

```bash
npm test -- --runInBand --watchman=false
npx tsc --noEmit
npm run check:adr
```

`npm test` sets `TZ=Europe/Copenhagen`. The Jest suite includes calculations, auth policies, encrypted-storage failure paths, cleanup, sync/outbox behaviour, local migrations and lifecycle tests. Native/remote dependencies are mocked where appropriate; these are not full device or hosted-service acceptance tests.

The architecture/inventory checks detect unknown routes and stores, stale documentation entries, new forbidden store dependencies and ADR register errors. `check:adr` compares against `main` by default and requires an ADR for governed architecture/data changes; another base ref can be supplied with `npm run check:adr -- <ref>`.

Separate database regression tests use Node's test runner and local PostgreSQL binaries (`postgres`, `initdb`, `pg_ctl`, `psql` on `PATH`):

```bash
node --test tests/db/*.test.cjs
```

They create disposable clusters with stand-ins for the Supabase auth surface and test mutation receipts, revisions, deletion records, RLS and concurrency. They do not contact a hosted database or verify the complete Supabase migration chain.

Use a full Git clone: local-migration fixture checks reference historical commits. [GitHub Actions](.github/workflows/ci.yml) runs TypeScript, Jest/architecture checks and isolated PostgreSQL regression tests on pull requests and pushes to `main`. Pull requests also run the ADR change gate against their base commit. CI needs no production credentials and does not run native builds or verify a hosted backend.

## Reading the project

Start with the [ADR register](docs/adr/README.md), [module registry](docs/module-registry.md), [data profiles](docs/data-profile-registry.md) and [migration contract](docs/local-migrations.md). Older story audits describe the scope at the time they were written; later code, tests and ADRs may supersede their “not yet implemented” notes.

The companion [lifesort-web](https://github.com/Hajrudin27/lifesort-web) repository contains the public site and administration/support tooling. It shares backend concepts and migration history, but is a separate Next.js application.
