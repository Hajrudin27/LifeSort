# ADR-0040: Pantry inventory preserves explicit facts and legacy text

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-21 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-050 |
| **Superseded by** | – |

## Context

The Pantry stored an optional free-text `quantity`, optional `expiryDate`,
and `addedAt`, and allowed add/delete only. The planner uses display-name
presence, not quantities. APP-050 requires editable structured inventory while
retaining historical text and avoiding inferred dates or ingredient identities.
Changing local, backup and server storage requires an ADR.

## Decision

- New Pantry writes use an optional positive finite number paired with the
  APP-047 `IngredientUnit` (`g`, `ml`, `piece`). Both fields are present or
  neither is. No conversion or family lookup occurs.
- Existing quantity text moves verbatim to `legacyQuantityText`. It is never
  parsed, including text that looks numeric. A named/date edit may explicitly
  keep it; a user may clear or replace it with a structured pair.
- Purchase, opening and expiry are separate optional user-entered
  `YYYY-MM-DD` calendar dates. `addedAt` remains system metadata. No date is
  derived from another, no chronology is imposed, and no expiry is predicted.
- Edits replace editable fields on the same id and `addedAt`, then upsert the
  same `(user_id, id)` row. Store writes validate before local mutation or
  server calls. Remote Pantry rows are decoded as a whole; an invalid row keeps
  the existing local Pantry intact and produces a fixed error code.
- The server migration adds `structured_quantity`, `structured_unit`,
  `purchased_date`, and `opened_date`, retaining the text `quantity`,
  `expiry_date`, and `added_at`. Constraints enforce pair coherence, positive
  finite quantity, allowed units, and exclusivity with legacy text. An
  owner-scoped UPDATE policy enables edits without delete/recreate.
- The Food Zustand key remains `lifesort-food-v2`, but its schema advances
  from version 1 to 2 through a deterministic, fail-closed pantry migration.
  Backup advances from format 4 to 5; formats 1–4 migrate Pantry text
  losslessly, while format 5 validates the current contract strictly.

## Consequences

Pantry stays in `food.user-planning`, locally and in `food_pantry_items`.
Backups and old local data retain free text. New dates have no time of day.
The existing name-presence planner remains a compatibility behavior and never
decrements stock. Clients must receive the additive schema migration before
using the new Pantry read/write fields. Older clients can still read the
retained legacy column, but cannot display structured quantities or dates.

## Alternatives considered

- Parse old text such as “500 g”: rejected because even apparently obvious
  strings would be guesses, and arbitrary notes cannot be converted losslessly.
- Reuse the text column to encode structured values: rejected because it would
  make old clients and future queries interpret an opaque convention.
- Infer expiry from purchase/opening time or ingredient name: rejected because
  no authoritative shelf-life fact exists; APP-051 owns use-soon behavior.
- Add family matching or quantity consumption to the planner: deferred to
  later stories; Pantry names are display text, not canonical identity.
