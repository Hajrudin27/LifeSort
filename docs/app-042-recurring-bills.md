# APP-042 recurring bills and subscriptions

**Story:** APP-042 (E4 · Economy, P1) — *As a user I want to track recurring costs.*
**Acceptance:** manual + bank candidate model; the user confirms detection; next date and frequency explicit.
**Decision:** [ADR-0035](./adr/0035-manual-recurrence-is-an-explicit-frequency-and-bank-candidates-only-suggest.md)
**Baseline:** `main` at `43ef5ac`. Builds on [APP-039](./app-039-financial-read-model.md), [APP-040](./app-040-money.md) and [APP-041](./app-041-manual-economy.md).

## Manual recurring costs

An `Expense` now carries the cadence explicitly:

| `isRecurring` | `recurrenceFrequency` | `recurrenceAnchorDay` |
| --- | --- | --- |
| `false` | `null` | `null` |
| `true` | `monthly`, `quarterly` or `yearly` | 1–31 |

No other combination may exist. `core/economy/recurrence.ts` declares the
frequencies, the coherence rule, the day anchor and the calendar arithmetic once;
the store, the server row mapper, the local migration, the backup parser and a
database CHECK all use it and fail closed rather than guess.

**`recurrenceAnchorDay` is internal schedule metadata, not a form field.** The
user picks a payment date; the store derives the anchor from that date's day and
owns it from then on. It is deliberately absent from the `updateExpense` payload
type.

**Strict now, permissive only for history.** A write happening today must name a
real calendar date: the store uses `anchorDayFromIsoDate` (strict `parseIsoDate`),
so creating or re-dating a recurring expense on `2026-02-31` throws before
`set()` and leaves state untouched. The permissive day-token reader
(`anchorDayFromDateText`, via `repairLegacyOccurrenceDate`) exists **only** for
the local v1 → v2 migration and pre-format-3 backups, which have to recover the
historical defect described below.

**Weekly is not supported.** LifeSort materializes at most one instance of a
series per month, so a sub-monthly cadence would be a different scheduling model.

### How dates are generated

`rollForwardMonth(monthKey)` still materializes at most one instance per series
per month, from the latest occurrence before that month, with a fresh ID, the
same `seriesId`, the same øre amount and **no** copied attachments. APP-042 adds
two rules:

1. **Due months only.** The target month must be a whole-month multiple of the
   cadence after the base month: every month, every third, every twelfth. A month
   that is not due produces nothing, and jumping straight to a later month works.
   Nothing is approximated in days.
2. **The day is always `min(recurrenceAnchorDay, last day of the target month)`.**
   Clamping applies to that one occurrence and **never** changes the anchor, so a
   schedule keeps the user's numeric day of month for good.

```
30 Jan → 28 Feb → 30 Mar → 30 Apr        (anchor 30)
31 Jan → 28 Feb → 31 Mar → 30 Apr → 31 May   (anchor 31)
30 Apr → 30 May                          (anchor 30)
29 Feb 2024 yearly → 28 Feb 2025 → 28 Feb 2026 → 29 Feb 2028
15 Jan → 15 Apr → 15 Jul                 (quarterly)
```

**There is no "last day of month" recurrence mode in APP-042.** An occurrence
that happens to fall on the last day of a short month is not evidence of one: the
30th and the 31st are different schedules and both survive February. The result is
always a real calendar date; `2027-02-30` and `2026-04-31` cannot be produced, and
a malformed or impossible base date generates nothing.

### Editing

Existing semantics are preserved: editing an instance drops the materialized
**future** instances of that series, and earlier months are left untouched.
Future months then regenerate from the edited values, so a changed frequency,
amount or date takes effect from the edit onwards.

The store maintains the anchor itself:

| Edit | `recurrenceAnchorDay` |
| --- | --- |
| Amount, name or category only | preserved |
| Frequency only | preserved |
| New payment date | reset from the newly selected date |
| One-time → recurring | derived from the current payment date |
| Recurring → one-time | cleared with the frequency |
| Generated occurrence | copied unchanged, with a fresh ID and the same series |

### Screens

- **New expense:** the frequency appears as soon as the recurring toggle is on,
  with `monthly` preselected and visible — the historical LifeSort behaviour,
  stated rather than implied. Options are radio-role chips with an explicit
  selected state and a checkmark, so the selection is not carried by colour alone.
- **Edit expense:** the stored frequency is shown as selected and can be changed;
  switching recurrence off hides and clears it.
- **No anchor field:** the anchor follows the payment date the user already picks,
  so no extra input was added.
- **Lists:** the category detail rows and the upcoming list show the cadence
  (`Hver måned` / `Every 3 months` …) instead of the old hardcoded "repeats every
  month", beside the date and amount. Danish and English copy lives in
  `localization/locales/{da,en}/expenses.json`; no label is hardcoded.

A recurring occurrence remains an ordinary expense occurrence in APP-039 totals.

## Migrations

Every layer maps the historical meaning of `isRecurring = true` to `monthly`,
because that is exactly how every shipped build behaved.

| Layer | Change |
| --- | --- |
| Local storage (`lifesort-expenses`) | inner Zustand **v1 → v2** via the APP-038 harness, run in memory by the encrypted adapter before one encrypted commit |
| Backup format | **2 → 3**; new exports write 3 |
| Supabase `expenses` | new nullable `recurrence_frequency` and `recurrence_anchor_day` columns, backfilled, with a CHECK |

**Local v1 → v2:** each expense gains `recurrenceFrequency` (`monthly` when
recurring, otherwise `null`) and `recurrenceAnchorDay` (the day token of its
payment date, otherwise `null`). IDs, series IDs, names, categories, attachments,
`createdAt`, `seriesStoppedAt`, category budgets and every APP-040 øre amount are
copied unchanged — no money is rescaled. A v1 payload that already carries either
field, or a non-boolean `isRecurring`, fails validation, so the harness writes
nothing and the original bytes stay.

Canonical v2 bytes are validated more strictly than the shared runtime rule:
**both** recurrence fields must be present on every expense — explicitly `null`
for a one-time cost, not merely absent — the triple must be coherent, and a
**recurring** expense's `nextPaymentDate` must be a real calendar date. The
permissive legacy reading lives in the v1 → v2 step alone, so the repair below
produces bytes that then satisfy this stricter rule. One-time dates keep whatever
the schema accepted before APP-042.

**Legacy invalid-date repair.** Before APP-042, `rollForwardMonth` built the next
date by concatenating the month key with the previous day number, without checking
the calendar, so devices can hold strings like `2026-02-31` or `2026-02-30`. For a
**recurring** expense whose year and month are valid and whose day token is 1–31,
the migration keeps the intended day as `recurrenceAnchorDay` and clamps
`nextPaymentDate` to that same month's real last day:

```
2026-02-31  →  nextPaymentDate 2026-02-28, recurrenceAnchorDay 31
```

The series then recurs on the 31st again in March. A one-time expense is left
exactly as it is — it never recurs — and anything outside this known pattern (a
bad month, a day of 0 or 32, a non-date) still fails closed.

**Backups:** a format 1 or 2 file is **normalized** on import (recurring →
`monthly` plus the anchor from the stored date, with the same invalid-date repair;
one-time → `null`/`null`). **Format 3 is the canonical schema and is never
normalized or repaired:** every expense must carry both recurrence properties
itself — explicitly `null`/`null` for a one-time cost — the triple must be
coherent, and a **recurring** expense's `nextPaymentDate` must be a real calendar
date, exactly as for local v2 bytes. A one-time expense's date is not newly
validated. An expense without a usable `isRecurring`, a missing recurrence
property, an unknown frequency, an anchor outside 1–31, or an impossible recurring
date fails the whole import with `invalid_format` before any store is touched. Format 1 money conversion is
unchanged and still happens exactly once. Format 4 and newer are still rejected as
`unsupported_version`, and the field whitelist and prototype-pollution protection
are untouched.

**Database** (`supabase/migrations/20260917120000_expenses_recurrence_frequency.sql`):
`recurrence_frequency text NULL` and `recurrence_anchor_day smallint NULL`,
backfilled for recurring rows to `'monthly'` and `extract(day from
next_payment_date)`, plus a CHECK that mirrors the client invariant.
`next_payment_date` is a real `date` on the server, so the local invalid-day
strings cannot occur there. The CHECK is written with explicit NULL tests, because
`recurrence_frequency in (...)` is NULL rather than false for a NULL value and a
CHECK only rejects false — without them, a recurring row with no cadence would
pass. No RLS change; no new table. Writes include both columns, the fetch selects
them, and a row whose recurrence state is incoherent rejects the whole fetch rather
than reaching app state.

### Legacy-write compatibility, and the rollout consideration

The CHECK is strict and a pre-APP-042 client sends neither new column, so without
help every recurring write from a client that has not been updated would be
rejected — including a plain rename, because its write is an upsert and PostgreSQL
validates the proposed row before resolving the conflict. There is no forced-update
or minimum-version mechanism in this repository, so the migration adds a **narrow,
temporary BEFORE INSERT OR UPDATE trigger**,
`public.expenses_legacy_recurrence_defaults()`:

- It acts **only** on the legacy shape, which differs by operation because a row
  trigger cannot see which columns a statement listed: on **insert**, both new
  columns are NULL; on **update**, both are *unchanged relative to the stored row* —
  a column the statement did not set still carries its old value, which is
  indistinguishable from a caller re-sending that same value.
- A **new** recurring row becomes `monthly` anchored to the day of the date it
  sent: exactly the pre-APP-042 behaviour.
- An **existing** recurring row **keeps its cadence** — an old client renaming a
  yearly expense does not turn it monthly — and keeps its anchor unless the date
  changed, in which case the new date's day becomes the anchor.
- A one-time row, or one the old client turns non-recurring, gets `NULL`/`NULL`.
- Partial or invalid modern metadata (cadence without anchor, anchor without
  cadence, unknown cadence, anchor 0 or 32, metadata on a one-time row) is the
  caller's own input: the trigger leaves it alone and the CHECK rejects it.

The canonical stored invariant is unchanged, and application-side validation stays
strict. Three ambiguities are inherent to a BEFORE row trigger, each pinned by a
scratch-PostgreSQL test:

1. A caller explicitly sending both columns as NULL on a recurring row is treated
   as legacy and normalized.
2. A write that moves the date while re-sending the stored anchor is re-anchored to
   the new date — which is what the APP-042 client would have sent anyway.
3. An **update** that re-sends the stored cadence and anchor while changing
   `is_recurring` also reads as legacy: turning recurrence off that way clears both
   columns instead of being rejected as incoherent. The same values sent as an
   **upsert** are still rejected, because the proposed insert row is incoherent and
   is validated before the conflict resolves.

All three are acceptable for the temporary compatibility window: stored state still
satisfies the strict CHECK, the APP-042 client produces none of these writes, and
removing the trigger removes the ambiguity.

**Removal plan:** the trigger and function exist only for the immediately previous
app schema and should be dropped in a later migration once old-client
compatibility is no longer required, or once a minimum-version policy exists. No
date is set here. The absence of such a mechanism remains a factual rollout
consideration for the release: the migration is safe to apply before or after the
APP-042 build ships, but the compatibility layer is what makes that true.

## Bank recurring candidates (contract only)

**OB-403 detection is NOT implemented.** No provider, SDK, consent flow, token,
ingestion, table, Edge Function or candidate store exists, and nothing produces
candidates. What APP-042 adds is the LifeSort-side contract
(`features/economy/recurringCandidates.ts`) so future work cannot bypass it:

- an opaque candidate id, `source: 'bank'`, the suggested frequency and next
  date, an optional amount (subscriptions vary), and the opaque LifeSort ids of
  **at least two** observed occurrences — one payment is not a cadence, and the
  ids are what make a suggestion explainable;
- **`suggestedNextDate` is one suggested occurrence, not a stored schedule.** A
  candidate found in February can only suggest 28 February for a schedule that is
  really on the 31st, so no day-of-month anchor may be read out of it. APP-042
  therefore **never extrapolates later dates from a candidate**: the contract has
  no projection API and no anchor field, because inferring one would recreate the
  short-month drift that manual recurrence just fixed. Detection, linkage and any
  richer schedule semantics are OB-403's work;
- a decision: `suggested` (never treated as accepted), `confirmed` (an explicit
  user action) or `dismissed` (explicit; not shown as an accepted cost);
- provider-neutral by construction: fields are copied one by one, so a provider
  payload, token, consent id, IBAN or merchant text cannot ride into app state.

**No double counting.** A candidate is metadata about payments the bank already
reports. It is not an APP-039 `FinancialTransaction`, the read model has no
adapter for it, and confirming one creates **no** manual Expense. When Open
Banking exists, the bank transaction remains the single financial fact.

```
Manual recurring cost → Expense series → APP-039 manual source ─┐
                                                                ├→ one read model
Future bank transactions → (OB-403 detection) → candidate       │
      → explicit confirm/dismiss → tracking metadata only ──────┘
```

Candidate state will be server-owned when Open Banking is built, so APP-042 adds
no local persistence, no Zustand store and no Supabase table for it.

## Series stop state: a pre-existing limitation

`seriesStoppedAt` is **device-local**. `deleteRecurringFromMonth` deletes the
affected rows on the server, but the "stopped from this month" marker itself
lives only in the local store: there is no Supabase column for it (it does travel
in a backup, which is in the field whitelist). Consequences, unchanged by APP-042
and not fixed here:

- another device that has not seen the stop still holds an earlier instance of
  the series and can regenerate it when that month is opened, syncing it back;
- a reinstall restores expenses from the server without the marker.

APP-042 deliberately does not rewrite sync to fix this; it is recorded so it is
not mistaken for a new defect.

## Not in scope

No Open Banking provider (Yapily, Tink, Plaid, Nordigen/GoCardless or any
other), PSD2 consent, OAuth, webhook, account or transaction ingestion, merchant
matching or cadence detection; no `REAL_BANKING_ENABLED`, `bank_sync`
enforcement or APP-131 entitlements; no bank table, Edge Function or bank store;
no weekly recurrence; no change to APP-039 reconciliation or APP-040 money; no
Food or Travel money change.
