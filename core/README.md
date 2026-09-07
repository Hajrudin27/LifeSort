# core/

The platform layer. Shared concerns live here exactly once.

**Core does not know its consumers.** A module may import core; core may never
import a module — no domain store, no domain util, no route, no feature
component. Rule R6 in `__tests__/architectureBoundaries.test.ts` enforces it.

Before adding anything here, read [`docs/core-contract.md`](../docs/core-contract.md):
it defines what belongs in core, where today's core code still lives, and why
this folder is close to empty on purpose.

Existing shared code moves in here when it is being changed anyway — not in one
large migration.
