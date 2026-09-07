# ADR-0003: Core is dependency-inward and migrates file by file

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-004 |
| **Superseded by** | – |

## Context

The specification's target structure has a `core/` layer holding auth, storage,
sync, privacy, dates and the design system. The repository has none: those
concerns live in `lib/`, `constants/`, `hooks/`, `utils/shared/` and
`utils/auth/`.

Creating `core/` and moving everything into it is a large rename with no user or
security value — which specification §3.1 explicitly warns against.

## Decision

Core is defined by direction, not by folder: **a module may depend on core; core
may never depend on a module.**

The rule governs the code that is core *today*, wherever it currently sits, and
`core/` itself. Files move into `core/` when they are being changed anyway, not
in one migration. `core/` therefore starts nearly empty on purpose.

## Consequences

- The boundary is enforceable now instead of after a migration, and a file
  dropped into `core/` is governed the moment it lands.
- Core-to-core imports stay legal even across folders, so `hooks/` may use
  `components/useColorScheme` — a core primitive that happens to be misfiled.
- Two files break the rule today, both hand-maintaining a list of every store:
  logout (`clearAllLocalData`) and export (`dataBackup`). They are baselined, and
  they are the same missing abstraction that ADR-0002's coupling points at.
- The repository keeps a mixed structure for a while. The core contract carries
  the map from where code is to where it is going.

## Alternatives considered

- **Move the date utilities into `core/dates/` now** as proof. Rejected: it
  touches roughly twenty import sites for no behavioural gain, and the point of
  the rule is that it does not need the move to work.
- **Wait for the migration before enforcing.** Rejected: the coupling that
  matters is being written now.
