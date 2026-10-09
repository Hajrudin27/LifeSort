# ADR-0053: Streaks are an optional, per-habit, device-local view of scheduled commitments

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-09 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-065 |
| **Superseded by** | – |

## Context

APP-064 removed every streak because the old one reset to zero at midnight, counted calendar days for
habits that were never daily, and was shown everywhere with a "Restart your habit streak" card
(ADR-0052). APP-065 asks for streaks the user can choose, without shame, and never by default for
health or finance. A habit has no structured category, so nothing in the data says which habits are
sensitive, and the title must not be read to guess.

## Decision

1. **Per habit, explicit opt-in, default off.** The choice is a separate device-local list of habit
   ids, `store/useHabitPreferencesStore.ts` (`lifesort-habit-preferences`, `streakEnabledHabitIds`).
   `Habit`, `public.habits`, the backup (still format 12) and the Habits persisted schema are
   unchanged. It is Profile A, not synced, cleared on logout and removed when the habit is deleted.
2. **Fail closed.** Missing, malformed or partly invalid stored values read as "no streaks" in the
   store `merge`; unknown ids are harmless. No migration exists or is needed.
3. **Scheduled commitments, not calendar days.** `habitStreak(habit, today)` counts consecutive
   scheduled days kept inside the current contiguous `weekdays` regime; unscheduled days neither
   count nor break; a scheduled today without an entry is pending; only a past scheduled day without
   an entry ends the run.
4. **Ineligible periods are boundaries.** Only `weekdays` is eligible. A `weekly` or `open` period
   ends the regime, so a streak never bridges `weekdays → open → weekdays`.
5. **Current only, derived, never stored** — no best streak, nothing persisted, exported or synced.
6. **Detail screen only.** The Habits list, Home, Life, the monthly review (ADR-0012 stands), Cycle
   and Search stay streak-free. A closed allowlist test replaces APP-064's blanket ban.
7. **Neutral copy.** No flame, colour, confetti, reminders or wording about losing, breaking,
   resetting or falling behind; a count of zero is explained, never shown as "0".

## Consequences

- No DB migration; the Staging and Production DB workflows are expected no-ops (and do not deploy the
  mobile client).
- A user who never opens a habit's detail screen never sees a streak.
- The streak inherits APP-064's best-effort Habits sync; durable Habits sync remains a follow-up.
- A preference can briefly outlive a habit that was removed on another device; it is inert.

## Alternatives considered

- **One global device switch.** Rejected: it would enable streaks for every eligible habit, including
  ones the user would not want scored, with no way to tell them apart.
- **Infer sensitivity from the title.** Rejected: a guess about a person's life, and wrong both ways.
- **`streakEnabled` on `Habit`.** Rejected: it would bump the persisted schema, the backup and the
  database for a presentation choice, and would sync it.
- **Bridge across open/weekly periods.** Rejected: months without a commitment would show as one
  unbroken run.
- **Streaks for weekly and open habits** (weeks met, logged days in a row). Rejected for this story:
  the commitment is not a day, so the number would mean something different per habit.
- **Best / longest streak, streak on Home or the list.** Rejected: adds pressure, not information.
