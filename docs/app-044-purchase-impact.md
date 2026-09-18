# APP-044 "Har jeg råd?" — purchase impact

**Story:** APP-044 (E4 · Economy, P1) — *As a user I want to see the impact of a purchase on my current budget.*
**Acceptance:** assumptions shown; uses current plan only; no credit advice; edge cases tested.
**Baseline:** `main` at `4889b4c`. Builds on [APP-039](./app-039-financial-read-model.md), [APP-040](./app-040-money.md), [APP-041](./app-041-manual-economy.md), [APP-042](./app-042-recurring-bills.md) and [APP-043](./app-043-savings-goals.md).

The user enters one amount and sees what spending it would do to this month's
registered plan. The screen answers *"what happens to the plan?"*, never
*"should I buy this?"*.

> **APP-045 update.** The current month is now the Europe/Copenhagen month from
> `core/dates/budgetPeriod.ts`, still resolved once per visit. Its preparation
> moved into the shared `usePreparedEconomyMonth` (`features/economy/currentPeriod.ts`),
> which the Economy tab and Home's Economy card also use: same `rollForwardMonth`,
> same re-run when the Expenses change, and typing still triggers nothing. The
> "screen-triggered materialization" limit below is resolved for those surfaces.
> The plan is ready only while the Expenses on screen are the snapshot that was
> prepared, so a late Expenses update shows the loading line, not a stale plan
> or result, until it too has been prepared.
> See [app-045-budget-periods.md](./app-045-budget-periods.md).

## The current plan

**The current plan is the current month's canonical Economy totals:**
`economyTotalsForMonth(expenses, incomeByMonth, currentMonthKey)`, the same
APP-039 read model and the same call the Economy tab makes.

```
before = plan.balance            (settled income − settled spending, from APP-039)
after  = before − purchase       (checked MinorUnits arithmetic, APP-040)
```

There is no second total and no hand-summed Expense list. Every APP-039 rule
is inherited unchanged: booked income and expenses count, pending entries do
not, refunds reduce spending, transfers are neutral, repeated identities and
explicitly linked manual/bank copies count once, and non-DKK or invalid input
fails with the read model's own codes. Production has no bank source, so the
plan is manual Economy alone (APP-041); nothing waits for a bank.

**Not part of the plan, and never added or subtracted:** savings goal balances
and targets, `extraSavings`, the Savings "available" figure, expense category
budgets, Food budgets, future expected income or purchases, assets and credit.
None of them forms an authoritative affordability contract. In particular, the
APP-043 Savings "available" formula is not used, and the screen does not decide
whether money in a goal is spendable.

## The calculation

`features/economy/affordability.ts` is pure: it imports only `core/money` and
the APP-039 types, and reads no store, clock, storage or network.

| Function | Contract |
| --- | --- |
| `purchaseAmountFromInput(text)` | `parseSupportedMoneyInput`, then `> 0`; otherwise `null`. No `parseFloat`, no `/ 100`. |
| `evaluatePurchaseImpact(plan, amount)` | `plan` is the APP-039 result. Returns one of the states below. |

| State | When | Carries |
| --- | --- | --- |
| `within-current-plan` | income registered and `after ≥ 0` | purchase, before, after |
| `over-current-plan` | income registered and `after < 0` | purchase, before, after |
| `plan-incomplete` | `hasIncome` is false | purchase only |

- **Descriptive, not a verdict.** `within` does not mean "affordable" and
  `over` does not mean "unaffordable". No state recommends anything.
- **Exact zero** is `within-current-plan`, with "0 kr." left. No warning
  threshold exists.
- **An already negative plan** is valid input. It is reported as a fact
  ("already 500 kr. under nul … 1.000 kr. under nul"), not as a judgement.
- **Missing income is not zero income.** Without a registered income for the
  month, no remaining balance is calculated or shown, and the screen asks for
  this month's income instead. A registered income of 0 kr. *is* a known plan,
  per the existing `hasIncome` contract.
- **Failures are fixed, value-free codes:** `purchase_amount_invalid` (zero or
  negative), `money_unsupported_amount` and `money_unsafe_arithmetic` (APP-040).
  Nothing is clamped, rounded or converted to kroner. The screen shows a fixed
  message instead of a number when the arithmetic would be unsafe.

## This month's recurring costs

A recurring series only becomes an Expense for a month when
`rollForwardMonth(monthKey)` materializes that month (APP-042). The audit found
that only the Expenses overview calls it; the Economy tab and Home do not. A
plan read without it can leave out a bill that is due this month.

**Decision:** once the Expenses and Income stores have hydrated, the screen
calls the existing `rollForwardMonth(currentMonthKey)`, and calls it again
whenever the Expenses change, before it shows the plan. The re-run matters
because the root layout does not await the startup fetch: a series that the
fetch, or any other source, brings in after the first pass still gets its due
instance, and the plan updates. The typed amount is not a dependency, so typing
never triggers a pass. It is the Expenses overview's own operation, reused
unchanged:

- current month only, never a later month and never the skipped months between;
- idempotent: repeated passes, visits and later store updates create no second
  instance;
- APP-042 cadence, anchor and stop rules apply exactly as before, so a quarterly
  bill that is not due and a stopped series add nothing.

**What a pass writes** is inherited APP-042 behaviour, the same as for each
Expenses overview visit:

- every pass rewrites the Expenses store's local persisted state, even when
  nothing is due, because zustand's `persist` saves on every `set`;
- a pass that creates an instance stores it and, when signed in, upserts it
  through the existing best-effort path.

Those writes are the user's own recurring schedule, **not** the purchase.
Projecting "virtual" instances instead was rejected: it would be a second
recurrence implementation beside `rollForwardMonth`.

## The hypothetical purchase is never stored

The amount lives in the screen's React state only. It creates or changes no
Expense, income, savings goal or bank-shaped entry; it is not written to
AsyncStorage, Supabase, a backup, analytics, a log or an AI request; and it
does not change the Economy tab or Home totals. No store, persisted key,
schema or version, migration, backup format or data-profile classification
changed.

## Screen

`app/economy/affordability.tsx`, route `/economy/affordability` (Economy
module). Entry: a quick action on the Economy tab, **"Har jeg råd?"** /
**"Purchase impact"**.

1. What the screen is: "a calculation, not advice".
2. The amount field, validated live; invalid text shows a hint and no result.
3. This month's plan: registered income ("Ikke registreret" when missing),
   registered spending, and what is left before the purchase.
4. The result, once the amount is valid: the state as text, the purchase, what
   is left after it, and one factual sentence. For a missing income, an action
   opens the existing income screen for this month.
5. The assumptions, always visible and never collapsed: only this month;
   registered income and spending, including fixed expenses due this month; no
   forecast; no credit, loans, overdrafts or buy now, pay later; savings goals
   kept separate; the purchase is not saved; the same figures as the Economy
   overview.

Copy lives in `localization/locales/{da,en}/economy.json` under
`affordability`. Danish and English have identical keys and placeholders, and
a test rejects verdict or advice wording in both languages.

**Accessibility:** the amount field has its own label and a decimal keypad;
section titles are headers; each label and value is read as one element; the
state is always text, with colour only as a supporting dot; the income action
is a 44-point button; amounts use the shared formatter and text scales.

**Maintenance.** In `maintenance`, ModuleGate blocks only routes with a `new`
or `edit` segment (APP-005/APP-006), so this route stays open, as the Expenses
overview does. That classification describes the path, not the writes: the
materialization pass above still runs and can write, exactly as it does for the
Expenses overview. Skipping it when `canCreate` is false would show a plan
without a due recurring bill, so APP-044 keeps the inherited behaviour and
records it under Known limits. The purchase itself writes nothing in any module
state.

## Period boundary (APP-045)

The month is the Economy tab's rule, `getMonthKey(new Date())` on the device's
local calendar, read once per visit so the plan, its label and the materialized
month agree. No timezone service or `BudgetPeriod` abstraction was added, and
month boundaries across Home, Food and Economy are unchanged. Consistent periods
belong to APP-045.

## Tests

- `__tests__/purchaseImpact.test.ts`: the states, exact zero, a negative start,
  missing versus zero income, amount validation, unsafe arithmetic and input
  parsing. It also covers the APP-039 semantics through the production read
  model (booked, refund, transfer, pending, linked duplicates, no bank), with
  savings and budgets having no effect. It checks that evaluation has no side
  effects, holds the purity and import boundaries, checks DA/EN parity and
  rejects verdict copy.
- `__tests__/purchaseImpactScreen.test.tsx`: the Economy entry point; the plan
  and every result state in Danish and English; invalid input; the incomplete
  plan and its income action; the fail-closed message; visible assumptions and
  accessibility. It covers current-month materialization, idempotency, cadence
  and a series that the startup fetch delivers after the first pass, on the
  same open screen. With a signed-in client, it shows that typing amounts never
  calls `rollForwardMonth`, changes no store or storage and sends nothing, while
  the only write is the APP-042 materialization.

## Known limits

- **Materialization is still screen-triggered.** The Economy tab and Home can
  omit a due recurring bill until the Expenses overview or this screen has
  materialized the month. A single materialization point is a follow-up for
  APP-042/APP-045, not part of this story.
- **Existing APP-042 sync limits apply to the reused operation.** Two devices
  that materialize the same month before syncing can each create an instance.
  `seriesStoppedAt` is device-local. APP-044 adds a trigger, not a new mechanism.
- **Maintenance does not stop materialization writes.** Neither this screen nor
  the Expenses overview checks `canCreate` before `rollForwardMonth`, so a
  module in `maintenance` can still get a generated instance stored and synced.
  Making materialization maintenance-aware belongs with the single
  materialization point, not in this story.
- **"Registered spending" is APP-039's settled spending.** A manual expense
  dated later this month already counts, exactly as on the Economy tab.
- **A protected-storage hydration failure** leaves the screen in its loading
  state: no plan and no result, like the Home snapshot (APP-014).

## Not in scope

No forecasting, future-month planning, credit, loan, overdraft, buy now, pay
later or investment model; no recommendation or AI advice; no Savings funding
model; no category or Food budget integration; no bank connection; no new
store, table, migration, persisted simulation or backup change; no APP-045
period architecture.
