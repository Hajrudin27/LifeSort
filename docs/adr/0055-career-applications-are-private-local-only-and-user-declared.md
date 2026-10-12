# ADR-0055: Career applications are private, local-only and user-declared

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-09 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-067 |
| **Superseded by** | – |

## Context

APP-067 asks the Career tracker for company, role, status, dates, notes, "sensitive docs private" and "no
employer inference". The tracker already existed as a legacy module: a persisted `JobApplication`
(`id`, `company`, `position`, `status`, `appliedDate`, `link?`, `notes?`, `createdAt`), four statuses, three
screens, and a best-effort Supabase mirror in `useCareerStore`.

Auditing it found:

- Notes are private text, yet the domain was classified Profile A with an `ambiguous` note, and
  `lifesort-career` was plaintext in AsyncStorage. The adjacent `lifesort-cv` (phone, email, address) was
  plaintext too.
- Nothing validated anything: a status fetched from the server was cast, `appliedDate` and lengths were
  unchecked, and a link was handed to `Linking.openURL` without looking at its scheme.
- The mirror cannot be made safe in place. Profile B requires reliable sync and the durable outbox rejects
  Profile B; Career has no revision, tombstone or conflict policy; and the legacy writer resolves the user
  after the `await`, so a write can be attributed to the wrong account across an account switch, while a
  delete can resurrect.
- `job_applications` had no CHECK constraints, owner policies `TO PUBLIC`, and every privilege (including
  `TRUNCATE`) granted to `anon` and `authenticated`.
- Backups wrote notes and CV contact details as ordinary plaintext JSON.

## Decision

1. **The persisted shape does not change.** `JobApplication` keeps its eight keys; `position` is not
   renamed (documents may say "role"); no `updatedAt`, `statusChangedAt`, salary, recruiter, location, tag,
   CV link, score or any employer metadata is added. A legacy id stays an opaque string; new ids come from
   `newEntityId()`; `createdAt` and `id` never change after creation.
2. **The four statuses stay exactly as they are** (`applied`, `interview`, `offer`, `rejected`). No
   `withdrawn`, no `accepted`: the four already satisfy the criterion, and a fifth would force a backup,
   schema and ordering change that adds no safety. Status is only ever what the user chose; any status may
   be corrected to any other; nothing transitions or infers one.
3. **One canonical, pure domain.** `core/career/persistedApplication.ts` is the persisted *format* (status
   set, limits, strict calendar date, http(s)-only link, stored and old-backup decoders, which read history compatibly). It is the same kind of
   documented C2 exception as `core/habits/persistedHabit.ts`, because the backup parser, which is core, must
   validate what the store persists. `features/career/domain/application.ts` holds the live rules (form
   validation, create, edit, order, link opening, counts); it imports core, never the reverse. Neither reads
   the clock. Limits: company and role 1–200 UTF-16 units after trimming, no control characters; link ≤ 2048,
   `http://` or `https://` with a host, no whitespace, empty means absent; notes ≤ 10,000, plain multiline
   text (no Markdown or rich text), NUL and other control characters refused; `appliedDate` a strict
   `YYYY-MM-DD`, a **future date refused on user input** but never when decoding stored data (the same bytes
   must decode the same on every day and in every timezone).
4. **Input is strict; history is read compatibly.** The limits and link rule in decision 3 bind **new
   input** (create and edit). Hydration and restoring a pre-APP-067 backup (formats 1–12) read *history*: the
   old form enforced no limit and no link rule, so a long note, a link typed without `https://` or even a
   `javascript:` link is a value the previous product legitimately created. Both decoders therefore require
   only a recognisable application — identity fields, non-blank company and role, one of the four statuses, a
   strict calendar date, a valid creation instant, string link and notes — and preserve the rest **exactly**.
   Nothing is normalised (no scheme is ever prepended) and an unsafe link stays inert text that is never
   opened. Editing such a row applies the current rules, so the user corrects the value before saving. A row
   that is not a recognisable application (unknown status, impossible date, wrong field type) is not rendered
   from storage, and makes a backup restore fail whole with a fixed error; a backup also refuses an unknown
   key and a repeated id.
5. **Order is deterministic and ranks nothing:** `appliedDate` descending, then `createdAt` descending, then
   `id` ascending.
6. **The whole `lifesort-career` key is Profile B.** `career.applications` is reclassified Profile B and the
   `ambiguous` note is gone. Because skills live in the same persisted key, the key as a whole — applications
   and skills — is written through the existing AES-GCM adapter (`documentMetadataEncryptedStorage`), whose
   closed legacy list (ADR-0024) gains `lifesort-career`. `career.skills` stays Profile A as a *domain* (the registry
   already models mixed surfaces) but shares the encrypted physical key.
7. **`lifesort-cv` is encrypted as storage hardening only.** It joins the same adapter and its closed legacy
   list; `career.cv` becomes Profile B. The CV model, screens, PDF generation and its legacy cloud mirror are
   untouched; that mirror is *not* a reliable Profile-B sync path and APP-067 does not claim otherwise. This
   is not APP-068 work.
8. **Existing plaintext upgrades in place** on the first valid hydrate. The persisted shape is unchanged, so
   there is no Zustand schema migration; the adapter's plaintext→envelope upgrade is the only transition. The
   adapter keeps its fail-closed behaviour (corrupt envelope, missing key, protected failure blocks writes)
   and logout / account switch removes the envelope and destroys the key.
9. **Career is local-only.** The store has no network code: the direct Supabase upsert/delete, the automatic
   `fetchFromSupabase` and the root-layout fetch trigger are removed, and Career is never enqueued into the
   ordinary (Profile A) outbox. This covers skills too, which share the key and the same flawed writer.
   Multi-device and reinstall restoration of Career data are deliberately **not** provided until a durable
   path exists. APP-067 is not "production-sync-ready".
10. **The legacy server tables remain, hardened where they are data about applications.** `job_applications`
    keeps its name, composite key and `ON DELETE CASCADE`; one migration adds `NOT VALID` CHECK constraints
    (the four statuses; company/position 1–200 and not blank; link ≤ 2048, null/empty or http(s); notes
    ≤ 10,000), revokes every privilege from `PUBLIC` and `anon`, leaves `authenticated` with
    `SELECT, INSERT, UPDATE, DELETE` only (no `TRUNCATE`, `TRIGGER`, `REFERENCES`), and replaces the policies
    with four owner policies `TO authenticated` using `(select auth.uid())`, UPDATE with an explicit
    `WITH CHECK`. Legacy rows are never rewritten. `skills` and `cv_*` are not changed by this story; the app
    simply no longer touches `job_applications` and `skills`.
11. **Backups exclude the Profile-B payload.** Format 13 exports `career: { skills }` only and no `cv`, so a
    plaintext archive no longer carries notes, company names or contact details. Formats 1–12 are still
    accepted: applications are read by the compatibility-aware decoder of decision 4 (so a legitimate old row is never refused for predating the new limits), and everything restored lands in the encrypted store. A
    file that claims format 13 or newer yet carries applications or CV content is refused. The export copy no
    longer promises "all your data".
12. **Documents stay in Documents.** Career creates no document bytes, filenames or signed URLs and holds no
    document reference; "sensitive docs private" is met by not building an insecure path. Linking is deferred.
13. **No inference and no AI.** No hiring probability, fit or applicant score, rejection or interview
    prediction, employer ranking or quality, salary, culture or recruiter inference, inferred status, or
    sensitive-trait inference. No LLM, prompt, embedding, provider, summarisation or note interpretation —
    APP-068 owns AI and must pass the context broker first. In particular, CV data (and application notes) must
    not be fed to any AI path until their sensitive handling is reliable: the CV's legacy best-effort cloud
    mirror is a known limitation that APP-068 has to resolve or exclude, not inherit.
14. **No new surface.** No Home snapshot, no Search entries (notes are never indexed; the screen's existing
    local text filter over company and role stays), no reminders, calendar, notifications, email ingestion,
    analytics, archive, status filter or history. The Career module stays `available`. The Life tab keeps its
    card; its metric becomes the neutral "Open applications" count of applications not marked rejected.
15. **Links open only after validation.** Only a canonical http(s) address is passed to the operating system;
    anything else a legacy row holds is shown as text with an explanation and is never opened.

## Consequences

- Career is device-only. A reinstall or a second phone does not bring applications, notes or skills back;
  rows already in `job_applications` / `skills` remain on the server, unreachable from the app, and are
  removed with the account (cascade). Users who relied on the old mirror lose that restore path until
  Career durable sync exists.
- The CV keeps its existing best-effort cloud mirror and its known weaknesses; only its storage at rest
  changed.
- A plaintext backup is no longer a complete copy of the user's data. Career applications and the CV have no
  export path until the privacy-center export story (APP-097) provides an encrypted one.
- Deleting an application is local and permanent, so it is always confirmed.
- A legacy row that violates a new database constraint stays readable and deletable by its owner but cannot
  be updated until it complies (`NOT VALID`).
- A stored row that is not a recognisable application (unknown status, impossible date, wrong field type) is
  not shown and is dropped on the next write. This is accepted deliberately: no released client could write
  one (the form offered four statuses and a picker date; the old fetch mapped server rows unchecked), so it
  needs a hand-edited or foreign row. Legitimate old values that merely exceed the new limits are never
  dropped.
- A pre-APP-067 backup (formats 1–12) is restored whenever its applications are recognisable, including a
  link typed without `http(s)://`, `javascript:` or `file:` links and text above the new limits; they are kept
  exactly and the links stay inert. A file with an unrecognisable application is refused whole, untouched and
  never half-restored.
- Editing such a legacy row may require the user to correct the link or shorten the text first.
- If the shared document-cache key ever becomes unreadable (ADR-0023/0024 fail closed), Career and CV data on
  that device stay unreadable and writes stay blocked, and unlike expenses or warranties **there is no cloud
  copy to refetch** for applications. The case to watch is an Android device-backup restore: the AsyncStorage
  envelope may be restored while Expo SecureStore deliberately excludes the key from Auto Backup, and iOS
  keychain persistence across reinstall is documented as not guaranteed. This is the platform-wide Profile-B
  trade-off, not new to APP-067, and it needs the device-backup round-trip QA.

## Follow-up boundary (not built here, not a numbered story)

Career cloud sync may return only after LifeSort has a **Profile-B-capable durable sync path** with:
encrypted/sensitive-safe mutation persistence, stable mutation ids, revision handling, tombstones,
reconciliation, an explicit conflict policy, account isolation, and retry / permanent-failure behaviour. It
must not reuse the Profile-A outbox or reintroduce a best-effort writer.

## Alternatives considered

- **Keep the mirror and encrypt locally.** Rejected: encrypting at rest does nothing about misattributed
  writes, resurrected deletes or last-write-wins on private notes.
- **Enqueue Career into the existing outbox.** Rejected: it rejects Profile B by design.
- **Build a second, Profile-B sync mechanism here.** Rejected: a platform story, and a second insecure
  mechanism is worse than none.
- **Add `withdrawn` / `accepted`, status history, archive, filters.** Rejected: mini-CRM scope that forces
  schema and backup changes without making the tracker safer.
- **Keep Career in Profile A and encrypt only notes.** Rejected: a physical key has one protection level and
  notes sit in the same key as everything else.
- **Leave `lifesort-cv` plaintext.** Rejected: it holds contact details, and a "production-safe" Career
  beside a plaintext CV is not production-safe.
- **Drop `job_applications`.** Rejected: rows exist, and silent remote deletion of user data is not this
  story's call.
- **Reject legacy rows, at hydrate or in an old backup, when they exceed a limit or fail the link rule.**
  Rejected: that deletes the user's record or makes a legitimate backup unrestorable. The limits bind new
  input only, not data the old product created.
- **Export Career into the plaintext backup.** Rejected: it defeats encrypting it on the device.
