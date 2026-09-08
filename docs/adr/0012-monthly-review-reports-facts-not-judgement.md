# ADR-0012: The monthly review reports facts, never judgement

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-016 |
| **Superseded by** | – |

## Context

A monthly summary is where an app is most tempted to editorialise: a score, a
comparison, a streak, an encouraging line. It is also, in LifeSort, a summary of
someone's money, their household and their habits — the three things
specification §25 warns against gamifying, because the user who most needs the
overview is the one having the worst month.

## Decision

The review contains derived facts only, and each fact is a key plus numbers
rather than a sentence.

Three consequences follow, and they are the decision as much as the rule is:

1. **Nothing counts what the user did not do.** Unfinished to-dos, missed habit
   days and untouched goals are not reported. They are true, and they are still
   a raised finger.
2. **Comparisons need two real sides.** The food budget is mentioned only when a
   budget exists. "Over budget" with no budget is invention.
3. **A module with no records says nothing.** Not zero — nothing.

Opting out removes the invitation from Home and leaves the page in Settings.

## Consequences

- The review will look sparse for a light user. That is honest: it reflects what
  they recorded, and a fuller page would mean inventing.
- Adding a module to the review means writing a provider that returns facts, not
  copy — so a contributor cannot accidentally add an opinion.
- A model can later phrase these facts, and cannot produce them, because the
  arithmetic happens before any text exists.
- Cycle is excluded, so the review is not a place health data can leak into a
  screenshot.

## Alternatives considered

- **A completion percentage or monthly score.** Rejected: it invents a
  denominator the user never agreed to, and it turns a bad month into a bad
  grade.
- **Streaks and "best month yet" comparisons.** Rejected: motivating for people
  already doing well, and punishing for exactly the people the overview is
  for.
- **Report zeros so the page always looks complete.** Rejected: a page of zeros
  is not information, and "0 completed" reads as an accusation.
