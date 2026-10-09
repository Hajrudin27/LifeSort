# Database deployment

How a migration in `supabase/migrations/` reaches the LifeSort databases. Two workflows do it; nothing
else should.

| | Staging | Production |
| --- | --- | --- |
| Workflow | [`db-staging.yml`](../.github/workflows/db-staging.yml) — *Deploy Migrations to Staging* | [`db-production.yml`](../.github/workflows/db-production.yml) — *Deploy Migrations to Production* |
| Starts | Automatically, after a **successful `push` CI run on `main`** | **Only** by hand (`workflow_dispatch`), from `main` |
| Commit deployed | Exactly the commit CI tested (`workflow_run.head_sha`) | Exactly the commit `main` pointed at when you dispatched the run (`github.sha`), even if `main` moves on before it is approved |
| Human gate | none | typed `DEPLOY_PRODUCTION`, **and** approval of the protected `production` environment, given **before** the job starts |
| GitHub environment | `staging` | `production` |
| Serialised | one at a time, never cancelled mid-migration | one at a time, never cancelled mid-migration |

[`ci.yml`](../.github/workflows/ci.yml) is unchanged and has no database credentials: TypeScript, Jest, the
architecture rules and the isolated PostgreSQL regression harness. It never touches a hosted database. These
two workflows contain the only commands in the repository that talk to a hosted Supabase project.

There is no `develop` branch. The flow is `feature or local work → CI → main → Staging (automatic) →
Production (manual)`.

## The canonical workflow

Developer:

1. Create a timestamped migration file locally in `supabase/migrations/`.
2. Test it against a disposable local PostgreSQL (`node --test tests/db/*.test.cjs`).
3. Commit the migration.
4. Open and merge the change through the normal process.

GitHub:

5. CI proves the application and the database tests.
6. A green `main` pushes the migration to **Staging** automatically.
7. **You** verify Staging.
8. **You** dispatch *Deploy Migrations to Production* on `main`.
9. The `production` environment waits for approval.
10. After approval the job runs a dry run.
11. If, and only if, the dry run succeeds, the same job immediately runs `db push`. There is no pause
    between 10 and 11 (see *What the approval means*).
12. It lists the remote migration history again so you can see local and remote now match.

Never:

- change the schema in the Supabase SQL Editor or the Table Editor, for Staging or Production;
- change migration history by hand as a routine step. This **supersedes** the "paste each file into the SQL
  editor" line in [`migration-verification.md`](./migration-verification.md), a record of an earlier one-off
  batch that now carries a pointer here;
- let a workflow repair migration history, reset a database, pull a schema or seed data;
- deploy Production on a push to `main`.

An emergency repair of migration history is a separate, reviewed operation done by a person, not by CI.

At the time these workflows were set up (2026-10-08), Staging and Production were both migrated through
`20261008120000_app064_habit_semantics` and their histories had been repaired to match the local filenames.
The workflows do not depend on that: they deploy whatever is pending, so future migrations need no change here.

## One-time GitHub setup

Do all of this **before the workflows are merged to `main`**. The Staging workflow only exists for GitHub once
`db-staging.yml` is on `main`, and the first push after that runs it. Do the steps **in this order**: GitHub
creates an environment the first time a workflow names it, with *no* protection rules and no secrets, so
configure the reviewer rule on `production` **before** adding any production secret.

1. **Settings → Environments → New environment → `staging`.** No reviewers are needed.
2. **Settings → Environments → New environment → `production`.**
   - Tick **Required reviewers** and add the repository owner (Hajrudin, `Hajrudin27`).
   - Leave **Prevent self-review** off while you are the only person who dispatches *and* approves. With it on,
     the person who started a run cannot approve it, so a single-person setup could never deploy.
   - **Untick "Allow administrators to bypass configured protection rules".** It is **on by default**, and while it
     is on, an administrator (you) can force a deployment past the reviewer rule.
   - Click **Save protection rules**.
3. On **both** environments, in the **Deployment branches** dropdown choose **Selected branches and tags**, then
   *Add deployment branch or tag rule* → ref type **Branch** → `main`.
   - Do **not** choose "Protected branches only": GitHub documents that when no branch has a protection rule,
     *all* branches can deploy, and `main` currently has none.
   - This rule is a security control, not a nicety. A `workflow_dispatch` run uses the workflow file *of the branch
     you pick*, so someone with write access could otherwise dispatch an edited copy of a workflow from a feature
     branch, and any workflow on any branch could name `environment: staging` or `production` and read its secrets.
     GitHub matches this rule against the run's `GITHUB_REF` before the job gets the environment's secrets. A
     `workflow_run` job always has `GITHUB_REF` = the default branch, so Staging is unaffected.
4. Add to **each** environment (not to the repository, so the two cannot be mixed up):

   | Kind | Name | Value |
   | --- | --- | --- |
   | Variable | `SUPABASE_PROJECT_ID` | the 20-letter project ref of **that** environment's project |
   | Secret | `SUPABASE_ACCESS_TOKEN` | a Supabase personal access token |
   | Secret | `SUPABASE_DB_PASSWORD` | the database password of **that** environment's project |

   `staging` and `production` hold **different** values for all three. Do not define any of these names at
   repository level. Prefer a separate access token per environment, so a Staging leak cannot reach Production.
   Check, once, that the ref you paste into each environment really is that environment's project: nothing in
   the workflow can tell Staging from Production (see *Residual risks*).
   The project ref is an **identifier, not a credential** (for Production it is also in the public app's API URL).
   It is not committed, but GitHub prints a step's `env` values in the log header and never masks variables, so
   it is visible in this public repository's Actions logs. The token and password are secrets and are masked.
   If you want the ref hidden, store it as a *secret* and change `vars.` to `secrets.` in both workflows.
5. **Recommended, because the whole flow assumes `main` is trustworthy:** protect `main` (Settings → Branches or
   Rulesets): require a pull request and the two CI checks (*TypeScript, Jest and architecture*, *PostgreSQL
   regression tests*), and block force pushes and deletion. When this was written `main` had **no** protection
   and there were no rulesets.
6. **Optional hardening** (Settings → Actions → General): *Require actions to be pinned to a full-length commit
   SHA* (every action here already is), and require approval for all outside collaborators' workflow runs
   (currently *first-time contributors*).

**Availability of these protections.** Per GitHub's documentation (read 2026-10-09), required reviewers, deployment
branches and tags, and the administrator-bypass setting are available for **public** repositories on the Free, Pro
and Team plans, and this repository is public. On a Free plan, environments and their secrets exist only for public
repositories: if the repository is made private, GitHub **ignores** the protection rules and the environment
secrets. The workflows would then stop at their configuration check (no secrets), so they cannot deploy, but the
protections would not be there either. Re-verify after any change of plan or visibility, and do not assume a
reviewer gate exists because the setting once did.

Until the reviewer rule is saved, a `production` run does **not** wait for anyone. A run in an unconfigured
environment still fails closed at the configuration check ("needs the secrets … and the variable …"), before any
Supabase command, only because the secrets are absent. That is why the reviewer rule comes first.

## Staging in detail

Trigger: `workflow_run` of the workflow named **CI**, type `completed`. The job runs only when **all** hold:

- the CI run's conclusion is `success`;
- its event is `push` (not a pull request, not a manual dispatch, not a schedule);
- its branch is `main`;
- it ran in **this repository**, not a fork (`head_repository.full_name == github.repository`).

These are fields of the `workflow_run` payload (checked against real run objects of this repository). GitHub's `==`
compares strings case-insensitively; that does not open a path here, because CI is only triggered by pushes to
`main`, and the tested commit must in any case be reachable from `main` (below).

**Coupling to CI.** The trigger names the workflow `CI` (`name: CI` in `ci.yml`). If CI is ever renamed, Staging
silently stops deploying and nothing turns red. Rename both together.

Why this is enough: `workflow_run` always executes the workflow file from the default branch, and per GitHub's
documentation it can use secrets even when the run it reacts to had none. A pull request that edits `db-staging.yml`
therefore changes nothing until it is merged, and a pull request's CI run (or a fork's) can never satisfy the four
conditions. Every CI completion, pull requests included, starts a run of this workflow; for those, the job is skipped
and never reaches the environment, so expect many *skipped* runs in the Actions tab.

**Exact commit.** The job checks out `github.event.workflow_run.head_sha` with `persist-credentials: false` and then
asserts that `git rev-parse HEAD` equals it. It never deploys "whatever `main` points at now". Before that it asks the
GitHub API (read-only, `contents: read`) how `main` relates to the tested commit (`compare/<sha>...main`):

| API answer | Meaning | Result |
| --- | --- | --- |
| `identical` | the tested commit is the tip of `main` | deploy |
| `ahead` | `main` has moved on and still contains the tested commit | deploy that tested commit |
| `behind` or `diverged` | the commit is not in `main`'s history (for example it was force-pushed away) | stop |
| an error, including 404 for a commit that no longer exists | unknown | stop (fail closed) |

So normal advancement of `main` does not invalidate an older commit that is still in `main`'s history; the CLI then
refuses it if a newer migration is already on the database (below).

**Concurrency.** Group `database-staging`, `cancel-in-progress: false`: one Staging deployment at a time, and a
running migration is never cancelled. Only qualifying runs share this group, so an ignorable pull-request run can
never displace a pending deployment. The assumptions, stated precisely:

1. GitHub keeps one running and at most one pending run per group; a newer pending run replaces an older pending one.
2. Discarding an older pending run is safe because every Staging run is for a commit in `main`'s history and
   migration files are timestamped, so a later commit contains every migration file of an earlier one.
3. Out-of-order deployment is blocked twice. `ci.yml` cancels an in-flight CI run on `main` when a newer push arrives
   (`cancel-in-progress: true` per ref), so an older commit's CI rarely finishes after a newer one's. If it ever did,
   the CLI will not apply an older tree to a database that already holds a newer migration: it stops with *Remote
   migration versions not found in local migrations directory.* and exit code 1, before anything is applied.
4. Not guaranteed: **re-running** an old CI run on `main` later re-triggers Staging for that old commit and, if a
   newer deployment is pending, replaces it. The database stays consistent, but Staging may lag until the next push.
   Do not re-run old `main` CI runs.

To re-run after fixing *configuration* (secrets, variables, environments), use **Re-run failed jobs** on the Staging
run: it redeploys the same commit and reads the configuration as it is then. A re-run uses the workflow file as it was
when the run started, so to pick up a fix to a workflow file, push a new commit.

## Production in detail

1. Actions → **Deploy Migrations to Production** → *Run workflow* → branch **main** → type `DEPLOY_PRODUCTION`.
2. A first job (`guard`, no environment, no secrets) fails at once unless the branch is `main` **and** the text is
   exactly `DEPLOY_PRODUCTION`. The check is a literal comparison: case-sensitive, no trimming, no pattern matching.
   The typed text is passed through an environment variable, never pasted into a script. A mistake therefore fails
   *before* anyone is asked to approve anything.
3. The `deploy` job (which also requires `github.ref == 'refs/heads/main'`) then waits for approval of the
   `production` environment.
4. After approval, in one job: install the pinned CLI → link → list history → **dry run** → **push** → list history.

**What the approval means (and what it does not).** Approving the environment is permission to run the whole
deployment job. It is given **before** the job starts, so the approver has **not** seen the dry run, and there is
**no pause** between the dry run and the push: when the dry run succeeds, the push starts at once. The dry run is a
technical gate that stops the push on a diverged history, a missing migration or a failed connection. It is **not** a
review step, and cancelling the run after reading the dry run is not a control you can rely on (the push step starts
within seconds). Decide **before approving**: compare `supabase/migrations/` on `main` with what Staging has already
run, and check the commit shown on the run page. If you want a human decision after seeing the dry run, that is an
architecture change (split the job in two behind a second protected environment, with its own secrets); it was
deliberately not done, and is recommended to be considered, not assumed.

**Exact commit.** The run records one commit when you dispatch it (`github.sha`, the tip of `main` at that moment) and
deploys exactly that commit, even if approval takes days and `main` moves on, and also on **Re-run**. It is *not* "the
latest `main`". A later commit needs a new dispatch. The job asserts `git rev-parse HEAD` equals that commit.

**Waiting runs.** A run that is waiting for approval occupies the `database-production` group; later dispatches queue
behind it, and only the newest queued one is kept. Reject or cancel a run you do not intend to approve.

Only dispatch Production for a commit whose Staging deployment you have seen succeed. The workflow cannot check that:
the token it runs with has `contents: read` only.

**First runs.** After the workflows are merged, Staging runs by itself on the next green `push` to `main`. Both
databases are already at APP-064, so its dry run should report that the remote database is up to date and the push
should do nothing (see *What the CLI does*): a safe smoke test, provided the histories are exactly as they were left.
Do Staging first. A first **Production** run is a deliberate operator choice, not a required step: with nothing
pending it writes nothing to the database, but it still links the project and connects with the production
credentials, so run it only if you want that proof, and never "just to test write behaviour".

## Reading the logs

`migration list` shows local and remote versions side by side; after a successful push every row has both. The dry
run prints `Would push these migrations:` and the file names, or reports that the remote database is up to date.

| You see | It means | Do |
| --- | --- | --- |
| *needs the secrets … and the variable …* | environment not configured | finish the setup above, then re-run |
| *SUPABASE_PROJECT_ID must be a 20-letter lowercase project ref* | the variable is empty, has spaces or a newline, or is not a bare ref | fix the variable |
| *Remote migration versions not found in local migrations directory.* | the database has a version this commit lacks | stop; do **not** repair in CI. Check you are deploying the right commit; if history really diverged, handle it as a reviewed emergency repair |
| *Found local migration files to be inserted before the last migration on remote database.* | a new file has an older timestamp than the newest remote one | rename the file to a newer timestamp; do not force it in |
| a SQL error | that migration file failed. Statements are normally applied in one implicit transaction per file, so the failing file is rolled back; statements that cannot run in a transaction (for example `CREATE INDEX CONCURRENTLY`) run on their own. Files applied *before* it in the same push stay applied and recorded | fix forward with a new migration |
| *Tested commit … is not part of main* | `main` was rewritten | investigate; nothing was deployed |

Migrations are forward-only. To undo one, ship a new migration. There is no reset.

## What the CLI does

Read from the CLI source at the pinned tag (`supabase/cli` `v2.116.0`, `apps/cli/src/legacy/`), and the flags checked
against the installed npm build's own `--help`:

- `link --project-ref`, `migration list --linked`, `db push --linked --dry-run --skip-vault` and `--yes` (global) are
  all valid for `2.116.0`.
- **`db push --dry-run`** connects, reads the local files and the remote history, prints the plan and writes nothing.
  Its history checks run first: a remote version missing locally, or a local file older than the newest remote version
  (without `--include-all`, which is never used), exits 1 before anything is applied.
- **A real push with nothing pending** prints that the database is up to date and returns before any write.
- **A real push with pending migrations** first runs idempotent `CREATE SCHEMA/TABLE IF NOT EXISTS … ADD COLUMN IF NOT
  EXISTS` on the CLI's own `supabase_migrations.schema_migrations`, then, per file, `RESET ALL`, the migration's
  statements and an insert of its row into that table.
- **`--skip-vault`** only stops it from syncing `[db.vault]` secrets from `supabase/config.toml` (there is none). It
  does not make the push "migrations only" in any stronger sense; what keeps it to migrations is that no seed or
  custom-roles file is requested (`--include-seed` and `--include-roles` are never passed).
- **`--yes`** only answers the CLI's own "push these migrations?" prompt, which defaults to yes when nothing is piped
  to it (as on a runner). It is passed so the behaviour is explicit.
- **Credentials.** `SUPABASE_DB_PASSWORD` from the environment is used directly for the database connection; only
  without a password does the CLI mint a temporary login role through the Management API. `SUPABASE_ACCESS_TOKEN` from
  the environment authenticates the Management API calls. Neither is passed as an argument.
- **Network.** GitHub-hosted runners have no IPv6, and a Supabase project's direct database host can be IPv6-only, so
  the CLI's default pooler connection is the one to keep. Do not add `--skip-pooler`.

## Security model

| Threat | Control |
| --- | --- |
| A branch edits a workflow and dispatches that copy, or names an environment from a feature branch | the environments accept only `main` (setup step 3); the secrets belong to the environments, not the repository |
| A pull request or fork reaches Staging secrets | the job's four-part gate; `workflow_run` runs the default-branch definition; secrets exist only in environments |
| A failed or cancelled CI run deploys | `conclusion == 'success'` |
| CI on a feature branch deploys | `head_branch == 'main'` and `event == 'push'` |
| Staging deploys a different commit than CI tested | checkout by `head_sha`, verified against `HEAD`; the commit must still be in `main`'s history |
| Two deployments overlap | fixed concurrency groups, never cancelled |
| Production starts on push | the only trigger is `workflow_dispatch` |
| Production runs from a branch | the `guard` job (exact comparison, `needs`), a second `if` on the deploy job, and the environment rule |
| A typo still deploys | exact comparison, in a job that precedes the environment |
| The typed input becomes a shell command | passed via `env`, compared with `[ "$X" != … ]`, never interpolated into a script |
| A failed dry run is ignored | later steps run only if earlier ones succeed; the shell is `bash -eo pipefail`, so `tee` cannot hide a failure |
| Secrets in logs | no `set -x`, no `--debug`, no `echo` of a secret; secrets are mapped only into the steps that run the CLI, never into the job, the third-party setup action or the npm install; the password is read from `SUPABASE_DB_PASSWORD`, never passed as an argument; GitHub masks secrets in logs |
| The wrong project is targeted | per-environment variable, shape-checked, passed as `--project-ref` and exported as `SUPABASE_PROJECT_ID`; Staging and Production credentials differ |
| History is "fixed" automatically | no `repair`, `pull`, `reset`, `diff`, `seed`, `--include-all` or `--db-url` anywhere; the CLI stops on divergence |
| A floating action or CLI changes under us | every action is pinned by commit SHA; the CLI version is explicit and verified after install |
| Over-broad token | `permissions: contents: read` in each workflow, and no job widens it |

Residual risks, accepted:

- The CLI is installed from the npm registry (a pinned version with a published provenance attestation, which the
  workflow does not verify).
- Write access to `main` is trusted, and `main` is not yet protected (setup step 5).
- The reviewer approves before any dry run exists (above).
- **Staging and Production could be swapped** by pasting a ref or credentials into the wrong environment. The workflows
  do not hard-code project refs and cannot tell which project a ref belongs to; the protection is the one-time check in
  setup step 4.
- The project ref is visible in public logs (setup step 4).

## Pins

Every action is pinned to a full commit SHA with its release in a comment, as in `ci.yml`. The Supabase CLI is pinned
in each workflow's `SUPABASE_CLI_VERSION` and checked after installation (its `--version` prints exactly the version
on stdout). Verified on 2026-10-08 and re-verified on 2026-10-09 against the upstream repositories.

| Action | Commit | Release | Why it is trusted |
| --- | --- | --- | --- |
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1 | already pinned in `ci.yml`; the tag resolves to this commit; official GitHub action, not a prerelease |
| `actions/setup-node` | `820762786026740c76f36085b0efc47a31fe5020` | v7.0.0 | already pinned in `ci.yml`; the tag resolves to this commit; official GitHub action, not a prerelease |
| `supabase/setup-cli` | `45a513f8c64c0bc8e0e3dfe572b5c95be85f6359` | v3.0.1 | the official Supabase action; the tag resolves to this commit; the release (2026-09-24) is not a prerelease or draft; the commit carries a valid GitHub signature; its `action.yml` takes a single `version` input and pins its own inner actions by SHA |

| Tool | Version | Why |
| --- | --- | --- |
| Supabase CLI | `2.116.0` | published to npm 2026-08-26 with a SLSA provenance attestation, not deprecated, no install scripts in the package itself, a non-prerelease GitHub release, no security advisories published for the CLI repository; it is the version already used to run and repair these databases, and it has soaked for six weeks. `2.120.0` (2026-10-06) was the latest on 2026-10-08 and was not chosen because it was two days old |

Why the CLI version must be passed: without `version`, `supabase/setup-cli` looks for a `supabase` package in the
repository's lockfile (there is none) and otherwise installs `latest`.

To upgrade deliberately, change `SUPABASE_CLI_VERSION` in **both** workflows (and the action SHA if the action moves),
re-check the flags in *What the CLI does*, update the tables above, and let the change run on Staging first. Do not use
`latest`, `beta` or a moving tag such as `v3`.

## Emergency repair

Repairing migration history, or any change made outside these workflows, is a separate operation. It is done by a
person, with the intent and the exact commands reviewed first, against Staging before Production, and recorded
afterwards. It is never added to a workflow.
