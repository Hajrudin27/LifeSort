# APP-058 — Trip canonical entity

**Story:** APP-058 (E6 · Documents, warranties, travel & home, P1)
**Owner:** Hajrudin Kardasevic
**Decision:** [ADR-0046](./adr/0046-trips-are-canonical-parents-and-reference-standalone-documents.md)
**Migration:** `supabase/migrations/20260930141858_app058_trip_canonical_entity.sql`
**Enforced by:** `tests/db/app058.test.cjs`, `__tests__/tripDomain.test.ts`,
`__tests__/tripStore.test.ts`, `__tests__/tripRemote.test.ts`,
`__tests__/tripLegacyDocuments.test.ts`, `__tests__/tripDocumentsUi.test.tsx`

## The story and its acceptance criteria

*As a user I want to link budget, packing and documents to one trip.*

| Criterion | Where it is met |
| --- | --- |
| Trip ID + dates | `trips.id` stays opaque text (new ids are `newEntityId()` UUIDs; legacy ids untouched). Start/end are strict calendar dates on the client and `CHECK (start_date <= end_date)` in the database. A canonical `destination` is added |
| References, not duplicated blobs | `trip_document_references` holds two ids and a time, owner-bound to both the trip and the document. No name, path, URL or bytes. Packing items and expenses become real children of the trip through foreign keys |
| Deletion dependency preview | `trip_deletion_preview()` counts on the server; the UI shows it, says linked Documents are kept, shows legacy on-device files separately, fails closed, and offers deletion only to the owner |

**Budget is not linked in APP-058.** APP-059 subsequently adds the Economy read bridge and
MinorUnits migration; see `docs/app-059-travel-budget-bridge.md` and ADR-0047.

## Baseline and audit

Implemented on `21e417c` (`feat: add warranty domain`).

- `public.trips` `(id text, user_id, name, start_date, end_date, budget, created_at)`, primary
  key `(user_id, id)`, plus a global unique index on `id` from the sharing-security migration.
- `trip_expenses` and `trip_packing_items` had **no trip foreign key**; their `user_id` is the
  row's author, possibly an accepted participant. `trip_participants` had no foreign key either.
- The client deleted a trip, then deleted expenses, packing items and participants filtered by
  the *deleter's* user id, each best effort.
- `can_access_trip_row(trip_id, author)` lets an accepted participant read rows written by the
  owner or another accepted participant. **It never let the owner read a participant's rows.**
- `Trip.documents` were local encrypted `TripAttachment`s that were never uploaded; the type
  duplicated `Attachment`. The trip screen had no UI for them at all — only the store kept them.
- `removeTrip` was called from the trip screen only; `app/travel/index.tsx` declared it unused.

## Database design

| Object | Definition |
| --- | --- |
| `trips.destination` | `text NULL`, no default, no backfill; `CHECK` non-blank and ≤ 200 characters when present |
| `trips_start_not_after_end` | `CHECK (start_date <= end_date)`; same-day valid |
| `trip_expenses_trip_id_fkey` | `(trip_id) → trips(id) ON DELETE CASCADE` |
| `trip_packing_items_trip_id_fkey` | `(trip_id) → trips(id) ON DELETE CASCADE` |
| `trip_participants_trip_owner_fkey` | `(owner_id, trip_id) → trips(user_id, id) ON DELETE CASCADE` |
| Indexes | `trip_expenses(trip_id)`, `trip_packing_items(trip_id)` for the cascade |
| `trip_document_references` | `(user_id, trip_id, document_id, created_at)`, PK `(user_id, trip_id, document_id)`; FKs `(user_id, trip_id) → trips(user_id, id)` and `(user_id, document_id) → documents(user_id, id)`, both `ON DELETE CASCADE` |
| `trip_deletion_preview(text)` | `SECURITY DEFINER`, `search_path = public, pg_temp`, `STABLE`; `EXECUTE` for `authenticated` only |

Children reference the trip by `id` alone because `user_id` there is the *author*; binding
`(user_id, trip_id)` would have made a participant's rows unreferenceable. The participant table
*is* owner-bound, so it references the pair.

**Preconditions.** Before changing anything the migration counts trips ending before they start,
expense and packing rows naming no trip, participant rows whose owner does not match their trip,
and expense and packing rows whose **author** is neither the trip's owner nor an accepted
participant, and stops with the counts. It never deletes or rewrites to fit. The author check is
blunt on purpose: a participant who was later removed or declined leaves rows that are legitimate
yet indistinguishable from forged ones, so the migration will not decide. For a read-only preflight
on a real database, count the same things by hand first; a non-zero result has to be resolved by a
person who can look at the rows, and on a real database it may well be non-zero.

### RLS and grants

| Who | trips | children (expenses, packing) | participants | document links |
| --- | --- | --- | --- | --- |
| **Owner** | full CRUD (unchanged) | reads **all** rows of their trip, every author (new SELECT policy); writes their own rows on their own trip | invite / remove / view (unchanged) | select / insert / delete own |
| **Accepted participant** | view + update shared trip (unchanged; `id`/`user_id` cannot change) | read the trip's rows; **insert only rows authored by themselves**; edit or delete content on the trip as before; identity columns immutable | own invitation only (unchanged) | **nothing** |
| **Pending / declined invitee** | nothing | nothing; **cannot write** into the trip (new) | own invitation only | nothing |
| **Unrelated account** | nothing | nothing; cannot write | nothing | nothing |
| **anon** | nothing | nothing | nothing | no grant at all |

`can_access_trip_row` is unchanged, byte for byte. The owner's read is a separate SELECT policy
because putting an owner branch in the helper would also have authorised owner *writes* with any
author id. The own-row INSERT and UPDATE policies on both child tables now also require the trip
to be the caller's or one they are an accepted participant of, so a foreign trip id is not
writable to. The older participant INSERT policies on both child tables are **dropped**: they also accepted
the owner or another participant as the author, so a participant could sign a row in someone
else's name, and the own-row policy already authorises an accepted participant's own row. A
`BEFORE UPDATE` trigger on `trips`, `trip_expenses` and `trip_packing_items` refuses any change to
`id`, `user_id` or `trip_id`, for anyone; collaborative *content* editing is kept. Grants on the
legacy tables are untouched (APP-107); the new relation gets explicit
ones — SELECT and DELETE, INSERT on three named columns so `created_at` is the server's, no UPDATE.

### Legacy clients

- An upsert that omits `destination` is valid and leaves an existing destination alone.
- A legacy edit that puts the end before the start is now refused; that client ignores the error,
  so the edit is silently not saved.
- A legacy client cannot write a child row for a trip it neither owns nor belongs to, nor under
  another author's identity — neither of which it ever did legitimately.
- A legacy client creating a trip sends the trip row and its default packing list as two concurrent
  requests. If the packing one commits first it is set aside by the compatibility buffer below and
  adopted when the trip arrives, so the list is kept.

### The deletion RPC

`delete_trip_if_dependencies_match(p_trip_id text, p_expenses int, p_packing_items int,
p_participants int, p_documents int) → jsonb` — `SECURITY DEFINER`, `search_path = public, pg_temp`,
`EXECUTE` for `authenticated` only.

| Answer | Meaning |
| --- | --- |
| `{"status":"deleted"}` | Caller owns the trip, the counts matched, the trip row was deleted in that transaction |
| `{"status":"changed","expenses":n,"packing_items":n,"participants":n,"documents":n}` | Counts differ; **nothing deleted**; these are the fresh counts |
| `{"status":"not-owner"}` | Accepted participant |
| `{"status":"not-found"}` | Missing, pending, or unrelated — one answer, as in the preview |
| error `not_authenticated` | No session |

Ownership is proved before the row is locked; then `FOR UPDATE`, recount, compare, delete. A child
insert needs a key-share lock on the trip row for its foreign key, which conflicts with `FOR
UPDATE`, so none can commit between the recount and the delete. A missing or NULL count never
matches. `trip_deletion_preview` remains the initial read.

## Client design

| Piece | Where |
| --- | --- |
| Trip rules (destination, strict dates) | `utils/trip/tripDomain.ts` — pure |
| Preview, delete, link/unlink/list links | `utils/trip/tripRemote.ts` — no logging, typed reasons |
| Explicit legacy file move | `utils/trip/legacyTripDocuments.ts` — injected dependencies |
| Documents section | `components/TripDocumentsSection.tsx` |
| Delete flow | `components/TripDeleteFlow.tsx` |
| Document names for the picker | `core/documents/documentReferences.ts` (APP-057) — id, name, date only |
| Upload of a new file | `core/documents/documentSync.uploadDocument` (APP-055), unchanged |

`addTrip` returns `null` (and stores and sends nothing) unless the destination is non-empty and
both dates are valid and ordered. `updateTrip` returns `false` when a change would break a rule,
and lets an old trip without a destination stay that way while never letting one that has it lose
it. New trips are created with the trimmed destination.

**Ownership.** `Trip.ownerId` (optional, now in the encrypted APP-059 v1 payload) is `trips.user_id` as
the server said it: mapped on fetch for own and shared trips, recorded when the server accepts a
trip row under my id, and backfilled onto a legacy trip on the next fetch. `isOwner` is true only
when it equals the signed-in user. **Unknown means hidden**: while participant data loads, when it
failed, for a legacy trip not yet fetched, and for a participant, the Documents section, invite,
participant-remove and delete are not offered. Missing participant data never grants anything. The
deciding answer is still the server's — the preview says `not-owner` to an accepted participant,
and the delete is one server call that locks the trip row and deletes it only if the dependencies are
still the counts the user confirmed (see Deletion).

**Ordering.** All remote writes of one trip run in a per-trip in-memory lane
(`utils/trip/tripWriteLane.ts`): create, edits and delete in the order asked, a write waiting its
turn sends the latest state, and a delete waits for everything before it. Once a trip is deleted
or removed, a write still queued for it does not run and a fetch already in flight cannot bring it
back. The delete preview waits for the lane too. This is not the outbox: nothing survives a
restart and nothing is retried.

### Documents

- **Link a saved document** — a picker over the user's own document references (id, name, date).
  Empty is said as empty; a failed read is said as a failed read, with a retry; documents already
  linked are not offered again.
- **Add a file** — the picker copy is uploaded through `uploadDocument`, and only a document the
  server confirmed is linked. If the upload fails nothing is linked. If only the link fails, the
  message says the file is in Documents but not on the trip. The picker's temporary copy is
  deleted in every case.
- **Unlink** — removes the link row only.
- Owners only. A participant gets no section and no request.

### Legacy on-device files

Listed under "N files on this device only", each with "Save to Documents". Nothing moves at
startup, on upgrade or on opening the screen. The move is: resolve (decrypting a `.lsenc` to a
temporary copy) → upload the plaintext copy → server confirms → link → **then** remove the legacy
metadata and its encrypted file. The temporary copy is always deleted. The encrypted bytes are
never given to the uploader; a resolver answer that is still an encrypted path is treated as
unreadable. A failure at any step leaves the legacy file exactly where it was. After an upload
that succeeded but could not be linked, a retry only links (the uploaded id is held in memory);
if the app is closed first a later attempt uploads again and leaves a duplicate standalone
Document, which the user can delete. No reauthentication step is added: the file goes to the
user's own private bucket, not out of the app.

### Deletion

1. The owner taps Delete → the sheet asks the server what the trip owns.
2. It shows, under "In the cloud (counted by the server)", expenses, packing items, participants
   and invitations, and document links, each across every author; "the documents themselves are
   not deleted"; and, under its own heading, what **this device** will also lose — local expenses,
   packing items, invitations shown and legacy files — in this device's numbers. If the device
   holds more expenses or packing items than the server counts, it says some may exist only here
   and cannot be recovered. "0 expenses" is never shown next to an undisclosed local expense.
3. If the preview cannot be had it says so and offers a retry; it never shows zeroes.
4. Confirm → one server call, `delete_trip_if_dependencies_match`, given the very counts on screen.
   It deletes the trip row (and the database cascades every child and link) **only if** the four
   counts are still those. No client child deletes remain as cleanup. If they changed — a
   participant added an expense, another device linked a document — nothing is deleted, the sheet
   shows the fresh counts with a notice, and the user must press delete again; it is never
   repeated automatically.
   If the delete does not confirm, the server is asked again: the delete may have committed while
   its answer was lost. Only a definite "no such trip for you" is treated as done; a retry
   converges the same way without reopening the screen.
5. Only after the server reported the row deleted (or, per the above, confirmed it is gone): local trip, expenses, packing items,
   participants, legacy files, expense files and the reminder are cleared. On failure all of it
   stays and the user is told nothing changed.
6. A trip the server does not know (never synced, or access removed) can only be removed from
   *this device*, with no server call, after everything this device would lose is listed.

### Local persistence

No version bump and no local migration. `destination` is an optional field in the existing
encrypted v0 payload of `lifesort-trips`; older payloads hydrate without it (tested through the
real APP-029 adapter, including legacy ids and legacy files). `Trip.documents` keeps its key and
shape; `TripAttachment` is deleted and `Attachment` (with its optional `storagePath`) replaces it.

## Data classification and disclosure

- Trip core data (name, destination, dates): personal. Budget and expenses: financial.
- Linked documents: document-sensitive — the relation holds only ids, and does not make the linked
  document's Profile B metadata less sensitive; `travel.trips` stays Profile A, as warranties do.
- Legacy local trip files stay document-sensitive and encrypted on the device.
- The destination is text the user types. It is not device location and needs no location
  permission or SDK. No new SDK, vendor, permission or data category: the trip table was already
  disclosed as user content, and Documents' bucket is unchanged. The store-disclosure mapping is
  therefore unchanged; the privacy policy's description of trip data may want a sentence about the
  destination field.
- No destination, document name or count is logged.

## Scope boundaries kept

APP-059 (Economy bridge, MinorUnits, FX), APP-060 (packing templates), APP-079/080 (notifications;
the trip reminder still names the trip), APP-098 (module data deletion) and APP-107 (grant
hardening) are untouched. No Travel outbox, revision or tombstone. **There is no reservation
entity in the repository and none was invented;** when one exists it should be referenced from a
trip the way documents are.

## Test evidence (LOCAL)

| Suite | What it proves |
| --- | --- |
| `node --test tests/db/app058.test.cjs` — 53 tests | The documents history, APP-057, the remote-schema trip tables (statements lifted from the file) and the sharing-security migration, legacy data, then the exact APP-058 migration. Every baseline migration byte-identical; forward apply; legacy rows unchanged; **fail-closed** against four broken copies of the pre-migration database (counts only, nothing deleted); destination optional; date order incl. same day and leap day; stale-client upsert and its refused date order; children need a real trip, participant-authored children accepted, foreign trip refused, moving a row onto a foreign trip refused; participant owner-binding; link schema ids-only; link accept / duplicate / foreign document / foreign trip refused with identical errors; document delete keeps the trip, trip delete keeps the document (real APP-056 lifecycle); links invisible to participants and outsiders; owner CRUD, outsider blocked; **owner reads participant-authored rows, read-only**; pending sees nothing; colliding trip id and forged acceptance refused; helper unchanged (md5) and grants; preview counts and answers for owner / participant / pending / outsider / missing; participant and outsider cannot delete; owner delete leaves no child of any author; account deletion cascades a shared trip; no dangling references. Review #1 adds: the author preflight (a stranger and a never-accepted participant) with counts only; an accepted participant cannot insert an expense or packing row authored by the owner or by another accepted participant (pending and unrelated fail too; legitimate rows still work); the old participant INSERT policies are gone while content editing is kept; `id`, `user_id` and `trip_id` cannot change on any of the three tables, including a participant taking a trip over; and the compatibility buffer (below). Mutations — drop the owner SELECT policy, drop the write tightening, keep the old participant INSERT policies, drop the identity triggers — each fail the suite |
| Review #2 (DB suite) | the 500-row cap holds when two requests for **different** missing trips arrive together (real concurrent sessions: the excess one is refused, exactly 500 remain, no deadlock, another account is not held up); two accounts filling the buffer at once; expiry decided on the wall clock across a long transaction; `queued_at` is real queuing time; the deletion RPC — matching counts delete and cascade with the linked Document surviving, a participant-added expense / packing item / document link / invitation each yield `changed` with fresh counts and nothing deleted, then a second confirmation deletes; null and partial expectations never delete; participant gets `not-owner`, pending and stranger get the preview\'s `not-found` (identical for a missing id); anon and no-session refused; a child insert in flight is counted; **no child can commit between the locked recount and the delete**. Mutations — no account lock, `now()` in the adopter, `now()` as the default, no row lock, deleting without comparing — each fail a test |
| Compatibility buffer (DB suite) | packing first then trip → once, canonical; a whole default list as one batch and as separate requests → all exactly once, field for field; trip first → direct insert, buffer untouched; another account's queued rows never adopted and cleared; expired rows never adopted (and one just inside the window is); opportunistic per-account cleanup; retries and upserts never duplicate; a failed trip adopts nothing; adopted rows cascade with the trip; no client (authenticated or anon) can read or write the table or run its functions; expenses, missing sessions, other people's trips and forged authors are not buffered; the 500-row bound; account deletion clears it; **two real overlapping-session interleavings**. Mutations — no advisory locks, adopt without owner match, adopt without expiry, a `STABLE` ownership helper, no conflict handling, queue rows authored by others — each fail a test |
| `__tests__/tripDomain.test.ts` — 14 | Destination and strict date rules, same-day and leap day, timestamps and unpadded dates refused, no timezone dependence |
| `__tests__/tripStore.test.ts` — 23 | Creation rules, trip-before-packing sync order, packing withheld if the trip is refused, legacy edit rules, fetch mapping and unchanged merge, real-adapter legacy v0 hydration, encrypted round trip, delete failure keeps everything, confirmed delete clears everything, one server delete only |
| `__tests__/tripRemote.test.ts` — 27 | Preview decoding (nine malformed shapes are failures, never zero), delete confirmation, link API idempotence, ids only, no logging |
| `__tests__/tripLegacyDocuments.test.ts` — 14 | Order of operations, encrypted bytes never uploaded, every failure keeps the legacy copy, retry only links, no double upload, temporary copy always cleaned, plaintext legacy file never deleted, production defaults |
| `__tests__/tripDeleteRace.test.ts` — 18 | Controlled-promise ordering: create in flight → delete, update in flight → delete, strict order across several writes, latest state sent, a write queued behind a delete never recreates the trip, a queued write still goes out if the delete failed, a stale fetch cannot resurrect, a lost delete answer converges, no match is re-checked, an unanswerable check stays a failure, a retry converges, a missing session is not "gone". Without the lane five of these fail; without the re-check three do. Review #2 adds: a fetch already in flight that returns the trip **and its packing item, expense and invitation** after the delete brings none of them back; a `fetchParticipants` in flight at delete time does not repopulate; unrelated trips' late answers still apply; an ordinary fetch is unchanged; a `changed` answer deletes nothing, keeps every local trace and does not re-check. Without the child guards three fail |
| `__tests__/tripDocumentsUi.test.tsx` — 48 | Source-level boundaries, every section state, link / unlink / add-file flows, legacy display and move, destination display, **canonical ownership** (confirmed owner sees controls with participant data never answering; loading, failed, unknown-legacy, accepted-participant and signed-out all fail closed, including the delete button), preview counts / zero / fail-closed / non-owner / not-found / failure / success, the delete receives exactly the counts on screen, a **changed** answer shows the fresh counts with a notice and never deletes without a second press (and can change more than once), a server `not-owner` ends in the non-owner state, and **device-local impact** (server 0 with a local expense or packing item, not-found with local data listed before the remove button, no warning when the server already counts more, waits for the trip\'s writes) |

There is no GitHub CI evidence for this change and no Maestro or on-device harness in the repository.

## Old-client compatibility buffer (finding 5, option B — approved)

A pre-APP-058 client creates a trip by sending the trip row and its default packing list as two
concurrent requests. If the packing request commits first the trip does not exist, and the foreign
key refuses it — silently, since that client ignores the error. The canonical model is unchanged
(`trip_packing_items.trip_id → trips(id) ON DELETE CASCADE`); this adds a **temporary,
server-only side door** for that one race, only for packing items.

| Piece | Behaviour |
| --- | --- |
| `trip_packing_compat_queue(user_id, id, trip_id, label, checked, category, queued_at)` | Holds only what a replay needs. PK `(user_id, id)` — the canonical identity — so a retried request is set aside once. FK to `auth.users` `ON DELETE CASCADE`. RLS on, no policy, **no privilege for `anon`, `authenticated` or `PUBLIC`**. Never readable by a client |
| Router: `BEFORE INSERT` on `trip_packing_items` | Sets a row aside only if the inserter is authenticated, the row is **their own** (`user_id = auth.uid()`), and the trip **does not exist**; returns `NULL` so the statement succeeds. Otherwise does nothing — trip first means a direct canonical insert and the buffer is untouched |
| Adopter: `AFTER INSERT` on `trips` | Replays the owner's queued rows into `trip_packing_items` where `queued.trip_id = new.id AND queued.user_id = new.user_id` and inside the window, `ON CONFLICT (user_id, id) DO NOTHING`, then deletes every queue row for that trip id. Same transaction as the trip: if the trip fails, nothing is adopted |
| Window | `trip_packing_compat_window()` = **15 minutes**, measured on the **wall clock** (`clock_timestamp()`, also the default of `queued_at`) rather than the transaction's start, because the triggers can wait. A row older than that is never adopted |
| Size | At most 500 queued rows per account, enforced atomically (cleanup → count → insert under the account lock); beyond that the row falls through and is refused as before |
| Serialization | Both triggers take `pg_advisory_xact_lock` on the trip id, so overlapping requests are ordered instead of racing; the second waits only for the other's single statement (a deliberate wait — nothing sleeps or retries while holding a connection). To queue, the router then takes a second lock keyed by the account, so the 500-row cap is atomic. **Lock order: trip, then account.** |
| `trip_is_owned_by_caller(text)` | `VOLATILE`, `SECURITY DEFINER`, pinned `search_path`, `EXECUTE` for `authenticated`. Used by the own-row write policies so a row that waited for its trip's commit is judged with a fresh snapshot |

**Retention and cleanup.** There is no scheduler in the repository, and none is claimed. A row is
never *adopted* after 15 minutes regardless of whether it is still stored; an account's own expired
rows are deleted when it next sets an early row aside; all rows for a trip id go when that trip is
created; and everything an account queued cascades away with the account. A stale row for an
account that never does anything compatible again **can stay physically** until the account is
deleted. No client can read it.

**Not done, on purpose.** No buffer for expenses (only the initial packing list races); no general
outbox; no retries or sleeps; no placeholder trips; no relaxed RLS; no minimum-version platform.

**Side effect.** For an authenticated user a packing insert naming a trip that does not exist now
succeeds (and is set aside), where one naming another account's trip is refused. That reveals only
whether a trip id exists, which the unique index already reveals.

**Removal condition.** When pre-APP-058 clients are no longer supported, a forward-only migration
drops the two triggers, `trip_packing_route_early_row()`, `trip_packing_adopt_early_rows()`,
`trip_packing_compat_window()` and the table. Nothing canonical depends on them. The moment to do
so is for whatever introduces a minimum supported client version.

## Remote migration status

**NOT APPLIED.** `20260930141858_app058_trip_canonical_entity.sql` was exercised only against
disposable local PostgreSQL clusters. Neither Staging nor Production was contacted.

Rollout order: APP-055 → its hardening → APP-056 → **APP-057** (supplies `documents(user_id, id)`)
→ APP-058 → a client build containing APP-058. Do the read-only preflight first: the migration
stops on trips ending before they start, orphaned expense or packing rows, mismatched
participant rows, and rows with an unexplained author (which includes a removed participant's
legitimate rows). A client with APP-058 against a database without it cannot fetch trips.

## Known limitations and debt

- The compatibility buffer is temporary infrastructure, removable as described; until then a stale
  row for an account with no later compatible activity can stay in the table (unreadable) until the
  account is deleted.

- Travel sync is unchanged: append-only fetch, whole-record upserts, last write wins. A trip
  deleted on one device is not removed from another device that already holds it, and if that
  device then edits the trip its upsert writes the trip row back (without the children the
  cascade removed). This predates APP-058 and needs the sync stories.
- A participant toggling an owner's packing item still writes a row under their own id (the
  primary key includes the author) instead of updating the owner's.
- Trip reminders still put the trip's name in the notification title (APP-079/080).
- Budget and trip expenses are still floating-point DKK with no Economy link (APP-059).
- Packing lists are still defaulted or copied (APP-060).
- Trip-expense attachments remain local-only and are not part of this story.
- A retried legacy move after an app restart can leave a duplicate standalone Document.
- The trip has no per-participant "leave shared trip" action.
- Linked Documents cannot be opened from the trip screen; opening stays in the Documents module.
- No reservation entity exists.
