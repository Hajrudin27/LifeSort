# ADR-0035: Manual recurrence is an explicit frequency, and bank candidates only suggest

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-17 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-042 |
| **Superseded by** | – |

## Context

A recurring Economy expense was only a boolean, `isRecurring`. The cadence was
implicit: `rollForwardMonth` copied the previous instance into any later month
the user opened, keeping the day number as text. That meant monthly was the only
cadence a user could express, and a bill on 31 January could materialize as
`2026-02-31` — a date that does not exist, and which devices may already hold.

Deriving the schedule from the latest materialized occurrence is not enough
either. A February occurrence is necessarily clamped, so using it as the day
source turns a schedule on the 30th into an end-of-month schedule permanently —
the user's chosen billing day is lost after one short month.

APP-042 also has to state how a *future* bank-derived recurring payment
candidate relates to manual costs. Detection over real transactions belongs to
Open Banking (OB-403) and is not built here, but the boundary must exist now so
that later work cannot quietly turn a suggestion into an accepted bill, or
count one payment twice.

## Decision

- **A recurring expense carries an explicit frequency:** `monthly`, `quarterly`
  or `yearly`. Weekly is deliberately excluded: LifeSort materializes at most one
  instance of a series per month, so a sub-monthly cadence is a different
  scheduling model.
- **The triple is an invariant, enforced everywhere:** one-time → `null` cadence
  and `null` anchor, recurring → exactly one supported frequency and a 1–31 anchor
  day. The store, the server row mapper, the local migration, the backup parser and
  a database CHECK all reject any other combination instead of guessing.
- **A recurring expense also carries `recurrenceAnchorDay`, 1–31:** the day of
  the month its schedule belongs to. It is internal metadata derived from the
  payment date the user picked, not a second form field, and the store owns it —
  it is not part of the public update payload.
- **Dates are calendar arithmetic** in one pure module (`core/economy/recurrence.ts`).
  A due month is a whole-month multiple of the cadence; nothing is approximated in
  days. The day is always `min(anchorDay, last day of the target month)`, so a
  short month clamps that one occurrence and **never** the anchor: 30 Jan → 28 Feb
  → 30 Mar. There is no "last day of month" recurrence mode, because an occurrence
  that lands on a short month's last day is not evidence of one. Output is always a
  real date.
- **History is not rewritten.** Editing an instance keeps earlier months as they
  are and drops materialized future instances, as before APP-042, so future
  months regenerate from the edited values, including a changed frequency.
- **Existing data means monthly on its own date's day**, because that is exactly
  how every shipped build behaved: local storage v1 → v2, backup format 2 → 3 and
  the database backfill all map `isRecurring = true` to `monthly` plus the day of
  the stored payment date.
- **A known historical defect is repaired while migrating.** For a recurring
  expense whose stored date is an impossible one the old code could write
  (`2026-02-31`), the day token becomes the anchor and the date is clamped to that
  month's real last day. Anything outside that pattern still fails closed.
- **A bank recurring candidate is a suggestion, never a fact.** The
  provider-neutral contract (`features/economy/recurringCandidates.ts`) carries an
  opaque candidate id, the suggested cadence and next date, an optional amount,
  the opaque ids of at least two observed occurrences, and one of `suggested`,
  `confirmed` or `dismissed`. Confirmation and dismissal are explicit user
  actions; no confidence score or threshold may accept one.
- **Confirming a candidate creates no Expense and no financial transaction.**
  When Open Banking exists, the bank transaction is the financial fact; a
  candidate is metadata about payments already reported, so it cannot double-count.
- **A candidate has no schedule, only a suggested next occurrence.** It carries no
  day anchor, and none may be inferred from `suggestedNextDate`, so APP-042 does
  not extrapolate later bank dates at all. OB-403 owns whatever schedule metadata
  real detection needs.

## Consequences

- A user can track quarterly and yearly bills, and a bill on the 28th, 30th or
  31st keeps that day: a short month clamps one occurrence and the schedule
  returns to its anchor. The cost is one extra persisted field in three places.
- The database CHECK is strict, so a temporary BEFORE trigger normalizes writes
  from the immediately previous app version, which sends neither column. It acts
  only on the legacy shape — both columns NULL on insert, both unchanged from the
  stored row on update — preserves an existing row's cadence, and never rescues
  partial or invalid modern metadata. A row trigger cannot tell an omitted column
  from a re-sent identical value, so a few writes the APP-042 client never makes are
  normalized rather than rejected; each is pinned by a test, and the stored
  invariant holds either way. It exists because the repository has no
  minimum-version mechanism, and should be dropped in a later migration once old
  clients are no longer supported; see docs/app-042-recurring-bills.md.
- Old data upgrades in three independent places, each fail-closed: an incoherent
  triple blocks startup with the bytes preserved, fails an import before any store
  is written, or is rejected by the database.
- The candidate model is intentionally inert: nothing produces candidates yet, so
  the acceptance criterion "user confirms detection" is only representable and
  tested, not live. That is OB-403's work.
- `bank_sync`, entitlements and bank kill switches are untouched, so APP-041's
  manual-Economy independence still holds.

## Alternatives considered

- **Keep `isRecurring` alone and infer the cadence from the dates.** Rejected:
  materialized instances only exist for months the user has opened, so the gap
  between them is not evidence of intent.
- **Add weekly now.** Rejected: it needs several instances per month, which is a
  different scheduling model than the one the store implements.
- **Derive the day from the latest occurrence, with no stored anchor.** Rejected
  in review: February clamps the occurrence, so the schedule drifts permanently —
  30 Jan → 28 Feb → 31 Mar under an end-of-month rule, or → 28 Feb forever under a
  plain clamp. Either way the user's chosen day is lost, which is why the anchor is
  persisted.
- **A full RFC 5545 recurrence rule per series.** Rejected: one day-of-month
  anchor is the smallest metadata that fixes the defect for the three supported
  cadences.
- **Let a confirmed candidate create a manual Expense.** Rejected: the bank
  transaction is already the fact, so the expense would be counted twice, and
  APP-039's reconciliation must not be redesigned to paper over that.
- **Store candidates locally so the flow can be demonstrated.** Rejected:
  bank-derived state is server-owned once Open Banking exists, and a local store
  now would be dead production code.
- **A nullable enum column without a CHECK.** Rejected: the invariant is the
  point, and the client is not the only writer over the lifetime of the table.
- **Weakening the CHECK so old clients pass.** Rejected: the stored invariant is
  exactly what makes the client's guarantees meaningful. A BEFORE trigger keeps
  the constraint canonical and confines the compatibility to writes that carry no
  recurrence metadata at all.
- **Column defaults instead of a trigger.** Rejected: a default cannot see the row
  being replaced, so an old client's edit would overwrite a quarterly or yearly
  schedule with monthly.
