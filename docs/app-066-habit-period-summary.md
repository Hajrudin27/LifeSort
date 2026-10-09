# APP-066 — Deterministic habit period summary

**Story:** APP-066 (E7 · Goals, habits, career & gifts, P1) — "Som user vil jeg see weekly/monthly progress."
**Decision record:** [ADR-0054](./adr/0054-habit-period-summaries-are-derived-current-period-counts-of-resolved-commitments.md)
**Owner:** Hajrudin Kardasevic

Acceptance: computed from records; tests; AI cannot invent completion.

## What shipped

One card at the top of the Habits list (`app/habits/index.tsx`, `components/HabitPeriodSummaryCard.tsx`)
with a Week / Month selector. It is shown only when at least one habit exists; with none, the existing
empty state is the only card. Week is selected by default.

The numbers come from one pure helper, `features/habits/domain/habitPeriodSummary.ts`:

```ts
habitPeriodSummary(habits, 'week' | 'month', today): {
  period: { kind; from: LocalDate; to: LocalDate };
  scheduled: { completed: number; total: number };   // resolved scheduled-weekday commitments
  otherEntries: number;                               // everything else that was recorded
}
```

It returns facts, not prose; the card turns them into text with `habits.summary.*` (EN and DA).

## Periods

| Kind | From | To |
| --- | --- | --- |
| `week` | the ISO Monday of today | today |
| `month` | the 1st of today's `YYYY-MM` | today |

Always "so far": never a rolling 7 or 30 days, never a future day. Only the current period is shown; there
is no previous/next control and no new route. Dates use the `LocalDate` utilities (`addDaysIso`,
`startOfIsoWeek`, `isScheduledOn`), never `new Date(stored)` or `getDay()`.

## Semantics, per date from `max(period start, startDate)` through today

Each date is judged by the schedule in effect **on that date** (`scheduleOn`), never today's.

| Situation | `scheduled.completed` | `scheduled.total` | `otherEntries` |
| --- | --- | --- | --- |
| scheduled `weekdays` date, entry | +1 | +1 | – |
| scheduled `weekdays` date before today, no entry | – | +1 | – |
| scheduled `weekdays` date that is today, no entry | – (pending) | – | – |
| entry on an unscheduled date of a `weekdays` habit | – | – | +1 |
| entry under a `weekly` schedule | – | – | +1 |
| entry under an `open` schedule | – | – | +1 |
| no entry on a non-scheduled date | – | – | – |

Also: nothing before `startDate`; a habit that starts after today contributes nothing; a log after today
contributes nothing; a duplicate date for one habit counts once (a `Set`, the habit is not mutated); a log
date that is not a real calendar date is never visited. A weekly target is not compared with anything and
creates no denominator. Build and quit use identical arithmetic. A schedule change inside the period
(`weekdays → weekly`, `weekly → weekdays`, `weekdays → open`, `open → weekdays`, `weekdays → weekdays`) never
rewrites earlier dates. Cost is `O(habits × days in period + logs)`; at most 31 dates per habit.

There is no percentage, ring, score, rating, best, streak or standalone "missed" number. `total − completed`
is derivable, but nothing names or shows it.

## Copy

Neutral and factual, with plurals: "2 of 3 scheduled commitments recorded so far", "4 additional habit
entries", "No habit activity recorded this week." (DA: "2 af 3 planlagte forpligtelser registreret indtil
nu", "4 ekstra vaneregistreringer", "Ingen vaneaktivitet registreret denne uge."). `0 of M` is shown as it
is. Titles say "This week so far" / "This month so far". No encouragement, judgement, emoji or colour coding.

## Accessibility

Selector is a labelled `radiogroup` ("Period") of two `radio` options with visible text labels,
`accessibilityState` `checked` and `selected`, targets of at least 44pt, and a check mark on the selected one
so selection is not colour alone. The card title is a `header`. Text scales and the card has no fixed
height. Dark mode uses the existing theme tokens. Manual VoiceOver, TalkBack, largest dynamic type and
physical dark-mode checks are still to do.

## What it deliberately does not do

- **Goals.** A goal stores its current progress, not when it changed, and has no `completedAt` or milestone
  completion time, so "what happened this week" cannot be computed. Nothing is inferred and nothing is
  added; the summary imports nothing from Goals.
- **Monthly Review (ADR-0012)**, **Home**, **Life**, **Cycle** (`scheduledDayOutcomes` is untouched) and
  `habitWeekFacts` are unchanged. `habitWeekFacts` keeps its whole-week denominator for Home; the summary's
  denominator holds only resolved commitments, which is why the copy says "so far".
- **Streaks (APP-065)** stay on the detail screen; the summary shows none.
- No persistence, key, preference, backup field (format 12), DB object, sync, analytics, SDK, network call or
  AI. A future AI phrasing layer may read the structured result; it cannot change it.

## Known limitations

- Habits are not production-sync-ready (best-effort sync, see APP-064): a device that has not received
  another device's entries can show lower counts.
- Weekly-target achievement and historical periods are out of scope; each needs its own story.

## Tests

`__tests__/habitPeriodSummary.test.ts` (domain: bounds, start/today/future, every schedule transition,
duplicates, DST spring and autumn, leap day, month and year boundaries, ordering, no clock),
`__tests__/habitPeriodSummaryScreen.test.tsx` (card, selector semantics, EN/DA plurals, empty and `0 of M`
states, wording), `__tests__/habitDomainBoundary.test.ts` (closed importer allowlists; no Goals, Home, Life,
Cycle, review, streak, store, persistence, AI, clock or percentage).
