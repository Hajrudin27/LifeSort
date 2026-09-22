# ADR-0041: Shopping lists are editable snapshots with durable source trace

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-21 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-052 |
| **Superseded by** | – |

## Context

The weekly planner previously copied display-name shopping suggestions into untyped
`{id,label,checked}` items. This lost quantity, ingredient identity, recipe trace,
and repeated-slot evidence. Historical manual labels cannot safely be parsed into
ingredient identities. Existing clients write only the four original base-row
columns and can still upsert them after an upgrade.

## Decision

- A dedicated pure function derives requirements from occupied plan slots.
  Family ingredients merge by `familyId` and unit; unlinked and legacy
  ingredients aggregate only by recipe ID and ingredient index. It never
  subtracts Pantry or uses price, offers, AI, or name matching.
- Generation is an explicit snapshot action. The current shopping artifact is
  editable, while the original per-slot contribution array is retained as
  immutable recipe-ID provenance. Regenerating a week requires confirmation and
  replaces only that week's generated rows.
- Local Food schema advances from v2 to v3, converting every historical
  shopping row losslessly to `kind: manual`. Backup format advances from 5 to 6
  with the same historical conversion and strict current validation.
- `food_shopping_items` remains the base artifact table with a default-manual
  `source_kind`. A separate `food_shopping_item_derivations` child table stores
  week, typed identity, current amount, and generated provenance, keyed by
  `(user_id, shopping_item_id)` and cascading from its owner-scoped parent.
  A base-row trigger preserves `meal_plan` on old-shaped update/upsert, so
  older clients cannot silently downgrade a generated item. The client rejects
  an incomplete or malformed base-plus-child read as a whole.

## Consequences

Recipe renames and deletion do not erase historical trace. A user edit to the
artifact does not rewrite generated amounts in its contribution array. An old
client may still edit the base label/checkbox or delete an item; it cannot
display or edit typed amounts. The two client writes for a derived item are
sequential rather than one database transaction, so a failed child write is
visible as a sync failure and an incomplete remote read fails closed. The
additive server migration must precede clients that query its new columns.

## Alternatives considered

- Reuse the planner's display-name list: rejected because it collapses distinct
  ingredient families and cannot provide reliable recipe trace.
- Encode metadata inside `label` or new base columns alone: rejected because
  old clients can overwrite base rows and would lose or corrupt derivation data.
- Make the shopping list a live plan projection: rejected because user edits
  must remain controlled artifacts after generation.
- Subtract Pantry quantities: rejected because Pantry names do not establish
  family identity or requirement coverage.
