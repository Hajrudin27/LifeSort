# LifeSort — Migration verification and E2 close-out

**Date:** 2026-09-08
**Scope:** the four migrations in `supabase/migrations/`, and the deployment tasks left open by E2.
**Status:** migrations **verified but not applied**. See "What remains" below.

## Environment available

| | |
| --- | --- |
| Supabase CLI | installed (`/opt/homebrew/bin/supabase`) |
| Docker | **not available** — so `supabase start` (the local stack) cannot run |
| `supabase/config.toml` | absent — the project is not initialised for local development, and not linked |
| Configured project | one only, in `.env`: `https://gqqwgjydei….supabase.co` — **production** |
| Local Postgres | running, but password-protected and not accessible |

There is **no staging project**. The only reachable Supabase instance is production,
so the migrations were **not applied to any Supabase environment**.

## How they were verified instead

A throwaway PostgreSQL cluster was created in a scratch directory on port 55432,
with a minimal stand-in for the parts of Supabase these migrations depend on:
`auth.users`, `auth.uid()`, `public.profiles`, and the `anon` / `authenticated`
roles. All four migrations were applied to it in filename order and the results
checked. The cluster was then stopped and deleted; the machine's own Postgres was
never connected to.

Five fixture users covered the cases that matter:

| User | name | age | gender | Prior choice |
| --- | --- | --- | --- | --- |
| Ada | set | set | female | – |
| Bo | set | set | male | – |
| Cee | – | – | unspecified | – |
| Dee | set | **null** | null | – |
| Eve | set | set | female | cycle = **off**, chosen before the seed |

### Results

**Ordering.** `user_modules` (…130000) must exist before the seed (…150000) can
insert into it. Filename order guarantees this and it applied cleanly.

**`onboarded_at` backfill** — set for Ada, Bo and Eve; not set for Cee or Dee.
That reproduces the old rule (`name` present *and* `age` present) exactly, so no
existing user is sent back through onboarding, and nobody who never finished it
is wrongly marked as having done so. Dee is the interesting case: a name but no
age was *not* onboarded under the old rule, and is not marked now.

**Cycle seed** — Ada `true`, Bo/Cee/Dee `false`, and **Eve `false`**: her own
earlier choice survived the seed despite her gender being `female`. That is the
`where not exists` clause doing its job, and it is the property that matters
most — the seed translates the old inference once without overriding anyone who
has already decided.

**Idempotency** — every migration was re-applied a second time and a checksum of
`profiles.onboarded_at` plus all of `user_modules` was identical before and
after. `create table if not exists`, `add column if not exists`,
`drop policy if exists` and the two guarded DML statements all behave.

**Row-level security** — Ada saw 2 of 6 rows. Writing a row for Bo was refused
by the policy; writing her own succeeded; updating Bo's row affected 0 rows.
`anon` was refused on `user_modules` entirely. On `module_flags`, `anon` could
read (kill switches are public by design) and `authenticated` could **not**
write, which is the operator-only property APP-006 depends on.

**Constraints** — a `core-shell` row was rejected by `user_modules_not_platform`;
an availability of `banana` was rejected by `module_flags_availability_valid`;
deleting a user cascaded their choices away.

**Compatibility with the app** — the exact statements the client issues were run
against the migrated schema and all returned correctly:

- `select name, gender, partner_name, onboarded_at from profiles where id = …`
- `select module_id, enabled from user_modules where user_id = …`
- `select module_id, availability from module_flags`
- the module toggle's upsert, including the on-conflict update path

**No defects were found, so no replacement migrations were written.**

## Repeating this check

The harness is small enough to rebuild: create a scratch cluster, add
`auth.users`, an `auth.uid()` that reads `request.jwt.claim.sub`, a `profiles`
table with `id/name/age/gender/partner_name`, and the `anon` and `authenticated`
roles; then apply `supabase/migrations/*.sql` in filename order. Automating it is
APP-141's job, not something to leave half-built here.

## What remains — applying the migrations

These require the Supabase project's credentials and are **not** possible from
this repository:

1. Link the project: `supabase link --project-ref <ref>` (needs the database
   password).
2. Apply: `supabase db push`, or paste each file into the SQL editor **in
   filename order**.
3. Confirm afterwards:
   - `select count(*) from public.user_modules where module_id = 'cycle';`
     should equal the number of rows in `public.profiles`.
   - `select count(*) from public.profiles where onboarded_at is not null;`
     should equal the number of users who had both a name and an age.

> **`profiles.onboarded_at` is required by the current code.** The profile fetch
> selects it, so until migration `…140000` is applied, sign-in will fail to load
> the profile and every user will be sent to onboarding. Apply before releasing
> this build.

One thing the harness could not check: whether every `auth.users` row has a
matching `public.profiles` row. If some do not — the app never inserts profiles,
so a database trigger must create them — those users get no seeded cycle choice
and will fall back to the client default of *enabled*. Worth confirming with
`select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id);`
before applying, and seeding those rows too if the count is not zero.

## What remains — the public deletion page

`web/account-deletion/index.html` is written and tested but **not deployed**.
Deploying it needs hosting and DNS that this repository does not reach:

1. Confirm the domain. `core/config/publicUrls.ts` assumes
   `https://lifesort.dk`; it was chosen from the product name and the
   Danish-first market and has **not** been verified as owned or resolving.
   If it is wrong, change that one constant — the app and the Play Console value
   both come from it.
2. Publish the file at `<origin>/delete-account`.
3. Replace `__SUPABASE_URL__` and `__SUPABASE_PUBLISHABLE_KEY__` with the
   project's values. Both are public and already ship in the app bundle; the
   service key must never appear there.
4. Add the same URL to Play Console under **App content → Data safety → Data
   deletion**.
5. Check the page loads over HTTPS, in a private window, without any other
   sign-in.

Until step 2 is done, the Play Console field cannot be filled truthfully. This is
recorded as finding D16 in `docs/data-sdk-inventory.md`.

## Smoke verification

| What | Verified how | Result |
| --- | --- | --- |
| Profile loads with `onboarded_at` | The app's exact select, against the migrated schema | **Passed** |
| Module selection persists | The app's exact upsert, including the on-conflict path, under RLS | **Passed** |
| Cycle choice seed | Five fixture users, including one with a prior choice | **Passed** |
| New sign-up asks only for credentials | `signUpMinimisation.test.ts` (10 cases) | **Passed** |
| Existing sign-in | `passwordAuth.test.ts` — the length rule is not applied at sign-in | **Passed** |
| Onboarding completion | `signUpMinimisation.test.ts` — completion is explicit, on the last step | **Passed** |
| Normal logout affects this device only | `sessions.test.ts` — `scope: 'local'`, and no scope-less `signOut()` anywhere | **Passed** |
| "Log out all devices" works separately | `sessions.test.ts` — `others` and `global`, and `others` does not clear this device | **Passed** |
| Logout clears stores, files, notifications | `logoutCleanup.test.ts` (15 cases) — including keys nobody registered | **Passed** |
| App-lock recovery path | `appLockPolicy.test.ts` — sign-out from the lock screen, and the cost stated first | **Passed** |

**What these do not prove.** Everything above is either a real database check or
a unit test. None of it exercises the app end to end against a live Supabase
project on a device: no simulator build was made, and no account was created,
because the only reachable project is production and the migrations are not
applied to it. The following need a device and a migrated environment:

- Sign up, receive the confirmation email, and confirm it.
- Sign in on a second device and confirm the module choice arrives.
- Sign out on one device and confirm the other stays signed in.
- Use "sign out of all other devices" and confirm the current device survives.
- Delete an account and confirm the storage objects are gone.
- Follow a password-reset link from the email back into the app.

Those belong to the Maestro suite in APP-142.
