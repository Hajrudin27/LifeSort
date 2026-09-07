# ADR-0004: Feature state never gates data rights

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-005 |
| **Superseded by** | – |

## Context

Modules can be hidden, put in maintenance or retired. Specification §1.2 says a
flag must never make existing user data unreachable, and names `maintenance` and
`retired` as the states that must keep a read, export and delete path.

The obvious implementation — one boolean per module — collapses "is this
released?" and "may I have my data?" into a single switch. Under GDPR those are
not the same question: export and deletion are rights, not features.

## Decision

The evaluator returns `canExportData: true` and `canDeleteData: true` for **every**
state, including `hidden` and `retired`, not only the two the specification
names. Availability governs the module's screens; it never governs the
data-rights path.

Access is expressed as seven capabilities rather than one boolean, because a
module in maintenance is open for reading and closed for writing at the same
time.

## Consequences

- A seventh state cannot be added that quietly drops the guarantee: the test is
  `it.each` over every state and every viewer.
- Two structural invariants hold by construction: nothing appears in navigation
  that cannot be opened, and nothing can be created in a module that cannot be
  opened.
- The Privacy Center (APP-096) can offer export and deletion for a module the
  user can no longer open, which is exactly the case that matters.
- Screens must ask which capability they need. "Is the module on?" is not a
  question the evaluator answers.

## Alternatives considered

- **Restrict the guarantee to `maintenance` and `retired`,** as the
  specification literally says. Rejected: `hidden` would then be free to strand
  a user's records, and hiding a module that holds real data is a plausible
  operator mistake.
