# APP-063 — Goal semantics

Master specification: E7 · Goals, habits, career & gifts · P0 — "Som user vil jeg create measurable
goals." Acceptance: *Type = count / amount / duration / binary; milestone / deadline; validation.*
Decision record: [ADR-0051](./adr/0051-life-goals-have-four-explicit-measurable-types-and-milestones-are-supporting-only.md).

## The model (`types/life.ts`; format in `core/goals/`, rules in `features/goals/domain/`)

Code layout: `core/goals/persistedGoal.ts` is only the persisted format (per-type shapes, the bound, strict
decoding and the frozen legacy mapping) that the migration and backup parser need; `features/goals/domain/`
holds progress, completion, builders, mutations, input parsing and server-row mapping and imports core.
`goalDomainBoundary.test.ts` keeps both pure and forbids any platform file from importing a feature.

```ts
GoalMilestone { id; title; completed }
GoalBase      { id; title; description?; deadline?; milestones: GoalMilestone[]; createdAt }
LifeGoal = BinaryGoal   & { type: 'binary';   completed: boolean }
         | CountGoal    & { type: 'count';    target: number; current: number }
         | AmountGoal   & { type: 'amount';   target: number; current: number; unit: string }
         | DurationGoal & { type: 'duration'; target: number; current: number }
```

| Type | Unit of storage | Target | Current | Completed when |
| --- | --- | --- | --- | --- |
| binary | boolean | none | none | `completed === true` (mark as done / reopen; no timestamp) |
| count | integer | ≥ 1 | ≥ 0 | `current >= target` |
| amount | integer hundredths of `unit` | ≥ 0.01 | ≥ 0 | `current >= target` |
| duration | integer minutes | ≥ 1 min | ≥ 0 | `current >= target` |

- Every stored integer is a safe integer, at most **1 000 000 000 000**; this bound is enforced in
  `isGoalValue`/`isGoalTarget` and in the SQL CHECK.
- `current` may exceed `target`; the ring clamps at 100% but the real numbers are shown (`30 / 12`).
- Numeric completion is **derived**, never stored, so editing the target below `current` completes the
  goal and raising it reopens it.
- The **type is immutable**; another type means a new goal. A field that does not belong to the type is
  refused everywhere (store, migration, backup, remote row, server).
- **Amount is a measurement, not money.** The unit is trimmed free text of 1–24 characters, stored
  exactly; there is no currency, no `MinorUnits` and no link to Savings Goals. The screen says so.
  Money goals belong to Economy.
- **Duration is a finite quantity**, entered as hours and minutes and stored as minutes only. A
  recurring target ("three times a week") is a Habit (APP-064).
- Titles and descriptions have no new length cap (history must keep loading); the unit and the typed
  numbers are validated.

## Progress and completion (one implementation)

`goalProgress(goal)` → `0..1`; `goalIsCompleted(goal)`; `meanGoalProgress(goals)`;
`goalMilestoneSummary(goal)`.

- binary: 0 or 1. Numeric: `min(1, current / target)`. An impossible target (< 1) gives 0, never a
  division by zero.
- The list ring, the detail ring, the Active / Show completed filter and the Life dashboard all call
  these. The **Life dashboard** percentage is the mean of every goal's own progress (0 with none); it
  used to be a sum over all sub-goals of all goals.
- Milestones never contribute. `2 / 3 milestones` is secondary text.

## Milestones

Optional, ordered by array position, allowed on all four types, unique ids, `{ id, title, completed }`.
They are supporting steps only: completing every one does not complete a binary goal and adding one
never reopens a completed goal. No count limit applies to existing data.

## Deadline

Optional `YYYY-MM-DD` (existing strict calendar primitive). Today, past and future are valid; it can be
cleared (new and edit screens); a passed deadline changes nothing and is shown neutrally ("Deadline:
2026-12-01"). Fixed bug: the new-goal picker showed today but saved nothing unless the date was changed;
adding a deadline now selects the date that is shown. No reminders.

## Mutations (`store/useLifeGoalsStore.ts`)

`addGoal(input)`, `updateGoal(id, { title?, description?, deadline? | null, target?, unit? })`,
`setGoalCurrent(id, absolute)` (numeric only), `setGoalCompleted(id, boolean)` (binary only),
`removeGoal`, `addMilestone`, `toggleMilestone`, `removeMilestone`. Each validates in the domain and
throws a fixed `GoalError` code (`goal_title_invalid`, `goal_target_invalid`, …) before any state or sync
change. There is no `increment`: an absolute value is idempotent under retry. There is no history.

## Legacy goals

A pre-APP-063 goal `{ id, title, description?, deadline?, subGoals[], createdAt }` becomes a
**binary** goal. Sub-goals are kept verbatim as milestones; `completed` = at least one sub-goal and all
done. No count, amount, duration or unit is invented.

| Historical goal | Becomes |
| --- | --- |
| no sub-goals | binary, not completed |
| 2 of 3 sub-goals done | binary, not completed, ring 0%, `2 / 3 milestones` shown |
| all sub-goals done (≥ 1) | binary, completed |

Accepted changes: a partial goal's ring drops to 0%; adding a milestone to a historically completed goal
no longer reopens it. The same mapping applies in the local migration, backup formats 1–10 and any
server row with all typed columns NULL.

## Persistence

| Surface | Change |
| --- | --- |
| Local `lifesort-life-goals` | Z0 → **Z1** through the APP-038 harness (`core/storage/migrations/goals.ts`; retained fixture `9c5330f`); `version: 1`, `partialize` to `goals`. Malformed goal or milestone, unknown field, duplicate id and future versions fail closed with the original bytes preserved. The registry entry is no longer `external`. |
| Backup | v10 → **v11**. Formats 1–10 use the legacy mapping; v11 is strict for all four types; the export is `{ goals }` only (no runtime, sync or validator state). Partial restore keeps the current goals when the field is absent. |
| Supabase `life_goals` | additive nullable `goal_type`, `target_value bigint`, `current_value bigint`, `unit`, `completed` and one CHECK (migration `20261007180000_app063_life_goal_semantics.sql`; not deployed by this work). `sub_goals` is kept and holds the milestones. |

CHECK per shape: **legacy** all five NULL; **binary** `completed` set, numbers and unit NULL;
**count / duration** target `1..10^12`, current `0..10^12`, unit and completed NULL; **amount** as count
plus a trimmed unit of 1–24 characters. Each branch guards every nullable column with an explicit
`IS [NOT] NULL` (a CHECK passes on NULL). No float or `numeric` column.

## Old clients and mixed fleets

An older client's upsert lists only `id, user_id, title, description, deadline, sub_goals, created_at`, so
a typed row keeps its typed columns (proven on Postgres with the exact `ON CONFLICT … DO UPDATE SET`).
A row an older client creates has every typed column NULL; a new client **permanently** reads that as a
legacy goal through the same mapping and converts it to typed columns on its first write. After that, an
older client toggling milestones does not change the explicit `completed` of a binary goal (accepted).
No direct write path is revoked.

## Account isolation (fixed in this story)

Write operations capture `initiatingAccountId()` synchronously, re-check the live session after the one
`await`, and send the initiator's `user_id`; a request that still goes out under another session is
refused by the owner RLS. A fetch captures account and dataset epoch first and discards its result if
either changed (logout, account switch, restore). Remote rows are validated before they reach state.
`clearLocal` and `restoreBackup` advance the epoch, and the logout reset uses `clearLocal`.

## Known, deferred: Goals are not production-sync-ready

Sync is unchanged and best-effort. Not solved here: concurrent numeric changes clobber each other; a
stale device's whole-row write overwrites a target, current value or completion changed elsewhere; the
whole milestone list is one JSON value; a failed delete reappears; delete versus edit can resurrect a
goal; offline writes are lost; stale clients resurrect deleted goals; changes made on another device to
a goal already held locally never arrive. The follow-up **"Goals durable sync"** (outbox, receipts,
revisions, tombstones, conflict policy, refusal handler — the APP-061 pattern) is required before Goals
are a migrated, sync-safe domain. No APP number was assigned (no defined process).

## Boundaries

Savings Goals (APP-043) are untouched and unlinked: no currency, balance or contribution is shared.
Habits are untouched: no recurrence, frequency, schedule, streak, log or missed-day concept was added.
`useSavingsGoalsStore` still has the asynchronous-owner defect Moving and Goals had; it is reported, not
fixed.

## UI

New goal: type chooser (four chips with a plain-language hint), title, description, per-type target,
optional starting progress and, for amount, the unit; deadline with an explicit remove control. Errors are
localized, shown next to the field and announced (`alert`). Detail: canonical ring and real numbers,
"target reached", milestone summary, deadline, "Update progress" (absolute), "Mark as done" / "Reopen",
milestones as checkboxes (role, state, 44 pt rows, labelled 44 × 44 remove), and an edit sheet (title,
description, target, unit, deadline) that states the type cannot change. List: canonical ring and value
text per goal, milestone summary as secondary text, completion filter. DA and EN; theme colours only.

## Rollback

Forward only. Z1 and backup v11 are one-way, and an older build meeting Z1 data fails closed. The SQL is
additive and nullable and keeps `sub_goals`, so older clients keep working. No user intent is fabricated:
every historical field survives and the only derived value restates the old completion rule.

## Tests

`goalDomain` (shapes, bounds, progress, builders, milestones, legacy mapping, remote rows, parsing,
form), `goalMigration` (Z0 → Z1 with the `9c5330f` fixture, fail-closed cases, Z1 validation),
`goalBackup` (v10 → v11 and real export/import), `goalStore` (mutations, persistence, upgrade on
hydration, account binding, stale fetch), `goalScreens` (create each type, detail, list, accessibility,
DA/EN), `goalLifeDashboard`, `goalDomainBoundary`, and `tests/db/app063.test.cjs` (additive schema,
exhaustive 4,320-combination CHECK oracle, old-client upsert, RLS, cascade).
