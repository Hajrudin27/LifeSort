# ADR-0037: Budget periods are Copenhagen calendar periods, independent of the device

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-18 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-045 |
| **Superseded by** | – |

## Context

Home, Economy and Food each decided for themselves which month and week were
"current", from the device's local clock: `getMonthKey(new Date())`, and a Food
week helper that read host-local date fields. Food purchases are stored as
instants, and they were placed by that host-local week, or by the first seven
characters of their UTC text in the monthly review. So the same instant could
land in two different periods: on a device outside Denmark, near midnight, and
in the gap between Copenhagen midnight (22:00 or 23:00 UTC) and UTC midnight.
Tests could not see it, because `npm test` runs in Europe/Copenhagen.

LifeSort is Denmark-first. Its budgets, income months and Danish store
campaigns are Danish calendar periods.

## Decision

1. **The budget timezone is the IANA zone `Europe/Copenhagen`**, and it is not
   a setting. One instant maps to one Copenhagen calendar date, month and ISO
   week, on every device. `core/dates/budgetPeriod.ts` is the only place this is
   derived.
2. **Instants and calendar dates are different things.** A value with `Z` or an
   explicit offset is an instant and is converted to its Copenhagen date. A
   `YYYY-MM-DD` value already is a calendar date and is taken literally. A local
   date-time without an offset is refused, never guessed.
3. **Weeks are ISO 8601 weeks**: Monday first, and the week-year is the year of
   the week's Thursday.
4. **The runtime's IANA time-zone data owns Copenhagen's offsets.** Summer
   time, its history and any future change come from the platform's tz database
   (iOS, Android's ICU, the browser), read through `Intl.DateTimeFormat` with
   `timeZone: 'Europe/Copenhagen'`. LifeSort does not encode the EU summer-time
   calendar. It asks for the zone by its literal name and never uses the
   device's own timezone or UTC fields as the user's calendar. The conversion is:
   instant → Copenhagen year, month and day from Intl → pure calendar and
   ISO-week arithmetic.
5. **Only what Hermes supports is used.** One formatter per field (year, month,
   day), and only `format` and `resolvedOptions`, which Hermes supports on iOS
   and Android. `formatToParts` is not listed as supported, so it is not used.
   The `en-US` locale gives Latin digits without the `numberingSystem` option,
   and the Gregorian calendar whatever the device's settings. No `calendar`
   option is passed.
6. **It fails closed.** If the runtime rejects the zone, resolves a different
   one, or answers with anything but Latin digits forming a real date, the
   service throws `budget_period_time_zone_unavailable`. It never falls back to
   the device's timezone or UTC.
7. **The service is pure.** A caller passes the instant (`new Date()` on a
   screen). Each surface keeps its existing lifecycle.
8. **Stored period keys are not migrated.** The ISO-week algorithm gives the
   previous Food helper's week key for every calendar date, 2000–2040 (tested),
   so a stored `2026-W38` still means the same week.

## Consequences

- A user abroad sees Copenhagen's budget period: at 20:30 in New York on
  31 August, it is already September in the budget. That is right for a
  Denmark-first product. A per-user budget timezone would be a new decision,
  with persisted state, not a flag on this one.
- A change to Danish summer time needs no LifeSort change. It arrives with the
  OS or browser tz data. A device that has not updated yet computes with its own
  data, as every other app on it does.
- Correctness on a device depends on its engine's Intl time-zone support. The
  APP-045 audit found that support in the Hermes V1 build that React Native
  0.86 uses, and ran the production module in it (see
  [app-045-budget-periods.md](../app-045-budget-periods.md)). An engine without
  it fails with a fixed code, visibly, instead of computing a wrong period.
- CI checks behaviour, not a rule: that the service asks for the literal zone
  and uses only `format` and `resolvedOptions`; that it fails closed; the
  boundary and DST fixtures; and identical results under six host timezones.
  Node's own tz data supplies the offsets in CI.
- Modules that are not budget periods (habits, to-dos, cycle, travel, career,
  reminders) keep their device-local dates. This decision does not reach them.
- Current Economy surfaces now prepare their month through one path that reuses
  APP-042's `rollForwardMonth`. Home does so at startup, earlier than any screen
  did before, which widens the existing multi-device window in which two devices
  can each materialize the same month (see APP-045's known limits).

## Alternatives considered

- **Keep device-local time.** Rejected: the same instant gives different
  periods on different devices, and the test suite, pinned to Copenhagen, cannot
  notice.
- **UTC.** Rejected: Copenhagen midnight is 22:00 or 23:00 UTC, so a purchase at
  00:30 on the 1st would count in the previous month.
- **Writing out the EU summer-time rule** (the last Sundays of March and
  October, 01:00 UTC). This was the first draft of APP-045, and the architecture
  review rejected it before merge. It matched the IANA data from 1996 to 2037,
  but it made LifeSort the owner of time-zone legislation: any change to the EU
  or Danish rule would need a LifeSort release, and until then every period
  near a transition would be silently wrong. Platform tz databases are
  maintained for exactly this.
- **`Intl.DateTimeFormat.formatToParts`**, one full-date formatter. Rejected:
  Hermes does not list it as supported, and on iOS it splits the platform
  pattern heuristically. Three single-field formatters need only `format`.
- **A time-zone library** (Luxon, date-fns-tz, a bundled tzdata). Rejected: every
  target already carries IANA data, and a bundled copy is a second one that
  someone must keep current. Adding a dependency would need its own approval.
- **A user-selectable budget timezone.** Out of scope. It needs a persisted
  setting and an answer for existing period keys.
