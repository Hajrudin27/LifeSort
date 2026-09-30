# ADR-0046: Trips are canonical parents and reference standalone documents

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-30 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-058 |
| **Superseded by** | – |

## Context

APP-058: *as a user I want to link budget, packing and documents to one trip*, with a
trip id and dates, references rather than duplicated blobs, and a deletion dependency
preview.

A trip was a row with children that merely named it. `trip_expenses` and
`trip_packing_items` carried a bare `trip_id`, `trip_participants` carried `trip_id` and
`owner_id`, and none had a foreign key. The client deleted a trip by removing the row and
then issuing three best-effort deletes filtered by the *deleter's* user id — which leaves
every row a participant wrote, and every row after a dropped request. Nothing stopped a
child from naming a trip that did not exist, or one that belonged to someone else. The
trip had no destination, no date order and no documents of its own: `Trip.documents` held
local encrypted files that never left the phone, under a `TripAttachment` type that
duplicated the canonical `Attachment` and lacked its `storagePath`.

Three things constrain the answer. `trips.id` is client-generated text that may be a
legacy timestamp string, and a global unique index on it exists because trip ids once
collided across users. `user_id` on the two child tables is the row's *author*, who may be
an accepted participant, not the owner. And the sharing policies
(`can_access_trip_row`, migration `20260906090000`) closed real cross-account
holes and must not be weakened. `docs/shared-primitives.md` §5 had planned to add
`'trip'` to `AttachmentOwnerType`; ADR-0043 had already said a document linked to a trip
is "a reference between two entities".

## Decision

**The trip row is the parent, and the database enforces it.** `trip_expenses.trip_id` and
`trip_packing_items.trip_id` reference `trips(id)` and `trip_participants(owner_id,
trip_id)` references `trips(user_id, id)`, all `ON DELETE CASCADE`. The child tables are
bound to the trip alone, not to `(author, trip)`, because the author is not the owner. The
participant table is bound to the pair, which the trip's primary key already expresses,
so a participant row cannot claim another owner's trip. Deleting the trip row removes every
child of every author. `trips.id` stays `text`; legacy ids are never rewritten.

**Fail closed.** The migration first counts trips that end before they start, children
naming no trip, participants whose owner does not match, and child rows whose **author** is
neither the trip's owner nor an accepted participant, and stops with those counts — never a
row, id or name — if any exist. It deletes and rewrites nothing to make a constraint fit.
Whoever applies it resolves the data first.

The author check is deliberately blunt. A participant who was later removed or who declined
leaves rows that are legitimate and yet look exactly like rows written under a forged
identity; nothing in the data tells them apart. The migration therefore will not launder
either into the canonical model — it stops and asks a person who can see the rows. On a real
database this may well stop it, and that is the intended outcome, not a defect.

**The trip gains a destination and an ordered date pair.** `destination text NULL`, no
default, no backfill, non-blank and at most 200 characters when present. `CHECK (start_date
<= end_date)`; a same-day trip is valid. The client requires a non-empty destination for
every trip it creates, validates both dates with `parseCalendarDate` (never `new
Date('YYYY-MM-DD')`), and lets an existing trip stay without a destination — but not lose
one it has.

**Writing a child row now requires a trip you may write to.** With no foreign key the
own-row INSERT and UPDATE policies could not tell a row for my trip from a row for anyone's;
now that a child must name a real trip they must also name one I own or am an accepted
participant of. Otherwise any account that learned a trip id — a pending invitee sees it —
could write into someone else's trip.

**`user_id` is the author, and it cannot be forged or changed.** Review found two holes that
the paragraph above did not close, because policies are OR-ed. The older participant INSERT
policies accepted `can_access_trip_row(trip_id, user_id)`, which also accepts the owner or
another accepted participant as the *author*, so an accepted participant could write a row
that looked like it was written by someone else. They were redundant — the own-row INSERT
policy already authorises an accepted participant's own row — so they are **dropped**, not
narrowed: one rule, not two OR-ed ones. And nothing stopped an UPDATE from rewriting a row's
identity. A `BEFORE UPDATE` trigger on `trips`, `trip_expenses` and `trip_packing_items` now
refuses any change to `id`, `user_id` or `trip_id` — for owner, participant and everyone else
— so no update can re-attribute a row, move it to another trip, or hand a trip to someone
else. Collaborative editing of a row's *content* (a participant may still update or delete
rows on a trip they belong to) is deliberately kept as it was. Grants are not touched.

**The owner reads what belongs to their trip through a plain SELECT policy, and
`can_access_trip_row` is not changed.** The gap was real: a participant-authored row was
invisible to the owner. The obvious fix — an owner branch in the helper — would also have
made it the WRITE authorisation for the participant policies, letting an owner stamp any
author id on a row and so write into another account's data. A separate read-only policy
gives the owner exactly the visibility required and nothing else; an owner still cannot
rewrite a participant's row. The helper, its `SECURITY DEFINER`, its pinned `search_path`
and its grants are byte-identical (checked by md5 in the DB suite).

**A TEMPORARY server-side buffer keeps old clients' initial packing list (option B, approved).**
Review found that a client built before APP-058 creates a trip by sending the trip row and its
default packing list as two concurrent requests, each its own transaction. If the packing
request commits first, the trip does not exist yet and the foreign key — correctly — refuses it,
silently, because that client ignores the error. The migration will exist before every installed
client has APP-058, so this could not be accepted as a limitation. The canonical model is
**unchanged**: `trip_packing_items.trip_id → trips(id) ON DELETE CASCADE` stays, and no placeholder
trip is ever created. What is added is a side door, not canonical Travel storage and not a general
queue:

- `trip_packing_compat_queue(user_id, id, trip_id, label, checked, category, queued_at)` — only
  what a replay needs. Its primary key is the canonical row's identity `(user_id, id)`, so an old
  client's retry sets the same row aside once. The author cascades from `auth.users`.
- A `BEFORE INSERT` trigger on `trip_packing_items` **routes** a row aside only when the inserter
  is authenticated, the row is **their own** (`NEW.user_id = auth.uid()`), and **the trip does not
  exist**. In every other case it does nothing, so when the trip exists the row goes straight into
  `trip_packing_items` and the buffer is not touched, and every other refusal — another account's
  row, a trip that exists but is not yours, no session, a full buffer — is still made by the
  policies and the foreign key, unchanged. The insert statement itself succeeds.
- An `AFTER INSERT` trigger on `trips` **adopts**: it replays the owner's queued rows into
  `trip_packing_items`, inside the trip's own transaction, only where
  `queued.trip_id = new.id AND queued.user_id = new.user_id` and the row is inside the window,
  with `ON CONFLICT (user_id, id) DO NOTHING`, then deletes every queue row for that trip id —
  adopted, expired, or set aside by someone who is not the owner (which can never be valid). If the
  trip insert fails, nothing commits; the rows simply wait out their window.
- The safety does not rest on a trip id being hard to guess. A queued row is adopted only by a
  trip created by the same account, and is otherwise never read by anyone.
- **Bounded window:** `trip_packing_compat_window()` is 15 minutes. An older row is never adopted.
- **Bounded size:** at most 500 queued rows per account; the 501st falls through to the foreign
  key and is refused. The bound is atomic: cleanup, count and insert happen under a second
  advisory lock keyed by the account, so two concurrent requests for *different* missing trips
  cannot both see 499.
- **Closed to clients:** RLS is enabled with no policy, and `anon`, `authenticated` and `PUBLIC`
  have no privilege on the table or on the three new functions. The two trigger functions are
  `SECURITY DEFINER` with a pinned `search_path` and every object schema-qualified.

**The two requests really do overlap, so the triggers serialize per trip.** Checking "does the
trip exist?" and "is anything set aside for it?" on either side of the other request's commit
would orphan a row set aside just after the adopter looked, or refuse one inserted just before
the trip committed. Both triggers therefore take the same `pg_advisory_xact_lock` keyed on the
trip id; whoever is second waits only for the other's own transaction (one statement), then sees
its result. This also needed the write policies to judge ownership with a fresh snapshot: a
`STABLE` function or inline subquery is judged by the snapshot the whole statement started with,
so a packing row that waited for its trip's commit would still have been refused for a trip that
plainly exists. The ownership test in the own-row INSERT and UPDATE policies is now a `VOLATILE`
`SECURITY DEFINER` helper, `trip_is_owned_by_caller(text)`, that answers only about the caller's
own ownership, with a pinned `search_path` and `EXECUTE` for `authenticated` only.

**Lock order is fixed: trip lock, then account lock.** The router takes the per-trip lock first,
and only when it is actually going to queue a row takes the per-account lock. The adopter holds a
trip lock while its inner canonical insert fires the router again; that re-entry is on the same
trip, finds the trip present and returns before it could reach the account lock, so nothing ever
takes an account lock and then a trip lock. Other accounts never contend on the account lock.

**Expiry is decided on the wall clock.** `now()` is the transaction's start time, and these
triggers can wait on a lock, so a transaction may be much older than the moment it decides. The
queue's `queued_at` defaults to `clock_timestamp()`, and both the cleanup and the adopter compare
against `clock_timestamp()`; `trip_packing_compat_window()` remains the interval contract. The
DB suite ages a row across a long transaction and fails if adoption regresses to transaction-start
time. A request may still wait briefly on another's advisory lock — that wait is deliberate — but
nothing sleeps or retries while holding a connection.

**Retention and cleanup — stated honestly.** There is no scheduler in this repository (the
account-deletion sweep for documents is a function with no job), and none is claimed. Cleanup is
therefore: a row is **never adopted** after 15 minutes, whether or not it is still physically
there; an account's own expired rows are deleted when that account next sets an early row aside;
all rows for a trip id are deleted when a trip with that id is created; and everything an account
has queued cascades away with the account. A stale row for an account with no later compatible
activity therefore **can remain physically** until that account is deleted. No client can read it.

**Removal condition.** Once pre-APP-058 clients are no longer supported, a forward-only migration
drops `trips_adopt_early_packing_rows`, `trip_packing_items_route_early_row`, the two functions,
`trip_packing_compat_window()` and `trip_packing_compat_queue`. The canonical tables do not depend
on any of them. Deciding when that is belongs to whatever establishes a minimum supported client
version, which this story does not build.

**One honest side effect.** For an authenticated user a packing insert naming a trip that does not
exist now succeeds (and is set aside) where one naming someone else's trip is refused, so the two
can be told apart. That reveals only whether a trip id exists — which a client can already learn
from the trip's unique index — and nothing about the trip.

**Trip documents are references to standalone Documents, not blobs.**
`trip_document_references(user_id, trip_id, document_id, created_at)`, primary key
`(user_id, trip_id, document_id)` so a duplicate link is impossible, with two owner-bound
composite foreign keys — `(user_id, trip_id) → trips(user_id, id)` and `(user_id,
document_id) → documents(user_id, id)` — both `ON DELETE CASCADE`. A trip and a document of
different accounts cannot be linked, and a foreign document id fails with the same error as a
missing one, so it is no existence oracle. Deleting a trip removes the link and keeps the
Document; deleting a Document (APP-056 finalize, or the account) removes the link and keeps
the trip. The table holds two ids and a time: no filename, storage path, URL or bytes.

It is **owner-only**. RLS allows SELECT, INSERT and DELETE on `user_id = auth.uid()` only;
`created_at` is the server's (INSERT is granted per column); there is no UPDATE; `anon` and
`PUBLIC` have nothing. Linking a document to a trip other people are invited to does not
share it, so a participant reads no link rows and cannot learn that a document exists. The
client renders the section only when it positively knows the viewer owns the trip.

`docs/shared-primitives.md`'s plan to add `'trip'` to `AttachmentOwnerType` is superseded
by this decision and says so in place.

**Travel reaches Documents through the boundary APP-057 made.** `core/documents/
documentReferences.ts` returns only `{ id, originalName, createdAt }`; Travel's link API
(`utils/trip/tripRemote.ts`) lives in the Travel domain, and core learns nothing of trips.
No Travel file imports `useDocumentsStore` (asserted by a source scan). A file added from a
trip is uploaded by the existing APP-055 `uploadDocument` first, as a standalone Document,
and only what the server confirmed is linked. Documents stays `internal`: listing one's own
metadata to choose from is not activating the module.

**Legacy on-device trip files are moved only on the user's explicit request.** They may be
real boarding passes; nothing is uploaded at startup or after upgrade, and none is discarded.
For one file, on request: resolve it through the existing attachment resolver (which decrypts
a `.lsenc` into a temporary plaintext copy) → upload that copy as a Document → server
confirms the row → link it → *only then* remove the legacy metadata and its encrypted file.
The temporary plaintext copy is deleted in every outcome, and encrypted bytes are refused
before they reach the uploader. If the upload succeeds and the link fails, the legacy copy
stays, the Document is not pretended away, and the uploaded id is remembered in memory so a
retry only links. If the app is closed first that memory is lost and a later attempt uploads
again: the cost is a duplicate standalone Document the user can delete, never a lost file.

**`TripAttachment` is deleted; `Attachment` is the one type.** The persisted key
`Trip.documents` and the shape of every stored object are unchanged (`storagePath` is
optional), so no local migration is needed. This is a type unification, not a change to
trip-expense attachments, which stay local-only.

**Deletion is previewed by the server, executed by the server, and cleared locally only
after.** `trip_deletion_preview(p_trip_id)` (`SECURITY DEFINER`, pinned `search_path`,
`authenticated` only) returns the owner the counts of expenses and packing items of every
author, participants and invitations, and document links. An accepted participant gets
`not-owner`; everyone else gets `not-found`, identical to an id that does not exist. The
client treats anything but a complete, well-formed answer as failure — never as zero — and
offers a retry. The delete is **one server call that deletes only what the user was shown**
(below); the database cascades the rest. Only then are the
local trip, its expenses, packing items, participants, legacy files, expense files and
reminder cleared. On any failure everything local stays and a safe message is shown. The copy
states that linked Documents are **not** deleted, and shows legacy on-device files as a
separate, device-local count.

**The delete deletes the dependencies the user confirmed, and nothing else.** The preview and
the delete are two requests, and in between a participant — or the owner's other device — can add
an expense, a packing item, an invitation or a document link, so a raw `DELETE` would cascade more
than was confirmed. `delete_trip_if_dependencies_match(trip, expenses, packing_items,
participants, documents)` is the destructive half. It authenticates with `auth.uid()`; proves
ownership *before* locking, so a non-owner can neither block the owner nor learn more than the
preview tells them; then locks the trip row `FOR UPDATE`, recounts the same four dependencies, and
compares them with the counts the user confirmed. If any differs it deletes **nothing** and returns
`changed` with the fresh counts; if they match it deletes the trip row in that same transaction and
returns `deleted`, and the cascades do the cleanup. `not-owner` (accepted participant) and
`not-found` (everyone else, exactly as the preview) are the other answers; a missing or NULL
expected count never matches. The row lock is what closes the gap: a child insert takes a
key-share lock on the trip row for its foreign key, which conflicts with `FOR UPDATE`, so one
already in flight finishes first and is counted, and one that arrives after waits and then fails
its foreign key. It is `SECURITY DEFINER` (the counts span every author) with a pinned
`search_path` and `EXECUTE` for `authenticated` only. The client passes the very counts on screen;
on `changed` the sheet shows the fresh counts with a notice and **requires a new press** — it never
deletes on the user's behalf after a changed preview. The ambiguous-response convergence is
unchanged: a failure or `not-found` is re-checked with the preview, and only a definite "no such
trip for you" counts as done. The owner's RLS policy still permits a direct `DELETE` of their own
trip (APP-107's to revisit), so a modified client can bypass this check for its own data; what it
protects is an honest client from a racing participant.

**A stale response cannot put a deleted trip's data back.** The "gone" mark that stops a stale
trip row now also stops stale packing items, expenses and invitations from a fetch already in
flight, and a `fetchParticipants` request that was out when the trip was deleted does not write.
Nothing else about the append-only merge changed.

**Deleting also clears what this device holds, and that is shown.** A write that failed or
never left the phone can leave an expense or a packing item only on the device, which the
server's count cannot include. The sheet therefore lists the device's own numbers — expenses,
packing items, invitations shown, legacy files — under their own heading, never mixed into the
server's, and says so plainly when the device holds more than the server counts, because that
data cannot be recovered. For a trip the server does not have, everything the device would
lose is listed before "Remove from this device" is offered. The server's counts are never
guessed and a failed preview is still fail-closed.

**Ownership is a positive fact.** `Trip.ownerId` (optional, inside the same encrypted v0
payload) is `trips.user_id` as the server said it: mapped when a trip is fetched — own and
shared — recorded when the server accepts a trip row under my id, and backfilled onto a legacy
trip on the next fetch without touching anything else about it. `isOwner` is true only when
`ownerId` equals the signed-in user. Unknown means hidden: while participant data loads, when
it failed, for a legacy trip not yet fetched, and for a participant, no Documents section,
invite, participant-remove or delete entry is offered. Missing participant data never grants
anything. This decides only what is shown; the server still refuses every owner-only action.

**A trip's remote writes are ordered, and a delete converges.** The trip row was written
fire-and-forget, so an earlier upsert could commit after a confirmed delete and put the trip
back. Every remote write of one trip now runs in a single in-memory lane, in the order asked,
and a delete waits for those before it. A write waiting its turn sends the latest local state
and does nothing if the trip has been deleted or removed meanwhile; if the delete failed, it
goes out as normal. The delete preview also waits for the lane, so a trip whose creation is on
its way is not reported as missing, and a fetch already in flight cannot bring a deleted trip
back. This is a lane, not the outbox: it lives in memory, retries nothing, and one failure
never blocks the next step. The server may commit a delete while the answer is lost, so a
delete that does not confirm is re-checked with the preview: only a definite "no such trip for
you" turns it into success and clears the device; still-there, not-yours or no answer stay
failures, and a retry converges the same way without reopening anything. One race remains: if
a request outlives the client's wait and lands later still, nothing on the client can order it.

A trip the server does not have (created offline and never synced, or the user was removed)
answers `not-found`; the only offer then is removing this device's copy, with no server call.

**The local persisted shape does not change.** `destination` is an optional field inside
the existing encrypted Zustand v0 payload of `lifesort-trips`; older payloads hydrate without
it, nothing is transformed, and there is no version bump. `travel.trips` stays Profile A: the
link relation is ids only, and the linked document's metadata stays Profile B in
`documents.files`.

**Sync is otherwise untouched.** No outbox, revisions, tombstones or wholesale fetch rewrite.
Narrow changes were forced by the foreign key and by review: a new trip's row is sent before
its packing list inside the trip's lane, the packing list is not sent if the server refused
the trip, and the delete and its follow-up checks described above.

## Consequences

**Compatibility with clients built before APP-058.** A legacy upsert names no destination and
keeps working. An old client that moves an end date before the start is now refused, and it
ignores the error, so that edit is silently not saved. An old client creating a trip fires the
trip and its packing list concurrently; if the packing request wins, the buffer above keeps those
rows and the trip adopts them, so that client keeps working unchanged for the initial packing
list. Old clients also cannot
write a child row for a trip they neither own nor participate in — which they never legitimately
did — nor under another author's identity. A client with APP-058 against a database without the migration fails its trip fetch (it
selects `destination`), so the rollout order is strict.

**Rollout order.** The migration needs `documents(user_id, id)` unique, which APP-057 added:
APP-055 → its hardening → APP-056 → APP-057 → **APP-058** → a client build containing APP-058.
Before applying, an operator should count the violation classes the migration checks
(read-only) — bad dates, children naming no trip, mismatched participants, and children with an
unexplained author — because a non-zero count stops it. Whether earlier migrations are applied to a
given environment is that environment's state and is not asserted here; APP-058 itself was
applied nowhere by this implementation.

**Cascades reach further than before.** Deleting a trip now removes rows authored by other
accounts. That is intended — they belong to the trip, and the preview counts them — but it
means an owner's deletion is visible to participants as their rows disappearing. Account
deletion cascades a whole shared trip the same way.

**Known debt.** The compatibility buffer is deliberate temporary debt, removable as above.
Otherwise: Warranty-style limits apply to Travel too: the fetch appends
unknown ids only and the upserts send whole records, so multi-device edits are last-write-wins.
A trip deleted on one device stays on another that already holds it, and if that device edits
it, its upsert writes the trip row back without the children the cascade removed. A participant's toggle of an owner's packing item creates a row under
the participant's id rather than updating the owner's (the primary key includes the author).
Trip reminders still name the trip in their title (`tripReminder.ts`); that belongs to
APP-079/080. Trip budget and expenses are still floating-point DKK, not `MinorUnits`
(APP-059). Packing lists are still copied or defaulted (APP-060). Trip-expense attachments
remain local-only. There is no reservation entity; when there is one, it should be referenced
the same way documents are.

## Alternatives considered

- **`attachments.owner_type = 'trip'` as the trip's document model** (the older plan).
  Rejected: it makes a trip the parent of a private blob with its own path convention, bucket
  entanglement and deletion debt, when a canonical standalone Document already exists with a
  reviewed delete lifecycle. A link is smaller and cannot dangle.
- **Copy filename, path or bytes into the trip.** Rejected: it duplicates Profile B metadata
  into a Profile A surface and goes stale the moment the document is deleted.
- **Import `useDocumentsStore` in Travel.** Rejected: rules R1/R3 exist to stop cross-module
  store coupling, and that store carries storage paths Travel has no use for.
- **Silently upload legacy files at startup or after upgrade.** Rejected: they may be the
  user's only copy of a boarding pass, an unattended upload can fail halfway, and a user
  should decide what leaves the device.
- **Delete the legacy copy after upload, and link later.** Rejected: an upload that succeeds
  while the link fails would leave a file in neither place the user expects.
- **Delete the standalone Documents with the trip.** Rejected: a Document is the user's own
  file with its own lifecycle; a trip may not destroy it.
- **Keep the client's manual child deletes as the canonical cleanup.** Rejected: they filter
  by the deleter's id so they miss participants' rows, and any dropped request leaves orphans.
  The foreign key cannot be dropped or forgotten.
- **Narrow the older participant INSERT policies instead of dropping them.** Rejected: they
  were redundant with the own-row policy, and two OR-ed rules are how the forgeable one
  survived review.
- **Treat the missing old-client packing list as an accepted limitation.** Rejected in review.
- **Roll out in a safe order and wait for old clients to disappear (option A).** Not taken: the
  repository has no minimum-version gate, and installed clients cannot be forced to update.
- **Drop the parent check on insert and cascade by trigger (option C).** Rejected: a child could
  then name a trip that never exists, weakening "no foreign trip relation is accepted".
- **Have the new client repair a missing list (option D).** Rejected: it does nothing for the old
  clients that cause the problem.
- **Let the packing insert wait or retry inside the database.** Rejected: it would hold a
  connection open for a request that may never be followed by its trip.
- **Create a placeholder trip.** Rejected: it would invent a parent the user never made.
- **Infer ownership from the absence of participant data.** Rejected: it exposed owner-only
  controls while that data was loading or had failed.
- **Give `can_access_trip_row` an owner branch.** Rejected: see the decision — it is also a
  write authorisation.
- **Reference `(user_id, trip_id)` from the two child tables.** Rejected: `user_id` there is
  the author, so an accepted participant's rows would be unreferenceable.
- **Convert every legacy trip id to a UUID.** Rejected: a primary-key rewrite across four
  tables and the local store, with no user or security value; ids stay opaque text.
- **Require the destination in the database.** Rejected: existing trips have none and none
  may be invented.
- **A soft fail on the preview (treat an error as an empty trip).** Rejected: the user would
  confirm a deletion they were never shown.
- **Implement the Economy bridge, packing templates, reminders privacy, a generic Travel
  outbox, or a reservation entity here.** Rejected: APP-059, APP-060, APP-079/080, the sync
  stories and a future reservation domain own them.
