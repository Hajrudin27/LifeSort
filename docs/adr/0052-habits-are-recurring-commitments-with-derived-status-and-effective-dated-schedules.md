# ADR-0052: Habits are recurring commitments with derived status and effective-dated schedules

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-08 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-064 |
| **Superseded by** | – |

## Context

Before APP-064 a habit was `{ id, title, direction, targetPerWeek?, logs[], createdAt }`. It had no
schedule beyond an unvalidated number, no start date, no notion of a day that was expected, and a
streak that was the only measure the app produced. The master specification (APP-064, P0) asks to
"track recurring behavior separately from one-time tasks": frequency or schedule, local date,
missed-day semantics and history.

Concrete defects that shaped the decisions:

- `targetPerWeek` was `parseInt(text)` with no bound: 0, a negative number and 40 were all stored.
- `toggleLogForDate` accepted any string, removed *every* entry on a date and could be double-fired.
- Three views each counted "this week" differently (`>= monday` including future dates, `n/7`, a
  separate label), and weekdays were taken from `getDay()` on stored dates.
- The week row stored the previous civil day in timezones east of UTC before `dd16507`; those dates
  are in real data and cannot be told apart from correct ones.
- `habit.createdAt.slice(0, 10)` (a UTC date) was compared with local dates, and the calendar
  derived its first month from a different expression than its first enabled day.
- A streak (`getCurrentStreak`) reset to zero the moment today was unlogged, shown in four places,
  and a "Restart your habit streak" focus card. ADR-0012 already says a monthly review must not
  produce that kind of number; the live screens did.
- Writes resolved the owner with `getUser()` after an `await`, so a write started by Account A could
  be sent under Account B's session; a fetch was applied without checking the account that asked.
- The Cycle insights card computed a habit "completion rate" per cycle phase in which every day since
  creation was an obligation, so absence was counted as failure whatever the habit asked for.

## Decision

**A log means the commitment was kept — in both directions.** A habit has a `direction`, `build` or
`quit`. An entry (`HabitLog { id, date }`) always means the user successfully kept the commitment on
that local date: for a build habit "I did it", for a quit habit "I held off". The direction never
inverts an entry, absence is never success, and there are no lapse events. Copy is direction-specific
("Mark completed", "Mark kept"); there is no bare "Log today". At most one entry exists per habit per
local date. Nothing is ever inferred from a title.

**Canonical model.**

```
HabitSchedule = { kind: 'weekdays', days: IsoWeekday[] }   // non-empty, unique, ascending, 1..7; "every day" = [1..7]
              | { kind: 'weekly',   target: 1..7 }          // N completions in an ISO week, no fixed day
              | { kind: 'open' }                            // nothing is expected
Habit = { id, title, direction, createdAt, startDate, scheduleHistory: HabitSchedulePeriod[], logs }
HabitSchedulePeriod = { effectiveFrom: LocalDate, schedule }
```

There is no `targetPerWeek`, no persisted missed state, no streak or week cache, no quantity and no
separate daily variant. The persisted key set is exact.

**Dates and weeks.** All dates are civil `YYYY-MM-DD` strings, never converted through an instant.
A week is the ISO Monday–Sunday week, independent of locale. The weekday of a stored date comes from
`isoWeekday()`, integer arithmetic on the date's own numbers in UTC (`localDate.ts`) — not
`Date#getDay()` on a stored value. A new habit's `startDate` is the device-local date at creation
(there is no start-date picker), not the UTC date of `createdAt`. Stored dates never move; no time
zone is stored.

**Status is derived and never stored.** `habitDayStatus(habit, date, today)` is a pure function with
no hidden clock:

| Status | When |
| --- | --- |
| `future` | `date > today` |
| `before-start` | `date < startDate` |
| `completed` | an entry exists |
| `missed` | `date < today`, a `weekdays` schedule in effect **on that date** lists that weekday, no entry |
| `pending` | the same, but `date == today` — today is never a miss |
| `optional` | nothing was expected: an unscheduled weekday, a weekly target, or an open habit |

A weekly habit has no per-day miss; it has a week fact ("2 of 3 this week"). Neutral wording only:
"Completed"/"Kept", "Not completed", "Scheduled today", "No entry".

**Week facts.** `weekdays`: completed scheduled days of all scheduled days of the ISO week from the
start date (the denominator is the whole week, so Friday counts on a Thursday); entries on other
days are reported separately. `weekly`: entries this week through today of the target. `open`: the
entry count, with no denominator. Entries after today are not counted.

**Schedule history is effective-dated and append-only for the past.** The first period starts on
`startDate`; `effectiveFrom` is strictly increasing. A status on a given day uses the period in
effect on *that day*, so changing a schedule never rewrites what earlier days meant.

- *Neither the old nor the new schedule is weekly:* the change is effective **today**.
- *Either is weekly:* effective **next ISO Monday**, or today when today is a Monday. A weekly target
  counts one whole ISO week; changing it on a Wednesday would make "2 of 3" mean two things inside
  one week. The UI says so ("Changes to weekly schedules apply next Monday."), and the tests cover
  Wednesday changes.
- A period that began today is replaced rather than stacked; a newer decision supersedes a change
  still waiting for Monday; choosing what is already in effect cancels it; adjacent equal periods
  are never left behind; a no-op returns the same object and writes nothing. No API edits a past
  period.

**Direction is editable only while there are no entries.** Every entry means "kept the commitment";
flipping what the commitment is would silently rewrite what each stored entry means.

**History can be corrected, without a time limit.** The user can mark or clear any date from
`startDate` through today. A future completion and one before the start date are refused by the
domain. Data that arrived from elsewhere with a future date (legacy, remote, backup) is preserved
and shown as `future`, and can be cleared. The persisted decoder does not read the clock, so the
same bytes decode identically today and in a hundred years. `setHabitDateCompleted(id, date, bool)`
states the wanted outcome and is idempotent; there is no toggle. A repeated mark keeps the existing
entry id and creates no new one.

**Legacy mapping (Z0 → Z1, backup 1–11, server rows with both new columns NULL).** `id`, `title`,
`direction`, `createdAt` and every entry id and date are kept verbatim. `startDate` is
`min(createdAt civil date, earliest logged date)`; the shifted dates of the old week-row bug are
**not** repaired. One initial schedule period is derived from `targetPerWeek`: absent or null → `open`;
an integer 1–7 → `weekly`; 0, a negative number, above 7, fractional or NaN → `open` — a lossy repair,
never clamped and never turned into weekdays the user did not choose. A value that is not a number is
malformed. A log date that is not a calendar date (a timestamp), a duplicate date or id, an unknown
field and a future version **fail closed** and leave the original bytes untouched. Every version of the
store in git history (`49c4355`, `134b13d`, `3101a7e`, `ec80364`, unchanged at `a818c9d`) has the same
toggle — it removed by date and added only if none existed — every writer passed a `YYYY-MM-DD` key,
a fetch only appended unknown ids and never merged logs, and the `Habit` types are identical at
`49c4355` and `a818c9d`. So no released path could write a duplicate date or a timestamp: these are
hand-edited or corrupt data, not a legitimate shape to merge. (Entry ids before `3101a7e` were
`Date.now()`-based; a reused id inside one habit is astronomically unlikely, and would also fail
closed.)

*Residual ambiguity, accepted and documented:* a historical **quit** habit's entries cannot be told
apart from before — the old UI offered one "Log today" for both directions, so a user may have meant
"I slipped" when logging a quit habit. They are read as "kept" and are never reinterpreted. The user
can clear them.

**Streaks are removed everywhere.** The Habits list and detail card, the Home hero, the Life
"Best streak" metric and the "Restart your habit streak" focus card are gone, and
`utils/habit/habitStreak.ts` is deleted. No replacement algorithm is added (APP-065 owns that).
Life shows the factual "completed scheduled habits today / scheduled habits today" and this ISO
week's entries; its focus card says "N habits scheduled today are not marked yet" and only for
`weekdays`-scheduled habits. Home's "Habits today" uses the same status, and "Habits this week" shows
the week fact above. There are no miss counts and no summary logic (APP-066). The monthly review
still reports entry counts only (ADR-0012), now with `personal` sensitivity.

**Cycle insights.** The card's habit "completion rate by phase" now takes plain dated outcomes
(`scheduledDayOutcomes`): only days a `weekdays` schedule asked for, completed or strictly before
today with no entry. Weekly and open habits contribute nothing, because no day was expected of them.
This is a behaviour change to an existing cross-module read (see Consequences); the coupling itself
(`CycleInsightsCard → useHabitsStore`) is unchanged and stays on the architecture baseline.

**Where the code lives.** Per the corrected APP-063 pattern and ADR-0003, only the persisted
*format* is core: `core/habits/persistedHabit.ts` holds the exact key set, the three schedule shapes,
the history invariants, one entry per date, strict decoding and the frozen legacy mapping — because
the local migration and the backup parser are core and must validate exactly what the store persists.
It never reads the clock. The live rules are the module's own in `features/habits/domain/`
(`habitStatus`, `habitCommands`, `habitRow`, `habitInput`), a pure leaf that imports core, never the
reverse. `__tests__/habitDomainBoundary.test.ts` holds the split, adds no new platform → feature
edge, and checks that no other module imports the Habits domain except through the screens and the
cycle card that already read the store.

**Persistence.** The Habits store moves under the APP-038 harness (Z0 → Z1, retained fixture from
`a818c9d`), persists only `habits` and no longer hydrates unvalidated data. Backup becomes format 12:
formats 1–11 decode the old shape through the legacy mapping, v12 carries the canonical model
strictly, and the export is a whitelist of the habits themselves — never a derived status, week
fact, streak, sync metadata or UI state. A partial restore without habits keeps the current habits.

**Server.** `public.habits` keeps its columns, `logs jsonb` and its policies and gains two nullable
columns: `start_date date` and `schedule_history jsonb`. One CHECK says: both NULL (a legacy habit,
valid permanently because an older client keeps creating such rows), or both non-NULL, with
`schedule_history` a JSON array of at least one period whose first `effectiveFrom` equals
`start_date`. Every branch guards each nullable column with an explicit `IS [NOT] NULL` and the path
comparison with `coalesce`, and `jsonb_array_length` is only evaluated behind a `CASE` on
`jsonb_typeof` (the APP-062 lesson: a CHECK also passes on NULL). Element validation stays in the
client decoder, which drops a row that fails it. `target_per_week` remains as a **compatibility
mirror** — the weekly target in effect on the day of the write, otherwise NULL, and never a weekly
change that is still waiting for Monday — that this client ignores whenever `schedule_history` is
present. It is as old as the last write: a change that took effect on a Monday reaches an older client
with the next write by a current client. No table, RPC, revoked write path or grant change; the
migration file is local only and has not been run against any remote database.

**Old-client compatibility** was proven against a disposable PostgreSQL with the exact legacy column
set: an older client's upsert lists only the historical columns, so it never touches the two new ones
(a canonical row is not nulled); a row it creates stays legacy and is read through the legacy mapping;
its log toggle stays understandable; editing `target_per_week` does not change `schedule_history`;
owner access is allowed, other users and anon are denied, and an account deletion cascades. The
pre-commit audit found one more case and fixed it: an older client enables every day from the UTC date of
`created_at`, which is one day before a current client's local `start_date` when a habit is created in the
first hours of a local day east of UTC, so it can write an entry before `start_date`. The remote decoder no
longer drops such a habit; it reads it as the legacy mapping does (the habit counts from the earlier of
`start_date` and its earliest entry, by moving only the first period's start back), within exactly the
older client's legal range, while local persistence and backups stay strict. Known limitation: an older
client can change `direction` on a habit that already has entries (this client refuses it).

**Account isolation.** As in APP-063: writes capture the acting account when the user acts and, after
the single `await`, the live session must still be that account or the write is dropped; the outgoing
row and filter carry the initiator's `user_id`, so a request that still reaches the server under
another session is refused by the owner RLS instead of re-owning the habit. A fetch records the
account and a dataset epoch before it starts and checks both after the final `await`, immediately
before `set()`; `clearLocal` (logout) and `restoreBackup` bump the epoch. Remote rows are validated
before they reach state and malformed rows are dropped without partial mutation.

**Classification.** Habits move from `ordinary` to `personal`: a recurring commitment, "quit"
habits in particular, can reveal private information about a person. It stays Profile A (no
encryption), is not health data, and no medical, withdrawal or treatment meaning is inferred or
worded anywhere. The module registry, the app inventory, the data-SDK inventory, the data-profile
registry (code and documentation) and the monthly-review fact are updated together. Home masking is a
property of a Home *snapshot tile* (`isMaskable(snapshot.sensitivity)`, docs/home-snapshots.md), and
`personal` shows in full by default (only `health` starts masked). Habits has no tile, so the
reclassification changes no visible default; the Today and Week cards are Home's own content, as are
to-do titles and the trip names in invitations, and they are not masked. Were a Habits tile ever added
it would carry `personal` and so be maskable (`habitHome.test.tsx` holds that).

**UI.** New habit: title, direction with a plain explanation of what marking means, a schedule
chooser (Every day / Selected days / N times a week / No fixed schedule) with weekday checkboxes and
a 1–7 field, no start-date picker, and Save disabled until the form is a valid habit. Detail: schedule
summary (and a waiting change), start date, today's status with a direction-specific mark button,
the week fact, a month history, and an edit sheet that locks the direction once an entry exists and
states when a schedule change takes effect. List: schedule summary, today's status and the week row.
Every real date is a checkbox with the full localized label ("Wednesday 7 October, scheduled,
completed"), checked and disabled state, a glyph (✓ completed, – not completed, ○ scheduled today, · nothing expected), a dashed border for
upcoming days, a faded cell before the start and a legend, so no state depends on colour; month navigation has real 44pt targets. Day cells are at
least 44pt tall. Seven columns share the width, so the grid bleeds 8pt into the card padding and the
whole column is the tap area (the visible gap is drawn inside it): it is 44pt wide or more from a
358pt-wide screen, and about 38.6pt on a 320pt phone, where it is not claimed (manual device check).

## Consequences

- Every habit has one unambiguous meaning of an entry, a day, a week and a miss, and the same code
  answers it in the list, the detail screen, Home, Life and the cycle insights.
- Users lose the streak. This is intended and approved; APP-065 will decide what, if anything,
  replaces it.
- Z1 and backup v12 are one-way. An older app build that meets Z1 data fails closed; the server
  change is additive and nullable, so older clients keep working against it. **The migration must be
  applied before a client that selects `start_date`/`schedule_history` ships**, or the fetch and
  upsert fail until it is.
- **Habits are NOT PRODUCTION-SYNC-READY.** This story deliberately keeps the original best-effort
  sync (whole-row upsert, append-only refresh). Known, deferred races: two devices marking or
  clearing different dates overwrite each other because the whole `logs` array is one value; a title
  edit races a completion; a schedule change races a completion; delete races edit and can resurrect
  the habit; offline writes are lost; a stale client can resurrect deleted habits; another device's
  changes to a habit already held locally never arrive. The follow-up **"Habits durable sync"**
  (outbox, receipts, revisions, tombstones, an explicit conflict policy and a refusal handler, as for
  Home tasks in APP-061) is required before Habits count as a migrated, sync-safe domain. It was not
  given an APP number because the repository has no defined process for that.
- **Cycle insights change.** The per-phase habit rate now includes only `weekdays`-scheduled days. A
  user whose habits were all migrated to `weekly` or `open` (every legacy habit is one of the two)
  sees no habit insight until they schedule specific weekdays. This is the semantically consistent
  consequence of "absence is not failure", but it is a visible change to a Cycle feature that reads
  Habits data; whether that cross-module read should exist at all (it joins habit behaviour to cycle
  phase) belongs to APP-071 and is raised, not decided, here.
- Manual device accessibility QA (VoiceOver, TalkBack, dynamic type, 44pt widths on small phones) is
  **pending**; it is not claimed.
- Out of scope and unchanged: Goals, Shopping, Moving, notifications and reminders, widgets,
  recovery of a habit deleted elsewhere, and any streak or summary computation.

## Alternatives considered

- **Persist missed days.** Rejected: a stored miss can disagree with the schedule and history it was
  derived from, and a schedule change would have to rewrite it.
- **Invert entries for quit habits** ("a log is a lapse"). Rejected: it makes absence the success
  state, which is unobservable, and it contradicts the one rule that makes weekly counts and
  direction-independent copy possible.
- **A start-date picker.** Rejected for new habits: backdating invites inventing history; the user
  can correct individual days from the start date instead.
- **Apply every schedule change today.** Rejected for weekly schedules only: a weekly target counts a
  whole ISO week, so a mid-week change would make one week's fact mean two things.
- **Collapse duplicate dates on migration.** Rejected: which of two ids to keep is a guess, and the
  repository's history shows no legitimate path that produces them.
- **Reinterpret historical quit entries.** Rejected: nothing in the data distinguishes "kept" from
  "slipped", and inferring from the title would be a guess about a person's behaviour.
- **A child table for entries.** Rejected for this story: it is the right shape for durable sync and
  belongs with it; `logs jsonb` is unchanged so older clients keep working.
- **Keep the persisted format in the feature and let core import it.** Rejected for the reason in
  ADR-0051: it puts a `core/` → `features/` edge in the platform, which ADR-0003 forbids.
