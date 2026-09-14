# core/

The platform layer. Shared concerns live here exactly once.

**Core does not know its consumers.** A module may import core; core may never
import a module — no domain store, no domain util, no route, no feature
component. Rule R6 in `__tests__/architectureBoundaries.test.ts` enforces it.

Before adding anything here, read [`docs/core-contract.md`](../docs/core-contract.md):
it defines what belongs in core and the gradual migration policy. Shared auth,
module, storage and sync services now live here; some older platform code still
lives under `utils/` and is governed by the same dependency rules.

Existing shared code moves in here when it is being changed anyway — not in one
large migration.
