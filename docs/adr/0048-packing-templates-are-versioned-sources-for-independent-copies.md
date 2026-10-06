# ADR-0048: Packing templates are versioned sources for independent copies

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-06 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-060 |
| **Superseded by** | – |

## Context

Travel already persists editable packing rows locally in the encrypted `lifesort-trips`
store and remotely in `trip_packing_items`. The server treats `user_id` on each packing
row as the immutable author and permits an accepted participant to collaborate under the
APP-058 policies. Before APP-060, the new-Trip screen copied one unversioned hard-coded
default list, while the packing screen could only add, check and remove items.

A template is global reference content, not user data. Applying it must not create a live
link through which a later app release can alter a user's list. Conversely, changing a
copied row must never change the bundled source. This distinction must survive local-first
persistence, restart, account changes, sharing and backup.

## Decision

Keep the template catalogue as immutable bundled Profile D content. Every definition has a
stable string id, positive integer version, title key and stable item definitions. Historical
versions remain addressable in code; only releases explicitly marked selectable appear in
the UI.

Applying a template is an explicit copy operation. It resolves localized labels at that
moment and creates fresh, ordinary Profile A `PackingItem` rows with new cryptographic ids,
the selected Trip id and the signed-in participant as author. Those rows contain no template
provenance and remain independently editable user data.

Separately, the Trip records one application marker identified by stable template id and
positive integer version. The marker is Trip-scoped Profile A state, not packing-item
provenance. It is stored in the encrypted `lifesort-trips` payload, backup format 8 and the
private `trip_packing_template_applications` table. The catalogue itself remains bundled
Profile D content and is neither exported nor synced.

Copying is additive. Existing rows, checked state and custom items are preserved. A
case/whitespace-normalized label already present on that Trip prevents a duplicate. The same
template may be copied to two Trips because each copy receives unrelated row ids.

Once an exact id/version marker exists for a Trip, that release is removed from that Trip's
suggestions and cannot be applied again. Another template or a later version remains eligible.
Availability is never inferred from copied or manually-created labels.

One pinned-search-path SECURITY DEFINER RPC atomically claims the exact marker and inserts the
ordinary packing rows. A losing repeat or concurrent request inserts neither marker nor rows.
Direct client access to the marker table is revoked; the apply and list RPCs enforce the same
owner-or-accepted-participant Trip access as APP-058. Markers cascade with their Trip.

Template application is remote-confirmed, not an offline mutation. Candidate row ids and values
exist only on the active async call stack until the RPC returns `applied`; only then are those
server-accepted rows and the marker committed to encrypted Zustand state. They therefore cannot
enter restart persistence or backup as provisional data. `already-applied` triggers a narrow
authoritative read of that Trip's marker and packing rows, merged by server row id without
removing ordinary local packing items. A normal successful marker fetch replaces that Trip's
local marker set rather than unioning it, so an unconfirmed marker cannot remain final. Replacement
is bounded by the request-start marker snapshot: a marker confirmed while that read is in flight is
newer and is preserved, preventing a stale empty response from undoing a successful application.

Every completion is gated by the initiating dataset epoch, authenticated account and surviving
Trip immediately before any state write. A stale completion returns without mutating the current
dataset. If a commit response is lost, no local candidate state becomes durable; restart fetches
the canonical server marker and rows. Retrying is safe because the database claim returns
`already-applied` and the losing candidate ids are never stored.

## Consequences

- A future template release is a new versioned definition; it cannot mutate prior copies.
- A copied item can be checked, renamed, recategorized or removed with existing row semantics.
- Template definitions are not exported or synced. Application markers are exported, restored,
  synced and deleted with the Trip; copied rows keep their existing lifecycle.
- Only server-confirmed application markers and copied rows are persisted or exported. The
  narrow request has no durable pending representation, retry queue or outbox.
- APP-060 uses a Supabase migration and a deterministic encrypted Travel-store v1→v2 migration
  that initializes an empty marker list. Older packing rows still hydrate unchanged.
- Product code must not infer a template from destination, dates, user history or other
  personal data. The user chooses the source.

## Alternatives considered

- Persist template identity/version on each copied row. Rejected because application state is
  one Trip-level fact, not per-item provenance; rows may be renamed or deleted without making
  the template eligible again.
- Infer application from packing labels. Rejected because manual items and edited copies make
  label equivalence neither identity-safe nor durable.
- Replace the whole packing list when applying a template. Rejected because it destroys user
  edits and existing collaborative rows.
- Store templates in Supabase and synchronize them with Trips. Rejected because the approved
  scope needs a small predefined catalogue, not an admin content system or generic template
  engine.
- Infer a template from the destination or the user's prior Trips. Rejected because APP-060
  prohibits hidden personal inference and requires an explicit choice.
