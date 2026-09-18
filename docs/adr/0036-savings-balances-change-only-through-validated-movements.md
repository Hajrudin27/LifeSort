# ADR-0036: Savings balances change only through validated movements

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-18 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-043 |
| **Superseded by** | – |

## Context

Savings goals already existed: a goal has a target, a current balance
(`savedAmount`), an optional deadline, and a history of signed contributions.
Four store actions changed balances, and each computed the new balance and the
new history entry separately. They disagreed in practice:

- a withdrawal larger than the balance clamped the balance to zero but recorded
  the full negative amount;
- a transfer clamped the source but credited the destination with the full
  amount, creating savings value out of nothing, and accepted the same goal on
  both sides;
- a distribution with a repeated goal ID recorded every allocation but applied
  only the first; negative allocations were accepted;
- a contribution to a goal that did not exist still appended history.

The forms happened to prevent most of this, but the store is the domain boundary
(APP-040 already validates money there), so any other caller could corrupt data.
On the server, `savings_history` had no link to `savings_goals` at all, and no
amount CHECKs existed.

APP-043's acceptance criteria are target/current/deadline, no double count
(APP-039's financial facts), and an *optional* link to Life Goals.

## Decision

- **A balance changes only through movements.** A movement is a signed amount on
  a named goal. `utils/savings/savingsGoalRules.ts` builds them (contribution:
  one non-zero movement; transfer: −amount and +amount on two different goals;
  allocation: one strictly positive movement per distinct goal) and validates
  them against the current goals: every goal exists and appears once, every
  resulting balance is ≥ 0 and supported money. The store applies each movement
  to its balance and appends history with *the same amount*, in one `set()`, so
  history and balance cannot disagree about an operation.
- **Refused operations are atomic.** Validation throws before `set()`, before
  persistence and before any server request. Codes are fixed
  (`savings_insufficient_balance`, `savings_duplicate_goal`, …) and carry no
  amount, name, ID or date. Nothing is clamped.
- **Target and deadline are validated in the store too.** A target is supported
  money and > 0. A deadline is absent or a real `YYYY-MM-DD` calendar date;
  nothing is normalized, and a past date is legitimate. An edit copies only the
  editable fields, so it can never reach the balance.
- **`savedAmount` stays the canonical current value.** No second field; no upper
  bound, because saving more than the target is valid.
- **Savings movements are allocation facts, never Economy facts.** They create no
  Expense, income or bank entry and do not change APP-039 totals. Savings history
  remains its own reporting source.
- **The server gains the same invariants, `NOT VALID`.** `target_amount > 0`,
  `saved_amount >= 0` (both finite), and `(user_id, goal_id)` references
  `savings_goals (user_id, id)` with `ON DELETE CASCADE`, which matches the app's
  existing delete behaviour. `NOT VALID` enforces every new write without
  re-checking existing rows, because the repository cannot prove what production
  holds and orphan history is plausible from legitimate partial deletes.
  Validation is a later, explicit step after a read-only audit.
- **History is sent only after its goal upsert succeeded.** The two requests used
  to run side by side; with the foreign key, history must not arrive first. And
  because supabase-js reports a refused write as `{ error }` rather than throwing,
  the goal result is checked: if the goal write fails, the history write is not
  attempted, so server history cannot record a change the server balance never
  got. The path is otherwise unchanged: direct, best-effort, no retry, no logging.
  The reverse partial write (goal saved, history refused) is not rolled back; it
  stays legacy sync debt.
- **Calendar dates come from the shared date module.** Savings validates and
  reads deadlines with `parseCalendarDate` in `utils/shared/localDate.ts`, not
  with Economy's recurrence module.
- **No link to Life Goals.** The criterion makes it optional, and nothing in the
  repository needs it.

## Consequences

- The balance ↔ history invariant holds for every operation made through this
  store, on this device. It is tested through the real store, including a mixed
  sequence of accepted and refused operations.
- Existing local data, backups and remote hydration are unchanged: no local
  schema bump, no backup format bump, no change to the merge policy. Legacy data
  that already violates a rule is kept as it is; only new mutations are refused.
- A pre-existing server row that violates a `NOT VALID` CHECK must be corrected
  before it can be updated. No shipped client could write such a row.
- Clients older than APP-043 still send their two requests side by side. For a
  goal that has never reached the server (created signed out or offline), their
  history insert can now be refused by the foreign key instead of arriving before
  its goal. This is a narrow window in an already best-effort path, and it is
  documented rather than worked around.
- **Not solved:** cross-device consistency. Each device upserts whole goal rows
  with its own computed balance, so two devices moving money from one goal can
  still leave the server balance out of step with server history. Fixing that
  needs a server-side savings command that applies movements and history in one
  transaction (in the style of ADR-0027), not a client-side merge rule. No global
  last-write-wins or new conflict policy was introduced; ADR-0030 still classifies
  only `SavingsContribution` history.

## Alternatives considered

- **Keep clamping, but record the clamped amount.** Rejected: a withdrawal the
  user asked for would silently become a smaller one. Refusing is honest and the
  form already prevented it.
- **Validate only in the forms.** Rejected: the store is the domain boundary, and
  APP-040 already enforces money rules there.
- **A validated (not `NOT VALID`) migration, or delete orphans first.** Rejected:
  a single unexpected row would fail the deployment, and deleting orphans would
  guess whether a goal deletion or a failed goal write caused them.
- **A database rule that `saved_amount` equals the sum of history.** Rejected:
  the client writes them in separate requests, and historical rows need not
  satisfy it.
- **Move savings onto the outbox and conflict engine now.** Rejected for APP-043:
  mutable goals, balances and coupled contribution/goal pairs have no reviewed
  conflict contract, and inventing one here would be a new sync architecture.
- **A funding ledger to make "available" savings authoritative.** Rejected: the
  funding source of historical contributions is unknown and cannot be derived.
