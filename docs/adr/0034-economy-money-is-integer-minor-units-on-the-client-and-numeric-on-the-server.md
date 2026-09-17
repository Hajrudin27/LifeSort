# ADR-0034: Economy money is integer minor units on the client and numeric on the server

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-17 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-040 |
| **Superseded by** | – |

## Context

Economy persisted money as major-unit JavaScript numbers: expense amounts and
category budgets (encrypted), monthly income, and savings goals, history and
extra savings. Sums such as `0.1 + 0.2` drifted, `parseFloat` accepted a third
decimal (`12.345`) and stored it, and some values were large enough that
`value × 100` could leave the safe integer range. The server columns are
PostgreSQL `numeric` in major DKK, and the untyped Supabase client delivers them
as JS numbers after `JSON.parse`. Backups restored Economy state directly with
`setState`, so a backup could reintroduce the old representation.

## Decision

- **Client canonical money is `MinorUnits`:** DKK øre as a branded JavaScript
  safe integer (`core/money`). Values are created only by a validating
  constructor, the text parser or a boundary converter; arithmetic is checked
  and never clamps.
- **Server canonical money stays `numeric` in major DKK.** No schema change.
  One boundary sends exact decimal text. Inbound values have no tolerance: a JS
  number must be exactly the double of one uniquely recoverable cent, and no
  decimal 0.000001 DKK or more from that cent may parse to the same double.
- **Persisted money must be *supported*, not merely a safe integer.** An amount
  is supported iff (1) its decimal, parsed as PostgREST's JSON number literal and
  recovered by the exact inbound converter, is the same amount, and (2) no
  decimal a material 0.000001 DKK or more away parses to the same double, proved
  with exact decimal text one material step either side. Without (2) numeric
  20000000000000.001 would arrive as exactly the double of 20000000000000.00 and
  be accepted as that cent. Every amount up to 2³³ DKK qualifies; above that only
  some cents do. Forms, every store write (including resulting savings balances
  and extra savings), local v1 validation, backups and the savings conflict
  policy all require it before any state changes.
- **Legacy local numbers convert only when the deviation is provably noise:**
  within min(1024 · `EPSILON` · max(|value|, 1 DKK), 0.000001 DKK / 2 − ulp).
  No deviation of 0.000001 DKK or more is ever absorbed, at any magnitude; from
  2³¹ DKK only exact cent doubles are accepted, and an exact cent double is
  accepted only when it passes the same sub-cent probe (a parsed third decimal
  can collapse onto it). Anything else fails closed. There is no rounding rule.
  This converter serves local migrations and backup format 1 only.
- **Local stores move from Zustand v0 to v1 through the APP-038 harness.**
  Income and Savings are generic versioned surfaces. Expenses stays owned by the
  encrypted adapter, which runs the harness in memory and makes one encrypted
  commit.
- **Remote hydration validates the complete fetched snapshot before any state
  change;** one invalid amount rejects the store's fetch.
- **Backups advance to format 2** (Economy money in `MinorUnits`). Format 1 is
  converted and format 2 validated in the parser, before any store mutation.
- **One localized DKK formatter** renders Economy money exactly for every
  `MinorUnits`, independent of support: Intl formats a same-shape template
  (1, 10, 100, …) and the amount's own digits replace the template's. No amount
  is converted to a major-unit double for display.

## Consequences

- Float drift and silent sub-cent precision are gone from Economy persistence,
  aggregation and transport, and cannot be reintroduced by a backup or a fetch.
- A device holding unsupported legacy money cannot start until the data is
  addressed; its bytes are preserved. This is deliberate: guessing would corrupt
  financial records.
- Amounts that a double cannot carry without ambiguity after `JSON.parse` (from
  8 589 934 592,01 kr.) cannot be entered, restored or hydrated, rather than being
  accepted locally and failing later or silently at the server boundary. Reading
  numeric as text would lift this limit but needs verification against the hosted
  PostgREST and is left for a separate decision.
- Derived totals of supported amounts can exceed that range. They are never
  persisted and still display exactly.
- Some legacy local values with genuine accumulated drift at very large
  magnitudes (from 2³¹ DKK) now fail closed instead of being recovered; the
  reviewer-approved policy prefers that over absorbing a possible sub-cent value.
- Food, Travel and other modules still use major-unit numbers; the Economy tab
  keeps their display path separate. `core/money` is ready for their own stories.
- Stores migrate independently (APP-038): a partially upgraded device finishes
  on the next boot without rescaling stores that already committed.

## Alternatives considered

- **Round legacy values to the nearest cent.** Rejected: it silently rewrites
  user financial data, and no approved rounding rule exists.
- **Convert server columns to integer cents.** Rejected: `numeric` is an
  approved server representation, a schema change touches every environment,
  and it would not fix the client representation by itself.
- **A `Money` object or decimal library.** Rejected for now: DKK-only Economy
  needs no currency field or arbitrary precision, and a branded safe integer
  keeps JSON persistence, Zustand state and arithmetic simple.
- **Store major units and round only when displaying.** Rejected: drift
  accumulates in canonical totals, which is the defect this story fixes.
- **A separate migration runner or a plaintext staging key for Expenses.**
  Rejected: APP-038 already provides the one-write harness, and plaintext
  staging would weaken the APP-029 encryption guarantee.
- **Keep one backup format and detect units heuristically.** Rejected: a
  plausible integer cannot be told apart from kroner or øre; the format version
  must say which.
- **Validate only safe integers and let sync discover transport problems.**
  Rejected: an un-round-trippable amount would already be canonical local state
  (and could arrive through a backup) before any fetch failed.
- **A relative-only legacy tolerance, shared with server ingress.** Rejected:
  at billions of DKK it absorbed third decimals (5 000 000 000.001 → a cent), and
  server values are exact decimals that need no tolerance at all.
- **A fixed user-facing maximum amount.** Rejected: the limit is a property of
  the transport representation, so each value is proven by the round trip and
  the sub-cent probe instead.
- **Round trip alone as the support test (2⁴⁶ DKK).** Rejected in review: an
  exact cent double does not prove the stored decimal had cent precision once
  `JSON.parse` can collapse a material third decimal onto it.
- **A different material threshold to keep a larger range.** Not taken: the
  0.000001 DKK policy was approved for the legacy rule, and the transport probe
  reuses it unchanged.
- **Require supported money for display.** Rejected: derived totals are not
  persisted and must not make Economy, Home or the monthly review throw; digit
  substitution displays every safe integer exactly.
