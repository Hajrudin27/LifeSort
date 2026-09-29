# APP-056 — Document delete cascade

**Story:** APP-056 (E6 · Documents, warranties, travel & home, P0)
**Owner:** Hajrudin Kardasevic
**Decision:** [ADR-0044](./adr/0044-per-document-deletion-uses-prepare-remove-finalize-with-retained-tombstones.md), extending [ADR-0043](./adr/0043-standalone-documents-use-a-dedicated-private-storage-boundary.md)
**Migration:** `supabase/migrations/20260927204302_app056_document_delete_cascade.sql`
**Enforced by:** `tests/db/app056.test.cjs`, `__tests__/documentDelete.test.ts`,
`__tests__/documentsModule.test.tsx`, `__tests__/reauth.test.ts`,
`__tests__/documentLocalSecurity.test.ts`, `__tests__/dataProfileRegistry.test.ts`

## The story and its acceptance criteria

*As a user I want to delete a file and all derived artifacts.*

| Criterion | Where it is met |
| --- | --- |
| Storage object deleted | The client removes the one canonical object through the Storage API inside a server-opened deletion window; `finalize_my_document_deletion` refuses to finish while `storage.objects` still has it, and the Storage INSERT policy keeps the path unclaimable by uploads before and after finalize commits |
| Metadata deleted | Finalize deletes the `public.documents` row — only after the object is confirmed absent, and in the same transaction as the tombstone |
| Derived OCR/thumbnail rows deleted | None exist in the repository (audit below). The forward contract makes any future derived artifact deletion-owned before it can ship |
| Tests prove no orphan | `tests/db/app056.test.cjs` asserts row = 0, object = 0, tombstone = 1 after a completed deletion, and that no tombstone anywhere has a surviving row or object |

## Baseline and audit

Implemented on `a3a3c71` (`fix: harden document function search paths`), on top of
the completed APP-055 foundation: `public.documents`, the private `documents`
bucket, the two-reason Storage DELETE policy and the account-deletion release.

The audit searched for OCR, thumbnails, derived documents, document previews,
document deletion, `deleted_at` and tombstones. **No document-derived persistence
exists:** no OCR table or text column, no thumbnail table or bucket prefix, no
preview generation, no derived Storage object. The only hits were APP-055's own
"no OCR, no thumbnails" statements, attachment-domain UI thumbnails that render in
memory (ADR-0024), and `user_modules.deleted_at` (APP-034). There is no table with
a foreign key to `public.documents`. APP-056 therefore invents no derived schema.

## The lifecycle

```
tap delete
  → confirmation: names the document, says it is permanent        (cancel → nothing)
  → APP-024 proof: biometrics / app-lock PIN / account password    (cancel → nothing)
  → begin_my_document_deletion(id)
        own row: deletion_requested_at = now(), return canonical path
  → client checks the path equals <session user>/<id>              (mismatch → stop)
  → storage.from('documents').remove([path])                       (result is advisory)
  → finalize_my_document_deletion(id)
        object still in storage.objects → 'object-present', nothing changes
        object absent → tombstone + row delete, one transaction → 'deleted'
  → local list and signed-URL cache entry updated only now
```

Nothing reaches the network before both the confirmation and the proof have said
yes. The row keeps its canonical path until the very last step, so any failure is
retried against the same object.

## Database contract

| Object | Kind | Contract |
| --- | --- | --- |
| `public.documents.deletion_requested_at` | nullable `timestamptz` | Set only by begin, on the caller's own row. No client INSERT/UPDATE/DELETE grant touches it |
| `public.document_delete_window()` | `IMMUTABLE` SQL, `search_path = pg_catalog` | `15 minutes`. Its own constant, not `document_release_window()`. No EXECUTE grant to `anon`/`authenticated` |
| `public.document_deletion_tombstones` | table | `(user_id, document_id)` primary key, `deleted_at` server default; FK to `auth.users` `ON DELETE CASCADE`, no FK to `documents`; RLS on, no policies, no grants to `anon`/`authenticated` |
| `public.refuse_deleted_document_id()` + `documents_refuse_deleted_id` | SECURITY DEFINER trigger, AFTER INSERT on `documents` | Refuses a row whose `(user_id, id)` has a tombstone, for every writer |
| `public.begin_my_document_deletion(uuid)` | SECURITY DEFINER, `search_path = pg_catalog, pg_temp` | `ready` + path (an active row, or a tombstoned id with anomalous bytes at its canonical path) / `already-deleted` (tombstone **and** no object) / `not-found`. EXECUTE: `authenticated` only |
| `public.finalize_my_document_deletion(uuid)` | SECURITY DEFINER, `search_path = pg_catalog, pg_temp` | `deleted` / `already-deleted` (tombstone **and** no object) / `object-present` (active row or tombstoned path) / `not-requested` / `not-found`. EXECUTE: `authenticated` only |
| `public.document_object_is_deletable(text)` | replaced | Adds the third reason; same search_path, grants and foreign-prefix behaviour |
| `public.release_my_documents_for_account_deletion()` | replaced | Returns only owned paths whose objects still exist — active rows' paths `UNION` the account's tombstone-derived paths; everything else unchanged |
| `public.document_object_is_insertable(text)` | SECURITY DEFINER, `STABLE`, `search_path = pg_catalog, pg_temp` | False when an active row or one of the caller's own tombstones claims the path; the constant `false` for a foreign prefix; true otherwise. EXECUTE: `authenticated` only, because the Storage policy evaluates it as that role |
| Storage policy `"Users can upload own documents"` | recreated, same name, `FOR INSERT TO authenticated` | `bucket_id = 'documents'`, own prefix, **and** `document_object_is_insertable(name)`. SELECT and DELETE policies unchanged; no UPDATE policy |

The Storage INSERT policy now reads:

| State | Upload | Why |
| --- | --- | --- |
| own prefix, no row, no tombstone | allowed | a fresh upload: object first, row second (APP-055) |
| own prefix, an active row claims the path | **denied** | whether or not its object is currently there |
| own prefix, an own tombstone claims the path | **denied** | a deleted document's path stays unclaimable |
| another user's prefix | denied | always; the helper answers the constant `false` |

It closes a race V2 left open: finalize checks that the object is absent, then
writes the tombstone and deletes the row, and an upload committing in between was
invisible to it. Finalize moves the claim from the row to the tombstone in one
transaction, so every concurrent upload sees one of the two, never neither.

The Storage DELETE policy now reads:

| State | Delete | Why |
| --- | --- | --- |
| own prefix, no row | allowed | failed-upload compensation (APP-055) |
| own prefix, row, fresh account-deletion release | allowed | account cleanup (APP-055) |
| own prefix, row, fresh per-document request | allowed | **APP-056** |
| own prefix, row, neither fresh (`NULL` or stale) | **denied** | a stored document |
| another user's prefix | denied | always; the helper answers the constant `false` |

## Failure matrix

| What happens | Server state afterwards | Client result | Retry |
| --- | --- | --- | --- |
| No session | untouched | `not-authenticated` | sign in |
| Begin fails or throws | row intact; a window may be open and expires | `delete-incomplete` | same action |
| Begin returns a path that is not `<user>/<id>` | row intact, object intact, window expires | `invalid-response` — Storage never called | same action |
| Begin: `not-found` | untouched | `not-found` | — |
| Begin: `already-deleted` | tombstone, no row, no object | success, no Storage call | — |
| An upload to the path while finalize is in flight | row (before) or tombstone (after) claims it | the upload is refused by RLS; finalize's `deleted` stays true | — |
| Anomalous bytes at a deleted document's path (pre-existing, operator-written or via a bypass — not creatable by ordinary clients) | tombstone, no row, object | begin `ready` + canonical path → remove (no-row reason) → finalize `already-deleted` → success | — |
| Same, but the removal fails | tombstone, no row, object | `delete-incomplete` (finalize `object-present`) | same action |
| Storage OK, finalize `deleted` | tombstone, no row, no object | success | — |
| Storage **throws**, object actually gone, finalize `deleted` | same | success | — |
| Storage **returns an error**, object actually gone, finalize `deleted` | same | success | — |
| Storage genuinely fails, finalize `object-present` | row and object intact | `delete-incomplete` | same action |
| Finalize answer lost after it committed | tombstone, no row, no object | `delete-incomplete` | begin answers `already-deleted` → success |
| Storage worked, app died before finalize | row, no object | — | begin opens a fresh window; finalize retires the row |
| Request expired before finalize | row; object may be gone | `delete-incomplete` (`not-requested`) | begin again |

Success is only ever `deleted` or `already-deleted` from the server. A Storage reply
never decides anything.

## Tombstones

Minimal deletion evidence: `user_id`, `document_id`, `deleted_at`. No filename,
path, MIME type, URL or content — it must not become a copy of the metadata the
user asked to delete. `deleted_at` is the server's default; no client role can
read or write the table.

Retention: as long as the account exists. Tombstones cascade with `auth.users`,
so account deletion removes them. No scheduler prunes them, and none is needed:
they are two ids and a time.

They exist for two reasons. First, "already deleted" becomes a fact the server can
state, so a retry after a lost answer settles to success instead of an error.
Second, resurrection control — below.

A tombstone is never the whole answer. `already-deleted`, from begin or finalize,
means a tombstone **and** no object at the canonical path `<auth.uid()>/<id>`,
which the server derives itself. A tombstone also keeps that path non-insertable, so
ordinary clients cannot put bytes back there. If anomalous bytes are nevertheless
found there, begin answers `ready` with that path, the owner removes them under the
existing no-row reason, and finalize answers `object-present` until they are gone —
defense in depth, kept deliberately.

## Stale clients and resurrection

A tombstoned id cannot be inserted again for that account, by any writer. The
check is an AFTER INSERT trigger because the obvious BEFORE trigger loses a race:
finalize writes the tombstone and deletes the row in one transaction, and a
concurrent insert that checked before that commit would wait on the primary key and
succeed the moment the delete committed. The AFTER trigger runs after that wait
and, under READ COMMITTED (every PostgREST request), sees the committed tombstone.

This was verified both ways during implementation: the committed test holds a
finalize open in one session, blocks a replayed insert in another, commits, and
asserts the insert is refused; a control run with a BEFORE trigger in its place
let the insert through and left an active row beside its tombstone.

There is no path by which the client itself recreates a document: uploads mint
fresh crypto UUIDs, there is no offline queue, and the local list is a cache that
never writes back. Stale encrypted metadata on a device is replaced by the next
successful fetch; opening a deleted document in the meantime fails, and deleting it
again resolves to `already-deleted`.

## Local state

- **No optimistic removal.** `useDocumentsStore.deleteDocument` keeps the record
  visible, sets `deletingId`, and removes it only after the server confirms
  `deleted` or `already-deleted`.
- **One deletion at a time.** A second request while `deletingId` is set is
  refused, not queued; the screen disables every delete control meanwhile.
- **Failures keep the record** and set `deleteError` to a typed reason.
- **Remote truth wins locally.** Once the server confirmed, a failing local write
  cannot turn the result back into "not deleted"; the next fetch reconciles the
  cache.
- **A refresh that overlapped a confirmed deletion is dropped.** A list read already
  in flight when the deletion was confirmed may predate it; applying it would show
  the deleted document again. A memory-only counter detects the overlap and the
  next read decides. Nothing about it is persisted.
- **Transient state is never persisted.** `partialize` still writes `documents[]`
  only; `deletingId` and `deleteError` stay in memory and are reset on logout. No
  local persisted schema changed, so there is no local migration or version bump.
- No bytes, paths beyond the existing record, signed URLs or tombstones are stored
  locally.

## Signed URL cache

The memory-only cache is keyed by storage path. After a server-confirmed `deleted`
or `already-deleted`, exactly that document's entry is dropped; other documents'
entries are untouched, and a failed deletion drops nothing. A signed URL that was
already handed out cannot be withdrawn — once the object is gone it simply stops
resolving.

## APP-024 gating

Per-document deletion is registered as `delete-document` in `SENSITIVE_ACTIONS` and
runs through the existing `useSensitiveAction` hook, after the explicit
confirmation. The proof is the local ladder APP-024 already uses — it answers the
unlocked-phone threat. No new server-side password requirement is added, and
`release_my_documents_for_account_deletion()` is not reused. Account deletion keeps
its server-verified recent-password (AMR) gate. `useSensitiveAction`'s behaviour did
not change.

## Account deletion compatibility

An APP-056 deletion interrupted after its object went leaves a row without an
object. The account release now:

- still refreshes `account_deletion_released_at` on **every** active owned row, that
  one included;
- returns only owned paths whose objects **still exist** in `storage.objects` —
  the ones that still need removal — where an owned path is an active row's path
  **or** the canonical path of one of the account's own tombstones, so anomalous
  bytes under a deleted document's path — not creatable by ordinary clients, but
  possible from history, an operator or a bypass — are removed with the account
  (the no-row reason already authorizes that removal). Defense in depth, kept
  deliberately. During the account cleanup itself, ordinary clients also cannot
  upload new bytes under any active or tombstoned canonical path;
- combines the two with `UNION`: both clients reject a manifest with a duplicate
  entry outright, so a path must appear once even if a row and a tombstone ever
  named it together;
- is otherwise APP-055's function: no arguments, `auth.uid()` only, recent password
  AMR required before any write, no metadata removed, rows and tombstones left for
  the cascade.

Every returned path — from an active row or from an owned tombstone — has the same
canonical `<user>/<uuid>` form, so the native and web all-or-nothing manifest checks
are unchanged and accept it; neither client changed. (With Supabase's `remove()`
reporting no error for an already-absent object, the old manifest would not have
failed outright either — but the flow no longer depends on that.)

If the function cannot see every row of `storage.objects`, it over-reports — every
active row's path and every tombstone-derived path: over-reporting costs a no-op
removal, under-reporting would strand bytes.

## Storage visibility precondition

Finalize's "the object is absent" is only a proof if its owner sees every
`storage.objects` row. Begin and finalize check `row_security_active` and refuse
with `document_storage_state_unverifiable` if RLS would apply to them. On Supabase
the migration owner bypasses RLS on `storage.objects` — the existing
`orphaned_*_paths` sweeps depend on the same — so this should never trigger.
**Rollout check:** on Staging, `select row_security_active('storage.objects');`
run as the role that owns the functions (the migration role, `postgres`) must
return `false`, and a begin/finalize round trip must succeed, before anything
relies on it. A read-only Staging preflight done by the reviewer before deployment
reported the migration role as `postgres`, the existing APP-055 SECURITY DEFINER
functions as owned by `postgres`, and `row_security_active('storage.objects')` as
`false` for it; this still has to be confirmed again once APP-056 is deployed.

## Derived-artifact forward contract

APP-056 deletes everything a document currently has. Any future derived artifact
must be deletion-owned **before its feature ships**:

- a derived table references `public.documents` with `ON DELETE CASCADE` where the
  semantics fit, so finalize's row delete takes it;
- a derived Storage object is added to this lifecycle — covered by begin's window
  and by finalize's absence check — before the feature that creates it is enabled.

The success invariant is:

> no active metadata row + no canonical document Storage object + no currently
> existing derived document artifact + exactly one minimal deletion tombstone.

## Threat model

| Threat | Control |
| --- | --- |
| Cross-user document IDOR | Begin/finalize take an id only; owner is `auth.uid()`; foreign ids answer `not-found`, identical to a missing id. Proven with two users |
| Direct metadata delete | No DELETE grant or policy on `documents`; refused at the privilege layer |
| Direct `deletion_requested_at` write | Not in the column INSERT grant; no UPDATE grant |
| Arbitrary-path Storage delete | Policy requires own prefix + a fresh window on that row's canonical path; the client refuses any begin path that is not `<user>/<id>` |
| Foreign-prefix probing | `document_object_is_deletable` returns the constant `false` for any foreign path, in every state |
| Stale deletion request | Window expires on the database clock; the object is protected again |
| Abandoned delete request | Same: nothing to clear, a stale timestamp grants nothing |
| Storage success + lost response | Finalize reads `storage.objects` itself and succeeds |
| Finalize success + lost response | Tombstone plus a confirmed-absent object makes the retry `already-deleted` |
| Upload to the canonical path while finalize is in flight (TOCTOU) | The INSERT policy refuses any path an active row or own tombstone claims; finalize swaps one claim for the other in one transaction, so no snapshot sees the path unclaimed. Tested with two sessions, before and after the commit; the same test fails against V2 |
| Re-upload to an active or deleted document's path | Refused by the INSERT claim check, object present or not (tested) |
| Anomalous bytes at a deleted document's path (history, operator, bypass) | Begin/finalize check the tombstoned canonical path in `storage.objects`; success waits until they are removed; the account release includes them (tested with privileged setup) |
| Copy/move into a claimed path | Copy is an INSERT and is refused; move and overwrite need an UPDATE policy, and the documents bucket has none |
| Concurrent finalizes | Row lock serializes them: one `deleted`, the other `already-deleted` (tested with two sessions) |
| Stale local encrypted metadata | A cache only; the next fetch replaces it; re-delete resolves `already-deleted` |
| A list refresh racing a deletion re-showing the document | A read that overlapped a confirmed deletion is not applied |
| Stale-client resurrection | AFTER INSERT tombstone check, race-safe under READ COMMITTED (tested with two sessions) |
| Account deletion during partial APP-056 state | Release returns only still-existing objects; all rows still released and cascaded |
| Tombstone tampering | RLS, no policies, no grants to `anon`/`authenticated`; `deleted_at` server default |
| Blind `storage.objects` read | Begin/finalize refuse under RLS; the release over-reports |
| Filename/path disclosure in logs or UI | No logging; confirmation names only the filename; ids, paths and URLs never reach the dialog, labels or results |
| Signed URL surviving deletion in the cache | That entry is dropped on confirmed deletion |
| Unlocked phone deleting a document | Confirmation + APP-024 proof before any network call |

**Residual, stated plainly:** a session token held off the device can delete that
account's documents one at a time, as it can any other owned data; APP-024 is a
device-level control.

The upload contract, current since V3:

- a normal first upload is allowed, before the metadata row exists;
- once an active document row exists, authenticated clients cannot INSERT its
  canonical path again;
- after deletion, the tombstone keeps that path non-insertable;
- therefore finalize's absence check remains true through its commit with respect
  to ordinary authenticated Storage INSERTs, and metadata resurrection remains
  impossible;
- tombstoned-object cleanup and the tombstone-derived account manifest remain as
  defense in depth for anomalous or pre-existing objects.

V2 handled bytes found at a tombstoned path on a later attempt; V3 closes the
concurrent insertion gap during finalize itself. The no-orphan success invariant
holds.

## Test evidence

| Suite | What it proves |
| --- | --- |
| `node --test tests/db/app056.test.cjs` — 40 tests | All three migrations applied in order to a scratch cluster: schema, grants and function owners, two users + anon, the Storage DELETE truth table, the Storage INSERT claim check (fresh path uploadable object-first/row-second, active-row path refused, tombstoned path refused, foreign prefix refused with a constant-false helper, anon refused), the exact documents-bucket policy set (INSERT, SELECT, three-reason DELETE, no UPDATE), finalize refusals and success, repeat safety, resurrection (two-session race), anomalous bytes at a tombstoned path seeded by privileged setup (begin `ready`, finalize `object-present` until removed, foreign account `not-found`), double finalize (two sessions), **upload vs open finalize (two sessions: refused before and after commit; ends row 0 / object 0 / tombstone 1)**, ambiguity and retry, the invariant guard, account-release regression including tombstone-derived paths and duplicate suppression, the storage-visibility guard via an RLS-bound owner, and the no-orphan assertion |
| `node --test tests/db/app055.test.cjs` — 30 tests | APP-055 still green against its own two migrations |
| `__tests__/documentDelete.test.ts` | The client lifecycle: gates, canonical path, every begin/Storage/finalize combination, lost-answer retry, signed-URL cache, no logging, no bypass |
| `__tests__/documentsModule.test.tsx` | The screen with the **real** APP-024 hook, the store semantics, DA/EN parity, and module maturity |
| `__tests__/reauth.test.ts` | `delete-document` is covered and the screen's destructive call sits inside the gate |

There is **no Maestro or on-device E2E harness** in this repository. Device-level
end-to-end coverage belongs to the later release/E2E story and is not claimed here.

## Module maturity

`documents` stays `internal`. The domain is now complete — a document can be put in
and taken out — but Production has not received the APP-055/APP-056 schema, and
making the module visible is its own activation gate. No `ModuleGate` bypass.

## Remote migration status

**NOT APPLIED.** `20260927204302_app056_document_delete_cascade.sql` was exercised
only against disposable local PostgreSQL clusters. Neither the Staging nor the
Production Supabase project was contacted. It must reach a database after both
APP-055 migrations, and before any client build that calls the two new functions.

## Not in scope

No OCR, thumbnails, AI, rename, sharing, search indexing, warranty or trip linking,
APP-098 work, or outbox integration.
