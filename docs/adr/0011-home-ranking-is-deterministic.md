# ADR-0011: Home's order is deterministic, and the user outranks the app

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-012 |
| **Superseded by** | – |

## Context

Home shows a handful of cards and something has to decide their order. The
industry default is an engagement score — what the user opens most, what keeps
them in the app, what is freshest — and it is the default because it works, for
the app.

LifeSort holds someone's money, their health and their obligations.
Specification §6.1 is explicit that Home must feel personal "uden at blive et
engagement-algorithm feed", and §25 warns against gamification that pressures
users in health, money and recovery flows. An order the user cannot predict is
also an order they cannot trust with those things.

## Decision

Three signals, in this order, and nothing else:

1. **Pinned**, in the user's own order. Their choice outranks every judgement
   the app makes, including urgency — a pinned card stays where they put it.
2. **Urgent**, which comes from data (an overdrawn month) rather than from a
   decision to make something eye-catching.
3. **Recently used**, recorded centrally from the route the user visits, so it
   means "you were in this module" rather than "you tapped this card" — which
   would be self-reinforcing.

Registry order is the final tiebreak, making the sort a **total order**: the
same input always produces the same output, down to the last position.

The function is pure and takes preferences as an argument, so the ordering can
be reasoned about and tested without a device.

## Consequences

- The user can predict Home. Nothing moves unless they moved it, something
  became urgent, or they visited a module.
- No dwell time, no impression counts, no randomised placement, no decay curve.
  A test asserts repeated ranking is identical, and another stands as a marker
  where a display counter would otherwise be introduced.
- Hiding a card needs a visible way back, or "hide" becomes "delete" in the
  user's eyes. Hidden cards are listed at the bottom of Home.
- Pinning and hiding are **device-local**. Card layout is a preference about the
  screen in your hand; syncing it would cost a table and a migration for
  something nobody asked for. The module *choice* (APP-010) does sync, because
  it decides what the app contains.

## Alternatives considered

- **Score cards by how often they are opened.** Rejected: it is the feed
  mechanic the specification rules out, and it would bury a module precisely
  when someone has been avoiding it — which in a finance or health app is
  exactly when it should be visible.
- **Sort by data recency** (most recently changed module first). Rejected: it
  lets the app manufacture movement, and a quiet module is not a less important
  one.
- **Drag-to-reorder for every card.** Rejected for now: pinning gives the same
  control with far less complexity, and a full manual order has to survive
  modules appearing and disappearing. Revisit if pinning proves too coarse.
