# ADR-0045: Warranty receipts are owner-bound document references, and the legacy columns keep their names

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-30 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-057 |
| **Superseded by** | – |

## Context

APP-057 asks that a user can track warranty expiry with purchase and coverage
dates, a receipt reference, seller and product, and reminders derived from
canonical dates. The specification adds that a warranty references its receipt
rather than duplicating the file.

The table already existed and was in use by installed clients:
`public.warranties (id text, user_id uuid, name text, type text, expiry_date date,
notes text, created_at timestamptz)`, primary key `(user_id, id)`, four owner RLS
policies. Every installed client selects and upserts those column names. Its reminder
text named the product on the lock screen, and it computed reminder days by parsing
`'YYYY-MM-DD'` with `new Date()`.

APP-055/APP-056 gave the user standalone private documents with their own table
(`public.documents`, primary key `id`, `user_id` owner), a private bucket and a
per-document delete lifecycle whose final step (`finalize_my_document_deletion`)
deletes the row. ADR-0043 anticipated this story: a warranty linking to a document
is a reference between two entities, not a reason to merge the file models.

The warranty's local store `lifesort-warranties` is a mixed Profile A/B surface
(records are A; the attachment metadata carried inside is B), which is why the
APP-031 plaintext outbox refuses it.

## Decision

**The legacy columns keep their names and gain their meaning.** `name` is the
product label; `expiry_date` is the canonical coverage-end calendar date and the
only input to reminders. Renaming either would break every installed client's
select and upsert at once. Column comments and the client type record the
semantics.

**Three nullable facts are added, with no defaults and no backfill:**
`purchase_date date`, `seller text`, `receipt_document_id uuid`. Existing rows never
recorded them, and nothing is invented for them.

**The dates are calendar dates, checked at both boundaries.** The client validates
both with the repository's one strict parser (`parseCalendarDate`); an impossible
day, a timestamp or an unpadded date is refused, never repaired. The database
enforces `CHECK (purchase_date IS NULL OR purchase_date <= expiry_date)`, and the
`date` type refuses impossible days by itself. The same calendar day is allowed.

**The receipt is an owner-bound reference, enforced by the database.** A composite
foreign key `(user_id, receipt_document_id) → public.documents (user_id, id)`,
MATCH SIMPLE, backed by a new `UNIQUE (user_id, id)` on `documents` (trivially
unique, since `id` is the primary key). Referential checks bypass RLS by design,
so the pair is the whole check: the warranty's own `user_id` — which RLS already
pins to `auth.uid()` — is the owner, and a document of any other account is simply
not present for it. A foreign document id is refused with the same words as a
missing one, so the constraint is not an existence oracle. A NULL reference is no
reference and is not checked.

**Deleting the document clears the reference and keeps the warranty.**
`ON DELETE SET NULL (receipt_document_id)` — the column-list form (PostgreSQL 15+;
the remote schema's `MAINTAIN` grants show the hosted database is 17+). A plain
composite `SET NULL` would also null `user_id`, which is `NOT NULL` and part of
the primary key, so every referenced document would become undeletable; a control
test reproduces that failure. `ON UPDATE NO ACTION`: document keys are immutable.
An index on `(user_id, receipt_document_id) WHERE receipt_document_id IS NOT NULL`
serves the delete action.

The reference is an id and nothing else. No blob, storage path, filename or signed
URL is copied into the warranty, locally or on the server.

**Warranties do not depend on the documents store.** A new core boundary,
`core/documents/documentReferences.ts`, reads this account's rows with `id,
user_id, original_name, created_at` — never `storage_path` — and returns
`{ id, originalName, createdAt }` built field by field, with `null` for a failed
read kept apart from `[]`. The one consumer is `components/WarrantyReceiptField`,
which holds the list in component memory only. Core does not know about
warranties. No warranty file imports `useDocumentsStore` or `documentSync`.

**Documents stays `internal`.** Listing the user's own document metadata to choose
a reference is not activating the module: nothing navigates to `/documents`, and
no upload is offered from the warranty. An account with no documents is told so.

**The legacy attachment model is separate and untouched.** Warranty `attachments`
(`public.attachments`, the `attachments` bucket, the APP-029 encrypted cache) keep
working exactly as before. None is migrated into Documents.

**Warranty sync is not moved to the outbox.** The existing fire-and-forget upsert
and merge-only fetch are preserved; the upsert and select name the three new
columns. One narrow addition is required by the new constraint: when an upsert is
refused by `warranties_receipt_document_fkey` (the referenced document no longer
exists for this account), the client clears that reference locally — only if it is
still the one held — and sends the warranty again without it, so the rest of the
edit is not lost. Any other failure changes nothing.

**Reminders derive from the coverage end in calendar days and say nothing
identifying.** 30, 7 and 1 days before, computed with `addDaysIso`, triggered at
09:00 built from the date's own local fields; a non-canonical coverage end
schedules nothing; past times are skipped. The title and body are generic ("A
warranty is expiring soon"); the scheduling function no longer takes the product
name, so it cannot put one on a lock screen. Rich, opt-in notification detail is
APP-079/080's.

**Reminders from earlier builds are replaced after upgrade, narrowly.** Earlier
builds put the product name in the title, and the OS keeps a scheduled
notification across an app update. `refreshWarrantyReminders` runs once the
encrypted local warranty list has hydrated for a signed-in user — an explicit root
layout effect, independent of the remote fetch, so it works offline. For every
local warranty it cancels the deterministic ids `warranty-<id>-<30|7|1>` (the only
scheme any build has used); cancelling needs no permission. It then reads the
permission with `getPermissionsAsync`, which never prompts, and only if it is
already granted schedules the generic reminders from the canonical coverage end.
It never calls `requestPermissionsAsync`, never throws, touches no other domain's
notifications and is idempotent. Warranty reminder operations share one
serialization lane, so a refresh cannot interleave with a user's edit or deletion
and leave a stale or orphaned reminder; the interactive permission request of a
user-initiated save stays outside that lane. This is not a notification platform
and does not implement APP-079/080.

**Local persistence gains optional fields inside inner Zustand v0.** Older
encrypted payloads hydrate with them absent. No version bump, no transform, no
change to the APP-029 adapter.

**`warranties.records` stays Profile A.** An opaque id and free-text seller are
record fields of the same kind as the existing notes; the document's Profile B
metadata stays in the documents domain.

## Consequences

Legacy and new clients coexist. A pre-APP-057 client's upsert names only the old
columns, and PostgREST's merge upsert updates only the columns in its payload, so it
preserves the new facts; a legacy insert leaves them NULL. The one thing a legacy
client can no longer do is move a coverage end before a purchase date it cannot
see: the CHECK refuses it, and that client ignores upsert errors, so its edit is
silently not saved.

Warranty sync keeps its known limits, now over three more fields. The fetch appends
unknown ids only, so a receipt linked on one device does not appear on another that
already holds the warranty; and the upsert sends the whole local record, so that
other device's next edit sends its own (absent) reference and clears the link. This
is the existing last-write-wins behaviour of every warranty field, not a new
mechanism. APP-057 does not claim offline retry, revisions or conflict handling for
warranties.

Document deletion now writes to `public.warranties` inside its own transaction: the
`SET NULL` action runs as the table owner and bypasses RLS, as referential actions
do. It was tested through the real APP-056 `finalize_my_document_deletion`, whose
pinned `search_path` does not affect it. Races settle without a dangling reference
in either order: a warranty write holding the reference makes finalize wait, then
the reference is cleared; a write racing an open finalize is refused once finalize
commits. Account deletion cascades both tables without the reference blocking it.

`public.documents` gains one constraint and its index. No APP-055/APP-056 policy,
grant, function, bucket or Storage policy changed; a before/after catalog
comparison proves it.

Reminders scheduled by an earlier build are replaced at the first start of this
build for each warranty in the local list. Where notification permission is not
granted, they are cancelled and nothing replaces them — which is correct, because
nothing could be shown. The refresh finds old schedules by the ids of warranties
the device still holds; a schedule whose warranty is no longer in the local list
(reachable today only through a backup restore that replaced the list) is not
found by it, and is removed at sign-out, which cancels every scheduled
notification.

Rollout order is strict. The migration needs APP-055/APP-056's `public.documents`;
a client build with APP-057 selects and upserts the new columns and would fail
every warranty fetch and upsert against a database without them. So: APP-055 → its
hardening → APP-056 → APP-057 → client build. As established project rollout
state before APP-057 — not re-verified by this implementation — APP-055, its
hardening and APP-056 are already applied to Production. APP-057's migration was
applied to neither Staging nor Production during this implementation.

The pre-existing warranty-attachment deletion debt is unchanged and recorded, not
solved: deleting a warranty removes its local attachment files, but the polymorphic
`public.attachments` rows (`owner_type = 'warranty'`) and their `attachments`-bucket
objects remain until account deletion.

## Alternatives considered

- **Rename `name`/`expiry_date` to `product`/`coverage_end_date`.** Rejected: every
  installed client's select and upsert would fail at once, and nothing about the
  data needs a new name.
- **A simple foreign key `receipt_document_id → documents(id)`.** Rejected: it would
  accept another account's document, and whether the insert succeeded would reveal
  whether that document exists.
- **A plain composite `ON DELETE SET NULL`.** Rejected, and shown by a control test:
  it nulls `user_id` as well, which is `NOT NULL` and in the primary key, so the
  document could never be deleted.
- **`ON DELETE CASCADE`.** Rejected: deleting a receipt would delete the warranty.
- **`ON DELETE RESTRICT`/`NO ACTION`.** Rejected: a warranty would block the user
  from deleting their own document, a data right APP-056 provides.
- **A trigger that checks ownership instead of a foreign key.** Rejected: the
  foreign key is declarative and race-safe through key-share locks; a hand-written
  check would have to reproduce that under concurrency, and ADR-0044 records how a
  plausible trigger lost exactly such a race.
- **Copy the filename or path into the warranty.** Rejected: it would duplicate
  Profile B metadata into a Profile A surface and go stale on deletion.
- **Let the warranty screens read `useDocumentsStore`.** Rejected: rules R1/R3 exist
  to stop cross-module store coupling, and the store carries storage paths the
  warranty has no use for.
- **Hide the receipt field unless the Documents module is accessible to the
  viewer.** Rejected: the viewer model has no internal users, so the field would be
  unreachable for everyone. Listing one's own metadata is not activating a module,
  and the empty state is stated honestly.
- **Move warranty records to the APP-031 outbox.** Rejected: the store is a mixed
  A/B surface and the plaintext outbox refuses it by design; weakening that gate or
  splitting the store is not this story.
- **Migrate warranty attachments into Documents.** Rejected: a separate model with
  its own table, bucket and debt; merging is not required by APP-057.
- **Keep the product name in reminders, or add a rich-copy preference now.**
  Rejected and deferred: the lock screen must not reveal a purchase by default, and
  the preference system is APP-079/080's.
- **Leave earlier builds' reminders until they fire, are rescheduled, or the user
  signs out.** Rejected in review: the product name would stay on the lock screen
  after an upgrade that promised generic text.
- **Request notification permission during the upgrade refresh.** Rejected: an app
  update is not a reason for a dialog. The refresh reads the permission and never
  asks.
- **Scan every scheduled notification for `warranty-` ids, including warranties no
  longer held locally.** Not taken: the refresh stays scoped to the local list, as
  the story's correction requires; sign-out still cancels everything.
