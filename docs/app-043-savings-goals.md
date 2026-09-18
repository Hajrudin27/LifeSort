# APP-043 savings goals

**Story:** APP-043 (E4 · Economy, P1) — *As a user I want to allocate savings to goals.*
**Acceptance:** target/current/deadline; no double count; links to Goals optional.
**Decision:** [ADR-0036](./adr/0036-savings-balances-change-only-through-validated-movements.md)
**Baseline:** `main` at `7b1d258`. Builds on [APP-039](./app-039-financial-read-model.md), [APP-040](./app-040-money.md), [APP-041](./app-041-manual-economy.md) and [APP-042](./app-042-recurring-bills.md).

APP-043 hardens the savings goals that already existed. It adds no new model,
store, route or persisted field.

## The contract

| Concept | Field | Rule |
| --- | --- | --- |
| Target | `targetAmount` | Supported money (APP-040) and > 0. |
| Current | `savedAmount` | The canonical current value. Never negative. No upper bound: overfunding is valid. |
| Deadline | `deadline?` | Absent, or a real `YYYY-MM-DD` calendar date. A past date is legitimate and is kept. |
| History | `SavingsContribution[]` | One signed entry per balance change, with exactly the amount applied. |

### Balances change only through movements

`utils/savings/savingsGoalRules.ts` is the single place the rules live. A
*movement* is a signed amount on one goal:

| Operation | Movements | Refused when |
| --- | --- | --- |
| Deposit / withdrawal (`addContribution`) | one, non-zero | goal missing; zero; result < 0 |
| Transfer (`transferBetweenGoals`) | −amount on the source, +amount on the destination | amount ≤ 0; same goal; either goal missing; amount > source balance |
| Allocation (`distributeContributions`) | one per goal, each > 0 | empty; any amount ≤ 0; repeated goal ID; any goal missing |

For every operation, every amount and every resulting balance must also be
supported money. The store validates the whole operation against the current
goals, then applies each movement to its goal **and** appends history with the
same amount in a single `set()`. So a balance and its history can no longer
disagree:

- a withdrawal above the balance is refused — 3,00 kr. held and 50,00 kr.
  requested changes nothing — instead of clamping to zero while recording −50,00;
- a transfer can no longer credit more than it debits, or target its own source;
- a repeated goal in one allocation can no longer record +100 and +200 while the
  balance moves by 100.

A refused operation throws a fixed code and leaves in-memory state, the persisted
bytes and the server untouched (tested for every path). Codes carry no amount,
name, goal ID or date.

| Code | Meaning |
| --- | --- |
| `savings_target_invalid` | target ≤ 0 |
| `savings_deadline_invalid` | not a real `YYYY-MM-DD` date |
| `savings_goal_not_found` | a movement names a goal that does not exist |
| `savings_amount_invalid` | zero contribution, or a transfer/allocation ≤ 0 |
| `savings_insufficient_balance` | a result would be negative |
| `savings_transfer_same_goal` | source and destination are the same goal |
| `savings_duplicate_goal` | one operation names a goal twice |
| `savings_allocation_empty` | an allocation with no entries |
| `money_unsupported_amount` | APP-040: an amount or result the app cannot persist |

`updateGoal` validates target and deadline the same way, can clear the deadline,
and copies only `name`, `icon`, `targetAmount` and `deadline` — never the balance.

The forms (`app/savings/[id].tsx`, `app/savings/allocate.tsx`) enable their
buttons with the same rules (`savingsMovementsAllowed`), so validation is not
duplicated by hand. The allocation screen now treats a negative entry as invalid;
before, it silently lowered the allocated total that the "remaining" check used.

## No double count

Economy has two kinds of fact, and APP-043 keeps them apart:

- **Canonical Economy facts** (APP-039): manual expenses, manual income and,
  later, bank transactions. They make up `settledSpending`, `settledIncome` and
  the monthly balance.
- **Savings allocation facts**: goal balances and their contribution history. They
  describe how the user earmarks money between their own savings buckets.

A contribution, withdrawal, transfer or allocation creates no Expense, no income
entry and no bank-derived entry, and it changes none of the APP-039 totals, Home's
Economy value or the monthly review's spending and income facts. This is tested
for all four operations. Savings history still feeds its own reporting (the
monthly review's saved/withdrawn fact and the insights trend); it is never merged
into Expense or income totals.

## Deadline and pace

The new-goal screen now offers the same optional deadline as the edit sheet (a
"Set a deadline" toggle and the existing `DatePickerField`). Editing can still
change or remove it.

Deadlines are validated and read with `parseCalendarDate` in
`utils/shared/localDate.ts`: exactly `YYYY-MM-DD`, a date the calendar has (leap
years included), nothing repaired, and no `Date` in between, so no UTC or local
timezone can shift it. `utils/savings/savingsPace.ts` does its month arithmetic
on those parts, never through `new Date()` (which parses `YYYY-MM-DD` as UTC and
can shift the month):

| Case | Required per month | Screen |
| --- | --- | --- |
| No deadline | none | — |
| Deadline in a later month | remaining ÷ whole calendar months from this month | "save X per month" |
| Deadline later this month, or today | remaining (this month counts as one) | "save X per month" |
| **Deadline passed, goal not reached** | **none** — previously remaining ÷ 1 | "The deadline was 15 January 2026." |
| Goal reached or overfunded | 0 | "Goal already reached!" |

The passed-deadline line is a plain fact, with no warning colour or
motivational copy. Pace values stay derived display numbers and are never stored.
The "at your current pace" estimate still averages **deposits only** since the
first deposit, as before; withdrawals and transfers out do not lower it.

## Accessibility and copy

- The "+" on the savings overview opens *Add to savings* (extra savings). Its
  label said "Add savings goal"; it now says what it does.
- English `addExtraTitle` / `addExtraHint` were Danish; they are now English.
- The history chart has a text alternative: its accessibility label and a visible
  caption give the number of movements, the first and last date, the net change,
  and the amounts added and taken out (`utils/savings/savingsHistorySummary.ts`).
- The allocation fields are labelled with their goal, and the edit sheet's name
  and target fields have labels. The edit button uses `savings.edit`.
- Danish and English `savings.json` have identical keys (tested).

## Database

Migration `supabase/migrations/20260918120000_savings_goal_integrity.sql`,
verified by `tests/db/app043.test.cjs` on a scratch cluster. **It has not been
applied to any remote project.** APP-042's migration (`20260917120000`) is not
applied remotely either; a normal `supabase db push` would apply APP-042's first,
then this one.

| Constraint | Definition |
| --- | --- |
| `savings_goals_target_amount_positive` | `target_amount > 0 and target_amount < 'Infinity'` |
| `savings_goals_saved_amount_non_negative` | `saved_amount >= 0 and saved_amount < 'Infinity'` |
| `savings_history_goal_fkey` | `(user_id, goal_id)` → `savings_goals (user_id, id)` `ON DELETE CASCADE` |

Plus the index `savings_history_user_id_goal_id_idx` for the key. The finite
bounds matter: PostgreSQL orders `NaN` above every number, so `NaN > 0` is true.
There is deliberately no `saved_amount <= target_amount` and no
`saved_amount = sum(history)` rule. RLS, policies and grants are unchanged.

**All three are `NOT VALID`.** They apply to every insert and update from now on,
but existing rows are not re-checked, and nothing is rewritten or deleted:

- History can outlive its goal through legitimate app behaviour — the client
  deletes the goal and then the history in two requests — and deleting such rows
  would guess the user's intent.
- Every shipped form required a positive target and the store clamped at zero, so
  legitimate rows should pass both CHECKs, but direct API writes or restored
  hand-edited backups cannot be ruled out, and one such row would fail a
  validating migration.

A pre-existing row that violates a CHECK keeps its value but must be corrected
before it can be updated.

### Validating later

After the migration is live, run this **read-only** audit against production:

```sql
select count(*) from public.savings_goals where not (target_amount > 0 and target_amount < 'Infinity'::numeric);
select count(*) from public.savings_goals where not (saved_amount >= 0 and saved_amount < 'Infinity'::numeric);
select count(*) from public.savings_history h where not exists
  (select 1 from public.savings_goals g where g.user_id = h.user_id and g.id = h.goal_id);
```

Only when all three return 0 can a follow-up migration run
`alter table ... validate constraint ...` for each. Non-zero results need a
product decision per row, not an automatic repair.

### The client

Goal rows are now written before the history rows that reference them, and the
history insert is attempted **only after the goal upsert succeeded**. Supabase
reports a refused write as `{ error }` rather than throwing, so the store checks
the goal result: on an error the sync attempt stops, and no history is sent that
the server balance does not reflect. The local change stays (local-first), and
nothing is retried or logged. The path is otherwise the legacy one: direct and
best-effort. The reverse partial write — goal saved, history refused — is not
rolled back and remains known sync debt (see below).

Deleting a goal still sends the history delete as a second request; with the
cascade it is a no-op, but it keeps pre-migration servers and pre-existing
orphans working.

Clients older than APP-043 still send the two requests side by side. For a goal
that never reached the server (created signed out or offline), their history
insert can now be refused by the foreign key instead of arriving first.

## Persistence and backup

- Local store `lifesort-savings-goals` stays **v1**: no field was added or
  changed, so there is no local migration. v0 data still migrates through
  APP-040's step and then obeys the APP-043 rules (tested with the historical
  fixture).
- Backup format stays **3**. Savings round-trips unchanged, including deadlines,
  overfunded goals and signed history.
- Remote hydration keeps its merge policy: unknown IDs are appended, local copies
  win, and one invalid amount still rejects the whole snapshot.
- Restored backups and hydrated rows are not re-validated against the new rules;
  legacy data is kept as it is, and only new mutations are refused.

## Sync limitation

Savings still uses the pre-APP-031 direct Supabase writes, not the outbox. APP-043
enforces its invariants **per device**. It does not make concurrent edits on two
devices safe: each device upserts whole goal rows with the balance it computed,
so two devices moving money from the same goal can leave the server balance out
of step with server history. On one device, a goal write that succeeds followed by
a history write that fails leaves the same kind of gap; it is not rolled back or
retried. ADR-0030 classifies only `SavingsContribution`
history (append-only); mutable goals, `targetAmount`, `deadline`, `archived`,
`extraSavings` and coupled contribution/balance pairs have no reviewed conflict
contract. The fix is a server-side savings command that applies movements and
history in one transaction, as a separate story.

## Known debt

- **"Available" is not an authoritative figure.** The overview and allocation
  screens show `current month's Economy balance − total saved across all goals +
  extraSavings`. That mixes one month's balance with lifetime balances and a
  persistent extra amount, and the funding source of historical contributions is
  unknown. APP-043 leaves the formula unchanged, and no new rule depends on it.
  Making it correct needs an explicit funding model, not a guess about history.
- The pace estimate ignores withdrawals (see above).
- Savings goals are not linked to Life Goals; the criterion makes that optional.
