# ADR-0005: Kill switches are server flags over compiled defaults, and fail closed

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-006 |
| **Superseded by** | – |

## Context

A broken module must be stoppable without a store release, which takes days.
That means the state has to come from the server. But a switch that can close a
module can also, if it goes wrong, close the whole app for every user at once —
and it is consulted precisely when something is already broken.

## Decision

`module_flags` in Supabase overrides the compiled-in state per module. Read-only
to clients; only the service role writes. Three rules govern how the client
treats the answer:

1. **Unknown input changes nothing.** Unknown module, unknown state, malformed
   row, non-array response: dropped, keeping the compiled default. Doubt narrows
   access; it never widens it. One bad row does not cost the others.
2. **The shell cannot be closed.** `core-shell` and `account` are rejected
   client-side whatever the server says, and a check constraint rejects the row
   too. The client does not trust the database here, deliberately: one bad row
   would otherwise remove every user's settings, export and account deletion.
3. **Failure keeps the last known answer.** Never "everything open" — that would
   reopen a broken module in exactly the situation where the server cannot be
   reached. Flags are cached, so a closed module stays closed offline.

Flags are fetched at startup rather than at login, so a closed module is closed
before anyone signs in, and are not cleared on logout: they are operator
configuration, not user data.

## Consequences

- A user with the app already open keeps the old state until relaunch. There is
  no live invalidation.
- `maintenance` is only partly enforced: creation and edit screens are blocked,
  but a screen that reads and writes in one place is not, because blocking it
  would take reading away with writing. `hidden` is the certain stop.
- `internal` and `beta` read as closed for everyone until a role model exists.

## Alternatives considered

- **Default to open when the fetch fails.** Rejected outright, for the reason in
  rule 3.
- **Let the flag close any module including the shell,** trusting the operator.
  Rejected: it makes a typo unrecoverable without a store release, which is the
  problem the switch exists to avoid.
