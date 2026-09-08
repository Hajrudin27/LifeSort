# LifeSort — Monthly Review

**Story:** APP-016 (E1 · Module registry & Home, P2)
**Owner:** Hajrudin Kardasevic
**Code:** [`core/modules/monthlyReview.ts`](../core/modules/monthlyReview.ts), [`features/monthlyReview.ts`](../features/monthlyReview.ts)
**Enforced by:** `__tests__/monthlyReview.test.ts`
**Decision:** [ADR-0012](./adr/0012-monthly-review-reports-facts-not-judgement.md)

## What it is

One page, once a month, saying what the user's own records contain. Nothing
more.

Five modules contribute — economy, food, tasks, habits, household — each
returning facts for a given `YYYY-MM` from its own store. Same shape as Home
snapshots: the module supplies **numbers and keys**, never sentences, so the
shell renders in the user's language and a model could one day phrase the same
facts without ever producing them.

## The three rules

**1. Derived facts only.** Every number is recomputable from the user's records
for that month. No score, no index, no "20% better than last month" unless both
months exist. A comparison appears only when both sides are real: the food card
mentions a budget only if a budget was set.

**2. No praise and no blame.** A review of money, habits and home must not read
like a school report. Specification §8.4 and §25 are explicit that health, money
and habit flows must not shame or pressure. Concretely:

- Nothing counts what the user **did not** do. Unfinished to-dos are not a fact
  we report; that number is only a raised finger.
- Habits report entries, not streaks. A broken streak is the clearest example of
  a number that blames.
- A withdrawal from savings is reported as information, not as a failure —
  different wording, same neutral tone.

**3. Silence beats zero.** A module with no records for the month contributes
nothing. A page of zeros is not information, and "0 completed" is a judgement
wearing a number's clothes.

## Opting out

The invitation on Home can be turned off; **the page stays in Settings**. An
opt-out should stop something being pushed at you, not lock you out of it.

The invitation is withheld until the preference has loaded, so it does not flash
up for someone who turned it off.

## Cycle is deliberately absent

The review is a page you scroll and might hand to someone or screenshot. Health
facts do not belong in a cross-module summary when the module already has its
own history view — consistent with masking health on Home by default
([`home-snapshots.md`](./home-snapshots.md) §5).

## Month boundaries

`monthKey` is `'YYYY-MM'` compared as text against ISO dates, so no timezone can
move a record between months. Tests cover a year boundary, a February, and both
sides of the Copenhagen DST change.

## No AI here

The acceptance criteria allow AI phrasing as optional. There is none, and there
should be none until the AI governance layer exists (APP-085 onwards). What
exists is the right shape for it: facts as keys and parameters, so wording can
be replaced without letting a model near the arithmetic.
