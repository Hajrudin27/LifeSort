# APP-039 financial read model

The Economy monthly summary now derives from `economyTotalsForMonth` in
`features/economy/monthlyTotals.ts`. It adapts existing sources and calls the
pure `financialTotalsForMonth` function. No source, normalized entry, link or
total is persisted. No store, schema, storage version or migration changed.

> **APP-040 update.** Every amount in this read model is now DKK `MinorUnits`
> (integer øre) and is summed with checked integer arithmetic; the accounting
> rules below are unchanged. See [APP-040 money primitive](./app-040-money.md).

## Sources and amounts

- `Expense[]` becomes booked manual transaction entries, identified by expense
  instance `id`. `seriesId` is not an economic identity across months. Existing
  signed amounts (DKK `MinorUnits` since APP-040) and `nextPaymentDate` are preserved. The adapter does
  not reinterpret a negative legacy expense as a new financial type.
- `incomeByMonth: Record<string, MinorUnits>` becomes manual monthly aggregates,
  identified only by their month within the aggregate namespace. These have no
  transaction ID or correlation. Zero remains distinguishable from absent income.
- `BankFinancialInput` is a non-persisted, Economy-owned boundary: `id`, `kind`
  (`debit | credit | transfer | refund`), signed `amountMinor` (DKK `MinorUnits`), `currency`,
  `date`, `status` (`pending | booked`) and optional `correlationId`. It contains
  no provider payload, account details, merchant or description. A future adapter
  must provide a stable ID across pending/booked snapshots and normalize dates
  to the intended accounting date. Negative debits become positive expense
  magnitudes; credits/refunds must be nonnegative; transfers accept either sign.

Production currently supplies **zero bank inputs**, via the facade's empty
default. Tests supply synthetic bank inputs to that same facade. There is no
bank client, onboarding, bank store, provider call or claim of bank availability.

The normalized `FinancialSource` discriminates manual transaction, manual
monthly aggregate and bank transaction. `FinancialEntry` restricts monthly
aggregates to income and prohibits their correlation. `FinancialTransaction`
supports expense, income, transfer and refund semantics.

## Identity and explicit correlation

Same-source identity is a tuple of source kind, representation and ID/month key.
A manual ID that happens to equal a bank ID is not a duplicate. A repeated
identity contributes once; booked replaces pending independent of input order.
Conflicting copies at the winning status have no revision ordering at this boundary
and fail with a fixed error code rather than selecting a guessed latest copy.

Transaction entries can carry an optional explicit `correlationId`, meaning a
one-to-one manual/bank economic relationship. The current manual adapters never
invent one. A future caller with trusted link evidence can enrich the derived
manual transaction entries and pass them with bank entries to the same core.
This contract is not added to `Expense`, income storage or any database table.

Where both source kinds share a correlation, bank facts take precedence over
the manual entry, including bank date, amount, semantic and pending status.
Thus a linked pending bank item suppresses the manual copy until booking.
Explicit links survive duplicate snapshots of the same stable ID when one
snapshot omits the link; contradictory links fail with a fixed error code.
Correlation alone does not deduplicate different IDs within one source.
Many-to-one cross-source correlations fail as ambiguous. Future provider IDs
that change on booking must be adapted to a stable identity upstream.

No amount, date, description or merchant matching exists. In particular, manual
monthly income plus an unlinked bank credit both count, even for equal amounts.

## Accounting and period rules

Reconciliation runs before month filtering. Booked ordinary income increases
settled income; booked expenses increase settled spending; refunds reduce
spending and never increase income; internal transfers are neutral. Pending
entries contribute to neither settled total. Refunds need no original-transaction
link and can make the month's net spending negative.

Month selection retains Economy's `YYYY-MM` string-prefix behavior. Manual
income already names its month. The pure functions receive the month explicitly
and read no clock, auth, storage, network or mutable module state.

Economy remains DKK. The bank boundary rejects any other currency before
deduplication or filtering, even for pending/out-of-month entries. Core entries
are typed DKK and also checked at runtime. There is no FX. APP-040 replaced the
former JS floating-point amounts with integer `MinorUnits` and one localized
formatter; a non-integer or unsafe amount is `financial_amount_invalid`.

## Consumer scope

The Economy overview, expenses monthly overview/category totals, savings
overview/allocation available balance, expense/income trends, and Economy-owned
Home/monthly-review providers now use the same monthly aggregation implementation.
The Home card's shape, formatting and savings helper are unchanged. Existing
income/expense write flows and all savings persistence/actions are unchanged.

Search-result, upcoming-window and category-detail list sums remain scoped to
their displayed manual lists. Savings balances, contribution history and savings
trends remain separate from income/spending. Food and Travel calculations are
unchanged. These are not alternative unified monthly summaries. No shared
budget-period service or cross-module contract was introduced.

## Ownership, validation and release evidence

Callers must pass only the current account's active source snapshots. The
boundary adds no account cache or tombstone shape. Existing manual deletes
remove items from their source arrays; future bank deletion filtering belongs
upstream. Existing manual sync resurrection risks are unchanged.

Invalid currencies, non-finite amounts, bank sign contradictions, empty links
and ambiguous identity/link evidence raise fixed codes without financial values
or identifiers. No logging was added. Errors are contract violations for the
caller to handle; there is no new error UI or raw provider error propagation.

Data-profile registrations are unchanged: manual finance remains Profile A,
receipt attachments Profile B. This derived layer creates no storage surface.
Focused unit and store-to-consumer integration tests use synthetic fixtures;
existing monthly review and Home tests remain unchanged. There is no existing
Maestro setup, so device E2E remains release-level evidence. Real bank ingestion,
source freshness and provider adapter verification remain future integration work.
