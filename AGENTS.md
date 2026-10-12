# LifeSort agent contract

## Authoritative sources

- The Master Production Specification is the product and architecture authority; existing ADRs bind decisions already made.
- Actual repository state beats assumptions. For Expo behavior, read the exact [Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/) before relying on platform behavior.

## Story discipline and architecture

- Work one approved story/scope at a time. Audit first when the task requires it; never silently implement later APP stories.
- Stop and report a decision that materially changes product semantics, security, or architecture. Prefer narrow changes over generic infrastructure.
- Feature modules must not import another feature's private store. Keep core dependency-inward and route files thin.
- Keep provider SDK/payload types at adapter boundaries; use typed shared/read contracts for cross-domain access.
- Do not add generic frameworks unless current scope proves them necessary. Preserve module- and data-profile registry contracts.

## Security and data

- Account isolation is mandatory. Review async work for stale-session/account-switch races.
- Sensitive data follows its storage profile; never put sensitive payloads in logs, analytics, or crash metadata.
- Fail closed for sensitive persistence/auth failures. RLS is a boundary, not a substitute for correct client ownership.
- Migrations are deterministic and tested.

## iOS-first v1

- Per ADR-0058, iPhone/App Store is the v1 release target. Defer Android-specific implementation and physical QA unless shared code is knowingly broken.
- Never mark deferred Android validation PASS. Apple privacy and App Store requirements remain release gates.

## Validation and release safety

- Use risk-appropriate validation: TypeScript, targeted Jest, full Jest when story risk warrants it, DB harness for DB-affecting/high-risk release work, `git diff --check`, ADR checks for governed changes, and migration tests for persistence/schema changes.
- Never use `git add .` or `git add -A`; use explicit staging manifests. Do not reset/clean unrelated work or touch unrelated untracked files.
- Do not stage, commit, push, deploy, or mutate hosted resources without explicit user instruction.
- If available usage becomes constrained during substantial work, stop at a coherent checkpoint and use the canonical Agent Handoff Report. Do not rush, stage, commit, or push incomplete work to beat a quota reset; another approved agent may continue after independently inspecting the working tree.

See [AI workflow](docs/engineering/AI_WORKFLOW.md), [release workflow](docs/engineering/RELEASE_WORKFLOW.md), and [story review standard](docs/engineering/STORY_REVIEW_STANDARD.md).
