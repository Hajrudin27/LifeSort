# ADR-0002: Architecture boundaries are enforced by a test gate with a shrink-only baseline

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-003 |
| **Superseded by** | – |

## Context

Modules reach into each other's Zustand stores: Home imports eleven of them,
Search five, and the task module reads reproductive-health state. A module that
cannot be isolated cannot be switched off, tested alone or given its own storage
profile. The specification asks for an "ESLint/import rule or code review gate".

Fixing the existing coupling means the module registry (APP-009), which is far
away. Something has to stop it growing in the meantime.

## Decision

Enforce the boundaries with a Jest test rather than ESLint, and freeze existing
coupling in a baseline list that can only shrink.

Module ownership is read from `docs/app-inventory.md` (see ADR-0001), so the
rules do not carry a second copy of the module map.

The baseline is a ratchet: a violation outside it fails, **and** an entry that is
no longer a violation fails until it is deleted. Adding a line to make a test
pass deletes the rule for that file and is never the right fix.

## Consequences

- No new dependency, and the gate runs in the existing `npm test`.
- **No editor feedback.** There is no red squiggle while typing; you find out
  when the tests run. This is the real cost.
- Only static `from '@/store/…'` imports are seen. A dynamic import or a barrel
  re-export would slip through; neither is used today.
- Each baseline entry names the story that removes it, so the debt is legible.

## Alternatives considered

- **ESLint with `no-restricted-imports`.** Rejected for now: the repo has no
  ESLint at all, so a first run would surface unrelated findings across 91 route
  files, and the rule is per-file-pattern — expressing "its own module's stores"
  would restate the module map per directory, free to drift. Revisit at APP-139,
  where ESLint can read the same inventory.
- **Fix the coupling now.** Rejected: it needs the registry, and a large
  refactor with no user or security value is what the specification warns
  against.
