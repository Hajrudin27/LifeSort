# LifeSort — Architecture Dependency Rules

**Story:** APP-003 (E0 · Architecture & inventory, P0)
**Owner:** Hajrudin Kardasevic
**Enforced by:** `__tests__/architectureBoundaries.test.ts`, on every `npm test`.
**Module ownership:** [`docs/app-inventory.md`](./app-inventory.md) §1, §2, §3, §5 — the single source of truth. The rules read it; they do not repeat it.

## Why

A module that cannot be isolated cannot be switched off, tested on its own,
given its own storage profile, or handed a privacy boundary. Every direct
reach into another module's store is a wire that has to be cut later — and the
longer it stays, the more expensive the cut.

The goal of this story is **not** to untangle what is already tangled. It is to
stop the tangle from growing while the platform layer is built.

## Vocabulary

**Platform stores** — the cross-cutting services every module is allowed to use:
the stores owned by the `core-shell` and `account` modules (session, profile,
settings, theme, toast, tab bar, sync status, app lock). Derived from
`docs/app-inventory.md` §3, not hard-coded.

**Domain stores** — everything else. Each belongs to exactly one module and is
private to it.

## The rules

| # | Rule | Rationale |
| --- | --- | --- |
| **R1** | A route may import its own module's stores and platform stores. Nothing else. | Master spec §3.2: `app/*` must not import another module's private store. This is the rule the story exists for. |
| **R2** | A store must not import from `app/`, `components/` or `hooks/`. | State does not depend on the UI that renders it. Keeps stores testable without a renderer. |
| **R3** | A store may only import platform stores. | Two domains sharing state directly cannot be separated later. |
| **R4** | A shared component or hook may only import platform stores. A module-owned component may also import its own module's stores. | The design system must not carry domain knowledge, or it stops being shared. |
| **R5** | `utils/<domain>/` must not import any store. `utils/shared/` and `utils/auth/` are exempt as platform services. | Domain logic stays pure, which is why it can be unit-tested directly. |
| **R6** | A core file must not import a domain store, a domain util, a route or a feature component. See [`docs/core-contract.md`](./core-contract.md). | Core that knows its consumers is not a platform but a hub. Added by APP-004. |

R2, R3 and R5 hold today with no exceptions. R1, R4 and R6 have frozen baselines.

## What to do instead

| Instead of | Do this | Story |
| --- | --- | --- |
| Home reading a domain store | Ask the module for a typed `homeSnapshot()` — done for the overview cards in APP-011, see [`docs/home-snapshots.md`](./home-snapshots.md) | APP-011, APP-012 |
| Search crawling stores | Ask the module for `searchEntries()` | APP-077 |
| A hub screen counting another module's items | Read through a typed selector the module exports | APP-009 |
| The root layout hydrating every domain | Iterate the module registry | APP-009 |
| Logout clearing every store by hand | Iterate the module registry's clear handlers | APP-021 |
| One module reacting to another's change | Emit a typed domain event with a minimal payload | APP-009 §4.2 |

## The baseline

`BASELINE` in `__tests__/architectureBoundaries.test.ts` lists the couplings that
existed when this rule was introduced: 38 route edges across six files, and 3
component edges. APP-011 removed the first four. Each entry carries the story that will remove it.

Two properties make it a ratchet rather than a rug:

1. A violation **not** in the baseline fails immediately.
2. A baseline entry that is **no longer** a violation also fails, so a fixed
   coupling must be deleted from the list.

So the list can only shrink. **Never add a line to `BASELINE` to make a test
pass** — that deletes the rule for that file. If a new dependency really is
justified, the right move is to change the rule deliberately and record why
(APP-007, ADR register).

The worst entry in the list is `app/todos/new.tsx -> useCycleStore`: the task
module reads reproductive-health state. It is carried here so it is impossible
to forget, and it is removed by APP-071.

## Known limits of this gate

- It runs in CI and on `npm test`, not in the editor. There is no red squiggle
  while you type; you find out when you run the tests.
- It matches static `from '@/store/…'` imports. A dynamic `await import()` of a
  store, or a re-export through a barrel file, would not be seen. Neither
  pattern is used in the repo today.
- It governs stores. Cross-module imports of types, components or utils are not
  restricted, because sharing a type is not the same as sharing state.
- R6 governs the code that is core **today**, wherever it currently sits, not
  just the `core/` folder — see the core surface table in
  [`docs/core-contract.md`](./core-contract.md). `utils/shared/` and
  `utils/auth/` are exempt from R5 but held to R6 instead, which is stricter.
