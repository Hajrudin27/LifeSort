# ADR-0043: Standalone documents use a dedicated private storage boundary

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-25 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-055 |
| **Superseded by** | – |

## Context

Files already existed in LifeSort, but only ever as *attachments*: `public.attachments`
requires an `owner_type` of `warranty` or `expense` and an `owner_id` that names a
row in one of those domains. The bucket, the object path, the owner RLS and the
short-lived signed URL in `utils/shared/attachmentSync.ts` are audited and work,
but the data model underneath them assumes every file belongs to something else.

APP-055 asks for the opposite: a document the user keeps for its own sake. There
is no warranty and no expense behind it, and `AttachmentOwnerType` has no honest
value for it. The object path is also parent-shaped — `<user>/<type>/<owner>/<id>.<ext>`
— so a parentless file could only be given a placeholder owner id.

Document metadata is not neutral either. A filename alone can disclose a medical
result, a legal dispute or a salary, which puts the metadata in Profile B even
though the bytes never touch the device.

## Decision

- Standalone documents get their own metadata table `public.documents` and their
  own private Storage bucket `documents`. They are not modelled as attachments
  with a synthetic owner, and `AttachmentOwnerType` is not widened.
- The **security** properties of the attachment system are reused deliberately:
  a private bucket, an object name whose first folder is the owner's user id, RLS
  on both the row and the object, and a signed URL minted only at open time with
  a one-hour lifetime and a memory-only cache. The **data model** is not reused.
- A document's object path is `<userId>/<documentId>`, derived from two crypto
  UUIDs. The original filename is never part of it. A filename comes from the
  user — or on Android from another application — and the Storage policy reads
  ownership out of the object's first path segment, so a name containing `/` or
  `..` would be a way out of the uploader's own prefix.
- Identity and location are one fact, enforced by the database: a CHECK requires
  `storage_path = user_id::text || '/' || id::text`, and the path is unique. A row
  therefore cannot claim another user's object or an arbitrary one, and the read
  decoder recomputes the path from the row's own ids rather than trusting it.
- Upload writes the object first and the row second, because a row pointing at a
  missing object is a document the user can see and never open. If the row then
  fails, removal of the object just created is *attempted*. That compensation is
  upload atomicity; it is not the APP-056 delete cascade, and it is one of the
  two narrow lifecycle reasons a DELETE policy exists on the documents bucket —
  the other being whole-account cleanup, below. Neither is a user choosing a
  document to delete.
- That DELETE policy is scoped to what makes deletion safe rather than to
  ownership alone. "May delete my own objects" would let a modified client
  destroy the bytes of a stored document and leave its row behind — and worse, an
  insert can commit on the server while the client still sees an error, so a
  compensating client could delete a file its own row now claims. There are
  exactly two reasons an object may go:

  | State | Delete |
  | --- | --- |
  | own prefix, no row | allowed — failed-upload compensation |
  | own prefix, row, no release | **denied** — a stored document |
  | own prefix, row, release **within the window** | allowed — account cleanup |
  | own prefix, row, release **older than the window** | **denied** — a stored document again |
  | another user's prefix | denied, always |

  The check is a SECURITY DEFINER function so it does not depend on what the
  caller can see through the metadata table's own RLS, and it answers only for
  the caller's own prefix so it is not an oracle about anyone else. It takes a
  path as a *question*, never as authorization: the authorization is the release
  state on the row.

  So the policy has **two** legitimate reasons and no third — failed-upload
  compensation, and whole-account cleanup under a fresh authorized release.
  Neither is a user choosing a document; APP-056 still owns that.
- `created_at` is the server's. The column has a default, but a default only
  decides what happens when the client stays silent, so `authenticated` is
  granted INSERT on `(id, user_id, storage_path, original_name)` at column level
  and cannot supply a creation time at all.
- Account deletion marks its documents `account_deletion_released_at` through a
  SECURITY DEFINER function that takes no arguments and touches only
  `auth.uid()`'s own rows. It **releases without destroying**: the rows, and with
  them the canonical paths, stay until `auth.users` cascades them away.
- The release itself is **authorized by server-verified recent password
  authentication**, not by being signed in. A released document is a deletable
  document, so `authenticated` alone would let any session release the account,
  remove one object's bytes and stop — recreating the dangling row this whole
  policy exists to prevent. The password prompt on the deletion screen is UI and
  proves nothing to the database.

  The signal is Supabase Auth's `amr` claim, whose timestamps GoTrue mints from
  `auth.mfa_amr_claims` rows written at authentication events. Refreshing a token
  writes no such row, so refresh moves `iat` and leaves the `amr` timestamp
  alone — which is the whole reason this and not token freshness. The window is
  5 minutes, matching APP-024, and every unreadable or unexpected claim shape
  fails closed.

  It proves *recent password authentication*, not intent to delete an account,
  and is documented as that. The threat it removes is a session held by someone
  who never knew the password.
- The release is a **window, not a latch**. `public.document_release_window()`
  holds the one constant — **15 minutes** — and authorization compares the stored
  timestamp against it on the **database clock**; a client clock is an input, not
  a source of authority. Releasing, removing a few objects and calling
  `delete_my_account` is seconds of work, so a longer window would only widen the
  period in which an abandoned attempt leaves live documents deletable.

  Without an expiry the capability never ends: a deletion that fails, is
  cancelled or dies midway leaves the account alive with its rows still marked,
  and those documents would stay deletable forever. With it, an abandoned attempt
  re-protects its own documents by doing nothing. **No scheduler is involved** —
  expiry is a comparison made at authorization time, and a stale timestamp may
  sit in the row indefinitely because a stale timestamp grants nothing. Nothing
  clears it, because clearing it would be a write that buys nothing.
- Every call to the release sets a **fresh** timestamp, so a retry after the
  window has closed can open a new one. Idempotence here is semantic rather than
  literal: repeat it as often as you like and the answer is the same set of
  paths, each usable for the next short while.
- The manifest it returns is validated **all or nothing** by the client. One entry
  that is not a canonical path owned by the caller — foreign owner, extra segment,
  malformed UUID, non-string, or a duplicate of another entry — rejects the whole
  list rather than being filtered out of it.

  That is the retry-safety invariant, and it is the reason the marker exists at
  all: *if Storage deletion fails, canonical metadata and path information
  remains available so a later account-deletion attempt can retry the same
  object.* Deleting the rows first — which an earlier revision of this story did
  — destroys the only record of where the object is, so a failed Storage call
  strands the file permanently and the next attempt has nothing to rediscover it
  by.

  The release is account-wide, selects nothing, accepts no user id or path, is
  idempotent, and removes no metadata. It is not APP-056 deletion state and must
  not be reused as such.
- Nothing is recorded locally until the server confirms the row, and nothing is
  queued offline. Queuing would mean holding document bytes in plaintext until
  the network returned, and the APP-031 outbox does not own Profile B payloads.
- The picker's `copyToCacheDirectory` copy is temporary plaintext this app asked
  for. It is deleted when the upload attempt finishes, and only when the URI
  *canonically resolves* inside the app's own cache directory — decoded once,
  refused if decoding again would change it, and refused outright on any `..` or
  `.` segment or backslash. A shared string prefix is not containment, and an
  external provider URI is never deleted.
- The module ships as `internal`. APP-055 delivers storage, metadata and reads;
  APP-056 still owns deletion, and a domain a user can put a document into but
  not take one out of must not look finished.

## Consequences

Documents can be stored and read without inventing a parent, and the attachment
domain is untouched: no rows migrate, no paths change, no policy loosens. The
cost is a second private bucket, which means a second place a deleted account can
strand objects — so account deletion now sweeps both buckets, and a
`orphaned_document_paths` function mirrors the existing attachments sweep rather
than widening its signature and breaking the caller written against it.

Compensation is attempted, never promised. If the row did commit while the client
saw a failure, the policy refuses the removal and the document stays whole instead
of being reduced to a row pointing at nothing.

If the compensating removal itself fails, the object stays with no metadata row —
and the sweep does **not** cover that while the account exists, because it keys on
an owning prefix that no longer names an `auth.users` row, not on absent metadata.
Only once the account is gone does that prefix become discoverable. No scheduler
for documents is established in this repository either way. The user is told only
the fact that is certain — nothing was saved — and never that a remote object was
definitely deleted.

The document half of account deletion fails closed and stays retryable. A release
that did not answer is not an empty account, and a `.remove()` that resolved is
not a file that is gone, so either one stops the flow at the files stage with the
account, the rows and the paths all intact. The next attempt repeats the release —
which re-opens the window — receives the same paths and tries the same objects.

The lifecycle, end to end:

| | |
| --- | --- |
| a normal document | protected |
| account deletion starts | released, for 15 minutes |
| it succeeds | object removed, account removed, metadata cascades |
| it fails or is abandoned | the release expires; the document is protected again |
| the user retries | the release is refreshed; the same path is handed back |

The cross-system *sequence* is therefore not atomic and is not presented as such:
it is a sequence whose failures are recoverable by repeating it. The *manifest*
that drives it is the opposite — strictly all or nothing. The client validates
every path the release returns against the canonical form and rejects the entire
list on one bad entry, because a filtered manifest looks exactly like a complete
one: the flow would remove what it understood, conclude the cleanup was done and
destroy the account, stranding whatever the discarded entry described. An
unusable manifest stops the flow before any object is touched.

Both deletion surfaces carry this out: the native app and the APP-023 web page run
the same sequence, because the reason is the bucket's, not the client's. The web
page keeps a small local copy of the canonical-path check rather than importing
app code — it is a standalone static file, and duplicating one regex there is
cheaper than giving it a build step.

`orphaned_document_paths` remains a backstop for exceptional leftovers, and its
reach is narrower than "anything without metadata": it keys on an owning prefix
that no longer names an `auth.users` row, so it finds objects belonging to
accounts that are gone. An object left by a failed upload *whose compensation also
failed* is invisible to it while that account still exists — a stated limitation,
not a covered case. It is explicitly **not** what makes an immediately known
Storage failure acceptable, and the repository still contains no scheduler that
runs it.

Two file systems now exist side by side. That is accepted for now: merging them
would mean either giving attachments a standalone identity they do not need, or
giving documents a parent they do not have. If a document later needs to be
linked to a warranty or a trip, that is a reference between two entities, not a
reason to collapse the two models.

Because only metadata is cached locally, the document list requires a network
read to populate on a new device, and an offline user sees the last known list
without being able to open anything in it.

## Alternatives considered

- **Add `'document'` to `AttachmentOwnerType` and reuse `public.attachments`.**
  Rejected: `owner_id` would have to be a placeholder, `NOT NULL` would be
  satisfied by a lie, and every existing query that means "files belonging to this
  warranty" would need a new exception. The parent column would stop meaning
  anything.
- **Reuse the `attachments` bucket with a `<user>/document/<id>` prefix.**
  Rejected: it keeps the parent-shaped path convention for something with no
  parent, and it entangles the retention, quota and future lifecycle of two
  differently-owned kinds of file.
- **Put the original filename or its extension in the object name.**
  Rejected: the object name is the ownership evidence the Storage policy reads,
  and user-supplied text has no place in it. The extension buys a content-type
  hint that the metadata already carries.
- **Insert the metadata row first, then upload.** Rejected: the visible failure
  becomes a document that exists in the list and cannot be opened, which is worse
  than an upload that plainly failed.
- **Cache document bytes locally like attachments do.** Rejected: APP-029's
  encrypted cache exists because attachments are created on the device and shown
  before they reach the cloud. A standalone document is uploaded and then read on
  demand, so a local copy would add a sensitive plaintext surface for no gain.
- **Ship the module as `available`.** Rejected: ADR-0004 and APP-005 exist so a
  half-built domain does not look live. Without APP-056 the user cannot delete a
  document, and offering storage without deletion is not a finished promise.
- **Widen `orphaned_attachment_paths` to return a bucket column.** Rejected: the
  signature is the contract an operational sweep is written against, and changing
  it would break that caller silently rather than loudly.
- **Let an owner delete any object under their own prefix.** Rejected: it permits
  destroying a stored document's bytes while its row survives, and it turns an
  ambiguous insert result into a way to delete a file the server has already
  accepted.
- **Give account deletion a metadata DELETE policy instead of a function.**
  Rejected: a policy is reachable by any statement, so it would quietly hand
  APP-056's job to anything that could write SQL. A SECURITY DEFINER function
  scoped to `auth.uid()`'s own rows does only the one thing the lifecycle needs.
- **Have account deletion delete the metadata rows first, then the objects.**
  Rejected, and this was a real defect before it was: the row is the only record
  of where the object is, so a Storage failure after the row is gone strands the
  file with nothing left to find it by. The sweep would be covering damage the
  design chose to cause.
- **Let the release be per-document so APP-056 could reuse it.** Rejected: an
  account-wide marker cannot be aimed, which is most of why it is safe. A
  selective release would be a per-document delete capability by another name,
  and APP-056 owns that lifecycle including its own metadata cascade.
- **Widen the Storage DELETE policy back to own-prefix ownership for the
  deletion flow.** Rejected: that is the original blocker, and UI absence is not
  a security boundary.
- **Let `authenticated` call the release, since the deletion screen asks for the
  password first.** Rejected: the screen is not an authorization boundary. The
  RPC is reachable directly, and a caller who reached it could release, delete
  one document's bytes and stop.
- **Gate on a fresh `iat` instead.** Rejected: token refresh produces a new `iat`
  without anyone entering a password, so it measures token issuance, not
  authentication.
- **Have the client assert that it checked the password** — a flag, a nonce it
  minted, or a timestamp it supplied. Rejected: all of them are the client
  vouching for itself, which is what the gate exists to stop.
- **Also gate `delete_my_account`.** Rejected as out of scope: that is APP-022's
  pre-existing contract, and silently changing it inside APP-055 would conflate
  two authorizations. The gap is recorded instead.
- **Leave the release permanent until the account is actually deleted.**
  Rejected: an abandoned or failed deletion would then leave that account's
  documents deletable forever, so one interrupted attempt would permanently
  weaken the protection on files the user still owns.
- **Clear expired release timestamps with a job.** Rejected: an expired
  timestamp already grants nothing, so clearing it is a write that buys nothing —
  and it would mean adding a scheduler this repository does not have.
- **Preserve the first attempt's timestamp for literal idempotence.** Rejected:
  a user whose window had closed could then never re-authorize, and would be left
  unable to finish deleting their own account.
- **Rely on `created_at`'s default alone.** Rejected: a default is what happens
  when the client says nothing, not a rule about what the client may say.
- **Keep `ON CONFLICT DO NOTHING` for the bucket.** Rejected: an environment that
  already had a `documents` bucket would keep whatever settings it had, which is
  exactly how a public bucket survives the migration meant to make it private.
