# ADR-0054: Habit period summaries are derived, current-period counts of resolved commitments

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-09 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-066 |
| **Superseded by** | – |

## Context

APP-066 asks for deterministic weekly/monthly summaries "computed from records", where AI "cannot
invent completion". The master spec (8.4) says summaries are deterministic from data first and AI may
only phrase them later. Habits have a full dated history (APP-064: logs, `startDate`, effective-dated
schedules). Goals do not: a goal stores its current progress, not when it changed, and has no
`completedAt` or milestone completion timestamp. "What happened this week" cannot be computed for a
goal without inventing history.

`habitWeekFacts` already answers a different question for the Home tab: a whole-week denominator
(Friday is in Thursday's denominator) and a weekly target. A summary that says "so far" needs a
denominator made only of commitments that are already resolved.

## Decision

1. **Habits only.** Goals are out of scope. No Goal history is inferred and none is added here; the
   summary does not import the Goals store or any goal helper.
2. **Current week and current month only.** Week = ISO Monday through today; month = the 1st of the
   current `YYYY-MM` through today. Never a rolling window, never the future part of the period. No
   previous/next stepper and no historical browser (the monthly review, ADR-0012, owns history).
3. **One pure helper**, `habitPeriodSummary(habits, kind, today)` in
   `features/habits/domain/habitPeriodSummary.ts`, returning
   `{ period: { kind, from, to }, scheduled: { completed, total }, otherEntries }`. `today` is a
   parameter; there is no clock, store, i18n or persistence in it.
4. **Resolved commitments.** Each date is judged by the schedule in effect on that date. On a scheduled
   `weekdays` date: an entry counts as completed and in the total; no entry on a date before today
   counts in the total only; no entry today is pending and counts in neither.
5. **Everything else is an entry count.** An entry on an unscheduled day, any entry under a `weekly`
   schedule and any entry under an `open` schedule is one `otherEntries`, once per habit and date. A
   weekly target is never compared with anything and creates no denominator; open habits have none.
6. **Dates are bounded.** Nothing before `startDate`, nothing after today. A duplicate date counts once.
7. **Integers, no verdicts.** No percentage, ring, score, best, streak or standalone "missed" number.
   Copy is neutral and says "so far". Selection of week/month is shown by label, check mark and
   `selected` state, not colour alone.
8. **Habits screen only.** One card at the top of `app/habits/index.tsx`. Home, Life, the monthly review
   (ADR-0012 stands unchanged), Cycle (`scheduledDayOutcomes` is not refactored) and the existing
   `habitWeekFacts` are untouched. APP-065 streaks stay on the detail screen.
9. **Derived, never stored.** No store, preference, key, backup field (still format 12), database
   object, sync work, analytics event or network call. No AI: the structured result is the factual
   source; a future phrasing layer may consume it but cannot change it.

## Consequences

- No DB migration; the Staging and Production DB workflows are expected no-ops.
- The numbers inherit APP-064's best-effort Habits sync: a device that has not received another
  device's entries can show lower counts until durable Habits sync exists.
- "So far" is a deliberately different denominator from `habitWeekFacts`. The same Thursday can read
  "1 of 2 scheduled commitments recorded so far" here and "1 of 3 scheduled days this week" on Home.
- A weekly habit contributes entries but no verdict; richer weekly-target summaries need a later story.
- A habit whose schedule changed mid-period is judged correctly per day, at the cost of reading the
  schedule history for each date (at most 31 dates per habit).

## Alternatives considered

- **Include Goals.** Rejected: no progress-event history, so any "this week" figure would be a
  point-in-time snapshot presented as period progress.
- **Reuse `habitWeekFacts` or `scheduledDayOutcomes`.** Rejected: whole-week denominator and weekly
  target for the former; the latter is the Cycle contract and refactoring it widens the story.
- **`k of target` for weekly habits.** Rejected: partial first weeks, mid-week legacy periods and target
  changes make the verdict ambiguous.
- **A percentage or ring.** Rejected: invites scoring, and a small denominator makes it noisy.
- **A missed count.** Rejected: absence is never success but also never a standalone number (ADR-0012,
  ADR-0052); the difference stays derivable but unnamed.
- **Previous/next period stepper.** Rejected: overlaps the monthly review and enlarges the story.
- **AI-written summary text.** Rejected: facts first; phrasing later, on top of the structured result.
