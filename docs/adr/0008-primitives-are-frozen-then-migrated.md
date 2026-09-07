# ADR-0008: Duplicated primitives are frozen now and migrated by the story that owns the semantics

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-008 |
| **Superseded by** | – |

## Context

Five shared primitives are implemented more than once: money formatting in three
ways across seventeen files, two id generators across sixteen, four reminder
modules, two attachment types, and two definitions of a week boundary. Each
duplication has already produced a defect — wrong Danish number formatting,
ids that can collide within a millisecond, a cycle reminder that works only
because another module requests permission first, and trip attachments that
never reach the server.

Unifying them looks like tidying. It is not. Money needs a representation
change from floating point to integer minor units and a versioned local
migration. Ids are referenced by rows already in Supabase and by paths in
storage. Attachments need a backfill for files that exist only on one device.
Each of these is a data change wearing the costume of a refactor.

## Decision

Name the canonical implementation for each primitive now, record precisely how
the copies differ and what that costs, and leave the migration to the story that
already owns the semantics — APP-030 for ids, APP-040 for money, APP-058 for
attachments, APP-080 for reminders, APP-045 for week boundaries.

Freeze the duplication in the meantime: a test holds the file lists and fails on
a new copy, with the same shrink-only ratchet as ADR-0002.

## Consequences

- The defects stay in the app until their stories run. They are written down
  with their consequences rather than quietly carried, and two of them —
  Danish money formatting and cycle reminder permission — are worth pulling
  forward on their own merits.
- A new module cannot add a sixth reminder or an eighteenth money format without
  the test objecting, which is the point during E0's freeze phase.
- The test encodes two defects as expectations: that trips are absent from
  `AttachmentOwnerType`, and that cycle is the only reminder not requesting
  permission. Both are commented as such. When the bugs are fixed, those tests
  fail and must be updated alongside the document — deliberate, so the fix
  cannot land while the document still claims the defect exists.

## Alternatives considered

- **Unify the primitives in this story.** Rejected: four data migrations under a
  P1 inventory story, with no rollback harness (APP-038) in place.
- **Document without freezing.** Rejected: the inventory would be out of date by
  the next module, which is how the repository reached three money formats.
- **Fix only the cheap ones** — the money renderings are mechanical. Rejected as
  a scope decision, not a technical one: it would leave `Money` half-migrated,
  with no canonical type to migrate to, which is worse than either end state.
