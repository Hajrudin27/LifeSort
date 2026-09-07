# LifeSort — Module Maturity States

**Story:** APP-005 (E0 · Architecture & inventory, P0)
**Owner:** Hajrudin Kardasevic
**Code:** [`core/modules/moduleAvailability.ts`](../core/modules/moduleAvailability.ts)
**Enforced by:** `__tests__/moduleAvailability.test.ts`, on every `npm test`.
**Current states:** [`docs/app-inventory.md`](./app-inventory.md) §1 — kept in sync with the code by test.

## Why

A half-finished module must not look finished. Without one shared state, each
screen invents its own half-measure — an `if` here, a hidden tab there — and
nobody can answer what the user can actually do right now.

One typed state per module, one evaluator that turns it into capabilities.

## The rule that outranks the others

**A flag may never make existing user data unreachable.**

Whatever state a module is in, the user can still export and delete their own
data. That is a data right, not a feature that can be switched off. The
evaluator returns `canExportData: true` and `canDeleteData: true` for **every**
state, and the test asserts it exhaustively across every state and every viewer
— so a seventh state cannot be added that quietly forgets it.

## The states

| State | In navigation | Can open | Sees existing data | Can create / edit | Export & delete |
| --- | --- | --- | --- | --- | --- |
| `hidden` | no | no | no | no | **yes** |
| `internal` | internal users only | internal users only | internal users only | internal users only | **yes** |
| `beta` | beta testers and internal | same | same | same | **yes** |
| `available` | yes | yes | yes | yes | **yes** |
| `maintenance` | yes | yes | **yes** | no | **yes** |
| `retired` | no | no | no | no | **yes** |

`maintenance` is the interesting one: the module stays open and readable, it
just stops accepting new work. That is what makes it usable as an incident
response — degrade a broken module without taking the user's records away with
it.

`retired` removes the module's screens but not the data: it remains reachable
through the export and deletion path, which is what "export/migration path
documented" in specification §1.2 requires.

## Choosing a state

| Situation | State |
| --- | --- |
| Code merged, not ready for anyone | `hidden` |
| Ready for the founder to dogfood | `internal` |
| Ready for invited testers, not for the store | `beta` |
| Meets its launch gate | `available` |
| Broken or under incident; existing data must stay readable | `maintenance` |
| Being wound down; users need their data out | `retired` |

A module goes to `maintenance`, never straight to `hidden`, once real users have
put data in it. Hiding a module that holds someone's records makes their data
look deleted.

## What the evaluator returns

`evaluateModuleAccess(availability, viewer)` answers seven questions rather than
one boolean, because "is this on?" is the wrong question. A module in
maintenance is on for reading and off for writing at the same time.

`status` carries **why** — `unreleased`, `internal-only`, `beta-only`,
`maintenance`, `retired` — so a gated screen can say what is going on instead of
rendering blank, which specification §6.2 requires.

Two invariants hold by construction and by test: nothing appears in navigation
that cannot be opened, and nothing can be created in a module that cannot be
opened.

## The viewer

`internal` and `beta` need to know who is asking. There is no role or beta model
in the app yet, so `ModuleViewer` is an input with a `PUBLIC_VIEWER` default of
"neither". The default is deliberately the least privileged: an unproven viewer
is not an internal one, and the test asserts the default matches the public
case exactly.

Populating it for real belongs with entitlements and beta membership
(APP-131, APP-166).

## Not in this story

- **Where the state comes from.** It is declared in code today. Remote flags and
  kill switches that can change it without a release are **APP-006**.
- **Consuming it.** Nothing calls the evaluator yet — every module is
  `available`, so it would change no behaviour. APP-006 wires it, with the safe
  fallback screen; APP-009 folds `availability` into `ModuleDefinition`.
- **User-chosen modules.** Whether a user has *enabled* a module is a separate
  axis from whether it is *released*. That is **APP-010**, and it must not be
  collapsed into this one: disabling a module must never delete data either.
