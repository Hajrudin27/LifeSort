# ADR-0029: Module choice deletions retain an immutable version

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-11 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-034 |
| **Superseded by** | – |

## Context

Master Production Specification v1.0 §5.2 and APP-034 require explicit deletion
history, server retention and protection against stale-client resurrection.
Continue the APP-031–033 Profile A `core.module-choice` / `module-choice` slice.
This extends ADR-0027/0028; their active-write, receipt and confirmed-state design
still applies, except that ordinary physical DELETE is now denied and tombstones
are immutable. The older ADRs record the scope as it stood in those stories.

Inspection: Settings and onboarding use `ModuleChoiceList` → `setModuleEnabled`
→ `useEnabledModulesStore.syncToSupabase`. Disabling writes `enabled=false`, never
a deletion. The store's direct upsert supplies a legacy client updated_at; the
APP-033 trigger replaces it. Other writers are `apply_sync_mutation`, the historical
cycle-choice seed, and test fixtures. No application code physically deletes an
individual user_modules row. However, the original owner DELETE policy and table
grant allowed an authenticated client to remove one directly. Account deletion
uses the privileged `delete_my_account()` RPC to delete auth.users and cascade
both user_modules and mutation_receipts. It does not need the client DELETE grant.

The existing persisted enablement store mixes optimistic and confirmed values.
It remains unwired to the sync primitives; the explicit proof delete has no UI.
Its legacy fetch still reads only module_id/enabled and does not interpret deletion.
No claim is made that the production UI now propagates or displays deleted choices.

## Decision

### Explicit server state and metadata

Add nullable `deleted_at timestamptz` to user_modules. Existing rows remain active
with NULL; adding the column does not rewrite their revision or updated_at.
A tombstone retains `(user_id, module_id)`, enabled, revision, updated_at and a
non-null deleted_at. The retained boolean is historical content, not a restore
instruction or a module-disable operation.

Extend the existing SECURITY INVOKER BEFORE INSERT/UPDATE revision trigger:

- INSERT creates active revision 1 with clock_timestamp(), overriding supplied
  revision, updated_at and deleted_at (the last becomes NULL).
- UPDATE of an active entity increments revision exactly once, and stamps
  `greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond')`.
- If that UPDATE requests deletion via a non-null deleted_at, replace it with the
  new updated_at. Clients cannot forge committed deletion time, even through
  legacy direct SQL. Timestamp describes server version-write time, not exact
  commit time or ordering authority. A direct owner UPDATE can express deletion
  intent too; it obeys the same tombstone invariant but has no mutation receipt.
- Any UPDATE of an already tombstoned row raises `PT409 / entity_deleted`, even
  a same-value write, metadata change, clearing deleted_at, or renaming its key.
  This includes ON CONFLICT UPDATE and privileged ordinary SQL with triggers on.

The helper retains empty search_path and revoked direct EXECUTE. It only touches
NEW/OLD and needs no definer privilege. Normal upsert does not implement restore.
There is no baseRevision parameter or precondition: the adapter continues rejecting
any supplied baseRevision. This stronger deletion-only refusal protects old and
new clients without making revisions authoritative for active-vs-active edits.
An earlier accepted upsert replay still returns replayed without touching a now
deleted row; a new upsert targeting that row returns conflict and no new receipt.

Revoke DELETE and TRUNCATE on this table from PUBLIC, anon and authenticated, and
remove the owner DELETE policy. Other RLS policies and grants stay unchanged.
This closes physical deletion/reinsertion and table-truncation bypasses. Privileged
service/account cleanup remains possible; no DELETE trigger blocks cascades.
A database owner can still change enforcement or physically purge records, so the
retention policy applies to privileged maintenance too. No malicious-DBA guarantee.

### Trusted mutation dispatcher

Keep the existing six-argument `apply_sync_mutation` signature, owner derived from
auth.uid() plus a live auth.users check, receipt table and least-privilege EXECUTE.
Definer execution is still necessary for the inaccessible receipt table, with
empty search_path and qualified domain/receipt access. Only module-choice upsert
and delete are allowed. No arbitrary-table delete dispatcher is introduced.

The minimal APP-031 delete envelope carries mutationId, dataDomain, entityType,
entityId and operation=delete, plus its existing local queue metadata; payload is
omitted. The adapter maps omitted/explicit-null payload to null for the RPC. SQL
NULL and JSON null are accepted and fingerprint identically; any other delete
payload fails PT400. Invalid identity/routing/operation fails PT400. A missing
entity (including excluded platform IDs) fails PT422 without a successful receipt.
Deletion does not create a version for an entity that has never existed.

The fingerprint remains exactly SHA-256 over JSONB text of
`[1, dataDomain, entityType, entityId, operation, payload]`. Existing upsert receipts
remain replayable across migration. Operation already distinguishes upsert/delete;
changing operation, entity or other logical content under a used ID is PT409,
even if the changed request would otherwise fail validation. Local scheduling
fields and baseRevision are neither sent nor fingerprinted.

- First delete: claim receipt, UPDATE active row to tombstone, return `applied`.
- Same delete ID: identical receipt returns `replayed` before any domain write;
  revision, updated_at and deleted_at remain identical.
- New delete ID on an existing tombstone: claim the new receipt and return
  `applied`, with **no entity write or metadata change**. This acknowledges a valid
  new intent without inventing another logical deletion event. Its replay is
  `replayed` in the usual way.

The receipt claim and domain action remain inside one exception block and one
transaction. Validation, row/receipt constraints, trigger errors, overflow and
outer rollback leave no partial deletion, metadata or success receipt. Stable
PT422 state failures are rethrown; other APP-032 error mapping remains intact.

UPDATE locks the row and rechecks its active predicate after a concurrent update
under READ COMMITTED. Concurrent deletes create one deletion version; normal
upsert uses the existing primary-key conflict lock and then the tombstone guard.
If deletion commits first, an upsert waiting on it fails. If the upsert commits
first, deletion stamps the resulting next version. If deletion rolls back, there
is no committed tombstone to protect and the waiting active update may proceed.
Higher isolation may produce the existing safe PT503 serialization result.
No preflight read outside a write lock is used to authorize resurrection.

### Reconciliation

Extend the immutable confirmed entity to
`{ entityId, enabled, revision, updatedAt, deletedAt }`. Require an explicit NULL
or valid timestamp from the server; missing deleted_at fails closed rather than
assuming an older server has deletion support. Preserve serialized timestamps,
including microseconds, and bigint revisions as exact decimal strings.

The explicit account-bound fetch selects deleted_at for **all** rows, including
tombstones. It retains pinned authorization, account filter, no GET retries,
post-fetch account check, dispose protection, and reconciliation against the
latest completed state. A failed fetch leaves existing state intact.

- Newer tombstone replaces older confirmed active state, including its metadata.
- Older active state cannot displace a newer tombstone, regardless of fetch order.
- Equal revision requires identical enabled, updatedAt and deletedAt, including
  active/tombstone state; contradictory equal versions fail the whole merge.
- Older tombstones cannot regress a newer confirmed version. Reconciliation still
  orders confirmed versions only; the server prevents creating a newer active
  version from a tombstone. No timestamp tie-breaker or restore is inferred.
- Missing remote rows preserve local confirmed entries, active or tombstoned.
  Absence never synthesizes deletedAt or physically discards deletion history.
- Stable-ID normalization produces one entity per ID, in deterministic order;
  contradictory duplicates are checked even around an intervening newer version.

Known pending IDs refuse reconciliation/fetch instead of selecting a local/remote
winner. This is the existing integration guard, not an atomic outbox observation
or conflict policy. APP-035 still owns production-store integration and true
active-vs-active conflicts. There is no new persistence or data-profile change.

### Retention and account lifecycle

Retain tombstones until an explicit future reviewed purge policy or account
deletion. There is no chosen age limit and no purge/cron job. Age alone proves
nothing about offline clients; dropping deletion history could reopen resurrection.
A future purge needs a justified stale-client/history protocol and product/security
basis. Mutation receipts keep their existing retention until account deletion.

The unchanged APP-022 account RPC still physically deletes auth.users and cascades
active choices, tombstones and receipts. That is account lifecycle cleanup, not
synced entity deletion. Existing local outbox cleanup/account isolation is unchanged;
requests bearing a deleted account fail the existing live-auth.users check.

## Consequences

One local migration, no remote deployment or relinking, no new dependency or UI.
The confirmed fetch requires the APP-034 schema before use. Hosted PostgREST/JWT,
schema drift and device UI propagation are not proven by scratch tests. Deploying
the migration remains a separate review; the legacy UI is intentionally deferred.

`node --test tests/db/app032.test.cjs tests/db/app033.test.cjs tests/db/app034.test.cjs`
uses the established per-story temporary PostgreSQL clusters, Unix sockets and
TCP disabled. Set APP032_PG_BIN / APP033_PG_BIN / APP034_PG_BIN if needed. The
APP-032/033 suites now apply APP-034 before assertions. APP-033's security assertion
compares non-delete policies/grants and RPC privileges rather than requiring the
old dispatcher body/physical DELETE permission to survive. APP-034 verifies
pre-upgrade receipts, immutable metadata, failure/rollback, direct SQL/grants,
two-account boundaries, and the unchanged account RPC using minimal dependencies.
Six two-session tests wait for a real database lock before releasing the first
transaction (both race orders, direct legacy upsert, same/new delete ID, rollback).
These fixtures are bounded regression tests, not an APP-038 migration framework.

Jest covers durable delete transport, no automatic outbox acknowledgment, exact
metadata, stale/contradictory/missing snapshots, late responses, account boundaries
and pending refusal. Existing architecture, data-profile, ADR and weak-ID gates
remain required, alongside TypeScript and the normal local Expo iOS export.

Explicitly unimplemented: APP-035 conflict policies (no active-vs-active CAS,
LWW, timestamp winners or merge); APP-036 sync UX; APP-037 connectivity, retry,
backoff, batching or workers; APP-038 migration harness. No restore, undelete,
Realtime, push notifications, other-domain tombstones or purge automation.

## Alternatives considered

- Physical DELETE or filtering tombstones out of confirmed state: loses the
  retained identity/version needed to stop stale resurrection.
- baseRevision-driven compare-and-swap: unnecessary when all normal tombstone
  updates are refused, and risks crossing into APP-035 active conflict policy.
- Guard only the RPC: legacy direct upserts would still resurrect rows.
- Advance revision on each new delete ID: creates artificial deletion versions
  for an already completed state transition.
- Reject every repeated delete intent: safe but less useful than acknowledging
  its receipt without changing the entity.
- Revoke all direct writes or add delete UI now: broadens scope into production
  store integration and changes the established enabled=false behavior.
- Timed purge: lacks a safe offline-client horizon and product/security basis.
