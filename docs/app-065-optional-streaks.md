# APP-065 — Optional streaks

**Story:** APP-065 (E7 · Goals, habits, career & gifts, P1) — "Som user vil jeg choose streak motivation without shame."
**Decision record:** [ADR-0053](./adr/0053-streaks-are-an-optional-per-habit-device-local-view-of-scheduled-commitments.md)
**Owner:** Hajrudin Kardasevic

Acceptance: can disable; no punitive copy; no health/finance streak by default.

## What shipped

- A streak is **off for every habit** until the user turns it on for that habit, on the Habit detail
  screen. Existing habits and new habits start off.
- The choice is **per habit, device-local**: `store/useHabitPreferencesStore.ts`, key
  `lifesort-habit-preferences`, state `streakEnabledHabitIds: string[]`. Not synced, not in the backup
  (backup stays format 12), cleared on logout, removed when its habit is deleted. There is no `Habit`
  field, no Supabase column and no migration.
- Deleting a habit removes its choice for every caller: `useHabitsStore.removeHabit` notifies `onHabitRemoved`,
  and `features/habits/habitRemoval.ts` (loaded with the logout registry) links that to the preference store.
  The stores cannot import each other (architectureBoundaries R3), so the link lives in `features/`.
- The number comes from one pure helper, `features/habits/domain/habitStreak.ts`:
  `habitStreak(habit, today)` returns `{ kind: 'ineligible' }` or `{ kind: 'current', count }`. It is
  recomputed every time and never persisted, exported or synced.
- The UI is `components/HabitStreakCard.tsx`, rendered only by `app/habits/[id].tsx`.

## Semantics

A streak is the number of consecutive **scheduled commitments** kept inside the current contiguous
weekday-schedule regime. It is not consecutive calendar days.

| Rule | Behaviour |
| --- | --- |
| Eligible | Only `schedule.kind === 'weekdays'`. `weekly` and `open` habits show no number. |
| Unscheduled days | Neither count nor break (Mon/Wed/Fri: Fri done, Mon done = 2). |
| Today | A scheduled today with no entry is pending: it neither adds nor breaks, so the number does not drop at midnight. |
| Break | Only a scheduled day strictly before today, inside the regime, with no entry. |
| Never participate | Future dates, dates before `startDate`, entries on unscheduled days. |
| Schedule history | Each past day is judged by the schedule in effect that day. `weekdays → weekdays` stays one regime. |
| Boundaries | A `weekly` or `open` period is a hard boundary. `weekdays → open → weekdays` and `weekdays → weekly → weekdays` do **not** bridge; the run restarts at the later `weekdays` period. A period that has not started yet is ignored. |
| Build / quit | Identical arithmetic. A log means the commitment was kept; copy says "completed" for build and "kept" for quit. |
| Current only | No best, longest or record streak. |
| Cost | Walks newest to oldest inside the regime and stops at the first miss. |

## UI

Detail screen only. A "Streak" card (header semantics) with a switch (role `switch`, checked state,
label, hint, 44pt target):

- off: the switch and a one-line explanation if the habit is not eligible;
- on, eligible, count > 0: "4 scheduled days completed in a row" (plural-aware, EN/DA);
- on, eligible, count 0: "Streak tracking is on. It starts after a scheduled day is completed." —
  never "0";
- on, not eligible (weekly/open): a neutral sentence; the preference is kept, so it applies again when
  the habit becomes weekday-scheduled (the count then starts from the new regime).

No flame, colour change, confetti, reminder or notification. The Habits list, Home, Life, the monthly
review, Cycle and Search contain no streak. The habit title is never read to decide anything.

## Guards

`__tests__/habitDomainBoundary.test.ts` replaces APP-064's blanket ban with a closed allowlist: only
the helper, the preference store, the card, the Habit detail screen and the registry may mention a
streak; only the card imports the helper; Home/Life/review/Cycle/Search/list stay free of it; the
`habits.streak.*` strings are checked against a punitive-wording list (EN and DA); flame icons and the
old removed keys remain banned.

## Data and privacy

Profile A, device only, minimum data (habit ids). No vendor, no analytics, no log of titles or history,
no DB change, no store-disclosure change ("no material change": no new data leaves the device).

## Known limits

- The derived streak inherits APP-064's best-effort Habits sync: two devices marking different dates
  can lose or resurrect a day until "Habits durable sync" lands. The choice itself is per device.
- Restoring a backup or fetching from the server can leave a preference whose habit is not present on
  this device. It is harmless (unknown ids are ignored) and is removed when that habit is deleted here
  or on logout.
- Pre-existing and out of scope: `Date.UTC(year, …)` in `utils/shared/localDate.ts` treats two-digit
  years specially. Real dates are four-digit; tests use 2026–2028.
- Manual VoiceOver/TalkBack and large-text QA is still required.
- Release model: no DB migration, so the DB workflows are expected no-ops. They do not deploy the
  mobile client.
