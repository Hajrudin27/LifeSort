# Architecture Decision Records

**Story:** APP-007 (E0 · Architecture & inventory, P1)
**Owner:** Hajrudin Kardasevic
**Enforced by:** `__tests__/adrRegister.test.ts` (register integrity) and `scripts/check-adr.js` (the rule below).

## Why

A decision that is not written down gets made again — usually the other way, by
someone in a hurry, six months later. ADR-0006 is the clearest case in this
repository: putting the auth session in the device keychain instead of
AsyncStorage is one line longer than getting it wrong, and nothing in the code
says why the longer line is there.

An ADR records what was decided, when, by whom, and **what was rejected**. The
alternatives section is the part that stops a decision being relitigated.

## The register

| # | Decision | Status | Date | Story |
| --- | --- | --- | --- | --- |
| [0001](./0001-inventories-are-verified-by-tests.md) | Inventories are documents verified by tests | Accepted | 2026-09-07 | APP-001 |
| [0002](./0002-boundaries-enforced-by-test-gate.md) | Architecture boundaries are enforced by a test gate with a shrink-only baseline | Accepted | 2026-09-07 | APP-003 |
| [0003](./0003-core-is-dependency-inward.md) | Core is dependency-inward and migrates file by file | Accepted | 2026-09-07 | APP-004 |
| [0004](./0004-feature-state-never-gates-data-rights.md) | Feature state never gates data rights | Accepted | 2026-09-07 | APP-005 |
| [0005](./0005-kill-switches-fail-closed.md) | Kill switches are server flags over compiled defaults, and fail closed | Accepted | 2026-09-07 | APP-006 |
| [0006](./0006-auth-session-in-device-keychain.md) | The auth session lives in the device keychain, chunked | Accepted | 2026-09-07 | Pre-existing |
| [0007](./0007-app-lock-pin-is-defence-in-depth.md) | The app-lock PIN is defence in depth, not an authorisation boundary | Accepted | 2026-09-07 | Pre-existing |
| [0008](./0008-primitives-are-frozen-then-migrated.md) | Duplicated primitives are frozen now and migrated by the story that owns the semantics | Accepted | 2026-09-07 | APP-008 |
| [0009](./0009-registry-is-the-single-source-of-module-metadata.md) | The module registry is the single source of module metadata | Accepted | 2026-09-07 | APP-009 |

## When an ADR is required

**Any change to storage, sync or authentication requires an ADR** — either a new
one, or a status change on the one it affects.

These are the areas where a decision is expensive to reverse: how data is laid
down, how it is reconciled between devices, and how a user is proven to be
themselves. They are also where the wrong choice is the convenient one.

The governed paths are listed once, in `ADR_GOVERNED_PATHS` in
[`scripts/check-adr.js`](../../scripts/check-adr.js), and a test asserts every
entry still matches something real. Roughly: `store/`, `utils/auth/`,
`lib/supabase.ts`, `supabase/migrations/`, the sync and backup utilities, and the
future `core/storage`, `core/sync` and `core/auth`.

```bash
npm run check:adr            # compare against main
npm run check:adr -- <ref>   # compare against another ref
```

**No CI runs this yet** — the repository has no CI at all. Until APP-139 and
APP-141 set that up, it is a command you run, or hang off a pre-push hook. The
test suite still checks that the register itself is well-formed.

Other changes are welcome to have an ADR, but only these require one. An ADR for
every decision is how a register becomes noise nobody reads.

## Writing one

Copy the shape of an existing file. `docs/adr/NNNN-kebab-title.md`, next number,
no gaps.

```markdown
# ADR-NNNN: Title in one line

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | YYYY-MM-DD |
| **Owner** | Name |
| **Story** | APP-NNN, or "Pre-existing" |
| **Superseded by** | – |

## Context
## Decision
## Consequences
## Alternatives considered
```

Statuses: `Proposed`, `Accepted`, `Superseded`, `Deprecated`.

**Never edit a decision away.** Reversing one means a new ADR that supersedes the
old, and setting the old one's **Superseded by** to point at it. The register is
a history, not a description of the present — the reasoning behind an abandoned
choice is exactly what stops it being re-adopted by accident.

Keep the alternatives honest. "We considered X and rejected it because Y" is
worth more than the decision itself.
