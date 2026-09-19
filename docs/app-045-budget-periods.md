# APP-045 budget period consistency

**Story:** APP-045 (E4 · Economy, P1) — *As a user I want to see the same totals across Home, Economy and Food.*
**Acceptance:** shared period service; Europe/Copenhagen; date-boundary tests; Home, Economy and Food use consistent current periods and totals.
**Decision:** [ADR-0037](./adr/0037-budget-periods-are-copenhagen-calendar-periods.md)
**Baseline:** `main` at `a8d14dc`. Builds on [APP-039](./app-039-financial-read-model.md), [APP-040](./app-040-money.md), [APP-042](./app-042-recurring-bills.md) and [APP-044](./app-044-purchase-impact.md).

For one instant, Home, Economy and Food now agree on which day, month and week
are current, and show the same derived totals for the same data. This is not a
new budget system: Economy and Food remain separate financial domains.

## The period service

`core/dates/budgetPeriod.ts`, in `core/dates/` as the APP-008 inventory planned
(it owns the `LocalDate` migration). It is pure: no clock, store, storage or
network. It imports only `utils/shared/localDate`, and neither Food nor Economy.

```ts
type BudgetPeriod = { dateKey: 'YYYY-MM-DD'; monthKey: 'YYYY-MM'; weekKey: 'YYYY-Www' };
```

| Function | Meaning |
| --- | --- |
| `budgetPeriodForInstant(instant)` | The Europe/Copenhagen period of an absolute instant |
| `budgetPeriodForCalendarDate(dateKey)` | The period of a calendar date, taken literally; null if not a real date |
| `budgetPeriodForRecordedDate(value)` | A stored date string: instant or calendar date, see below; null otherwise |
| `isoWeeksInMonth(monthKey)` | The ISO weeks touching a month, from its calendar dates |
| `addMonthsToMonthKey`, `budgetPeriodDaysFrom`, `isoWeekdayOf` | Calendar arithmetic on keys and periods |

**Europe/Copenhagen, always.** The timezone is the IANA zone
`Europe/Copenhagen`. It is not configurable and is never the device's. LifeSort
does not encode summer time: the runtime's tz database (iOS, Android's ICU, the
browser) owns the offsets, their history and future changes (ADR-0037). An
instant is converted in three steps:

1. `Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Copenhagen', … })`, one
   formatter per field, gives the Copenhagen year, month and day. Only `format`
   and `resolvedOptions` are used, because Hermes does not support
   `formatToParts`. `en-US` gives Latin digits and the Gregorian calendar
   whatever the device's settings.
2. The answer is checked: the resolved zone must be `Europe/Copenhagen`, and the
   fields must be Latin digits forming a real date.
3. Dates, months and ISO weeks follow by pure calendar arithmetic.

If the runtime does not know the zone, resolves another one, or answers
unexpectedly, the service throws `budget_period_time_zone_unavailable`. It never
falls back to the device's timezone or UTC. The formatters are created once, and
answers are memoized per instant (at most 4,096).

**Instant or calendar date.**

| Value | Treated as | Example |
| --- | --- | --- |
| `…Z` or `…±HH[:MM]` | An instant, placed in Copenhagen | `2026-08-31T22:30:00.000Z` → `2026-09-01` |
| `YYYY-MM-DD` | A calendar date, never moved | `2026-09-01` → `2026-09-01` |
| A local date-time without an offset, or anything else | Unknown: null, never guessed | `2026-09-01T10:00:00` |

**ISO week-year.** Weeks start on Monday and belong to the year of their
Thursday: 1 January 2027 is in `2026-W53`, and 29 December 2025 in `2026-W01`.
There is now one ISO-week algorithm in the app. `utils/food/foodWeek.ts` keeps
only its weekday labels. For every calendar date from 2000 to 2040, the week key
equals the one the old Food helper produced, so stored `YYYY-Www` keys keep
their meaning.

**Weeks in a month.** Food's rule is unchanged: monthly budget ÷ the number of
ISO weeks that touch the month. The count now comes from the month's calendar
dates rather than from host-local `Date` construction. September 2026 has 5,
February 2027 has 4, and January 2027 has 5 (it starts in `2026-W53`).

## Runtime support

The APP-045 architecture review asked whether `Intl` time zones are reliable on
every target. React Native 0.86.3 runs Hermes V1 (`250829098.0.17`) by default
on iOS and Android. This project does not opt out.

| Target | Evidence | Result |
| --- | --- | --- |
| iOS, Hermes V1 | Hermes' `doc/IntlAPIs.md` at that tag lists `DateTimeFormat` `format` and `resolvedOptions` as supported on both platforms; it does not list `formatToParts`. `PlatformIntlApple.mm` checks `timeZone` against `NSTimeZone.knownTimeZoneNames`, raises `RangeError` for an unknown zone, and formats with an `NSDateFormatter` set to that `NSTimeZone`. React Native builds Hermes with Intl enabled. The production module ran in the same Hermes V1 build's macOS slice, which uses the same Apple Intl backend, under four host timezones. Every fixture matched Node, `resolvedOptions().timeZone` was `Europe/Copenhagen`, and 46,413 instants over 2024–2040 had no mismatch against Node's IANA data. | Supported |
| Android, Hermes V1 | The same Hermes document. `DateTimeFormat.java` checks the zone against `TimeZone.getAvailableIDs()` (`RangeError` otherwise) and sets it on the ICU `DateFormat` (API 24+, the app's `minSdk`). Hermes for Android is built with Intl only. | Supported, from source; not executed |
| Web | Standard ECMA-402 time zones. The web export succeeds. | Supported |
| Jest / Node | Full ICU with IANA data. | Supported |

A conversion took about 6 µs in Hermes, so the memo is a safeguard rather than
a need.

## Surfaces

Each surface resolves its period from one `new Date()` in its existing
lifecycle. No global timer or midnight refresh was added.

| Surface | Period | Lifecycle |
| --- | --- | --- |
| Economy tab | Copenhagen month, and its Food card's month and week | per render (the tab stays mounted) |
| Home: Economy and Food cards | Copenhagen month/week | per collection; one instant shared by all cards |
| Home: "set a food budget" prompt | Copenhagen month | per render |
| APP-044 purchase impact | Copenhagen month | one per visit (unchanged) |
| Income form default, Expenses overview's first month, Insights trends, Savings "available" month | Copenhagen month | per render / per mount |
| Food overview, weekly plan, budget form | Copenhagen month and week | per render |
| Recipes (this week's offers), Offers screen and meal-plan prices | Copenhagen week; Copenhagen date for campaign validity | per render / per lookup |

Historical, explicit periods are untouched: month navigation in the Expenses
overview, the monthly review's requested month, and stored keys.

## Economy

**APP-039 stays the only aggregator.** Every surface calls
`economyTotalsForMonth(expenses, incomeByMonth, period.monthKey)`, and the read
model's files are unchanged.

**One current-period preparation path**, in `features/economy/currentPeriod.ts`.
The current total no longer depends on which screen the user opened first:

- `prepareEconomyMonth(monthKey)` waits until Expenses and Income are read from
  disk, then calls APP-042's `rollForwardMonth(monthKey)`. That covers the
  current month only, idempotently, and with unchanged cadence, anchor and stop
  rules.
- `usePreparedEconomyMonth(monthKey)` does the same for a mounted screen, and
  again whenever the Expenses change. It keeps APP-044's fix for a series that
  arrives after the first pass. Nothing else is a dependency, so income changes
  and typing an APP-044 amount never trigger it.

**Readiness means this Expenses snapshot was prepared.** The hook returns true
only while the Expenses array the screen reads is the very array a pass for
`monthKey` left behind. A pass that creates an instance leaves a new array,
and that array is the one marked prepared. A no-op pass leaves the same array,
so readiness settles without another render or pass. A new month or a new
Expenses array, such as one from the startup fetch, is not ready on the render
that first observes it, before any effect has run. The comparison happens
during render and nothing is written to a store there.

While not ready, the Economy tab shows "…" for this month's spending and
balance, "Henter månedens tal …" / "Loading this month's figures…" in the
Expenses card, and no spending chart. This is a loading state, distinct from
"Ikke sat" for a missing income. Income, which needs no preparation, and the
non-financial content stay visible. APP-044 shows its existing loading line and
no result. Once ready, both screens are unchanged.

| Consumer | Prepares with |
| --- | --- |
| Economy tab | `usePreparedEconomyMonth` |
| Home Economy card | `prepareEconomyMonth`, before the card is computed |
| APP-044 | `usePreparedEconomyMonth`; no plan until prepared |
| Insights (APP-046) | `usePreparedEconomyMonth`; no current expense point or spending change until prepared ([app-046](./app-046-explainable-insights.md)) |
| Expenses overview (browsing) | its own `rollForwardMonth(selectedMonth)`, as before |

What a preparation pass writes is unchanged APP-042 behaviour: zustand `persist`
rewrites the Expenses store, and a created instance is upserted when signed in.

**Missing income is not zero income.** Home's Economy card used to show
`totals.balance` without an income, so 2.000 kr. of expenses read as
"−2.000 kr. available". Now, when `hasIncome` is false it shows **—** with
"Tilføj månedens indkomst for at se, hvad der er tilbage" / "Add this month's
income to see what's left" (`home.moneySnapshotMissingIncome`), priority
normal. The Economy tab already said "Ikke sat". A registered **0 kr.** income
is known, and its negative balance is shown as before.

## Food

**One pure read model**, `features/food/budgetReadModel.ts`:
`foodBudgetFacts({ period, monthlyBudgetByMonth, purchases })` returns
`hasBudget`, `monthlyBudget`, `weeklyBudget`, `spentThisWeek` and `remaining`
for the caller's period. It reads no store and no clock. The Food overview,
weekly plan, Home Food card and the Economy tab's Food card all call it, so the
four cannot disagree. Economy no longer imports any Food date helper.

- **Purchases are instants.** `addPurchase` has always stored
  `new Date().toISOString()`, and `food_purchases.date` is `timestamptz`.
  Purchases are placed by their Copenhagen date. A legacy date-only value (only
  possible from an edited backup) keeps its written date. An unreadable date
  counts nowhere, as before.
- **Money is unchanged.** Food amounts stay major-unit numbers with their own
  formatting; nothing converts them to APP-040 `MinorUnits`.
- **Offers.** The recipes' "this week's offers" filter uses the Copenhagen week.
  Global campaign validity (`valid_from`/`valid_to`, date-only Danish campaigns)
  uses the Copenhagen date on the Offers screen and in meal-plan pricing.
- **Monthly review** keeps its explicit requested month. It now places a
  timestamped purchase by its Copenhagen month instead of its UTC text, so a
  purchase at 00:30 on 1 September counts in September.

## Boundaries kept

- No Food purchase becomes an Expense, an APP-039 transaction or Economy
  spending. Food → Economy integration is APP-049.
- No change to APP-039 reconciliation, APP-042 cadence, anchor or stop rules,
  or the APP-043 Savings funding formula. Savings only takes its month from the
  service.
- No stored `YYYY-MM` or `YYYY-Www` key is rewritten, and no historical date is
  reinterpreted.
- No store, persisted key, storage or backup version, migration, Supabase
  schema or data-profile change.
- Other modules' dates (habits, to-dos, cycle, travel, career, reminders) keep
  their device-local behaviour.

## Home snapshot lifecycle

Home cards are snapshots, not subscriptions. A collection (on mount, on
module-choice or flag changes, on pull-to-refresh) passes one instant to every
provider, and the Economy card prepares the month before computing. Data that
arrives after a collection (such as the startup fetch) shows on the next
collection. The Economy tab and APP-044, which subscribe to the stores, update
immediately.

## Tests

- `__tests__/budgetPeriod.test.ts`: Copenhagen midnight in winter and summer;
  Aug→Sep and Dec→Jan at the Copenhagen boundary, not the UTC one; ISO
  week-year edges and week 53; a leap day; both DST changes, including the
  repeated hour; literal date-only values; timestamp parsing, including
  PostgreSQL's `+00:00` with microseconds; weeks in a month; the three field
  answers against a full-date formatter for the same zone, every 15 minutes
  through each transition, 2024–2040; week keys equal to the old helper's,
  2000–2040; no clock dependence; and host independence, both under an emulated
  UTC host and in real child processes in six timezones, each loading the module
  afresh. The runtime contract is tested by behaviour through a replaced
  `Intl.DateTimeFormat`. The service asks for exactly `Europe/Copenhagen` with
  `en-US`, and no `calendar` or `numberingSystem`, and works with an object
  that has only `format` and `resolvedOptions`. It fails closed with
  `budget_period_time_zone_unavailable` when the zone is rejected or resolved
  as another zone, or when the answer is not Latin digits.
- `__tests__/foodBudgetPeriod.test.tsx`: the read model's facts, formula,
  no-budget and 0-budget cases, and purchase placement at Copenhagen boundaries.
  It shows the Home card, Food overview, Economy Food card and weekly plan
  giving identical facts at an instant where UTC and Copenhagen disagree on
  month and week. It also covers the plan saving under the Copenhagen week, this
  week's offers, campaign validity, the budget form's month and the monthly
  review's placement.
- `__tests__/economyBudgetPeriod.test.tsx`: Home, the Economy tab and APP-044
  show the same month's APP-039 totals. It covers the income form's default
  month, preparation before the Home card (idempotent), a late series on the
  open Economy tab, missing versus 0 kr. income, one instant per Home
  collection, and import boundaries. Two regressions record every commit of a
  mounted Economy tab. In the first, the tab opens directly on a month whose
  recurring rent is not yet materialized. In the second, a later Expenses
  snapshot brings in an older series. Neither ever commits the plan without
  the rent: the first commit shows the loading state, then the one instance
  and the final totals follow. Income changes stay ready, and a no-op pass
  settles without looping.
- `__tests__/helpers/utcHost.ts` makes `Date`'s local getters answer as a UTC
  device would, because the suite itself runs in Copenhagen.

## Known limits

- **Earlier materialization widens the multi-device window.** Home now
  materializes this month at startup, possibly before the startup fetch has
  delivered another device's instance for the same month. APP-042's existing
  race, where two devices each create one, therefore has more chances to occur.
  The fix is server-side or deterministic instance identity, as a separate story.
- **Maintenance still does not stop materialization writes** (inherited from
  APP-042/APP-044).
- **No midnight refresh.** A surface that stays open across midnight or a month
  change keeps the period it resolved until it renders again (or, for APP-044,
  until the next visit).
- **Not yet run on a phone.** The Android Intl backend was checked from source
  only, because no Android SDK or emulator was available. The Apple backend ran
  on macOS, not on an iOS device. Release QA on one iOS and one Android device
  should check one period near a DST change, for example that
  `2026-10-25T01:30:00Z` is `2026-10-25`.
- **Offsets are only as current as the device's tz data.** A device that has
  not received an OS tz update computes with the data it has, as every other
  app on it does.
- **Not migrated:** savings history classification in its trend and review
  (Savings semantics), the monthly review's "previous month" invitation, and
  other modules' date handling.
