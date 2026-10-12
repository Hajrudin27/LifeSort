# APP-067 — Career tracker (P1)

**Story:** APP-067 · E7 Goals, habits, career & gifts · P1
**Acceptance:** company, role, status, dates, notes, sensitive docs private, no employer inference
**Decision record:** [ADR-0055](./adr/0055-career-applications-are-private-local-only-and-user-declared.md)
**Migration:** [`20261009120000_app067_job_applications_hardening.sql`](../supabase/migrations/20261009120000_app067_job_applications_hardening.sql)

APP-067 **hardens the existing Career tracker**. It adds no feature: it makes the tracker validated,
private on the device, local-only, and incapable of inferring anything about an employer.

## What an application is

The persisted shape is unchanged:

```
{ id, company, position, status, appliedDate, link?, notes?, createdAt }
```

`position` is not renamed (documents and copy may call it "role"). No `updatedAt`, `statusChangedAt`,
salary, recruiter, location, tag, CV version, cover letter, score or employer metadata exists.

| Field | Rule (new input) | Rule (stored and old backups — read compatibly) |
| --- | --- | --- |
| `id` | `newEntityId()` (UUID v4); never changes | any non-blank string; legacy ids stay opaque |
| `company`, `position` | trimmed; 1–200 UTF-16 units; no control character (NUL included) | non-blank string of any length |
| `status` | exactly `applied`, `interview`, `offer`, `rejected` | the same closed set |
| `appliedDate` | strict `YYYY-MM-DD`; impossible dates refused; **future refused** | strict calendar date; the clock is never read when decoding |
| `link` | optional; trimmed; ≤ 2048; only `http://` or `https://` with a host and no whitespace; empty = absent | any string, kept exactly (never normalised); inert text unless canonical http(s), never opened |
| `notes` | optional; plain multiline text; ≤ 10,000; NUL and other control characters refused; no Markdown or rich text | any string, kept exactly |
| `createdAt` | set once, immutable | valid instant |

Any status may be corrected to any other. Only an explicit user action changes a status: nothing
transitions, infers or suggests one. `withdrawn` and `accepted` are deliberately not added.

List order: `appliedDate` descending, then `createdAt` descending, then `id` ascending. It ranks nothing.

## Where it lives

| Concern | File |
| --- | --- |
| Persisted format and decoders (core, clock-free) | [`core/career/persistedApplication.ts`](../core/career/persistedApplication.ts) |
| Live rules: validate, create, edit, order, open link, counts (pure) | [`features/career/domain/application.ts`](../features/career/domain/application.ts) |
| Store (local-only, encrypted) | [`store/useCareerStore.ts`](../store/useCareerStore.ts) |
| One form for create and edit | [`components/ApplicationForm.tsx`](../components/ApplicationForm.tsx) |
| Screens (routes unchanged) | `app/career/applications/{index,new,[id]}.tsx` |

## Privacy and storage

- **Profile B.** `career.applications` is Profile B. The physical key `lifesort-career` holds applications
  and skills together, so the whole key is encrypted: the existing AES-GCM adapter
  (`documentMetadataEncryptedStorage`, key in SecureStore) gains `lifesort-career` in its closed legacy list.
  `career.skills` stays a Profile A *domain* on a shared encrypted key.
- **CV hardening.** `lifesort-cv` (phone, email, address) is moved to the same adapter and its closed
  legacy list; `career.cv` becomes Profile B. Storage only: the CV model, UX, PDF and its cloud mirror are
  unchanged, and APP-068 is not touched.
- **Upgrade.** Existing plaintext is encrypted in place on the first valid hydrate; the persisted shape does
  not change, so there is no Zustand schema migration (`docs/local-migrations.md`). Corrupt envelope or
  missing key fails closed and blocks writes; logout and account switch remove the envelope and destroy the
  key. Nothing is logged: Career runtime has no `console` call and no analytics.
- **Hydrate decodes.** A stored application that is not recognisable (unknown status, impossible date, blank
  company or role) is not rendered, and is dropped from storage on the next write. Over-long text and an unsafe
  link are kept as inert text: a record is never deleted for being untidy.
- **Sensitive documents.** Career creates no document bytes, filenames or signed URLs and holds no document
  reference. Documents stay in the private Documents domain (APP-055). A reference from an application to a
  document is deferred.

## Local-only

The legacy best-effort Supabase mirror is removed: no `upsert`, no `delete`, no `select`, no
`fetchFromSupabase`, no root-layout fetch trigger, and nothing is enqueued into the ordinary outbox. This
covers skills too (same key, same flawed writer).

Consequences, accepted:

- Applications, notes and skills are not restored on a second device or after a reinstall.
- Rows already in `job_applications` and `skills` remain on the server and are removed with the account.
- APP-067 is **not** "production-sync-ready".

### Follow-up boundary (not built here; no new story number)

Career durable sync may return only after LifeSort has a Profile-B-capable durable sync path with
encrypted/sensitive-safe mutation persistence, stable mutation ids, revision handling, tombstones,
reconciliation, an explicit conflict policy, account isolation, and retry / permanent-failure behaviour. It
must not reuse the Profile-A outbox or revive a best-effort writer.

## Legacy server table

`job_applications` is retained. The migration is additive/security only:

- no column added, renamed or dropped; the composite primary key `(user_id, id)` and the
  `user_id → auth.users ON DELETE CASCADE` foreign key are unchanged;
- five `NOT VALID` CHECK constraints: the four statuses; company and position 1–200 and not blank; link ≤ 2048
  and null/empty/http(s); notes ≤ 10,000. Legacy rows are never rewritten; a violating row remains readable and
  deletable by its owner and cannot be updated until it complies;
- every privilege revoked from `PUBLIC` and `anon`; `authenticated` keeps `SELECT, INSERT, UPDATE, DELETE`
  (no `TRUNCATE`, `TRIGGER`, `REFERENCES`); `postgres` and `service_role` untouched;
- four owner policies `TO authenticated` using `(select auth.uid())`; UPDATE has an explicit `WITH CHECK`, so
  a row cannot be reassigned to another user.

It is proven by [`tests/db/app067.test.cjs`](../tests/db/app067.test.cjs) against a disposable local
PostgreSQL built from the real baseline. Deployment follows [`database-deployment.md`](./database-deployment.md):
CI → automatic Staging → verify → manual Production → verify. It is never run by hand.

## Backup

Format **13**. A new export carries `career: { skills }` and **no `cv`**, so a plaintext archive no longer
contains application notes, company names or CV contact details. It is therefore no longer a complete copy of
the user's data; the export screen says so. Formats 1–12 are still restored: the previous form enforced no limit and no link rule, so applications are
read by the same compatibility-aware decoder as local storage. A row must be a recognisable application
(identity fields, non-blank company and role, one of the four statuses, a strict date, a valid creation
instant, string link and notes, no unknown key, no repeated id); a link typed without `https://`, a
`javascript:` link or text above the new limits is preserved exactly, and an unsafe link stays inert text.
One unrecognisable row refuses the whole file (nothing is half-restored; nothing about it is returned or
logged), and everything restored lands in the encrypted store. A file claiming format 13 or newer that carries
applications or CV content is refused. An encrypted full export belongs to APP-097.

## Interface

- Create, edit and detail use one form with a visible label on every field, a fixed error code under a failing
  field (`career.errors.*`), `url`/multiline keyboards, a notes counter, status radios with an explicit
  checked state (never colour alone) and ≥ 44 pt targets. The picker is labelled for screen readers.
- Delete is **local and permanent** and is always confirmed (list and detail); the message says "this device
  only". No archive, no auto-hide, no status filter.
- A link opens only if it validates as http(s). Otherwise it is shown as text with an explanation.
- The Life tab keeps its Career card; the metric now reads **Open applications** (applications the user has not
  marked rejected), with no rate or score. Career is not on Home and not in Search; notes are never indexed.
- English and Danish.

## Accepted residuals

- **CV cloud mirror.** `lifesort-cv` is encrypted at rest only. Its best-effort Supabase mirror is a legacy
  limitation, not a reliable Profile-B sync path, and the CV is not "production-sync-ready". APP-068 must not
  feed CV data (or application notes) to any AI path before that is resolved or the CV is excluded.
- **Skills are local-only too**, because they share the `lifesort-career` key and its flawed writer; splitting
  the store is a later decision.
- **Unrecognisable stored rows** (unknown status, impossible date, wrong field type) are not shown and are
  dropped on the next write; no released client could write one. In an old backup the same row refuses the
  whole file.
- **Unreadable key.** If the shared encryption key is lost (for example an Android device-backup restore
  that brings back the encrypted data but not the SecureStore key), Career and CV stay unreadable and writes
  stay blocked; applications have no cloud copy to refetch. Same platform-wide trade-off as the other
  Profile-B stores (ADR-0023/0024); covered by the pending device-backup round-trip QA.
- **Legacy rows may need correction before an edit.** A restored or stored row with a link that is not
  http(s), or text above the new limits, is kept and shown, but saving an edit applies the current rules, so
  the user corrects that value first.

## Explicitly not in APP-067

withdrawn/accepted statuses, status history, `statusChangedAt`, archive, filters, employer scoring,
probability, ranking, enrichment, salary, recruiter CRM, recommendations, scraping, email or calendar
ingestion, notifications, reminders, Search, a Home snapshot, document upload or linking, CV UX redesign,
AI (APP-068), cover letters, interview coaching, analytics, durable Career sync, a sensitive-outbox platform,
APP-069+.

## Manual QA still required

VoiceOver and TalkBack on create, edit and delete; Dynamic Type at the largest sizes on all three screens;
upgrade from a build that holds plaintext `lifesort-career` and `lifesort-cv` (including the Life tab count);
a device with a legacy application whose link is `javascript:`; Danish copy review; a backup round trip on a
device (export, then restore an older file).
