# ADR-0017: Logout clears by sweeping storage, not by remembering every store

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-021 |
| **Superseded by** | – |

## Context

Logout cleared seventeen stores from a hand-written list. The list was correct
when written and had already drifted: `useHomeLayoutStore`, `useReviewStore` and
`sync-status` were added in later stories and never made it in, so a previous
user's pinned cards, the times they opened each module, and the names of the
modules whose sync had failed all survived a sign-out.

Attachment files were never deleted (D4) and scheduled notifications were never
cancelled (D5), so a cycle reminder could fire on a phone the account had been
signed out of a week earlier.

A list you must remember to update is not a mechanism. It is a hope.

## Decision

**Invert the rule.** Anything stored under a key we own is user data and gets
removed on sign-out. Keeping something requires an explicit entry with a stated
reason — currently two: the device's language, and the operator's kill switches.

A forgotten store is therefore *cleared by accident* rather than *kept by
accident*, and of those two mistakes the first is much the better one.

Clearing happens in two passes, in this order:

1. **In-memory resets**, handed in from `features/localStores.ts`, because
   emptying a store is not always setting it to empty — built-in categories and
   seed recipes belong to the app, not the user, and that knowledge belongs with
   the module.
2. **A sweep of AsyncStorage**, which catches stores nobody registered *and*
   stores that were never imported in this session and so could not be reset.

Order matters: resetting a store makes its persist layer write the empty state
back to disk, so sweeping first would leave the keys rewritten behind us.

Then files, notifications and keys — the three that were missing entirely.

## Consequences

- Adding a store now needs no change to the logout path for its *persisted*
  data. It should still get a reset entry so the current session is cleared too,
  and a test fails until it does.
- The sweep only touches keys under our prefixes, so other libraries sharing
  AsyncStorage are untouched.
- Every exception carries a reason, and a test asserts the reason is written.
- The seventeen-store list disappeared from `core`, which removed fourteen edges
  from the ADR-0003 baseline: core no longer reaches into any domain for logout.
- Cancelling *all* notifications is deliberately blunt. Every scheduled
  notification in the app belongs to the signed-in user, so there is nothing to
  preserve, and precision here would mean another list to forget.

## Alternatives considered

- **Have each store self-register on import.** Rejected: a store that was never
  imported never registers, which is exactly the case the sweep exists to cover,
  and it would mean editing every store file.
- **Keep the explicit list and add a test that it is complete.** This is half of
  what was built — the reset list still exists and is tested. But a list alone
  cannot clear a store that was never imported, and the persisted data is the
  part that outlives the session.
- **Clear the whole of AsyncStorage.** Rejected: it belongs to other libraries
  too, and it would take the device's language with it.
