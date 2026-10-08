# APP-064 — Habit semantics

Master specification: E7 · Goals, habits, career & gifts · P0 — "Som user vil jeg track recurring
behavior separately from one-time tasks." Acceptance: *Frequency/schedule; local date; missed-day
semantics; history.*
Decision record: [ADR-0052](./adr/0052-habits-are-recurring-commitments-with-derived-status-and-effective-dated-schedules.md).

## The model (`types/life.ts`; format in `core/habits/`, rules in `features/habits/domain/`)

Code layout: `core/habits/persistedHabit.ts` is only the persisted format (exact key set, three schedule
shapes, history invariants, one entry per date, strict decoding and the frozen legacy mapping) that the
migration and backup parser need; it never reads the clock. `features/habits/domain/` holds day status,
schedule resolution, week facts, builders, mutations, input parsing and server-row mapping and imports core.
`habitDomainBoundary.test.ts` keeps both pure and forbids the platform from importing a feature.

```ts
HabitSchedule = { kind: 'weekdays'; days: IsoWeekday[] }   // non-empty, unique, ascending, 1..7
              | { kind: 'weekly';   target: number }       // 1..7 completions per ISO week
              | { kind: 'open' }                           // nothing is expected
HabitSchedulePeriod { effectiveFrom: LocalDate; schedule }
HabitLog  { id; date: LocalDate }                          // "the commitment was kept on that date"
Habit     { id; title; direction: 'build'|'quit'; createdAt: instant;
            startDate: LocalDate; scheduleHistory: HabitSchedulePeriod[] /* >= 1 */; logs: HabitLog[] }
```

There is no `targetPerWeek`, no persisted missed state, no streak or week cache, no quantity and no separate
"daily" schedule (every day is `weekdays` with all seven).

## Meaning of an entry, build and quit

An entry always means the user **kept the commitment** on that local date: "I did it" for a build habit,
"I held off" for a quit habit. Direction never inverts an entry, absence is never success, there are no
lapse events, and at most one entry exists per habit per date. Copy is direction-specific ("Mark
completed" / "Mark kept"); there is no bare "Log today". Nothing is inferred from a title.

## Day status (derived, never stored) — `habitDayStatus(habit, date, today)`

| Status | When |
| --- | --- |
| `future` | `date > today` |
| `before-start` | `date < startDate` |
| `completed` | an entry exists |
| `missed` | `date < today`, a `weekdays` schedule *in effect on that date* lists that ISO weekday, no entry |
| `pending` | the same with `date == today` — today is never a miss |
| `optional` | nothing was expected: an unscheduled weekday, a weekly target or an open habit |

Pure: `today` is a parameter. A weekly habit has no per-day miss. A future-dated entry from legacy, remote
or backup data keeps status `future` and can be cleared.

## Week facts — `habitWeekFacts(habit, today)`

ISO Monday–Sunday of `today`, from the start date on. **weekdays:** `completedScheduled / scheduled`, where
`scheduled` counts the scheduled days of the **whole** week (Friday is in the denominator on a Thursday),
plus entries on other days reported separately. **weekly:** entries this week through today of the target
(going over is shown as is). **open:** the entry count, no denominator. Entries after today are not counted.
The kind of fact follows the schedule in effect today; because weekly changes only take effect on a Monday,
a week is either weekly throughout or not weekly at all.

## Local date and weeks

Dates are civil `YYYY-MM-DD`, never converted through an instant. `isoWeekday` and `startOfIsoWeek`
(`utils/shared/localDate.ts`) use integer arithmetic on the date's own numbers in UTC — not `Date#getDay()`
on a stored value, and correct for two-digit years. A new habit's `startDate` is the **device-local** date
at creation (00:30 in Copenhagen is 22:30 UTC the day before: the habit counts from the local day). There
is no start-date picker. Stored dates never move; no time zone is stored. After travelling west a habit
created "tomorrow" locally can show as starting tomorrow for up to a day (accepted).

## Changing a schedule — `withSchedule`

| Old → new | Takes effect |
| --- | --- |
| neither is weekly | **today** |
| either is weekly | the **next ISO Monday**, or **today** if today is a Monday |

UI copy: "Changes to weekly schedules apply next Monday." A period that began today is replaced rather than
stacked; a newer decision supersedes a change still waiting for Monday; choosing what is already in effect
cancels it; adjacent equal periods are merged; a no-op returns the same object and writes nothing. Past
periods are never edited. A seeded random-walk test checks that the history stays valid, past periods are
untouched, every boundary that involves a weekly schedule lies on a Monday and no two neighbours are equal.
Wednesday cases are tested in the domain and through the edit screen.

## Direction

Editable only while the habit has no entries; locked after the first entry (the edit screen says why),
unlocked again if every entry is cleared.

## History correction

The user can mark or clear any date from `startDate` through today with no time limit. The domain refuses a
future completion and a completion before the start date. `setHabitDateCompleted(id, date, bool)` states the
outcome (idempotent; a repeat keeps the existing entry id); there is no toggle.

## Mutations (`store/useHabitsStore.ts`)

`addHabit`, `updateHabit` (title; direction while unlogged), `setHabitSchedule`, `setHabitDateCompleted`,
`removeHabit`, `fetchFromSupabase`, `restoreBackup`, `clearLocal`. Each validates before it stores and
throws a fixed `HabitError` code (never a title, id or date) leaving state untouched.

## Legacy data

| Source | Rule |
| --- | --- |
| `targetPerWeek` absent / null | `open` |
| integer 1–7 | `weekly` N |
| 0, negative, above 7, fractional, NaN | `open` (lossy repair; never clamped; never weekdays) |
| not a number | malformed → fail closed |
| `startDate` | `min(createdAt civil date, earliest logged date)`; shifted dates of the pre-`dd16507` week-row bug are **not** repaired |
| log dates | must be calendar dates (a timestamp fails closed); kept verbatim with their ids and order |
| two entries on one date, a reused entry id, an unknown field, a future version | fail closed; original bytes kept |

Evidence for failing closed on duplicates and timestamps: every version of the store in git history
(`49c4355`, `134b13d`, `3101a7e`, `ec80364`, unchanged at `a818c9d`) has the same toggle — remove by date,
add only if none existed — every writer passed a `YYYY-MM-DD` key, fetch only appended unknown ids, and the
`Habit` types are identical at `49c4355` and `a818c9d`; so neither can be produced by released code.
(Entry ids before `3101a7e` were `Date.now()`-based; a reused id inside one habit is astronomically
unlikely and would also fail closed.) A **quit** habit's historical
entries are read as "kept" and are never reinterpreted (residual ambiguity: the old UI had one "Log today"
for both directions).

## Persistence

| Surface | Change |
| --- | --- |
| AsyncStorage `lifesort-habits` | Z0 → **Z1**, `version: 1`, `partialize` durable state only (`habits`); APP-038 harness; retained fixture `__tests__/fixtures/local-migrations/habits/a818c9d-v0.json`; the registry entry is `versioned` (was `external`) |
| Backup | **format 12**; formats 1–11 decode the old shape through the legacy mapping, 12 is strict; export is the whitelist `{ habits }` — never status, week facts, streaks, sync metadata or UI state; a restore without habits keeps the current ones |
| Supabase `habits` | additive nullable `start_date date` and `schedule_history jsonb` plus one CHECK (migration `20261008120000_app064_habit_semantics.sql`; **not deployed by this work**); `logs jsonb` unchanged; `target_per_week` kept as a compatibility mirror |

CHECK: **legacy** both NULL; **canonical** both non-NULL, `schedule_history` a JSON array of at least one
period whose first `effectiveFrom` equals `start_date`. Element validation stays in the client decoder.
Every nullable column has an explicit `IS [NOT] NULL` guard (a CHECK passes on NULL); `jsonb_array_length`
is only evaluated behind a `CASE` on `jsonb_typeof`. The mirror is the weekly target of the schedule **in effect
on the day of the write** (captured when the user acted), otherwise NULL; a weekly change still waiting for
Monday is *not* mirrored, so an older client never shows next week's target today. The price: a change that takes
effect on a Monday reaches an older client only with the next write by a current client (the mirror is as old as the
last write). This client ignores the mirror whenever `schedule_history` is present.

**Deployment order:** apply the migration before releasing a client that selects the two new columns.

## Old clients and mixed fleets

Proven on disposable PostgreSQL with the exact legacy column set (`id, user_id, title, direction,
target_per_week, logs, created_at`): an older client's upsert never nulls the canonical columns; a row it
creates stays legacy and is read through the legacy mapping; its log toggle stays understandable; editing
`target_per_week` does not change `schedule_history`; owner allowed, other users and anon denied, account
deletion cascades; no grant or policy changed, no write path revoked.
**An older client's entry before `start_date` (found and fixed in the pre-commit audit).** An older client enables
every day from `created_at.slice(0, 10)`, the *UTC* date of creation. A habit a current client creates within the
first hours of a local day east of UTC has a `start_date` one day later, so the older client can mark the day before
it, while its upsert (historical columns only) leaves `start_date` and `schedule_history` intact. Strict decoding
used to reject that row and the habit vanished from a fresh device. The remote decoder now reads it as the legacy
mapping does — the habit counts from the earlier of `start_date` and its earliest entry — by moving only the *first
period's* start back to that day. No entry is dropped or re-dated, no period is invented, and the window is exactly
the older client's legal range (never earlier than the UTC date of `created_at`; at most one day for any real zone),
so a hand-edited or corrupt row is still refused. Local persistence and backup validation stay strict; what the
decoder returns is already coherent, and the next write by a current client makes the server row coherent too.
Reproduced against real PostgreSQL and Jest from one shared row (`__tests__/fixtures/habits/old-client-pre-start-row.json`).
**Remaining limitation:** an older client can flip `direction` on a habit that has entries (current clients refuse).

## Account isolation (fixed in this story)

Write operations capture `initiatingAccountId()` synchronously, re-check the live session after the one
`await`, and send the initiator's `user_id`; a request that still goes out under another session is refused
by the owner RLS. A fetch captures account and dataset epoch first and checks both again after its final
`await`, immediately before `set()`. `clearLocal` (the logout reset) and `restoreBackup` advance the epoch.
Remote rows are validated before they reach state; a malformed row is dropped and never partially applied.

## Known, deferred: Habits are NOT PRODUCTION-SYNC-READY

Sync is unchanged and best-effort. Not solved here: two devices marking or clearing different dates
overwrite each other (the whole `logs` array is one value); a title edit races a completion; a schedule
change races a completion; delete versus edit can resurrect a habit; offline writes are lost; stale clients
resurrect deleted habits; changes made on another device to a habit already held locally never arrive. The
follow-up **"Habits durable sync"** (outbox, receipts, revisions, tombstones, conflict policy, refusal
handler — the APP-061 pattern) is required before Habits are a migrated, sync-safe domain. No APP number
was assigned (no defined process).

## Streaks

Removed from the Habits list and detail, the Home hero, the Life tab (metric, module value and the
"Restart your habit streak" focus card). `utils/habit/habitStreak.ts` is deleted and no replacement
algorithm exists (APP-065). `habitDomainBoundary.test.ts` fails if a streak helper or streak wording
(EN or DA) reappears in runtime code or in the Habits, Life, Home or module strings.

## Consumers

| Consumer | After |
| --- | --- |
| Life tab | metric and module value `completed / scheduled today` (weekday-scheduled habits only); helper = entries this ISO week through today; focus card "N habits scheduled today are not marked yet" only when such habits are unmarked, otherwise it falls through |
| Home tab | "Habits today" chips use the canonical status and an explicit outcome; "scheduled today" summary; "Habits this week" shows the week fact (weekdays `done of total`, weekly `done of target`, open count) |
| Monthly review | still entry counts only (ADR-0012); fact sensitivity `personal` |
| Cycle insights | **behaviour change.** The per-phase habit rate now uses `scheduledDayOutcomes` — only days a `weekdays` schedule asked for — so weekly and open habits (every migrated legacy habit) contribute nothing until the user schedules weekdays. The card reads plain dated outcomes; `utils/cycle/cycleInsights.ts` knows nothing about schedules. Whether Cycle should read Habits at all is APP-071's question |
| Search | title only, unchanged |

## Classification

Habits `ordinary` → **`personal`** (module registry, app inventory, SDK inventory, data-profile registry in
code and docs, monthly-review fact). Still Profile A, no encryption, not health data; no medical,
withdrawal or treatment meaning is inferred or worded. Masking on Home belongs to a snapshot **tile**
(docs/home-snapshots.md): `personal` is maskable and shows in full by default. Habits has no tile, so the
change affects masking only if one is added (a test then requires it to carry `personal`); the Home Today and
Week cards are Home's own content — like to-do titles and the trip names in invitations — and show titles as
before. This was audited and is intentional, not a bypass.

## UI

New habit: title, direction with a plain explanation, schedule chooser (Every day / Selected days with
weekday checkboxes / N times a week, 1–7 / No fixed schedule), no start-date picker, Save disabled until the
form is valid. Detail: schedule summary and any change waiting for Monday, start date, today's status, a
direction-specific mark button, the week fact, a month history with legend, and an edit sheet (direction
locked after the first entry; effective-date copy). List: schedule summary, today's status, the week row.
Every real date is a `checkbox` with checked/disabled state and a full localized label
("Wednesday, October 7, scheduled, completed"), a glyph (✓ completed, – not completed, ○ scheduled today,
· nothing expected), a dashed border for upcoming days, a faded cell before the start, and a legend. Month
navigation targets are at least 44 × 44. Day cells are at least 44 pt tall. Seven columns share the width, so the grid
bleeds 8 pt into the card padding and the **whole column is the tap area** (the visible gap is drawn inside it):
the column is `(W − 62 + 16) / 7`, which is **44 pt or more from a 358 pt-wide screen** (360, 375, 390, 393, 412, 430
all qualify) and 38.6 pt on a 320 pt phone — below that width it is **not claimed**, see manual QA
(`components/habitGrid.ts`, `habitGrid.test.tsx`). EN and DA; theme colours
only; text scales (min-heights, no fixed heights).

## Rollback

The server change is additive and nullable; undoing it is `drop constraint habits_semantics_check` then
dropping the two columns, and no older client depends on either. Local Z1 data and backup v12 are **one-way**:
an older app build meeting them fails closed. Rolling the client back therefore means restoring from a
pre-APP-064 backup, which an older build reads (formats 1–11).

## Tests

`habitDomain` (including every schedule change from every kind to every kind on a Wednesday and a Monday),
`habitMigration`, `habitRow` (including the older-client pre-start row and the `target_per_week` mirror with a
pending change), `habitBackup`, `habitStore`, `habitScreens`, `habitGrid` (the tap-area arithmetic),
`habitDateLabels`, `habitDashboards`, `habitHome`, `habitCycleInsights`, `habitDomainBoundary`, `habitDates`,
`useToday` (timer count, cleanup, 23- and 25-hour days), plus updated `entityCreationIds`, `monthlyReview` and every
backup version pin; `tests/db/app064.test.cjs` on disposable PostgreSQL (16). Every Habit suite also passes under
`America/Los_Angeles`, `Asia/Tokyo`, `Pacific/Kiritimati` (UTC+14) and `Pacific/Pago_Pago` (UTC−11), not only the
project's `Europe/Copenhagen`.

A mutation pass breaks 44 rules one at a time (today as a miss, Sunday as 0, weekly changes applying today or
always next week, duplicate entries, future / before-start completions, an unlocked direction, a lenient decoder,
clamped legacy targets, un-rechecked writes and deletes, an unguarded fetch, missing epoch bumps, a mirror of the
pending period, a late `today`, a removed or unbounded older-client tolerance, a grid that does not bleed or a
shrunken tap area, a date formatted in local time, a timer that is not re-armed, a half-canonical row, legacy shape
in v12, an ignored restore, a missing spoken label…); no mutant survives. 3 of 8 SQL mutants survive and are
equivalent (the `CASE … ELSE false` and `coalesce` already refuse the cases the explicit guards also refuse; the
guards are kept on purpose and the migration says so).

## Verification

`npx tsc --noEmit` clean; `npm test -- --runInBand` 152 suites / 3491 tests passing; `node --test` on
`tests/db/app032, app043, app058–app064` all passing (19, 13, 53, 11, 4, 8, 12, 13, 16); `npm run check:adr` ok
(it compares committed history only, so the working-tree rule was also evaluated directly: seven governed files
touched, ADR-0052 present); `git diff --check` clean. There is no `lint` script in `package.json`.
**Manual device QA is pending** — VoiceOver, TalkBack, dynamic type at the largest sizes, dark mode on a device,
and the 44 pt column width on phones narrower than 358 pt; none of it was run.

## Pre-commit audit

An independent audit of the working tree found and fixed: (1) an older client's entry dated one day before a
current client's local `start_date` dropped the whole habit from view — now read as the legacy mapping does;
(2) the `target_per_week` mirror announced a weekly change before it took effect — now the schedule in effect on
the day of the write; (3) seven-column cells were 42.9 pt wide at 390 pt — now 44 pt or more from 358 pt, by bleeding
the grid and making the whole column the tap area; (4) the modules launcher still mapped Habits to a flame icon;
(5) one week-row timer per habit — the screen now owns `today`. It also confirmed, without change, that Home's
Habits cards are Home's own content and not snapshot tiles, so reclassifying to `personal` bypasses no masking.
