# ADR-0001: Inventories are documents verified by tests

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-001 |
| **Superseded by** | – |

## Context

The master specification asks for several registers: routes and modules, data
types and SDKs, retention, vendors. Written as prose, every one of them starts
accurate and drifts. A stale inventory is worse than none, because decisions get
made on it — the privacy policy and the store forms are generated from exactly
this kind of document.

## Decision

Each inventory is a Markdown document with machine-readable table blocks marked
by `<!-- inventory:<name>:start -->` comments, and a Jest test parses the
document and compares it against the repository.

The document is the source of truth. The test is what stops it from becoming
fiction. A new route, store, component, Supabase table or dependency fails the
test until it has a row.

## Consequences

- Adding a file forces an inventory update in the same change. That is the
  point, and it has already worked: APP-006 added a store, a component and a
  table, and five existing tests failed until the inventories were updated.
- The tests catch omissions, not wrong descriptions. A row can say the wrong
  thing about *purpose* and still pass; only structure and coverage are checked.
- Data lives in exactly one place. Rules and code read module ownership from
  `docs/app-inventory.md` rather than keeping a second copy.

## Alternatives considered

- **Generate the documents from the code.** Rejected: sensitivity, purpose and
  owner are judgements that cannot be derived from source, and a generated file
  invites nobody to think.
- **Prose documents with a review checklist.** Rejected: this is precisely what
  drifts, and there is one maintainer to notice.
