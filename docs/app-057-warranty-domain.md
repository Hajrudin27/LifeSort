# APP-057 — Warranty domain

**Story:** APP-057 (E6 · Documents, warranties, travel & home, P1)
**Owner:** Hajrudin Kardasevic
**Decision:** [ADR-0045](./adr/0045-warranty-receipts-are-owner-bound-document-references.md)
**Migration:** `supabase/migrations/20260930122303_app057_warranty_domain.sql`
**Enforced by:** `tests/db/app057.test.cjs`, `__tests__/warrantyDomain.test.ts`,
`__tests__/warrantyStore.test.ts`, `__tests__/warrantyReceiptReference.test.tsx`,
`__tests__/warrantyReminderRefresh.test.ts`

## The story and its acceptance criteria

*As a user I want to track warranty expiry.*

| Criterion | Where it is met |
| --- | --- |
| Purchase and coverage dates | `purchase_date` (new, nullable) and `expiry_date` (existing, now the canonical coverage end). Both are calendar dates, validated by `parseCalendarDate` on the client and by the `date` type plus `CHECK (purchase_date IS NULL OR purchase_date <= expiry_date)` in the database |
| Receipt reference | `receipt_document_id` — an opaque, owner-bound reference to one of the user's own APP-055 documents. Composite FK `(user_id, receipt_document_id) → documents (user_id, id)`; deleting the document clears only the reference |
| Seller/product | `seller` (new, nullable free text) and `name` (existing, now the product label) |
| Reminders from canonical dates | 30/7/1 days before the coverage end, in calendar days (`addDaysIso`), at 09:00 local time, with generic lock-screen text |

## Baseline and audit

Implemented on `4b6e284` (`feat: add document delete cascade`).

- `public.warranties` had `id text, user_id uuid, name, type, expiry_date date,
  notes, created_at`, primary key `(user_id, id)`, a cascade from `auth.users`, four
  owner RLS policies (`TO PUBLIC`, `auth.uid() = user_id`; the UPDATE policy's USING
  doubles as its WITH CHECK) and the broad legacy table grants APP-107 owns.
- The store synced by a fire-and-forget whole-record upsert that ignored errors, and
  fetched by appending ids it did not know — existing ids were never updated.
- `lifesort-warranties` is a mixed A/B encrypted Zustand v0 surface, refused by the
  APP-031 plaintext outbox.
- Reminders parsed the coverage end with `new Date('YYYY-MM-DD')` (UTC midnight,
  which lands on the previous local day west of UTC) and put the product name in
  the notification title.
- Warranty attachments are the separate, parent-shaped `public.attachments` model.
  **Pre-existing debt, recorded and not solved here:** `removeWarranty` deletes the
  local attachment files, but the `public.attachments` rows with
  `owner_type = 'warranty'` and their objects in the `attachments` bucket are not
  removed with the warranty (the owner id is polymorphic, so no foreign key cascades
  it). They remain until account deletion.

## Semantics kept, facts added

| Column | Client field | Meaning | Since |
| --- | --- | --- | --- |
| `name` | `name` | Product label | existing; meaning recorded by APP-057 |
| `expiry_date` | `expiryDate` | Canonical coverage-end calendar date; the only reminder input | existing; meaning recorded by APP-057 |
| `purchase_date` | `purchaseDate?` | Optional calendar date of purchase, never after coverage end | APP-057 |
| `seller` | `seller?` | Optional free text; blank means not recorded | APP-057 |
| `receipt_document_id` | `receiptDocumentId?` | Optional opaque document id | APP-057 |

Nothing was renamed: every installed client selects and upserts the old names. No
row was backfilled: an old warranty simply does not know its purchase date.

## The receipt reference

```
warranties (user_id, receipt_document_id)  ──►  documents (user_id, id)
            MATCH SIMPLE · ON UPDATE NO ACTION · ON DELETE SET NULL (receipt_document_id)
```

- **Owner-bound.** Referential checks bypass RLS, so the pair is the check: the
  warranty's own `user_id` (pinned to `auth.uid()` by RLS) must own the document.
  Another account's document is "not present" in exactly the words a missing one
  is, so the constraint is not an existence oracle (tested).
- **Deletion clears, never cascades.** The column-list `SET NULL` touches only
  `receipt_document_id`. A plain composite `SET NULL` would null `user_id` too — it
  is `NOT NULL` and part of the key — and make every referenced document
  undeletable; a control test reproduces that.
- **FK target.** `UNIQUE (user_id, id)` on `documents`, trivially unique because
  `id` is the primary key. Additive; no APP-055/APP-056 policy reads it.
- **Index.** `(user_id, receipt_document_id) WHERE receipt_document_id IS NOT NULL`
  for the delete action.
- **An id only.** No blob, storage path, filename or signed URL is copied into the
  warranty, on the server or on the device.

## The boundary between warranties and documents

`core/documents/documentReferences.ts` is the only thing the warranty side reads:

| Returns | Never returns |
| --- | --- |
| `id`, `originalName`, `createdAt`, built field by field | `storage_path`, signed URLs, bytes, deletion state, another account's rows |

It selects `id, user_id, original_name, created_at` with `.eq('user_id', …)`, drops
any row it does not fully understand, and returns `null` for a failed read so a
network error is never shown as "you have no documents". Core does not import
anything from warranties. No warranty file imports `useDocumentsStore` or
`documentSync`; `components/WarrantyReceiptField.tsx` is the one consumer, and it
holds the list in component memory only.

**Documents stays `internal`.** The field lists the user's own document metadata to
choose from; it does not navigate to `/documents` and offers no upload. Because no
viewer is internal today, an ordinary account has no standalone documents, and the
field says so: *"You have no saved documents to link."*

## UI

The existing create screen and the detail screen's edit sheet gain Seller, Purchase
date (clearable) and the receipt field; the product field is labelled, and "Expiry
date" now reads "Coverage ends". A purchase date after the coverage end is refused
before save with an inline, announced message. The detail screen shows seller and
purchase date ("Not set" when absent — legacy warranties are shown as they are), the
coverage end, and the linked receipt by its name. The field's states:

| State | Shown |
| --- | --- |
| Nothing linked | "No receipt document linked" (read-only: no network call) |
| Linked, list loaded, found | the document's name and date |
| Linked, list loaded, not found | "The linked document is no longer available" |
| Linked, list not loaded or failed | "A document is linked" — never "gone" |
| Picker: no documents | "You have no saved documents to link." |
| Picker: read failed | the failure and a retry — never "no documents" |

Legacy attachments are unchanged and still shown and editable.

## Reminders

Derived only from `expiryDate`: 30, 7 and 1 days before, by `addDaysIso`, triggered
at 09:00 built from the reminder date's own local fields — so neither UTC parsing
nor DST can move a reminder to another day or hour (tested across the 2026-10-25
and 2027-03-28 Copenhagen transitions). A non-canonical coverage end cancels old
reminders and schedules none. Past times are skipped. Changing the coverage end
reschedules. The request uses the v57 `DateTriggerInput` (`type: DATE, date`)
unchanged.

The copy is generic: *"A warranty is expiring soon — It expires in 7 days. Open
LifeSort to see which one."* `scheduleWarrantyReminder(id, coverageEnd)` no longer
takes a name, so product, seller, notes and document names cannot reach a lock
screen. Rich, opt-in detail belongs to APP-079/080, which this story does not build.

### Replacing reminders that earlier builds scheduled

Earlier builds put the product name in the title, and the OS keeps a scheduled
notification across an app update. So APP-057 also sanitizes what is already
scheduled — narrowly, for warranties only:

| | |
| --- | --- |
| When | Once per sign-in/app start, from an explicit root-layout effect, after `whenStoreHydrated(useWarrantiesStore)` — i.e. after the encrypted local list has been read successfully. Independent of the remote fetch, so it works offline |
| What it reads | The local warranty list (`id`, `expiryDate`) through the store action `refreshReminders`. No network, no Supabase |
| What it cancels | `warranty-<id>-30`, `-7`, `-1` for every local warranty — the only identifier scheme any build has used. Cancelling needs no permission, so this happens whatever the permission state |
| What it schedules | Only if `getPermissionsAsync()` says permission is already granted: the generic reminders, derived from the canonical coverage end exactly as above. Invalid or past dates schedule nothing |
| What it never does | Call `requestPermissionsAsync` — an update is not a reason for a dialog; touch another domain's notifications; throw (every native call is contained and the result is counts only, no ids or text) |
| Repeatability | Idempotent: running it again leaves the same schedule |
| Ordering | Schedule, cancel and refresh share one serialization lane, so a refresh cannot interleave with a user's edit or deletion and leave a stale or orphaned reminder. The interactive permission request of a user-initiated save runs outside the lane, so a dialog waiting for the user holds nothing up |

This is not a notification platform and does not implement APP-079/080: no
categories, no preferences, no rich copy, no permission centre.

## Sync — what did and did not change

APP-031–038 provide platform primitives, but warranty production CRUD has **not**
adopted the generic outbox/revision orchestration, and APP-057 does not change that.
The warranty store is a mixed A/B surface that the plaintext outbox refuses by
design; no gate was weakened and no queue was added.

What changed is field mapping — the upsert sends and the fetch selects the three new
columns — and one narrow reaction the new constraint makes necessary: an upsert
refused by `warranties_receipt_document_fkey` means the referenced document no
longer exists for this account, so the client clears that reference (only if it is
still the one held) and sends the warranty again, keeping the rest of the edit. Any
other error changes nothing, as before.

Known limits, unchanged in kind:

- The fetch still appends unknown ids only, so a receipt linked on one device does
  not appear on another that already holds the warranty.
- The upsert still sends the whole local record, so that other device's next edit
  clears the link (last write wins, as for every warranty field).
- No offline retry, revision or conflict policy exists for warranties.

## Stale and legacy clients

| Client | Effect |
| --- | --- |
| Pre-APP-057 upsert of an existing row | Updates only its payload's columns; purchase date, seller and receipt are preserved (tested) |
| Pre-APP-057 insert | New facts NULL (tested) |
| Pre-APP-057 client moving coverage end before a recorded purchase | Refused by the CHECK; that client ignores upsert errors, so the edit is silently not saved |
| APP-057 client against a database without the migration | Every warranty fetch and upsert fails — hence the rollout order below |

## Local persistence

The three fields are optional inside the existing inner Zustand v0 of the encrypted
`lifesort-warranties` envelope. A payload written before APP-057 hydrates with them
absent (tested through the real APP-029 adapter); a new one keeps them inside the
ciphertext. No version bump, no local migration, no adapter change. The warranty
state never holds a document's name, path or URL.

## Threat model

| Threat | Control |
| --- | --- |
| IDOR: referencing another account's document | Composite FK over the row's own `user_id`; RLS pins `user_id` to `auth.uid()`. Tested with two users, insert and update |
| Existence oracle through the FK | A foreign id fails with the same message as a missing one (tested) |
| Client-supplied `user_id` | RLS WITH CHECK on insert; UPDATE's USING doubles as WITH CHECK, so a row cannot be re-homed (tested) |
| Reading another account's warranty or its receipt metadata | Owner RLS on both tables; the boundary also filters by `user_id` and drops foreign rows (tested) |
| Stale session | Every read and write is the database's under the caller's JWT; nothing is authorized on client state |
| Document deleted while referenced | `SET NULL (receipt_document_id)`; warranty and `user_id` intact (tested through real finalize) |
| Deletion race | A referencing write makes finalize wait, then the reference is cleared; a write racing an open finalize is refused after commit (two-session tests) |
| Stale local reference after deletion elsewhere | FK refusal → local reference cleared → resend without it; other failures untouched (tested) |
| Storage-path or signed-URL leakage into warranties | The boundary never selects the path; the warranty stores an id only (tested on source and on encrypted bytes) |
| Lock-screen disclosure | Generic copy; the scheduler takes no name (tested with product, seller, notes and receipt present) |
| Product-named reminders from earlier builds surviving the upgrade | Startup refresh from the local encrypted list cancels them by deterministic id and, only with permission already granted, replaces them with generic ones; no permission prompt (tested, including offline and not-granted) |
| Sensitive values in logs | No logging in these paths (tested: no console calls) |
| Weakening APP-055/APP-056 | Before/after catalog comparison of policies, grants, functions, buckets and RLS flags (tested) |

## Test evidence (LOCAL)

| Suite | What it proves |
| --- | --- |
| `node --test tests/db/app057.test.cjs` — 16 tests | The three documents migrations, then `public.warranties` exactly as the remote schema declares it (statements lifted from the file, count asserted), legacy rows, then APP-057: legacy values unchanged; APP-055/APP-056 surface unchanged; every baseline migration byte-identical to `4b6e284`; column types; FK shape including `confdelsetcols`; CHECK incl. equality and leap day; own reference on insert/update; foreign reference refused like a missing one; RLS two-user read/write/claim/re-home; control for plain composite `SET NULL`; deletion through real begin/remove/finalize; account cascade; legacy upsert/insert; both race orders; no dangling reference |
| `__tests__/warrantyDomain.test.ts` — 28 tests | Date rules, seller and reference shapes, legacy validity, reminder derivation (month ends, leap days, both DST transitions, past skipping), generic DA/EN copy with plurals, rescheduling, end-to-end reminder privacy through the store, DA/EN key parity |
| `__tests__/warrantyStore.test.ts` — 22 tests | Upsert payloads incl. nulls, refusals, updates and clears, legacy edit, renewal, stale-reference heal and its limits, fetch mapping and unchanged merge semantics, encrypted v0 legacy hydration and encrypted round-trip, no logging |
| `__tests__/warrantyReceiptReference.test.tsx` — 26 tests | Boundary decode and query, empty vs failed, no session, no path/URL/Storage in source; no warranty → documents-store/sync imports; Documents internal; every field state; create screen and detail/edit screen |
| `__tests__/warrantyReminderRefresh.test.ts` — 15 tests | Against a faked OS scheduler: old product-named ids replaced with generic content; other domains untouched; denied and not-yet-asked permission clear without scheduling; unreadable permission; contained sync/async failures; invalid and past dates; idempotence; unreadable list; ordering with a concurrent edit and deletion (both fail without the lane); refresh from the real encrypted local list while offline; the root-layout wiring; no `requestPermissionsAsync` anywhere on the path, and no unhandled rejection |

There is no GitHub CI evidence for this change; these are local runs. There is no
Maestro or on-device E2E harness in this repository.

## Remote migration status

**NOT APPLIED.** `20260930122303_app057_warranty_domain.sql` was exercised only
against a disposable local PostgreSQL 18 cluster. It was applied to neither Staging
nor Production during this implementation, and neither was contacted.

Prerequisite history, as the established project rollout state before APP-057 (not
re-verified by this implementation): APP-055, its hardening and APP-056 are already
applied to Production.

Rollout order: APP-055 (`20260925090000`) → its hardening (`20260925225633`) →
APP-056 (`20260927204302`) → APP-057 (`20260930122303`) → a client build containing
APP-057. The migration needs `public.documents`; the client needs the new columns.
`ON DELETE SET NULL (column)` requires PostgreSQL 15+; the remote schema's `MAINTAIN`
grants indicate 17+, which should be confirmed on Staging before applying.

## Known limitations and non-goals

- Multi-device warranty sync keeps its merge-only fetch and whole-record upsert (see
  above). No outbox, revisions or conflict policy for warranties.
- The startup refresh finds earlier builds' reminders by the ids of warranties the
  device still holds. A schedule whose warranty is no longer in the local list —
  reachable today only through a backup restore that replaced the list — is not
  found by it; sign-out cancels every scheduled notification.
- Without granted permission the refresh only cancels. Reminders return at the next
  start after permission has been granted, or when a warranty is next saved or
  renewed (the existing user-initiated path, which may ask for permission as before).
- No rich notification preference (APP-079/080), no central notification platform.
- No upload from the warranty, no opening the receipt from the warranty, no
  activation of Documents.
- Warranty attachments are not migrated; their pre-existing deletion debt (above)
  is unchanged.
- No APP-107 grant hardening; the legacy `anon`/`authenticated` table grants on
  `public.warranties` are unchanged.
- `renewWarranty` still adds a year with its existing helper (29 February renews to
  1 March); only reminder arithmetic moved to the calendar primitives.
