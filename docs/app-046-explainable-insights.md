# APP-046 explainable insights

**Story:** APP-046 (E4 · Economy, P2) — *As a user I want to understand spending changes.*
**Acceptance:** deterministic metrics; source / freshness is shown; AI may only phrase approved facts.
**Baseline:** `main` at `bd05a70`. Builds on [APP-039](./app-039-financial-read-model.md), [APP-040](./app-040-money.md), [APP-041](./app-041-manual-economy.md), [APP-042](./app-042-recurring-bills.md) and [APP-045](./app-045-budget-periods.md).
**Follows:** [ADR-0012](./adr/0012-monthly-review-reports-facts-not-judgement.md) (facts, never judgement), [ADR-0034](./adr/0034-economy-money-is-integer-minor-units-on-the-client-and-numeric-on-the-server.md) (money), [ADR-0037](./adr/0037-budget-periods-are-copenhagen-calendar-periods.md) (periods). No new ADR: nothing here touches storage, sync or auth.

The Insights screen (`/economy/insights`) now opens with one deterministic,
read-only insight: how APP-039 settled spending changed between the **two
latest completed** Europe/Copenhagen budget months. It says what the records
show, never why. This is not an AI story.

## What the user sees

```
Ændring i udgifter                          Change in spending
  Udgifter i august 2026                      Spending in August 2026
  5.200 kr.                                   DKK 5,200
  1.200 kr. højere end i juli 2026            DKK 1,200 higher than in July 2026
  Udgifter i juli 2026 ........ 4.000 kr.     Spending in July 2026 ...... DKK 4,000
  2 registrerede udgiftsposter i august 2026  2 registered expense entries in August 2026
  1 registreret udgiftspost i juli 2026       1 registered expense entry in July 2026

Datagrundlag                                Data basis
  Sammenligning   juli 2026 → august 2026     Comparison      July 2026 → August 2026
  Kilde           Registrerede økonomidata    Source          Registered Economy data
                  i LifeSort                                  in LifeSort
  Synkronisering  Ikke tilgængelig endnu      Sync freshness  Not available yet
  + three short notes: whole Copenhagen months, open month excluded; figures are
    the registered expenses; the last sync time cannot be shown yet.

Udgifter de sidste 6 måneder   (unchanged chart; new caption, see below)
Indkomst de sidste 6 måneder   (unchanged)
Opsparing over tid             (unchanged)
```

Direction is always words ("højere", "lavere", "Uændret fra"), in the ordinary
text colour; no colour carries it. When neither month has anything registered,
the card says **"Ingen registrerede udgifter i juli 2026 eller august 2026." /
"No registered spending in July 2026 or August 2026."**, and no amount,
difference or direction is shown.

## The approved fact

`features/economy/explainableInsights.ts`, `settledSpendingChange(input)`:

```ts
input = { currentMonthKey, expenses, bank? }   // bank: APP-039's boundary, production passes none

SpendingChangeFact =
  | { kind: 'settled-spending-change', latest, previous, absoluteDelta, direction, coverage, source, syncFreshness }
  | { kind: 'no-registered-spending',  latest, previous,                           coverage, source, syncFreshness }

latest / previous = { monthKey, settledSpending: MinorUnits, expenseCount }
direction         = 'higher' | 'lower' | 'unchanged'
coverage          = { basis: 'completed-budget-months', timeZone: 'Europe/Copenhagen', openMonthKey, records: 'as-registered' }
source            = { kind: 'registered-economy-records', bankInputs: 'none' | 'supplied' }
syncFreshness     = { status: 'not-available', reason: 'no-authoritative-sync-time' }
```

- **Pure.** Explicit inputs only: no store, clock, storage, network, i18n,
  logging or AI. Its imports are the period service, money, the APP-039 facade
  and types. A test walks the whole transitive import graph and fails if a
  store, `lib/supabase` or any other module appears.
- **Facts, not prose.** The fact carries keys and numbers; the screen owns the
  wording (as the monthly review does, ADR-0012). Source and freshness are
  typed values mapped to copy, so a new variant forces new copy.
- **Checked money.** `absoluteDelta = absMinorUnits(subtractMinorUnits(latest, previous))`.
  No `parseFloat`, kroner arithmetic, `Math.abs` or clamping. A difference
  outside the safe integer range throws `money_unsafe_arithmetic`, and the
  screen shows a fixed "cannot calculate" line instead of a number.
- **No percentage.** 0 kr. → 1.000 kr. has no meaningful percentage; the
  absolute difference answers the story.
- **Empty is not zero.** `no-registered-spending` means both months have no
  expense entry *and* zero settled spending. Entries that net to 0 kr. are a
  registered result and give `unchanged`. A refund-only month (bank inputs, not
  production) has negative spending and is not empty.

## Completed months only (APP-045)

The open month is never compared: its figure grows as the month's entries are
registered, so comparing it with a whole month would be a false signal.

```
latest   = addMonthsToMonthKey(currentMonthKey, -1)
previous = addMonthsToMonthKey(currentMonthKey, -2)
```

`currentMonthKey` is `budgetPeriodForInstant(new Date()).monthKey` on the
screen, so the Copenhagen rule and its time-zone data stay owned by
`core/dates/budgetPeriod.ts`. No date or time-zone code was added.

| Instant | Open month | Compared |
| --- | --- | --- |
| any time in September 2026 | 2026-09 | 2026-07 → 2026-08 |
| `2026-08-31T22:30Z` (00:30 on 1 Sep in Copenhagen) | 2026-09 | 2026-07 → 2026-08 |
| January 2027 | 2027-01 | 2026-11 → 2026-12 |
| February 2027 | 2027-02 | 2026-12 → 2027-01 |

## APP-039 owns every figure

Each compared month is exactly one call to
`economyTotalsForMonth(expenses, {}, monthKey, bank ?? [])`, and the fact
reports its `settledSpending` and `expenseCount` unchanged. Nothing re-sums an
Expense, and `financialReadModel.ts` and `financialSources.ts` are untouched.
Everything APP-039 decides is inherited: booked expenses count, pending entries
do not, refunds reduce spending, transfers are neutral, a repeated identity
counts once, explicit manual/bank links resolve to the bank fact, amounts are
DKK `MinorUnits`, spending may be negative and is never clamped, and invalid
sources fail with APP-039's fixed codes.

**Income is not passed.** Spending does not depend on income, so a missing or
present income cannot change the insight, and an income problem cannot break it.
The trends pass `{}` the same way.

**Expense count is context, never a cause.** It is APP-039's count of booked
expense entries for the month, shown as "8 registered expense entries in
August". The copy never links it to the difference.

## Source

Production supplies no bank inputs to Economy (APP-041): every production caller
uses the facade's empty default, and the screen passes none. The source is
therefore **"Registrerede økonomidata i LifeSort" / "Registered Economy data in
LifeSort"**, with `bankInputs: 'none'`. Nothing on the screen mentions a bank,
live data or a bank feed, and a test fails if any on-screen text does.

`bankInputs: 'supplied'` exists so the fact stays honest when tests (and a
future adapter) pass APP-039 bank inputs. The screen has no bank copy. A future
bank adapter must add bank provenance and bank freshness wording before it
passes bank inputs to this screen.

## Freshness and coverage

The audit looked for an authoritative "data as of" time and found none:

- `Expense.createdAt` is the creation time; editing does not change it, and a
  materialized instance gets its own. It is not a dataset or sync timestamp.
- `incomeByMonth` stores one number per month with no timestamp.
- Expenses and income sync by best-effort direct writes (upsert, fetch-merge).
  No `lastSyncedAt` or equivalent exists anywhere in the client.
- APP-036's sync status projects only the durable outbox. The direct Expense and
  income writes do not go through it, so a "clear" status says nothing about them.

So the screen shows **no time**, no "updated just now", no "synced", no "live"
and no "as of". It separates the two things it can state honestly:

1. **Coverage:** which months were compared ("juli 2026 → august 2026"), that
   they are whole Copenhagen calendar months, that the open month (named) is
   excluded, and that the figures are the expenses registered for them.
2. **Sync freshness:** "Ikke tilgængelig endnu" / "Not available yet", with one
   neutral line saying LifeSort cannot yet show when the data was last synced.

## No causes, no advice, no AI

The fact can state spending in each month, the absolute difference, its
direction, the entry counts, the months, the source and the freshness limit.
It cannot state a cause, a judgement, advice, affordability, a forecast or a
score, and neither can the copy. `__tests__/explainableInsights.test.ts` scans
every `economy.insights` string in both languages for cause ("fordi",
"skyldes", "because", "due to"…), judgement ("bedre", "overforbrug", "better",
"healthy"…), advice ("bør", "prøv", "råd", "should", "afford"…), forecast or
percentage, and unbacked claims ("bank", "live", "i dag", "today", "so far",
"opdateret"…), with Unicode-aware word edges so "Datagrundlag" is not "grund".

APP-046 adds no model SDK, endpoint, Edge Function, prompt, AI store or network
call. `SpendingChangeFact` is the boundary a later AI story (APP-085–APP-088) can
phrase: the arithmetic happens before any text exists, so a model can reword
these facts but cannot produce new ones.

## The open month's trend point

The six-month expense trend still ends at the open month. Its point is what
APP-039 counts for that month today, which includes a manual expense dated
later in the month. Its caption no longer shows a bare amount. It reads
**"9.999 kr. registreret for september 2026 (indeværende måned)" / "DKK 9,999
registered for September 2026 (current month)"**, never "through today" or
"so far".

**Preparation.** Opening `/economy/insights` directly used to read the open
month without APP-042's materialization, so a recurring cost due this month
could be missing. The screen now calls the shared
`usePreparedEconomyMonth(monthKey)` (APP-045). Until the Expenses on screen
are the prepared snapshot:

- the expense trend card shows the existing "Henter månedens tal …" /
  "Loading this month's figures…" and no chart;
- the spending-change card shows "Henter tallene …" / "Loading the figures…".
  Preparation never touches the compared months, but readiness also means the
  Expenses were read from disk (APP-014), so an unread store is never reported
  as "no registered spending".

Income and savings trends need no preparation and are never blocked. Nothing
new materializes: only the open month is prepared, through the existing path,
and no completed month is reconstructed.

## Boundaries kept

- No change to APP-039 reconciliation, APP-040 money, APP-042 cadence, anchor,
  stop or sync behaviour, APP-044, Home, or the savings trend's semantics.
- No DB table, migration, schema, RPC, store, AsyncStorage key, persisted
  insight, backup format, storage version or data-profile change. The insight
  is derived on every render and never stored, sent, logged or tracked.
- No analytics event, notification or log line with a financial value.

## Tests

- `__tests__/explainableInsights.test.ts` (32): higher, lower and unchanged;
  a previous month of 0 kr.; two silent months; entries netting to 0 kr.;
  negative spending; exact and unsafe checked arithmetic; open month excluded;
  Dec→Jan and Jan→Feb; an invalid month; determinism and input immutability;
  clock independence; explicit source, coverage and freshness; `bankInputs`.
  APP-039 integration through the real facade: the exact two calls (no income,
  no open month), sentinel totals reported unchanged, booked debits, refunds
  (including a refund-only month), transfers, pending→booked, repeated
  identities, no amount/date matching, link evidence across snapshots, and
  APP-039's currency validation. Purity: the import list, the transitive
  import graph and forbidden constructs. Copy: DA/EN key and placeholder
  parity, and the language guard with a live-guard control.
- `__tests__/explainableInsightsScreen.test.tsx` (16): the headline comparison
  in Danish and English; open month excluded; lower and unchanged; direction in
  text with one uncoloured style; previous 0 kr.; the empty wording; income has
  no effect; year boundary; the Copenhagen boundary instant; the data basis in
  both languages; no bank, sync-time or "through today" text; all three trends
  still end at the open month, the expense trend equal to APP-039 per month;
  the open-month caption. Preparation: a direct visit with a series last
  materialized in July shows only loading states until prepared, then exactly
  one September instance, no reconstructed August, one APP-042 upsert and no
  further commits; a later Expenses snapshot is prepared again, and an income
  change never is.

Mutation checks, each restored byte-for-byte afterwards:

| Mutation | Caught by |
| --- | --- |
| Compare the open month instead of the latest completed one | 29 failing tests |
| Hand-sum raw Expenses instead of APP-039 | 9 failing tests (facade calls, sentinel totals, refund, pending, identity, bank) |
| Remove the source and freshness rows | 2 failing screen tests |
| Add "fordi … bør" / "because … should" to the copy | 7 failing tests, including both language guards |

## Known limits

- **No bank source in production**, so the insight covers manual Economy only.
  Bank provenance and freshness are future Open Banking work.
- **Sync freshness cannot be shown** until the Economy sync model has an
  authoritative last-sync time (see above).
- **Completed months are taken as registered.** A recurring cost counts for a
  past month only if its instance exists there, meaning it was materialized
  while that month was current or when the Expenses overview was browsed to
  it. Browsing to such a month later can add an instance and change the
  comparison. APP-046 reconstructs nothing.
- **APP-042's multi-device race** can leave two instances of one recurring cost
  in a month. APP-039 counts different IDs separately, so the comparison
  includes both.
- **No midnight refresh (APP-045).** A screen left open across a month change
  keeps the old months until it renders again.
- **Savings trend semantics are unchanged**, including APP-045's open item on
  savings-history date classification.
- **Maintenance does not stop the preparation write** (inherited from
  APP-042/APP-044/APP-045).
- **A protected-storage hydration failure** leaves the insight and the expense
  trend in their loading states, like APP-044.
- **Not run on a device.** Covered by Jest and a web export smoke test.

## Not in scope

Category, merchant or cause analysis; anomaly detection; forecasts or
projections; recommendations, scores, safe-to-spend or affordability; credit,
loans, overdraft or buy now, pay later; savings recommendations or funding
changes; percentages; ML or AI of any kind; insight notifications or analytics;
Food (APP-049) or Travel integration; bank connection, onboarding or freshness;
reconstructing past recurring months; a user-selectable time zone; APP-085–APP-088.
