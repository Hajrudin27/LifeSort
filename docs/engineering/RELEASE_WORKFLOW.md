# Release workflow

## Pre-commit

Require green implementation evidence, independent review when required, exact `git status`, no protected/unrelated files, and an explicit staging manifest.

An agent handoff does not change Git or release authority: regardless of model, human staging approval and explicit staging remain required, and commit/push/release rules are unchanged.

## Staging and commit

Use `git add` only for listed paths—never `git add .` or `git add -A`. Verify `git diff --cached --check`, `--stat`, and `--name-only`; inspect the full staged diff when risk warrants it. Use a concise conventional-style commit message and no `Co-Authored-By` line unless explicitly requested. After committing, verify `HEAD`, `main`, and `origin/main` as applicable.

## Push and CI

The human performs the push. Confirm the remote SHA exactly equals the local SHA, then confirm the CI run belongs to that SHA.

## Database pipelines

After successful CI on `main`, the Staging database workflow runs automatically and must use the exact tested SHA. The Production database workflow is manual and retains its own confirmation rules. Never substitute a manual `supabase db push`. With no migration, these are no-op release gates.

## Client and native release work

Database workflows do not deploy the Expo client. Physical/native QA is required only when behavior warrants it. Native-module or configuration changes may require a rebuild, development client, or TestFlight; ordinary JavaScript and documentation changes do not automatically require a rebuild.

## Close

A story closes on evidence, not merely a commit: the commit is on the remote, CI is green, DB gates are green where used, required physical QA is complete or honestly **DEFERRED**/**NOT REQUIRED**, residual work belongs to a future APP, and the exact final SHA is recorded.
