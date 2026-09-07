# ADR-0009: The module registry is the single source of module metadata

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-009 |
| **Superseded by** | – |

## Context

Module metadata had spread across three places within a single epic: availability
in `moduleAvailability.ts`, route roots in `moduleRoutes.ts`, sensitivity in
`docs/app-inventory.md`. Each was correct in isolation. Together they were three
things to keep in step, and the repository already shows what happens when that
fails — the backup exporter's hand-written store list quietly lost cycle data.

## Decision

One `ModuleDefinition` per module in `core/modules/moduleRegistry.ts`, holding
everything the platform needs to know: availability, sensitivity, route roots,
notification class, and the optional handlers that Home, Search and the privacy
tooling will supply later.

Consumers read the registry rather than keeping their own copy.
`moduleAvailability.ts` is reduced to the state machine and no longer knows which
modules exist; `moduleRoutes.ts` derives its prefixes from `routeRoots` and sorts
them longest-first, so correctness does not depend on the order of entries in a
table.

`sensitivity` means the data a module **owns**, not the data it renders.

## Consequences

- Adding a module is one definition plus one inventory row, checked against each
  other by test, instead of edits in several files that nothing verifies.
- The optional handlers are declared and left undefined, with a test asserting
  they stay that way. A handler can only arrive with the story that owns it.
- The registry becomes load-bearing for the kill switch, so a mistake in it is a
  user-visible mistake. That is the trade for having one place to be right.
- `routeRoots` extends the specification's contract. The alternative was a second
  table mapping paths to modules, which is the duplication this ADR exists to
  remove.

## Alternatives considered

- **Derive the registry from `docs/app-inventory.md` at build time.** Rejected:
  runtime code should not depend on parsing a document, and the handlers are
  functions that no document can express. Keeping them as two sources checked
  against each other is honest and cheap.
- **Keep availability where it was and add only the handlers.** Rejected: it
  leaves the three-way spread in place, which is the problem.
- **Populate `homeSnapshot` for the launch modules now.** Rejected: each snapshot
  is a judgement about what is safe to show on a shared screen, which is APP-011
  and APP-013's work, not a side effect of introducing a contract.
