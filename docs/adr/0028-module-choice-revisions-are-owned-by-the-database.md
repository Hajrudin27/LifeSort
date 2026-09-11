# ADR-0028: Module choice revisions are owned by the database

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-11 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-033 |
| **Superseded by** | – |

## Context

The master specification §5.2 and APP-033 require revision/updated_at metadata
and fetches that update existing rows. APP-031's durable outbox and APP-032's
single-send adapter are deliberately not wired to production stores (ADR-0026,
ADR-0027). Continue their Profile A `core.module-choice` / `module-choice` proof
slice, whose server identity is `(user_id, module_id)` and value is `enabled`.

Inspection found these writes to `public.user_modules`:

- `useEnabledModulesStore.syncToSupabase`: direct upsert, called by
  `setModuleEnabled` from Settings and onboarding. It sends client updated_at.
- `apply_sync_mutation`: authenticated, receipt-protected upsert using `now()`.
- The historical cycle-choice seed: insert when no choice exists.
- Owner RLS/grants allow direct INSERT/UPDATE/DELETE, independently of the RPC.
  Account deletion cascades rows. The scratch fixtures also write directly.

The existing schema has a composite primary key, auth.users cascade ownership,
non-null boolean enabled and timestamptz updated_at defaulting to now(), plus a
constraint excluding core-shell/account. No update trigger existed. Direct SQL
could omit updating the timestamp or supply arbitrary clocks; it was not reliable
version metadata. The RPC alone cannot establish an all-write invariant.

The only existing production fetch is `useEnabledModulesStore.fetchFromSupabase`,
called from the root layout. It selects module_id/enabled, parses them via
`parseModuleEnablementRows`, and replaces the local enablement map. The persisted
`lifesort-enabled-modules` value has booleans only: optimistic and confirmed values
are indistinguishable, and there is no durable per-choice pending marker. Wiring
revision reconciliation into that store now would silently choose a conflict policy.

## Decision

### Server metadata

One APP-033 migration adds a non-null positive `bigint revision` to user_modules.
Every existing row receives revision **1**, regardless of its prior value or age.
The migration replaces all pre-revision timestamps with one server statement time:
this is the baseline version time, not a reconstruction of historical edits.
Client-supplied future/infinite timestamps must not poison the new invariant.
Domain values, ownership and receipts are untouched. Migration statements run in
one transaction so no concurrent writer can slip between the baseline and trigger.

A narrowly scoped BEFORE INSERT OR UPDATE trigger always replaces caller metadata.
INSERT receives revision 1 and clock_timestamp(). UPDATE receives OLD.revision + 1
and greatest(clock_timestamp(), OLD.updated_at + one microsecond). This guarantees
strict per-row advancement even for multiple writes inside a transaction or a
server clock adjustment. Timestamps describe the version's server write time;
they are not exact transaction commit timestamps and are never used for ordering
or conflict resolution. An aborted write/transaction leaves neither new value nor
metadata. Bigint exhaustion aborts rather than wrapping.

The trigger is SECURITY INVOKER, with empty search_path and qualified callable
catalog functions; it only assigns NEW fields and needs no elevated privilege.
Direct EXECUTE is revoked from PUBLIC, anon, authenticated and service_role.
Existing table grants, owner RLS policies and RPC privileges are unchanged.
The trigger protects INSERT/UPDATE/UPSERT regardless of whether a legacy client,
APP-032 or privileged ordinary SQL performs the write. Database owners can of
course change/disable schema enforcement; no protection against a malicious DBA
is claimed. Existing DELETE privileges are unchanged. Recreated rows begin at 1;
tracking identity across deletion belongs to APP-034, not this revision model.

Every accepted write advances, including a new mutation ID with the same boolean.
There is no semantic no-op detection. APP-032 receipt replay returns before any
domain write, so it cannot advance revision or updated_at or restore an old value.
PT409 collision and failure/rollback semantics remain unchanged. The RPC and its
fingerprint are deliberately not edited. Its existing now() assignment is now
overridden by the trigger. The status-only RPC response remains applied/replayed;
revision metadata is obtained by the explicit fetch path, not inferred from it.

### Confirmed-state reconciliation

`core/sync/moduleChoiceReconciliation.ts` defines an immutable normalized
`{ entityId, enabled, revision, updatedAt }` for confirmed choices. Account ownership
is held by the enclosing handle, not accepted from remote payload as authorization.
The fetch selects `revision::text`, preserving the complete PostgreSQL bigint range
through JSON and JavaScript; canonical positive decimal strings are compared by
length then lexical order. Missing/invalid/versionless metadata fails closed.
updated_at is preserved as returned, including sub-millisecond precision.

`createModuleChoiceSnapshots(accountId)` is an explicit in-memory confirmed-state
handle beside the existing outbox/send primitives. `fetch(pendingEntityIds)` pins
the matching account bearer and filters user_id, disables SDK GET retries, then
rechecks the current account before publishing. Failure keeps the previous state.
Concurrent requests reconcile against the latest state when they finish, avoiding
out-of-order response regression. `getSnapshot()` retains account ID, values and
metadata across calls; `dispose()` clears state and rejects late responses.
Callers must dispose at account cleanup. There is no global store or automatic
production lifecycle integration. A new handle/restart starts empty and fetches
confirmed state again; this adds no persisted surface and no rehydration contract.
Profile A classification and the data-profile registry therefore remain unchanged.

Reconciliation uses stable entity IDs, with deterministic ID ordering and no
append-only behavior or duplicate rows:

- Newer remote revision replaces the existing value and both metadata fields.
- Older remote revision cannot regress local confirmed state, whatever its clock.
- Equal revision and identical content/metadata are idempotent.
- Equal revision with different enabled or serialized updatedAt fails the entire
  reconciliation with an internal invariant error. No timestamp tie-breaking.
- Missing remote entities are retained. Absence conveys no deletion instruction.

The handle accepts only server snapshots; it has no setter for local optimistic
values. Callers explicitly supply pending entity IDs; known pending work refuses
the fetch instead of choosing a winner. The pure primitive likewise refuses a
pending ID participating in reconciliation. This is an integration guard, not an
atomic observation of the outbox or a concurrent conflict solution. Production
store integration is intentionally deferred to APP-035 because the current store
cannot distinguish confirmed data from unsent writes. Its existing behavior is
unchanged; this ADR does not claim it now has revision-aware synchronization.

APP-031 baseRevision remains optional stored metadata. APP-032's adapter continues
to reject a supplied baseRevision and does not send it; the RPC has no revision
precondition. APP-033 does not add optimistic concurrency control.

## Consequences

Only user_modules has migrated revision semantics. The new fetch requires this
migration to have been separately deployed; a versionless response is rejected.
This implementation applies it only to scratch PostgreSQL, never linked STAGING
or Production. No new dependency, local persisted state, UI, or automatic sync
execution is introduced. There is no atomic local entity/outbox transaction.

`node --test tests/db/app033.test.cjs tests/db/app032.test.cjs` uses the established
scratch-PostgreSQL approach: unique temporary clusters, TCP disabled, minimal auth
fixtures, real roles/RLS, failure and concurrency tests, then clean shutdown.
APP-032's original regression suite now also applies the APP-033 migration before
its assertions. Set APP033_PG_BIN / APP032_PG_BIN to PostgreSQL bin directories if
needed. These are bounded story tests, not a historical app migration harness.
Jest verifies fetched updates of existing rows, stale/equal versions, bigint
precision, pending refusal, account boundaries and out-of-order reads. Hosted
PostgREST/JWT behavior and schema drift are not proven by these local fixtures.

APP-034–038 are explicitly unimplemented: no deletion propagation/tombstones,
retention/resurrection protection, local-vs-remote conflict policy, field merge,
LWW, sync-status UX, retries/workers/connectivity/batching, or migration framework.
No inference of deletion from a missing row, and no interpretation of timestamp
as version authority. No remote migration, Git commit or push is part of APP-033.

## Alternatives considered

- Maintain revisions only inside the RPC: legacy direct writes would bypass them.
- Revoke direct writes and migrate the UI/outbox now: broadens this story into
  pending-write persistence, lifecycle and conflict policy work.
- updated_at ordering or JS numeric bigint transport: clocks are not revisions,
  and numeric JSON loses integer precision beyond 2^53 - 1.
- Persist a second module-choice cache: unnecessary for this confirmed-state
  primitive and adds account cleanup/rehydration complexity before integration.
- Global revisions, generic triggers, or migration of more domains: no benefit
  to the requested incremental proof slice.
