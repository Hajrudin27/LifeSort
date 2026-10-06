# APP-060 — Packing templates

## Shipped behavior

APP-060 adds versioned, predefined packing suggestions to Travel. The new-Trip form can start
with an empty list, an explicitly selected template version, or a copy of another Trip. The
packing screen can apply a selected template to an existing Trip. Applying is additive and
skips labels already present after trimming, whitespace folding and case normalization.
After application, that exact template id/version is hidden for that Trip and cannot be
applied again. Other templates and later versions remain available.

Every suggestion becomes an ordinary editable packing row with a fresh id. Users can check,
rename, recategorize and remove it. Copies on different Trips have no shared identity, and a
future catalogue version cannot change a prior copy.

## Data boundary

| Data | Profile | Persistence |
| --- | --- | --- |
| Versioned template definitions | D (global reference) | Immutable bundled TypeScript source only |
| Copied packing rows | A (user-created) | Encrypted `lifesort-trips` plus `trip_packing_items` |
| Applied template id/version per Trip | A (Trip state) | Encrypted `lifesort-trips`, backup format 8 and private `trip_packing_template_applications` |

Template-item ids never enter user data. The copied label/category and ordinary packing fields
persist independently, while a separate marker stores only Trip id, stable template id,
version and application metadata. Backup format 8 carries both ordinary `packingItems` and
the explicit marker list; bundled definitions remain outside backup data. The encrypted Travel
store is version 2.

## Authorization and lifecycle

The apply action confirms that the authenticated account matches the loaded Travel dataset.
New rows use that account as immutable author, including on a shared Trip. Existing APP-058
RLS remains the server authority. A private marker table has no direct client grants; two
pinned-search-path functions allow owners and accepted participants to list markers and
atomically claim a marker while inserting copied rows. Pending, removed and unrelated accounts
are denied.

Copied rows and application markers follow existing behavior through encrypted restart hydration,
participant fetch, Trip deletion, remove-from-device, backup/restore and logout cleanup. Login
reloads markers only for accessible Trips. An account change during application cannot leave
the application in the replacement account's local dataset: every completion is gated by the
initiating dataset epoch, account and Trip before it may write.

Template application is remote-confirmed rather than offline-first. Candidate copies remain only
in request-local memory while the atomic RPC runs, so they are not encrypted, rehydrated or backed
up before confirmation. `applied` commits the accepted ids locally. `already-applied`, including a
retry after a lost response, reads the canonical marker and packing rows for that Trip and merges
rows by server id. A successful login/fetch treats the server marker set as authoritative for each
accessible Trip, while preserving any marker confirmed after that particular read began. This is a
narrow recovery read, not an outbox or general retry system.

## Version policy

`features/travel/packingTemplates.ts` is the catalogue authority. A materially changed list is
a new integer version under the same stable id. Old definitions are retained for deterministic
history and tests; only definitions explicitly marked `selectable` appear in the product.
Catalogue objects and nested item arrays are frozen at runtime and readonly in TypeScript.

The UI localizes titles and labels only when copying. That localized text then belongs to the
user's independent row and is not silently translated or refreshed later. Availability uses
only exact marker identity, never a label comparison.

## Migration decision

The Supabase migration adds `trip_packing_template_applications` plus narrow apply/list RPCs.
The encrypted Travel payload migrates deterministically from v1 to v2 by adding an empty
`appliedPackingTemplates` list. Backup format 8 whitelists and validates that list. Existing
packing rows retain the same columns and semantics; no copied row gains template provenance.
