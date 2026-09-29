# ADR-0044: Per-document deletion uses prepare-remove-finalize with retained tombstones

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-27 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-056 |
| **Superseded by** | – |

## Context

ADR-0043 gave standalone documents their own private boundary and deliberately
gave the user no way to delete one. It left APP-056 a precise problem: a document
is two things in two systems — a metadata row in `public.documents` and an object
in the private `documents` bucket — and no single transaction spans both.

Whatever order they are removed in, something can fail in between:

- **Row first, object second.** A failed Storage call leaves bytes with no row. The
  row was the only record of where the object is, so nothing can find it again
  while the account exists (ADR-0043 records exactly this defect in an earlier
  account-deletion design).
- **Object first, row second.** A failure in between leaves a row pointing at
  nothing: a document the user can see and cannot open. That is recoverable only
  if something can finish the job later.

Two more facts shape the answer. Storage calls fail *ambiguously* from the client's
side: a removal can report an error and have worked, or throw after its request
already reached the server. And once a row is gone, "no row" means too many
things — deleted, never existed, someone else's — for a stale client or a retry to
tell apart.

The story's acceptance criteria are: the Storage object deleted, the metadata
deleted, derived OCR/thumbnail rows deleted, and tests that prove no orphan.

## Decision

**A two-phase lifecycle per document, with the server deciding each step:**

1. `begin_my_document_deletion(id)` sets `deletion_requested_at = now()` on the
   caller's own row and returns the canonical path. It takes the id and nothing
   else; the owner is `auth.uid()`. An id the caller does not own gets exactly the
   answer an id that does not exist gets (`not-found`), so it is not an ownership
   oracle. Nothing is deleted.
2. The client removes that one object through the Storage API, after checking the
   returned path against the one it derives from the session and the id.
3. `finalize_my_document_deletion(id)` locks the row, reads `storage.objects`
   itself, and **refuses while the object exists**. Once it is absent, it writes the
   tombstone and deletes the row in the same transaction. The client always calls
   finalize — whatever Storage reported — because finalize, not the Storage reply,
   is the authority.

Success is claimed only when finalize says `deleted`, or `already-deleted` when an
earlier attempt committed and its answer was lost. Every other outcome leaves the
row, and with it the canonical path, in place: running the lifecycle again is the
retry. `already-deleted` — from begin or finalize — means a tombstone **and** no
object at the canonical path; a tombstone alone is never reported as done.

**The Storage DELETE policy gains a third, reviewed reason.** ADR-0043's
`document_object_is_deletable` allowed exactly two: no row (failed-upload
compensation) and a fresh account-deletion release. It now also allows a row whose
`deletion_requested_at` is fresh. Everything else is unchanged — own prefix only,
the constant `false` for a foreign prefix, SECURITY DEFINER, a path taken as a
question rather than an authorization — and it is written so that `NULL` can only
refuse: a row blocks unless at least one comparison is actually true.

**The Storage INSERT policy refuses a path that is already claimed.** APP-055 let an
owner upload anything under their own prefix, which left finalize open to a
time-of-check/time-of-use race: finalize reads `storage.objects`, finds the
canonical object absent, writes the tombstone and deletes the row — and an upload
to the same path committing in between is invisible to it, because no row or gap
lock protects an object that does not exist yet. Finalize would then report
`deleted` over a stored object. The APP-055 policy is therefore replaced under the
same name — still `FOR INSERT TO authenticated`, still own prefix only — with one
more condition: `public.document_object_is_insertable(name)`, a SECURITY DEFINER
helper (`search_path = pg_catalog, pg_temp`) that is false when an active
`documents` row or one of the caller's own tombstones claims the path, and the
constant false for any foreign prefix. The ordinary upload is unaffected: it mints a
fresh id and uploads the object while no row or tombstone exists, then inserts the
row. The race closes because finalize moves the claim from the row to the tombstone
in one transaction, and a snapshot sees all of that commit or none of it: a
concurrent upload sees the row (before) or the tombstone (after), never neither.
Copying into the bucket goes through the same INSERT policy; moving or overwriting
an object would need an UPDATE policy, and the documents bucket has none. The SELECT
policy, the DELETE policy, the bucket and its size limit are unchanged.

**The request is a window, not a latch.** `document_delete_window()` is its own
15-minute constant — not a reuse of `document_release_window()`, because the two
capabilities have different authorization and should not change together.
Authorization compares against it on the database clock, so an abandoned request
re-protects its document with nothing running. Every begin sets a fresh
timestamp, so a retry after the window closed opens a new one.

**A minimal tombstone is retained.** `public.document_deletion_tombstones` holds
`user_id`, `document_id` and a server-set `deleted_at` — no filename, path, MIME
type, URL or content. It exists so that "already deleted" is a fact the server can
state — together with the canonical object being absent, never on its own — and so
the database can refuse a stale or modified client that writes the same id back.
For a tombstoned id, begin and finalize derive the canonical path from
`auth.uid()` and the id and check `storage.objects`: if anomalous bytes are there —
ordinary clients cannot put them there, but history, an operator or a bypass could —
begin answers `ready` with that path, the owner removes them under the existing
no-row reason, and finalize answers `object-present` until they are gone. This is
defense in depth, kept deliberately.
The refusal is an AFTER INSERT trigger on `public.documents`, not a
BEFORE one: finalize writes the tombstone and deletes the row in one transaction,
and a racing insert that checked BEFORE would look before that commit, then wait on
the primary key and succeed the moment the delete committed. The AFTER trigger
runs once that wait is over and, under READ COMMITTED, sees the committed
tombstone. A control run with a BEFORE trigger reproduced the resurrection; the
committed test proves the AFTER trigger refuses it. The tombstone is per account,
cascades with `auth.users`, has no foreign key to `public.documents` (it must
outlive the row), RLS with no policies, and no grant to `anon` or `authenticated`.

**Finalize only trusts a reading it can prove is complete.** "The object is
absent" is a proof only if the function's owner sees every row of
`storage.objects`. Both begin and finalize check `row_security_active` and refuse
(`document_storage_state_unverifiable`) if RLS would apply to them — begin so it
never opens a window that nothing could close. The account release instead
over-reports — every active row's path and every tombstone-derived path — because
over-reporting costs a no-op removal and under-reporting strands bytes. In a correctly configured Supabase
project the owning role bypasses RLS and none of this triggers; the existing
`orphaned_*_paths` sweeps already depend on the same fact.

**Account deletion tolerates a half-finished APP-056 deletion.** A deletion that
stopped after the object went and before finalize answered leaves a row with no
object. `release_my_documents_for_account_deletion()` still refreshes the release
on every active owned row, but now returns only the owned paths whose objects still
exist — the ones that still need removal. An owned path is an active row's path
**or** the canonical path of one of the account's own tombstones, so anomalous
bytes under a deleted document's path — not creatable by ordinary clients, but
possible by other routes — are removed with the account rather than stranded (defense
in depth); the two sets are combined with `UNION`, because both clients reject
a manifest containing a duplicate. Its authorization (recent password AMR), its
lack of arguments, its account-wide scope and the clients' all-or-nothing manifest
check are unchanged, and every returned path — from a row or from a tombstone — has
the same canonical `<user>/<uuid>` form. The native and web clients did not change.

**The client asks twice before anything reaches the server:** an explicit
confirmation that names the document and says the deletion is permanent, then the
APP-024 proof through the existing `useSensitiveAction` hook, registered as
`delete-document` (ADR-0018). The threat is the same unlocked phone that APP-024
answers, so it gets the same local proof. The server's own boundary for this
action is ownership of that one document through `auth.uid()`; no new server-side
password requirement is added, and account deletion keeps its stronger AMR gate.

**Deletion is online, direct and not queued.** No outbox, no offline queue. The
local encrypted list changes only after the server confirms, and the next
successful fetch remains authoritative for the cache — except a read that was
already in flight when a deletion was confirmed, which may predate it and is
therefore not applied.

**Derived artifacts are a forward contract, not invented schema.** There are no
OCR, thumbnail or other derived-document tables or objects in the repository
today, so APP-056 creates none in order to delete them. A future derived table must
reference `public.documents` with `ON DELETE CASCADE` where that fits, and a future
derived Storage object must join this lifecycle — begin's window, finalize's
absence check — before its feature may ship. The success invariant is:

> no active metadata row + no canonical Storage object + no existing derived
> artifact + exactly one minimal tombstone.

The module stays `internal`: the domain is complete, but Production has not
received the schema, and activation is a separate gate.

## Consequences

The lifecycle is not atomic across the two systems and is not presented as such.
It is a sequence whose every interruption is recoverable by repeating it:

| Interrupted | State | The next attempt |
| --- | --- | --- |
| before begin answers | row intact; window maybe open | begin again |
| after begin, Storage fails | row and object intact; window expires | begin again |
| Storage worked, finalize never ran | row, no object | begin again, finalize retires the row |
| finalize committed, answer lost | tombstone, no row, no object | begin says `already-deleted` |
| anomalous bytes at a deleted path (not client-creatable) | tombstone, no row, object | begin says `ready`; remove; finalize says `already-deleted` |

The one state a user can see between attempts is the third: a listed document that
no longer opens. It is bounded — the same delete action finishes it — and it is
the state ADR-0043's ordering chose over its opposite, stranded bytes nobody can
find.

A deleted id can never be reused by the same account, and neither can its path.
Uploads mint fresh crypto UUIDs, so this costs nothing. The upload contract is:

- a normal first upload is allowed, before the metadata row exists;
- once an active row exists, authenticated clients cannot INSERT its canonical path
  again — whether or not the object is currently there;
- after deletion, the tombstone keeps that path non-insertable;
- so finalize's absence check stays true through its commit with respect to ordinary
  authenticated Storage INSERTs;
- metadata resurrection remains impossible (the AFTER INSERT trigger).

Bytes at a tombstoned path can therefore only come from outside that contract —
objects written before this policy existed, an operator, or a path that bypasses
RLS. For those, a subsequent delete of the id cleans them before it reports success,
and account deletion includes owned tombstone-derived paths. The no-orphan success
invariant holds.

This was corrected in two steps during review. The second revision handled bytes
found at a tombstoned path on a *later* attempt; it did not stop an upload landing
*during* a finalize that had already checked. The third revision closed that
concurrent insertion gap with the INSERT claim check, proven by a two-session test
that holds finalize open, is refused an upload before and after its commit, and
ends with no row, no object and one tombstone. The same test fails against the
second revision.

The resurrection trigger's race guarantee holds for READ COMMITTED, which is what
every PostgREST request runs. A direct database session at REPEATABLE READ or
SERIALIZABLE is not a client path and is not covered by that argument. The INSERT
claim check does not depend on isolation level: any snapshot sees finalize's commit
entirely or not at all, so it sees the row or the tombstone.

A session token held off the device can delete that account's documents one at a
time, just as it can delete any other data the account owns. APP-024 is a
device-level control (ADR-0007, ADR-0020); the server boundary is ownership. That
is the accepted cost of not demanding the account password per document.

Tombstones live as long as the account and cascade with it. They are pseudonymous
per-account records — two ids and a time — and carry nothing about what the
document was.

ADR-0043 is extended, not superseded: its boundary, its path invariant, its upload
ordering and its account-deletion release all stand. What changed is the third
DELETE reason and the release's manifest, both reviewed here.

## Alternatives considered

- **A metadata DELETE policy or grant, with the client deleting the row.**
  Rejected: a policy is reachable by any statement, so a client could remove the
  row and leave the bytes — the stranded-object defect ADR-0043 records. The row is
  retired only by finalize, only once the object is gone.
- **Widen Storage DELETE to "anything under my own prefix".** Rejected: that is the
  original APP-055 blocker. A modified client could destroy a stored document's
  bytes and leave its row dangling, with no window and no record of intent.
- **A single RPC that deletes the row and the object together.** Rejected: Storage
  bytes are removed through the Storage API, not by SQL (the repository recorded
  `storage.protect_delete` refusing SQL deletion in `20260907090000`), so such a
  function would delete the row and trust something else to remove the object.
- **Row first, then object.** Rejected for the same reason as in ADR-0043: a Storage
  failure after the row is gone strands the file with nothing left to find it by.
- **Trust the client's Storage result to decide success.** Rejected: the result is
  ambiguous both ways. Finalize reads `storage.objects` itself.
- **Reuse `release_my_documents_for_account_deletion()` or its window for one
  document.** Rejected: it is account-wide by design, authorized by recent password
  authentication, and ADR-0043 explicitly forbids aiming it. A per-document release
  is a different capability with its own column and constant.
- **A permanent deletion flag.** Rejected: an abandoned request would leave a live
  document deletable forever. The window expires on the database clock.
- **No tombstone — treat "no row" as "deleted".** Rejected: absence is ambiguous,
  so a retry after a lost answer would read as an error, and nothing would stop a
  stale client writing the id back.
- **Answer `already-deleted` from the tombstone alone.** Rejected — and it was the
  first revision's behaviour: bytes found at a deleted path would then be reported
  as deleted while still stored, and an account release built from rows alone
  would strand them. Both answers now also require the canonical object to be
  absent, and the release includes tombstone-derived paths.
- **Leave Storage INSERT as own-prefix only and rely on the retry check.** Rejected
  — the second revision's behaviour: an upload committing between finalize's
  absence check and its commit is invisible to finalize, which would then report
  `deleted` over a stored object. Only a claim-aware INSERT policy closes it.
- **Serialize finalize and uploads with a lock instead.** Rejected: the upload is
  the Storage API's statement, not ours, so there is no place to take a matching
  lock; the policy's MVCC view of the row-then-tombstone claim needs none.
- **A richer tombstone with the filename or path.** Rejected: it would keep a copy
  of exactly the metadata the user asked to delete. The path is recomputable from
  the two ids and nothing needs it.
- **A BEFORE INSERT resurrection check.** Rejected after testing: it loses the race
  with a concurrent finalize, as the control run showed.
- **Assume the function owner can see every `storage.objects` row.** Rejected: a
  blind "absent" would let finalize retire rows whose bytes still exist. Begin and
  finalize check and refuse; the release over-reports instead.
- **Create OCR or thumbnail tables now so the cascade has something to delete.**
  Rejected: inventing schema to satisfy a criterion is architecture theatre. The
  forward contract above binds the feature that eventually adds them.
- **Queue deletions in the APP-031 outbox for offline use.** Rejected: a queued
  destructive write would run later against state the user can no longer see, and
  the outbox does not own Profile B payloads.
- **Optimistic local removal.** Rejected: the list would claim a deletion the
  server had not made, and a failure would have to resurrect the row locally.
- **Require the account password (server-verified AMR) per document.** Rejected:
  it is the wrong factor for the local threat ADR-0018 answers, it needs a network
  sign-in per deletion, and the account-deletion AMR gate exists because that
  release is account-wide. Per-document deletion is scoped to one owned document.
- **No confirmation, re-authentication alone — or the reverse.** Rejected: the
  confirmation guards against a mistaken tap by the owner; the proof guards against
  a phone in someone else's hand. They answer different mistakes.
