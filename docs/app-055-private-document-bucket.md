# APP-055 — Private document bucket

**Story:** APP-055 (E6 · Documents, warranties, travel & home, P0)
**Owner:** Hajrudin Kardasevic
**Decision:** [ADR-0043](./adr/0043-standalone-documents-use-a-dedicated-private-storage-boundary.md)
**Enforced by:** `tests/db/app055.test.cjs`, `__tests__/documentContract.test.ts`,
`__tests__/documentUpload.test.ts`, `__tests__/documentLocalSecurity.test.ts`,
`__tests__/documentsModule.test.tsx`, `__tests__/documentAccountDeletion.test.ts`

## The story and its acceptance criteria

*As a user I want to store documents privately.*

| Criterion | Where it is met |
| --- | --- |
| Private storage | Bucket `documents`, `public = false`, no public object URL, 25 MiB server-side ceiling |
| Owner RLS metadata | `public.documents` with RLS: own rows only for SELECT and INSERT; no anon grant at all |
| Signed short-lived reads | A signed URL minted at open time, one-hour expiry, memory-only cache, never persisted |
| Random object paths | `<userId>/<documentId>` from two crypto UUIDs; the filename is never in the path |

## Baseline and audit

The repository already had a working, audited file pipeline — private bucket,
user-prefixed paths, owner RLS, short-lived signed URLs, memory-only URL cache and
the APP-029 encrypted local cache. What it did not have was a file that belongs to
nobody but the user.

- `AttachmentOwnerType` is `'warranty' | 'expense'`. Nothing else.
- `public.attachments` requires `owner_type` and `owner_id` and checks the type.
- The object path is `<user>/<type>/<owner>/<id>.<ext>` — parent-shaped throughout.
- Trip documents are `TripAttachment`, local-only; they are never uploaded.
- There was no Documents module and no `/documents` route; `docs/app-inventory.md`
  listed `documents` under "spec modules with no implementation".

## The standalone boundary, and why it is not an attachment

Giving a standalone document a fake parent would mean a placeholder `owner_id`
satisfying a `NOT NULL` column with a value that means nothing, and every existing
"files for this warranty" query acquiring an exception. So APP-055 takes the
**security shape** of the attachment system and leaves its **data model** alone:

| Reused | Not reused |
| --- | --- |
| Private bucket, no public URL | `public.attachments` and its parent columns |
| `(storage.foldername(name))[1] = auth.uid()::text` ownership | The `<user>/<type>/<owner>/<id>.<ext>` path convention |
| Short-lived signed URL, memory-only cache | `AttachmentOwnerType` |
| The APP-029 encrypted metadata adapter | The APP-029 encrypted *file* cache |

Nothing in the attachment domain changed: no rows migrated, no paths moved, no
policy loosened, `AttachmentOwnerType` untouched.

## The canonical path

```
<userId>/<documentId>          e.g. 3f1b7c2e-…/a1b2c3d4-…
```

Both segments are crypto UUIDs (`core/ids.newEntityId()`, ADR-0025). The original
filename is **not** in the path and never shapes it. That is not tidiness: the
Storage policy reads ownership out of the object's first path segment, so a name
containing `/` or `..` would be a way out of the uploader's own prefix. There is
no extension either — it would only restate what the metadata already holds.

The database enforces that identity and location are the same fact:

```sql
CHECK (storage_path = user_id::text || '/' || id::text)
UNIQUE (storage_path)
```

so a row cannot claim another user's object or an arbitrary one. The read decoder
independently recomputes the path from the row's own `id` and `user_id` and rejects
any row that disagrees, rather than trusting the stored string.

## Metadata, RLS and grants

`public.documents` holds `id`, `user_id`, `storage_path`, `original_name`,
`created_at` and the account-lifecycle marker `account_deletion_released_at` —
and nothing else. No OCR, thumbnails, tags, categories, notes, parent references,
sharing or retention state. `created_at` defaults to `now()` on the server; the
client never supplies it. The marker is nullable, set only by the account-deletion
release described below, and unwritable by any client statement — `authenticated`
has no UPDATE grant and the column is absent from the INSERT column grant.

| Actor | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| Owner | own rows | own rows, canonical path, four columns only | – | – |
| Other authenticated user | no | no | – | – |
| anon | no grant at all | no grant at all | – | – |

The table-level grant is `SELECT` only; INSERT is granted **per column** on
`(id, user_id, storage_path, original_name)`. `created_at` has a server default,
but a default only decides what happens when the client stays silent — with a
table-level grant a modified client could simply send its own value and date a
document whenever it liked. With the column grant it cannot name the column at
all. An UPDATE or DELETE attempt is refused at the privilege layer rather than
quietly matching no rows.

There is no metadata DELETE policy because APP-056 owns the cascade, and an
unpaired metadata delete would strand the object it points at. Account deletion
does not need one either: the `user_id → auth.users ON DELETE CASCADE` foreign key
covers the cascade, and the account-lifecycle release below is a SECURITY DEFINER
function rather than a policy, so no ordinary statement can remove a row.

## Storage

Bucket `documents`: `public = false`, `file_size_limit` 25 MiB, no
`allowed_mime_types` (arbitrary document types are the point of the module). The
ceiling deliberately matches the attachments bucket set in `20260906190000`; this
is not a new upload scale.

The bucket row is written with `ON CONFLICT DO UPDATE`, not `DO NOTHING`. An
environment may already contain a bucket called `documents` with settings from
before this migration, and leaving them is exactly how a public bucket or a
missing size limit survives the thing meant to fix it. The invariants are
asserted, not merely proposed.

Three object policies, each scoped to `bucket_id = 'documents'` and the caller's
own prefix: INSERT, SELECT and DELETE. The DELETE policy has exactly two reasons
to say yes:

```
bucket_id = 'documents'
AND (storage.foldername(name))[1] = auth.uid()::text
AND public.document_object_is_deletable(name)
```

| State | Delete | Why |
| --- | --- | --- |
| own prefix, **no row** | allowed | failed-upload compensation |
| own prefix, row, **no release** | **denied** | a stored document |
| own prefix, row, release **within the window** | allowed | account cleanup |
| own prefix, row, release **older than the window** | **denied** | a stored document again |
| another user's prefix | denied | always, in every state |

The fourth row is the expiry. `public.document_release_window()` holds the single
constant — **15 minutes** — and the helper compares the stored timestamp against
it using `now()`, the **database clock**. A client clock is an input, never a
source of authority.

Ownership alone would be too wide. It would let a modified client destroy the
bytes of a document that is already stored, leaving its row pointing at nothing —
and worse, an insert can commit on the server while the client still sees an
error, so a compensating client could delete a file its own row now claims.

`document_object_is_deletable` runs SECURITY DEFINER so the answer does not depend
on what the caller can see through the metadata table's own RLS, and it returns
false for anything outside the caller's own prefix so it cannot be used as an
oracle for whether someone else has a document at a guessed path. It takes a path
as a *question*, never as authorization — the authorization is the release state
on the row.

There is no delete action in the UI.

## Upload, and the two failure orders

1. generate a document id, derive the path
2. validate the filename; reject an unusable one
3. reject a file over 25 MiB when the size is knowable, before reading bytes
4. upload with `upsert: false` — the identity is new, so an existing object is a collision
5. insert the metadata row and decode what the server returns
6. only then does the document exist in local state

| Failure | Response |
| --- | --- |
| Object upload fails | No row, no local record, retryable error. Nothing to compensate. |
| Metadata insert fails | Removal of the object just uploaded is *attempted*; explicit retryable error. Not APP-056 — upload atomicity. |
| Metadata succeeds, local write fails | The remote record is **not** destroyed. It is valid and the next fetch recovers it. |

Compensation is attempted, never promised. The server permits it only for an
object with no canonical `documents` row, so if the insert did commit while this
client saw a failure the removal is refused and the document stays whole rather
than becoming a row pointing at nothing.

**If the compensating removal itself fails**, the object stays in the bucket with
no metadata row and nothing in APP-055 cleans it up later. Be precise about why:
`orphaned_document_paths` finds objects whose owning prefix no longer names an
`auth.users` row, so while that account still exists it does **not** see this
object. It becomes discoverable only once the account is gone. That is a stated
limitation of this story, not something the sweep quietly handles.

The user is told only the fact that is certain — nothing was saved — never that a
remote object was definitely deleted, and never a path, object id, URL or internal
cleanup state.

Upload is online and authenticated. Offline shows a retryable state; nothing is
queued, because queuing would mean holding document bytes in plaintext until the
network returned, and the APP-031 outbox does not own Profile B payloads.

## The picker's temporary file

`copyToCacheDirectory: true` gives an app-owned copy in `FileSystem.cacheDirectory`.
That copy is temporary plaintext this app asked for, so it is deleted when the
upload attempt finishes, success or failure — and **only** when the URI canonically
resolves inside the app's own cache directory.

A string prefix is not containment: `file:///app/cache/../documents/x` starts with
the cache directory and is not in it, and the same trick survives percent encoding,
double encoding and backslashes. So the URI is decoded once, refused if decoding it
again would change it (that is a double-encoded payload, not a filename), refused
on any backslash or NUL, and refused outright if any segment is `..` or `.` — a
file the picker copied into our cache never has one. Containment is then tested
against the cache root **with its trailing separator**, so `/app/cache-evil/` does
not match. No Node `path`/`url` module is imported; this runs on the device.

A `content://` provider URI or a path in the user's own storage is a file we were
lent, and is never deleted. No persistent plaintext copy is written, and no second
encryption implementation was added.

## Local persistence — Profile B

`lifesort-documents` holds metadata only, through the APP-029
`documentMetadataEncryptedStorage` adapter. A filename alone can disclose a medical
result or a legal dispute, so this is Profile B and plain AsyncStorage is not an
option. The raw stored bytes contain no filename, path, user id or timestamp — the
test reads them and checks.

Never persisted: document bytes, signed URLs, the picker's temporary URI, blobs.

There is no historical `lifesort-documents` key, so the surface is born encrypted.
That is enforced, not just asserted: the adapter asks two separate questions. One
recognises the *shape* of an already-authenticated payload; the other asks whether
raw plaintext under a key is a known historical payload eligible for in-place
upgrade, and answers yes only for the closed set
`lifesort-expenses`/`lifesort-warranties`/`lifesort-trips`. Raw plaintext under
`lifesort-documents` therefore fails closed with the existing protected-data error,
is left byte-for-byte on disk rather than being adopted into a fresh envelope, and
blocks subsequent writes. No legacy migration, no plaintext compatibility guessing,
and no version bump to any other store. It is registered in `core/storage/dataProfileRegistry.ts` as
domain `documents.files` over four physical surfaces — the AsyncStorage key, the
Supabase table, the Storage bucket and the SecureStore key. The picker's temporary
copy is transient interoperability data and is deliberately **not** registered as a
persistence surface.

## Module maturity — `internal`

`documents` is registered with `availability: 'internal'`, `sensitivity: ['document']`
and route root `/documents`. APP-055 delivers storage, metadata and reads; APP-056
still owns deletion, and a domain a user can put a document into but not take one
out of must not look production-ready. `ModuleGate` therefore covers `/documents`
for an ordinary viewer with the existing internal-only state — no special bypass,
and no weakening of the maturity evaluator. Data rights are unaffected
(ADR-0004): export and delete stay `true` in every maturity state.

## Logout and account switch

Logout resets the store, sweeps `lifesort-documents` by the `lifesort-` prefix
(ADR-0017), clears the documents signed-URL cache alongside the attachments one,
and destroys the shared document-cache key in the established order — so even
stale ciphertext left on disk cannot be read back by the next account.

## Account deletion

APP-022 promises deletion across the database and storage. Storage objects do not
cascade from `auth.users`, so a new bucket is a new way to make that promise false.
Two things close it:

- `core/auth/deleteAccount.ts` now removes objects from **both** buckets, before
  `delete_my_account`, while the session that owns them still exists.
- For documents that needs one extra step, because object removal is refused
  while an unreleased row points at the object. The flow calls
  `public.release_my_documents_for_account_deletion()` — a SECURITY DEFINER
  function that takes no arguments and touches only `auth.uid()`'s own rows. It
  sets `account_deletion_released_at` and returns every path the account still
  owns.
- The release is **temporary**. Authorization lasts 15 minutes from the
  timestamp, measured by the database; after that the ordinary protection returns
  on its own. Without an expiry, one failed or abandoned deletion attempt would
  leave that account's documents deletable forever, because the marker would
  survive as long as the account did.
- Expiry needs **no scheduler, job or worker**. It is a comparison made at
  authorization time. A stale timestamp may sit in the row indefinitely: it
  grants nothing, so clearing it would be a write that buys nothing.
- Every call sets a **fresh** timestamp, so a retry after the window has closed
  can open a new one. Idempotence is semantic rather than literal — repeat it and
  the answer is the same set of paths, each usable for the next short while.
- It **releases without destroying.** The rows stay. That is the retry-safety
  invariant of this story:

  > If Storage deletion fails, canonical metadata and path information remains
  > available so a later account-deletion attempt can retry the same object.

  It is stated because the alternative was tried and was wrong: deleting the rows
  during preparation removes the only record of where the object is, so a failed
  Storage call strands the file permanently and the next attempt has nothing to
  rediscover it by.
- **The release requires recent password authentication, verified by the server.**
  `authenticated` alone is not enough. A released document is a deletable
  document, so a session that merely exists could otherwise release the account,
  delete one object's bytes and stop — leaving exactly the dangling row the
  Storage policy was written to prevent. The password prompt on the deletion
  screen is UI; it proves nothing to the database.

  The gate reads Supabase Auth's `amr` claim. GoTrue records, per session, which
  method verified the identity and when — a row in `auth.mfa_amr_claims` written
  at each authentication event — and mints `amr` timestamps from those rows. A
  refresh writes no such row, so **refreshing a token moves `iat` and leaves the
  `amr` timestamp where it was**: a stolen session can keep itself alive forever
  and never pass. `public.document_release_reauth_window()` holds the constant —
  **5 minutes**, matching the APP-024 window the app already reasons in — and
  `public.has_recent_password_authentication()` fails closed on a missing claim,
  a non-array claim, the RFC-8176 string form a custom access-token hook may
  emit, a missing or non-numeric timestamp, and any method that is not
  `password`.

  **Read it honestly: this proves recent password authentication, not intent to
  delete the account.** Nothing available here can prove the second. What it
  removes is the case the Storage policy actually fears — a session held by
  someone who never knew the password. A refused release raises before any write,
  so no timestamp moves.
- The release is account-wide, selects nothing and accepts no user id or path. It
  is idempotent in what it *says* — the return is every owned path, so repeating
  it yields the same manifest — and deliberately not in the timestamp it sets,
  which moves forward on every call so a retry can re-open a closed window. It is
  an account-lifecycle primitive, not the APP-056 per-document cascade, and must
  not be reused as one.
- **The manifest is all or nothing.** The client validates every entry against the
  canonical `<userId>/<documentId>` form and rejects the whole list on a single
  bad one — a foreign owner, an extra segment, a malformed UUID, a non-string, or
  a duplicate. A filtered manifest is indistinguishable from a complete one: the
  flow would delete what it understood, conclude the cleanup was finished and
  destroy the account, leaving behind whatever the discarded entry described. At a
  boundary where the next step is irreversible, "most of the list" is not a usable
  answer, so an unusable manifest stops the flow at `failedAt: 'files'` before any
  object is touched.
- Both halves fail **closed** and stay retryable. A release that did not answer is
  not an empty account, and Supabase reports a refused `.remove()` in `error`
  rather than by throwing, so a resolved promise is not a removed file. Either
  failure stops at `failedAt: 'files'` with the account, the rows and the paths
  intact. `filesAlreadyDeleted` reflects confirmed removal only — never a
  successful preparation, a changed marker or a `.remove()` that was merely
  called.

**Both deletion surfaces do this.** The native app
([core/auth/deleteAccount.ts](../core/auth/deleteAccount.ts)) and the APP-023 web
page ([web/account-deletion/index.html](../web/account-deletion/index.html)) run
the identical sequence: password sign-in, release, all-or-nothing manifest
validation, `storage.from('documents').remove(...)`, confirm no error, and only
then `delete_my_account`. The web page needed it for the same reason the app did —
objects do not cascade with `auth.users`, and no scheduler for
`orphaned_document_paths` is established here, so deleting the account first would
strand the bytes with nothing left to find them by. The page keeps its own small
copy of the canonical-path check rather than importing app code; it is a
standalone static file with no build step.

**The lifecycle, in order:** release (marks, destroys nothing, starts a 15-minute
window) → remove objects → check the Storage result → `delete_my_account` → rows
disappear through `documents.user_id → auth.users ON DELETE CASCADE`. A failure at
any point before the last step leaves the whole thing repeatable.

**And the document's own lifecycle:**

| | |
| --- | --- |
| a normal document | protected |
| account deletion starts | released, for 15 minutes |
| it succeeds | object removed → account removed → metadata cascades |
| it fails or is abandoned | the release expires → the document is protected again |
| the user retries | the release is refreshed → the same path is handed back |

The client holds no part of this. It has no timer and no expiry logic; it calls
the release on **every** attempt rather than reusing a previous authorization,
and the database decides whether that authorization is current.
- `public.orphaned_document_paths(int)` mirrors `orphaned_attachment_paths`:
  service-role only, revoked from public/anon/authenticated, returning objects
  whose first path segment names a user who no longer exists.

`orphaned_attachment_paths` was deliberately **not** widened. Its signature is the
contract an operational sweep is written against, and changing it would break that
caller silently.

**What the sweep is and is not.** It covers exceptional leftovers — an abandoned
client, an account lost some other way. It is **not** what makes an immediately
known Storage failure acceptable: the normal account-deletion flow is retry-safe
on its own, and a failure there is meant to be retried, not handed to the sweep.
**Limitation, stated plainly:** the repository contains the function and this
documentation, not a scheduler. APP-055 does not invent a job that does not exist
here.

## Threat model

| Threat | Control |
| --- | --- |
| Cross-user metadata IDOR | RLS SELECT restricted to `auth.uid() = user_id`; proven by two-user reads, including a predicate-free listing |
| Cross-user Storage object access | Object policies compare `(storage.foldername(name))[1]` to `auth.uid()`; proven by two-user read, insert and delete |
| Destroying a stored document's bytes | DELETE has two reasons and no third: no row (failed-upload compensation), or a row carrying a fresh authorized account-deletion release. A stored, unreleased document is refused — proven by deleting the row and watching the same object become removable |
| Ambiguous insert result used to delete a committed file | Same control — a committed row makes the compensating delete impossible |
| Client-chosen creation time | Column-level INSERT grant excludes `created_at`; supplying it is refused at the privilege layer |
| Pre-existing misconfigured bucket | `ON CONFLICT DO UPDATE` asserts private/25 MiB/no MIME allowlist, proven against a bucket pre-created public, 500 MiB and MIME-restricted |
| Unexplained plaintext adopted as legacy data | The legacy-migration recognizer answers only for the three pre-encryption stores; plaintext under `lifesort-documents` fails closed and is left untouched |
| Account deleted while its documents are unreachable | Release and removal both fail closed at the files stage; `delete_my_account` is not called |
| A failed Storage removal stranding a file forever | The release destroys no metadata, so the canonical path survives and the next attempt rediscovers the same object |
| Account-deletion release reused as a per-document delete | Account-wide only, takes no arguments, removes no metadata; `authenticated` has no UPDATE grant so the marker cannot be set by a client statement |
| Direct RPC call from a modified client to make one document deletable | The release requires server-verified recent password authentication (`amr`), refuses before any write, and cannot be aimed at another account |
| Stolen session kept alive by token refresh | `amr` timestamps come from persisted authentication events, not from token issuance; refreshing moves only `iat` |
| Abandoned deletion leaving a permanent delete capability | The release expires after 15 minutes on the database clock; ordinary protection returns with nothing running, and a retry simply opens a new window |
| Foreign path used to probe another account's release state | `document_object_is_deletable` returns the constant `false` for any path outside the caller's prefix, whatever the real state is |
| Path traversal / prefix escape | Path built only from two validated UUIDs; the filename never enters it; non-UUID segments return `null` before any network call |
| Predictable object names | Crypto UUIDs (ADR-0025), no filename, no timestamp, no counter |
| Public bucket misconfiguration | `public = false` in the migration and asserted in the DB test; no public URL path exists in the client |
| Signed URL persistence / leakage | Minted at open time, one-hour expiry, memory-only cache, cleared on logout; never in the table, the store, AsyncStorage, the encrypted envelope, logs or analytics; the decoder refuses to promote any URL to identity |
| Oversized upload / storage abuse | 25 MiB server-side bucket limit as the authority, plus a client guard before the bytes are read and again once the real blob length is known |
| Metadata/object partial failure | Object first, row second, compensating object removal on row failure; no local record until the server confirms |
| Plaintext local cache exposure | No document bytes cached locally at all; the picker's temp copy is deleted after the attempt, and only when its URI canonically resolves inside our own cache directory — traversal, encoded traversal, double encoding, backslashes and prefix-sharing siblings are all refused |
| Account-switch metadata leakage | Prefix sweep, store reset, signed-URL cache cleared, encryption key destroyed |
| Account-delete Storage orphan | Both buckets swept before deletion; `orphaned_document_paths` as the service-role backstop |
| Malicious / active document content | No WebView, no HTML/SVG rendering, no preview generation. The file is handed to the OS through a signed URL |
| Untrusted content-type | Filename, extension and picker MIME are display/transport hints only; nothing is authorized on them |
| Logging sensitive values | No filename, path, URL, URI or bytes are logged; failures surface as typed reason codes |

**Not claimed:** there is no malware or virus scanning. That is outside APP-055.

## What APP-055 deliberately does not do

APP-056 owns the **user-facing per-document** delete cascade — choosing one
document and removing its metadata, its object and anything derived from it, with
a deletion preview and tombstones. There is no delete button, no rename, no OCR,
no thumbnails, no AI, no tags, no search indexing and no sharing here.

APP-055 does remove document objects, in exactly two situations, neither of which
is a user choosing a document:

1. **failed-upload compensation** — the object landed, the metadata row did not,
   so removal of that one object is attempted;
2. **whole-account deletion** — every object the account owns, after a
   server-authorized release, before `delete_my_account`.

Both are account-lifecycle, not document selection. Nothing here lets a user
delete one saved document.

## Remote migration status

`supabase/migrations/20260925090000_private_document_bucket.sql` is **additive and
not applied remotely.** It was exercised against a disposable local PostgreSQL
cluster only; no production or staging Supabase project was contacted.

Rollout order matters: the migration, the bucket and the policies must exist before
a client build that uses APP-055 can upload anything. The module staying `internal`
limits the exposure of that window until APP-056 completes the domain.

## Known limitations

- The module is `internal`, so an ordinary user cannot reach `/documents` yet.
- A user cannot delete a document. That is APP-056, and it is the reason for the
  maturity state.
- The document list needs a network read to populate on a new device; offline, the
  last known list is shown and nothing in it can be opened.
- Metadata is immutable: no rename, and no UPDATE policy exists.
- `release_my_documents_for_account_deletion()` is granted to `authenticated`, but
  being signed in is not enough to use it: it verifies **recent password
  authentication** server-side from the AMR claim, and an ordinary session without
  one is refused before anything is written. It is reachable outside the deletion
  screen, so the residual risk is this, stated plainly: after proving the account's
  password, a modified client can open the account-wide release and then choose
  which of *its own* released objects to delete before stopping, leaving those rows
  dangling. The 15-minute expiry bounds that capability, and it cannot be aimed at
  another account or at a document the caller does not own.

  This is **not purpose-bound authorization** — the server proves recent password
  authentication, never intent to delete an account, and the documentation does not
  claim otherwise. What it removes is the case the Storage policy actually fears: a
  session held by someone who never knew the password. A user removing their own
  files remains a right ADR-0004 states is never withdrawn.
- The release gate proves **recent password authentication**, not that the user
  asked to delete their account. An account owner who knows their own password
  and runs a modified client can still release and delete their own bytes; the
  boundary removes the attacker who holds a session but not the password.
- `delete_my_account` itself (APP-022, pre-existing) has no such recent-auth gate
  — it checks only `auth.uid()` and admin status. That is a separate, older
  contract and APP-055 deliberately does not redesign it. Noted so the two
  authorizations are not read as one.
- The APP-023 web deletion path now performs the same document cleanup (see
  below). Its own pre-existing omission of `attachments` cleanup is unchanged and
  recorded in [docs/account-deletion.md](./account-deletion.md).
- A deletion abandoned midway leaves its account's documents deletable by that
  account for the remainder of the window. That is the residual exposure, and it
  is bounded: after 15 minutes the ordinary protection returns without anything
  having to run. The stale timestamp itself is left in the row, because it grants
  nothing.
- Compensation after a failed metadata insert is an attempt, not a guarantee. A
  row that committed while the client saw a failure leaves the object in place by
  design — that case is correct.
- **A failed compensation on a live account leaves an object nothing currently
  finds.** If the upload's object landed, the metadata insert failed *and* the
  compensating removal also failed, the bucket holds a metadata-less object whose
  owner still exists. `orphaned_document_paths` keys on the owning prefix no
  longer naming an `auth.users` row, so it does not discover this one until that
  account is gone. Closing it would need a live-account sweep, which is new scope
  and deliberately not in APP-055.
- The orphan backstop is a function plus operational documentation. The
  repository establishes **no scheduler for `orphaned_document_paths`**, and none
  is claimed. (`orphaned_attachment_paths` has a daily sweep under the separate,
  pre-existing APP-022 operational contract; that is not evidence of one here.)
- The database tests reproduce Supabase's documented claim shape in a synthetic
  `auth.jwt()`, so they prove **this repository's SQL**, not GoTrue's behaviour.
  The GoTrue side is established by its source: AMR rows are written by
  `AddClaimToSession` at authentication events and read back by
  `CalculateAALAndAMR` when a token is minted, and the refresh grant writes
  none.
- Two file models now exist side by side (attachments and documents). That is the
  accepted cost of not giving either one a shape it does not have.
- The server enforces 25 MiB; the client guard is best-effort because a picker may
  not report a size, in which case the bucket limit is the only refusal.
