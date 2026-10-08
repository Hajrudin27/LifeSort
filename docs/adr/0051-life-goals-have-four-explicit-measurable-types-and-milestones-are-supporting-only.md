# ADR-0051: Life goals have four explicit measurable types and milestones are supporting only

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-063 |
| **Superseded by** | – |

## Context

Before APP-063 a Life goal was `{ id, title, description?, deadline?, subGoals[], createdAt }` and
its only measure of progress was the share of completed sub-goals. A goal with no sub-goals was
always 0% and always active, a goal could not state a number it was working towards, and three
screens each derived progress themselves: the list and detail screen per goal, and the Life dashboard
as a sum over every sub-goal of every goal, which is a different figure from any single goal's ring.
The master specification (APP-063, P0) asks for measurable goals: "Type = count / amount / duration /
binary; milestone / deadline; validation".

Writes also resolved the owner with `getUser()` after an `await`, so a write started by Account A
could be sent under Account B's session and store A's goal title and description in B's account.
Responses were applied without checking that the account was still the one that asked.

## Decision

**Four types, one canonical model.** `LifeGoal` is a discriminated union of exactly `binary`,
`count`, `amount` and `duration`, with a shared base (`id`, `title`, `description?`, `deadline?`,
`milestones`, `createdAt`). Impossible states are unrepresentable: a binary goal has `completed` and
no numbers; a numeric goal has `target` and `current` and no stored completion; only `amount` has a
`unit`. The type is immutable: changing it means creating a new goal.

| Type | Stored | Meaning |
| --- | --- | --- |
| binary | `completed: boolean` | one outcome; reopenable; no timestamp |
| count | integer `target`, `current` | a tally with no unit |
| amount | integer hundredths of `unit` | a **non-currency** quantity with a required 1–24 character unit |
| duration | integer minutes | a finite amount of time, never a schedule |

Every stored integer is a safe integer in `[0, 10^12]` (target at least 1), checked identically in
JavaScript and in SQL. Values are parsed from typed text by digit strings; no stored value is derived
from floating-point arithmetic. `current` may exceed `target`.

**Derived completion and one progress definition.** Numeric completion is `current >= target`;
progress is `min(1, current / target)`; binary is 0 or 1. `goalProgress`, `goalIsCompleted` and
`meanGoalProgress` are the single implementation used by the list, the detail screen and the Life
dashboard, whose figure becomes the mean of each goal's own progress (0 with no goals). Editing a
target below `current` therefore completes the goal, and raising it reopens it, with nothing stored
that can disagree. Numeric progress is changed only by `setGoalCurrent(absoluteValue)`, which is
idempotent under a retry; there is no increment API and no history.

**Milestones are supporting structure.** They are optional, ordered, available on every type, have
unique ids and never affect progress or completion: completing every milestone does not complete a
binary goal, and adding one never reopens a completed goal. There is no count limit on historical
data. The old `SubGoal` is renamed `GoalMilestone`; the shape is unchanged and the server column keeps
the name `sub_goals`.

**Deadline.** An optional civil date `YYYY-MM-DD` validated by the existing calendar primitive. Today,
the past and the future are all valid; it can be cleared; a passed deadline is neither a failure nor
a state change and carries no punitive wording. The new-goal screen used to drop the deadline when the
user opened the picker and accepted the date it showed; adding a deadline now selects that date.

**Legacy goals become binary goals, and nothing numeric is invented.** A pre-APP-063 goal maps to a
`binary` goal whose milestones are its sub-goals verbatim and whose `completed` restates the only
completion rule the app ever had: at least one sub-goal and all done. A historically completed goal
stays completed and adding a milestone later does not reopen it; an open goal with `2 / 3` sub-goals
keeps its `2 / 3 milestones` as text but its ring becomes 0%. Both are accepted, visible consequences.
The same mapping serves the local migration, backup formats 1–10 and server rows with no typed
columns.

**Where the code lives.** The module's rules are in `features/goals/domain/` (progress, completion,
building and changing goals, input parsing, server-row mapping). They are not in `core/`, because they
are one module's business rules (core contract C2). One thing must be visible to the platform: the local
migration and the backup parser are both core and must validate exactly what the store persists. That is
the persisted *format*, and only that lives in `core/goals/persistedGoal.ts`: the exact per-type key
sets, the 10^12 bound and unit rule, strict decoding of a stored list, and the frozen mapping of the old
`subGoals` shape onto a binary goal. It is the same documented C2 exception that `core/food/ingredients`,
`core/economy/recurrence` and `core/home/moving` already are (`docs/core-contract.md`), it imports only the
shared entity types and the calendar primitive, and `features/goals/domain` imports it, so the dependency
points inward. An earlier draft of this story kept the format in the feature and let the two core files
import it; that put a `core/` → `features/` edge in the platform, which ADR-0003 forbids ("core may never
depend on a module"). Rule R6 did not flag it because it matches stores, domain utils, routes and
components but not `@/features/*`; that gap is real and remains, so
`__tests__/goalDomainBoundary.test.ts` enforces it for the whole platform with a frozen baseline of one
pre-existing edge (`core/auth/deleteAccount.ts` → `features/localStores`, the logout registry) and also
checks that the core contract carries no live rules, that exactly the migration, the backup parser and the
Goals domain import it, and that the domain stays a pure leaf. Extending R6 itself to `features/` is a
follow-up; the exception shrinks when the export-handler registry (APP-097) replaces the hand-maintained
backup list.

**Persistence.** The Goals store moves under the APP-038 harness (Z0→Z1, retained fixture `9c5330f`),
persists only `goals`, and no longer hydrates unvalidated data. Backup becomes format 11: formats 1–10
decode the old shape through the legacy mapping, v11 carries all four types strictly, and the export is
a whitelist of the goals themselves. Malformed or cross-typed goals, an unknown field, a duplicate id
and a future version fail closed.

**Server.** `life_goals` gains five nullable columns (`goal_type`, `target_value bigint`,
`current_value bigint`, `unit`, `completed`) and one CHECK with an explicit shape per type and the same
10^12 bounds. Every branch guards each nullable column with an explicit `IS [NOT] NULL`: a CHECK also
passes on NULL, and an unguarded `goal_type = 'binary'` let a row with no type but a stored `completed`
through; the disposable-database test enumerates all 4,320 NULL / boundary combinations against an
independent oracle and fails if that guard is removed. All typed columns NULL is a legacy goal and
remains valid permanently, because an older client keeps creating such rows. `sub_goals` is untouched.
An older client's upsert lists only the historical columns, so PostgreSQL's merge never touches the new
ones; this is proven against Postgres with the exact `ON CONFLICT … DO UPDATE SET` shape. An old
client that edits milestones on an already converted binary goal does not change its explicit
`completed`. No table, RPC, revoked write path or grant change.

**Account isolation.** Writes capture the acting account when the user acts; after the single `await`
the live session must still be that account or the write is dropped, and the outgoing row and filter
carry the initiator's `user_id`, so a request that still reaches the server under another session is
refused by the owner RLS instead of re-owning the goal. A fetch records the account and a dataset epoch
before it starts and discards its result if either changed, so it can never repopulate a logged-out
store or mix accounts. Remote rows are validated before they reach state: partial, cross-typed or
malformed rows, and non-array `sub_goals`, are dropped rather than rendered.

**Boundaries.** An amount is a measurement, not money: there is no currency, no `MinorUnits`, no link to
Savings Goals and no balance. Money goals belong to Economy (ADR-0036 still says the two are not
linked). A goal is a finite outcome; recurrence, schedules, streaks, logs and missed days are Habits
(APP-064) and are not added here.

## Consequences

- Every goal has one unambiguous progress and completion, and three screens can no longer disagree.
- The ring of an old partially completed goal drops to 0%, and the dashboard percentage changes to the
  mean of per-goal progress. Both were approved.
- Z1 and backup v11 are one-way. An older app build that meets Z1 data fails closed; the server change
  is additive and nullable, so older clients keep working against it.
- **Goals are not production-sync-ready.** This story deliberately keeps the original best-effort sync
  (whole-row upsert, append-only refresh). Known, deferred races: concurrent numeric changes clobber
  each other; a stale device's edit overwrites a target, a current value or a completion changed
  elsewhere; the whole milestone list is replaced as one JSON value; a failed delete can reappear and a
  delete can race an edit and resurrect the goal; offline writes are lost; a stale client can resurrect
  deleted goals; another device's changes to a goal already held locally never arrive. The follow-up
  **"Goals durable sync"** (outbox, receipts, revisions, tombstones, an explicit conflict policy and a
  refusal handler, as for Home tasks in APP-061) is required before Goals count as a migrated, sync-safe
  domain. It was not given an APP number because the repository has no defined process for that.
- Out of scope and unchanged: Savings Goals (which still resolves its owner asynchronously and has the
  same account-binding defect; reported separately), Habits, Shopping and Moving.

## Alternatives considered

- **Derive progress from milestones.** Rejected: a mutable list would change a goal's percentage when
  a step is added or removed and would disagree with an explicit target.
- **Legacy goals become count goals with `target = number of sub-goals`.** Rejected: it invents intent,
  and the target would move whenever a sub-goal was added or removed.
- **A fifth "legacy" type.** Rejected: the specification names four; binary with preserved milestones
  needs none.
- **Legacy goals all open (`completed = false`).** Rejected: it would resurrect every historically
  completed goal.
- **Currency amounts with `MinorUnits`.** Rejected: it would duplicate Savings Goals as a second source
  of financial truth.
- **Floating-point or `numeric` columns.** Rejected: exact integers in a fixed unit need neither.
- **A JSON payload column for the typed state.** Rejected: five typed columns can carry a real,
  testable CHECK.
- **Stored completion for numeric goals.** Rejected: a flag next to `current` and `target` can disagree
  with them.
- **An `incrementBy(delta)` mutation.** Rejected: a replayed delta counts twice; an absolute value does
  not.
- **Adopting the durable sync platform in this story.** Rejected for scope: it is a story of its own
  (a dedicated RPC envelope, receipts, revisions, tombstones, a conflict policy), and the P0 deliverable
  here is the semantics; the dependency on it is documented above instead.
- **Putting the whole domain in `core/`.** Rejected: it is one module's rules; only the persisted format
  that two core consumers must share is in core.
- **Letting core import the feature domain** (the first draft). Rejected as above: it is the exact edge
  ADR-0003 forbids, and it would make the Goals module impossible to disable or retire without breaking
  the startup migration.
- **Registering decoders with the platform at startup** (full inversion). Rejected as larger than the
  problem: the migration runtime and the backup parser need the decoders before any feature code has run,
  so a registry adds ordering rules for no gain over a small, dependency-free format module.
