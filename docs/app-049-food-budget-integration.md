# APP-049: Food budget integration

Baseline: `4456bdff4b21604818b22383451895cd8727cd54`
(`feat: add price freshness semantics`). HEAD, main and origin/main matched; the
working tree was clean before editing. Product scope: Mobile Master Production
Specification v1.0 §8.2 and APP-049. See also [APP-045](./app-045-budget-periods.md),
[APP-048](./app-048-price-freshness.md), [ADR-0037](./adr/0037-budget-periods-are-copenhagen-calendar-periods.md)
and [ADR-0039](./adr/0039-price-freshness-requires-temporal-provenance.md).

## Audit

`food_monthly_budget` is the existing persisted Food budget authority.
`foodBudgetFacts` in `features/food/budgetReadModel.ts` is the existing pure,
discriminated read contract for no budget versus monthly budget, Copenhagen
month/week, weekly allocation, weekly spending and signed remaining allocation.
It divides the monthly value by ISO weeks touching the Copenhagen month, using
`core/dates/budgetPeriod.ts`. Food overview, weekly plan, Home Food snapshot and
Economy Food card already consume this model. A set zero is distinct from no
budget in the read model; the budget form previously rejected zero input.

Food purchases persist in `food_purchases`, separately from Economy `expenses`.
Food's budget, purchase, plan and shopping methods write only their own Food
tables. Economy category budgets are persisted in `expense_category_budgets` as
APP-040 MinorUnits, without a canonical groceries-to-Food mapping. APP-039's
`FinancialEntry` does not accept a Food purchase source or carry a Food/Expense
correlation contract. Food remains on legacy major-unit numbers. No schema or
storage change is needed.

The gap was limited to weekly planning: it passed the full `weeklyBudget` to
`planWeek`, ignoring purchases already placed in the week. It also passed 0
when no monthly budget existed, turning “not set” into a budget cap.

## Behavior

The Food monthly budget is still saved only to `food_monthly_budget`.
`foodBudgetFacts` remains the only week-allocation calculation. The planner
receives `facts.remaining` as its numeric cap, or `null` for no budget.
`null` means planning without a budget cap; a set zero remains a real zero cap.
A negative remainder is passed unchanged: no new unlocked candidate with a
nonnegative known-price subtotal can fit, while explicit locked recipes stay.
Already chosen plans remain chosen when purchases or budget change, and the
screen updates its comparison to the new remaining allocation. Regeneration
uses the new cap.

`assessFoodPlanBudget` compares APP-048's current/partial/unavailable estimate
with the signed remaining allocation. It never turns a partial subtotal into
confirmed budget fit. The UI shows weekly allocation and remaining spending,
then qualifies the plan comparison by price completeness. APP-048's item source,
scope, campaign dates and warnings remain visible. This comparison is not a
promise of final cost: name matching, package sizes, quantities and unknown
prices remain limitations of the current planner.

No Food action calls Economy's expense store or writes `expenses` or
`expense_category_budgets`. Food purchases are not added to APP-039 financial
entries. This avoids inventing a Food/Expense correlation and possible double
counting. Economy's Food card continues consuming Food's public read model,
without new store coupling or a second allocation formula.

## Tests and governance

Tests cover the existing four/five-week rule and ISO year edge, Copenhagen
purchase placement, absent/zero/negative budget, the reduced planning cap,
current versus partial/unavailable price comparisons, the four UI surfaces,
budget and purchase updates, Economy category budget isolation, and exact Food
Supabase write destinations. Existing APP-045 and APP-048 tests remain intact.

No migration or persistence contract changes were made; no database test is
needed for this UI/domain integration. No new ADR is required by the register:
the established APP-045 allocation and APP-048 price provenance decisions remain
in force, and no governed storage/sync/auth path changes. `check:adr` compares
commits only, so it does not see uncommitted work; working-tree paths were
checked against the same governance rule manually.

Future Food/Expense reconciliation, retailer-to-category mapping, Food money
migration, pantry redesign and full offer-aware planning remain deferred.
