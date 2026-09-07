# ADR-0010: A user's module choice is a filter, never a deletion

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-010 |
| **Superseded by** | – |

## Context

Users need to switch off areas they do not want, or LifeSort feels cluttered.
But a toggle beside "Economy" or "Cycle" is frightening: if it might delete two
years of expenses or a health history, nobody will touch it, and the feature
fails at its purpose.

There is also a second axis already in the app. A module can be *released* or
not (APP-005/006, the operator's decision) and *chosen* or not (the user's).
Collapsing them into one boolean would mean a kill switch looking like a user
preference, and a user's choice looking like an outage.

## Decision

**Disabling hides. It never deletes.** The store writes one row in
`user_modules` and touches no domain data, locally or remotely. Re-enabling
restores the module with everything in it.

**The two axes stay separate.** `moduleEnablement` answers "did the user choose
this?"; the availability evaluator answers "is this released?". Screens ask both.
Concretely: a user's choice removes a module from navigation but does **not**
block its routes, while a kill switch blocks the routes themselves. Someone who
disables Travel and then follows an old link still reaches their trips.

**The default is on**, and doubt resolves to on. An unparseable server response
leaves modules enabled — the opposite of the kill-switch rule, where doubt
closes. Both follow the same principle: never let confusion hide a user's data.

**The platform cannot be disabled.** `core-shell` and `account` are rejected in
the client, absent from the toggle list, and rejected by a check constraint,
because hiding them would hide the route to export and account deletion.

## Consequences

- The choice syncs across devices as one row per module, so two devices can
  change different modules without overwriting each other's answer.
- It is cleared on logout, unlike kill switches: it belongs to the user, not the
  device, and the next person to sign in must not inherit it.
- A disabled module's data is reachable only by re-enabling it or through
  export. That is acceptable because both paths are always available, and it is
  the reason the screen says so in plain words.
- Every surface that lists modules must now filter. Missing one means a disabled
  module still appears, which is a visible bug rather than a silent one.

## Alternatives considered

- **Delete the module's data on disable**, as a "clean slate". Rejected: it
  makes the toggle a destructive action behind a switch, and it contradicts
  ADR-0004.
- **One boolean combining released and chosen.** Rejected: the two have
  different owners, different defaults and opposite failure directions.
- **Block routes for disabled modules,** as the kill switch does. Rejected: a
  user hiding a module has not asked to be locked out of it, and an old deep
  link or a notification would then dead-end.
- **Default new modules to off** so the app starts uncluttered. Rejected here:
  it would hide data from existing users at upgrade. Onboarding may narrow the
  selection for *new* users instead (APP-020).
