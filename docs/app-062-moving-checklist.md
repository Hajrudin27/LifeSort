# APP-062 — Moving checklist

Master specification: E6 · "Som user moving home vil jeg get structured checklist." Acceptance:
content-driven; no address required until needed; source/review metadata. Decision record:
[ADR-0050](./adr/0050-moving-checklist-is-a-versioned-editorial-template-copied-into-user-owned-rows-with-provenance.md).

## Shipped behavior

- The Moving screen groups rows into sections: **Administration** (change address, mail
  forwarding, insurance), **Utilities** (internet, electricity) and **Your items** (anything the
  user wrote). Sections are stable ids with localized titles.
- A fresh install, and any emptied checklist, stays empty. **Add suggested items** copies the
  latest selectable template into the user's own rows. It is offered whenever no template has been
  applied yet, also beside rows the user typed first (those are kept and never duplicated). After a
  template was applied and the list was emptied the same action reads **Start a new checklist from
  suggestions**. While a template-based checklist has rows, no start action is shown.
- A card shows the template title, version, source, who reviewed it and when, the review status
  and a disclaimer: these are suggestions, not legal or safety requirements.
- When a newer selectable version has items the applied version did not, the screen offers
  **Add N new suggestions**. Nothing changes until the user taps it.
- Check, uncheck, add a custom item and delete work as before. Rename is out of scope.

## Content model (`features/home/movingTemplates.ts`, Profile D)

| Concept | Rule |
| --- | --- |
| Template id | `moving-home`; a stable kebab-case id |
| Version | positive integer; a shipped version is never edited, a change is a new version |
| Selectable | only selectable versions are offered; historical ones stay addressable |
| Section / item ids | stable semantic ids; translated text is never identity |
| Labels | resolved to text only when copied (`household.movingDefaults.<labelKey>`) |
| Metadata | template-level: `source`, `reviewedBy` (`lifesortEditorial`), `reviewedAt`, `reviewDueAt`, `jurisdiction` (`null`) |
| URL | none: no external authority is claimed |

v1 metadata: reviewed 2026-10-07 by LifeSort editorial, due for review 2027-10-07. Review status
is `movingReviewStatus(metadata, today)` with the date injected; no test reads the clock.
Definitions are validated by `validateMovingTemplate` (identity, version, authority, valid civil
dates, `reviewDueAt >= reviewedAt`, jurisdiction, unique ids, items in known sections) and are
deeply frozen.

## User data

```ts
MovingItem { id; label; checked; templateRef?: { templateId; templateVersion; templateItemId } }
movingTemplate: { id; version } | null     // latest version explicitly applied
```

No `templateRef` means a user-created row. A copied row is user data from the moment it exists.
New rows use `newEntityId()`; the `default-*` ids are legacy identities only.

## Version semantics

Example: v1 `A B C`; the user checked A, renamed nothing (not possible), deleted C and added D;
v2 ships `A B C E`.

| Item | Result |
| --- | --- |
| A | unchanged, still checked |
| B | unchanged |
| C | does **not** return: newness compares v1 with v2 by item id, not by existing rows |
| D | untouched |
| E | offered as "1 new suggestion"; accepting adds one fresh row with v2 provenance and moves the marker to v2 |

Nothing is applied automatically, an item the user already holds is never duplicated, and a
marker at or above the latest selectable version offers nothing. v2 content is not shipped;
these semantics are proven with synthetic catalogues.

## Legacy ids

`default-addressChange`, `default-internet`, `default-electricity`, `default-mailForwarding` and
`default-insurance` map to `moving-home` v1 and their key. Nothing else does: not another
`default-*` id, not a different case, not a label match. Id, label and checked state are kept
exactly. The shared decoder is `core/home/moving.ts`.

## Persistence

| Surface | Change |
| --- | --- |
| Local `lifesort-household` | Z1 to **Z2** through the APP-038 harness (`core/storage/migrations/household.ts`): validates each Moving row item by item, derives `templateRef` for the five seed ids, keeps everything else, records the v1 marker, keeps an empty list empty, fails closed (original bytes preserved) on any malformed row, extra field, stored provenance, duplicate id or future version. Retained fixtures: `9523a34` (Z0) and `db72a8c` (Z1). Hydration no longer seeds. |
| Backup | v9 to **v10**. Formats 1–9: rows validated, seed ids mapped, v1 marker added, an incoming marker ignored. v10: rows with `templateRef` and `movingTemplate` round-trip, including an empty list and an explicit `null` marker; strict validation rejects malformed provenance. A missing field keeps the current value. The catalogue and sync state are never exported. |
| Supabase `household_moving_items` | additive: `template_id text`, `template_version integer`, `template_item_id text`, plus a CHECK (all NULL, or all present and well formed). Migration `20261007150000_app062_moving_template_provenance.sql`; not deployed by this work. |

Legacy default rows need no backfill: a client derives their provenance from the fixed id.

## Old clients

A previous client upserts only `id, user_id, label, checked`. PostgREST builds `DO UPDATE SET`
from the payload keys, so provenance on an existing row survives; `tests/db/app062.test.cjs`
proves the equivalent statement against Postgres, together with the constraint, RLS (owner,
other user, anon) and the account-deletion cascade. Old clients ignore the new behaviour.

## Remote rows and the marker

Remote rows are decoded strictly: all-NULL provenance is a user row (a legacy seed id derives v1),
all-valid provenance is kept, anything partial or malformed is dropped. The marker is advanced to
the highest version proven by valid provenance and never lowered; labels and custom rows prove
nothing. Refresh stays append-only for ids already held locally.

## Account binding (W6)

`addMovingItem`, `toggleMovingItem`, `removeMovingItem`, `startMovingFromTemplate` and
`acceptMovingTemplateUpgrade` capture `initiatingAccountId()` synchronously. The write then checks
the local session once; if it is no longer that account the write is dropped. A request that goes
out anyway carries the initiator's `user_id`, so the owner RLS refuses it under another session. It
can never be re-owned by the new account. Shopping keeps its original `getUser()` path.

## Privacy

No address (old or new), postcode, geolocation, Contacts, Maps data or permission request, and no
field that could hold one, exists in a row, marker, column, backup or catalogue.

## Known, accepted, deferred limitations

Moving sync is unchanged and best-effort: writes are fire-and-forget, so an offline write can be
lost; a failed delete can come back on the next refresh because refresh is append-only and not a
revision/tombstone reconciliation; two devices editing the same row are not conflict-safe; a
marker that only existed on rows all deleted remotely cannot be proven by the server.

**Follow-up (no APP number assigned; the repository has no defined process for creating one):**
"Household lists durable sync — Shopping + Moving", covering the APP-031–037 primitives for
`household_shopping_items` and `household_moving_items`.

## Rollback

Forward only. Z2 and backup v10 are one-way migrations; the SQL change is additive and nullable
(no rename or drop); an older client keeps working and ignores provenance; a catalogue update only
adds a version and never rewrites existing user rows.

## Tests

`movingTemplates` (catalogue, copy, grouping, upgrade semantics), `movingMigration` (Z1 to Z2),
`movingBackup` (v10 and the real export/import), `movingStore` (no seeding, restart,
persisted bytes, upgrade, remote marker, account binding, Shopping unchanged), `movingScreen`
(sections, actions, metadata card, review status, accessibility, DA/EN, new suggestions),
`tests/db/app062.test.cjs` (additive schema, constraint, old-client upsert, RLS, cascade).
