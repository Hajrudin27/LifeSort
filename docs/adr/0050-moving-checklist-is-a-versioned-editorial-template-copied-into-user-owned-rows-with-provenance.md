# ADR-0050: Moving checklist is a versioned editorial template copied into user-owned rows with provenance

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-062 |
| **Superseded by** | – |

## Context

Before APP-062 the Moving checklist was a flat list of `{ id, label, checked }`. Five
suggestions were created inside `onRehydrateStorage` whenever the list was empty at
hydration, using the fixed ids `default-<key>` and whatever language was active at that
moment. That had four consequences the master specification (APP-062: "content-driven; no
address required until needed; source/review metadata", "versioned") cannot accept:

- an empty checklist could never stay empty, and a suggestion the user had deleted came back
  after any restart, logout or empty restore;
- content had no identity, no version and no source, so a future release could neither add a
  suggestion safely nor say where one came from;
- the seeded labels were translated once and then looked like user text;
- Moving writes resolved the owner with `getUser()` after an await, so a write started by
  Account A could be sent under Account B's session.

## Decision

**Content.** The catalogue is bundled, immutable, Profile D reference content in
`features/home/movingTemplates.ts`: a stable template id (`moving-home`), a positive integer
version, a `selectable` flag, stable semantic section ids and stable item ids that are never
translated text. Historical versions stay addressable; only selectable ones are offered. A
shipped version is never edited; a change is a new version. The catalogue is neither synced
nor exported and there is no CMS, template table or RPC.

**Source and review metadata.** Metadata belongs to the template version, not to each item:
`source` and `reviewedBy` (an authority id, both `lifesortEditorial` for v1), `reviewedAt`,
`reviewDueAt` (civil dates) and `jurisdiction` (`null`: the suggestions are generic and cite
no rule). There is no URL because no external authority is claimed. The UI shows version,
source, review date and review status and states that these are suggestions, not legal or
safety requirements. Review status is a pure function of an injected date; a test never reads
the clock, so the build does not start failing when `reviewDueAt` passes.

**User data.** Copying is explicit. The user presses "Add suggested items"; the app creates
ordinary Profile A rows with fresh crypto UUIDs, the label localized at that moment,
`checked: false` and a `templateRef { templateId, templateVersion, templateItemId }`. A row
without `templateRef` is user-created. After the copy a row is user data: it can be checked
or deleted, the catalogue never rewrites it, and rename stays out of scope. Hydration never
creates rows, so an emptied checklist stays empty.

**Marker.** Household state records `movingTemplate { id, version } | null`: the latest
version explicitly applied to the one current checklist. It is not a Moving project and not
per-item metadata. An emptied checklist with a marker offers "Start a new checklist from
suggestions", which copies the latest selectable version.

**Upgrades.** What is new is decided by comparing two template VERSIONS by stable item id
(the applied version against the latest selectable one), never by which rows currently exist,
because a missing suggestion may be a deliberate deletion. Nothing happens automatically: the
screen offers "Add N new suggestions"; accepting adds only those items as fresh rows and then
advances the marker. A deleted suggestion does not return, a checked row keeps its state, no
label is overwritten, custom rows are untouched and an item the user already holds is never
duplicated.

**Legacy ids.** Exactly five historical ids prove provenance without a stored reference:
`default-addressChange`, `-internet`, `-electricity`, `-mailForwarding`, `-insurance`. The
local migration (Household Z1 to Z2), backup formats before 10 and remote rows with null
provenance derive `moving-home` v1 for those ids and for nothing else; labels, case and
look-alike ids (`default-foo`) never imply provenance. IDs, labels and checked state are kept
exactly. Because the old code exposed that v1 set automatically on every install, every
historical envelope or backup receives the v1 marker.

**Persistence.** Household local storage becomes Z2 through the APP-038 harness: every Moving
row is validated, malformed data fails closed with the original bytes preserved, and
`onRehydrateStorage` no longer migrates or seeds anything. Backup becomes format 10 and
carries `movingItems` with provenance and `movingTemplate`; a missing field keeps the current
value; the catalogue is never exported.

**Server.** `household_moving_items` gains three nullable columns (`template_id`,
`template_version`, `template_item_id`) and a CHECK that they are all NULL or all present and
well formed. The explicit `IS NOT NULL` terms are required: a CHECK also passes when its
expression is NULL, which let a partial combination through in the first draft and was caught
by the disposable-database test. RLS, grants and the account-deletion cascade are unchanged.
A PostgREST upsert from an older client lists only `id, user_id, label, checked`, so its
`DO UPDATE SET` never touches the new columns; this is proven against Postgres rather than
assumed. A client reading rows with partial or malformed provenance drops them; it advances
its marker only to the highest version proven by valid provenance and never lowers it.

**Account binding.** Moving writes capture the acting account when the user acts. After the
single await (a local session check) the live session must still be that account, otherwise the
write is dropped; a request that nevertheless goes out carries the initiator's `user_id`, so the
owner RLS refuses it under another session. Shopping is unchanged.

**Privacy.** APP-062 collects no old or new address, postcode, location, contacts or
permission, and no row, marker, column or backup field can carry one. "Change address" is only
checklist text.

## Consequences

- A catalogue release can add a new version but cannot change, add to, remove from or relabel
  an existing user's checklist. The user chooses when to take new suggestions.
- A fresh install starts with an empty checklist and one clear action instead of five items.
- Provenance on a row is proof of origin for upgrade comparison, not a live link: deleting or
  checking a row never changes what the catalogue offers later.
- Moving remains Profile A ordinary data; the catalogue is Profile D.
- A marker lost with every template-derived row (all deleted remotely and not restored) cannot
  be proven by the server. That is accepted; the next explicit start simply uses the latest
  version.
- **Accepted, deferred limitations (unchanged by this story).** Moving writes are still
  best-effort and fire-and-forget: an offline write can be lost, a failed delete can reappear
  on the next refresh, refresh is append-only and not a revision/tombstone reconciliation, and
  two devices are not conflict-safe. Durable sync for Shopping and Moving (outbox, receipts,
  revisions, tombstones, conflict policy) is follow-up work; it is deliberately not started
  here.
- Rollback is forward only: Z2 and backup format 10 are one-way migrations, the SQL change is
  additive and nullable, older clients ignore the new behaviour and keep working, and a
  catalogue change only ever adds a version.

## Alternatives considered

- **Keep seeding on hydration, with versioned content.** Rejected: it cannot represent an
  intentionally empty checklist and would silently re-add deleted suggestions.
- **Silently merge a new version into the checklist.** Rejected: the specification asks for
  versioned content, not for unrequested edits to user data, and "missing row" cannot be told
  apart from "deleted by the user".
- **Detect newness from the rows the user has.** Rejected for exactly that reason.
- **Per-item source and review metadata.** Rejected: the claim is about a reviewed content set;
  duplicating it per item would let rows drift from the version they came from.
- **Store the catalogue or the marker in Supabase / a CMS.** Rejected: the approved scope is a
  small bundled editorial list; a table, RPC and admin plane would add surface without need.
- **A Move/MovingProject entity with history.** Rejected: nothing in the acceptance criteria
  needs more than one current checklist; "start again when empty" covers a later move.
- **Infer provenance from labels or from `default-*` prefixes.** Rejected: translations and
  user text are not identity, and `default-foo` is not a seed.
- **Adopt the APP-061 durable sync for Moving now.** Rejected for this story: it would need its
  own RPC envelope, receipts, revisions, tombstones and conflict policy; the account-binding
  defect is fixed without it.
- **Reuse a generic template framework with APP-060 packing templates.** Rejected: the
  semantics differ (encryption, sharing, a server-claimed marker, rows without provenance on
  one side and provenance on the other), so an abstraction would be shared in name only.
