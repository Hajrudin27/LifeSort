# APP-050: Pantry inventory

Baseline: `b16dbefe695261e75f2093ea6cd148272bc6cc6a`
(`feat: integrate food budget planning`). HEAD, main and origin/main matched
and the working tree was clean. Product scope: Master Production Specification
v1.0 §8.2 and APP-050. Decision: [ADR-0040](./adr/0040-pantry-inventory-preserves-explicit-facts.md).

## Audit

The Pantry model had id, name, optional text quantity and expiry date, and a
system `addedAt`. The screen added/deleted but could not edit. The old
`food_pantry_items.quantity` column is text and there were no purchase/opening
dates or UPDATE policy. The planner checks Pantry presence by name and never
counts quantity. Food local storage was Zustand v1, backup format 4, and Pantry
belongs to `food.user-planning`. Storage and sync paths are ADR-governed.

## Contract

New items have optional structured `quantity`/`unit` as one pair, using the
APP-047 units only. Optional purchase/opening/expiry values are separate real
calendar dates. No date, ingredient family, quantity or consumption is inferred.
`addedAt` is metadata and is never shown as a purchase or expiry date.

Historical free-text quantity is copied exactly to `legacyQuantityText` by the
v1→v2 local migration, backup formats 1–4, and Supabase row decoder. Editing
can preserve that text, clear it, or explicitly replace it with structured
quantity/unit. Edits keep id and `addedAt`, mutate one local entity and upsert
the same server row. The UI has visible edit/delete controls and clearable
optional dates.

The additive SQL migration retains legacy `quantity`, `expiry_date` and
`added_at`, adds four columns and constraints, and supplies an owner-scoped
UPDATE policy. It is a review artifact only; no remote migration was run.
Malformed local/backup/server Pantry data fails closed without content-bearing
error messages. A malformed server result does not partially add Pantry items.

## Boundaries

The planner still matches Pantry names for presence and does not decrement
stock. APP-047 ingredient identity, APP-048 price evidence and APP-049 budget
allocation remain unchanged. APP-051 expiry suggestions, APP-052 shopping-list
derivation and APP-053 offer-aware planning remain separate work.

Pantry remains in the existing `food.user-planning` data profile. The added
date fields are user content in the same local/cloud storage surfaces; the
store disclosure inventory describes them. Logout/account cleanup continues
through the existing Food store sweep and Supabase user-owned row cascade.

## Verification

Jest covers strict Pantry values, local v1→v2 migration, backup formats 1–5,
add/edit/delete and remote-row validation, UI add/edit/clear, planner presence
and no automatic consumption. The isolated PostgreSQL test
[`supabase/tests/app050_pantry_inventory.sql`](../supabase/tests/app050_pantry_inventory.sql)
runs in a **fresh scratch cluster only** with `psql -X -f`. It creates the old
table, applies the migration, checks unchanged legacy rows, rejects invalid
quantities/units, and verifies same-row upsert and owner-scoped update. Do not
run it against an existing local or remote project database.
