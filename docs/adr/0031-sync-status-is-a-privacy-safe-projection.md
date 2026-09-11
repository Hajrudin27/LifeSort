# ADR-0031: Sync status is a privacy-safe projection of durable sync state

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-11 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-036 |
| **Superseded by** | - |

## Context

APP-031 supplies an account-bound durable outbox with pending/failed status,
attempt count and individual acknowledgement. APP-032/034 supports one explicit
module-choice upsert/delete RPC, with idempotent receipts and tombstones.
APP-033 snapshots and APP-035 policies are separate proof seams, not production
orchestration. The production enablement store still writes user_modules directly;
it never enqueues an outbox mutation. No other production domain adopts the outbox.

The old useSyncStatusStore held raw error messages, arbitrary module/operation
names and timestamps in memory, logged them in development, and persisted only
lastSuccessAt under sync-status. Settings rendered a generic failure count or a
success timestamp. It was not account-bound, although APP-021 reset it and swept
the disk key at logout. It contained no duplicated mutation payloads.

## Decision

### Truth, persistence and privacy

The existing store becomes ephemeral presentation of APP-031 state. Core owns a
pure selector, a shared supported-envelope predicate and a one-shot controller.
The selector outputs only account ID, state, count, safe code, retry mutation ID
and in-flight flag. The controller retains only safe error enums keyed by durable
mutation ID plus an ephemeral in-flight ID. It rereads the actual outbox rather
than caching payloads or keeping another queue. Applied/replayed responses use
individual APP-031 acknowledgement. Durable writes emit metadata-only local
invalidation events; observers refresh their projection, never dispatch mutations.

There are no new persisted fields, versions or migrations. The old timestamp
key is no longer read or written. It remains registered as device-only Profile A
legacy metadata and the existing logout sweep deletes it. Ignoring optional old
UI metadata requires no schema conversion or APP-038 harness. Old asynchronous
callbacks cannot rehydrate or republish it.

Raw errors, SQL/PostgREST details, response bodies, paths, tokens, stacks and
payloads never enter the projection, localized messages, accessibility labels or
logs. Fixed safe codes are unavailable, auth-required, conflict, validation and
unknown. APP-035 unresolved/invariant results map to conflict without resolving
them. No runtime conflict ledger or resolver invocation is invented.

### State and action

Priority is needs-attention > failed > retrying > pending > clear, independent of
timestamps and array order. Counts cover all current-account unacknowledged work.
Clear renders nothing. Pending appears immediately as a compact neutral surface;
no age threshold, clock, polling or timers are needed. A supported pending entry
may be sent by explicitly tapping Retry: there is no worker to attempt it first.
Failed means a supported envelope with a known transient/unavailable result.
Retrying is an in-flight manual attempt; other failed or attention conditions
retain priority. Needs-attention includes unsupported/invalid envelopes, conflicts,
authorization failures, storage failures and restored failures with unknown cause.
Authorization has separate generic sign-in wording. Needs-attention offers no
blind Retry, including when retryable work coexists. Success disappears quietly.

Retry chooses a failed eligible entry first, otherwise a pending eligible entry,
in stable mutation-ID order. IDs only select the action, never state priority.
Each tap rereads the specific mutation and verifies the current account/generation
and sender contract before incrementing its attempt count and calling the sender
once. An in-memory guard acquired before any await prevents overlapping actions,
including rapid taps. The RPC explicitly disables SDK retries. No nextRetryAt
is set or interpreted. Both applied and replayed responses acknowledge the entry;
a failure retains it with durable failed status and ephemeral safe classification.
A storage failure fails closed without presenting the error text.

Only core.module-choice / module-choice envelopes targeting known toggleable
modules are supported: upsert with exactly enabled:boolean, or delete with
absent/null payload; no baseRevision. The adapter rejects unsupported envelopes
before transport. Known auth and conflict codes receive specific safe classes;
transient transport/5xx results are unavailable. Other backend errors fail closed
as validation. Raw message text never determines retryability.

After restart, a durable failed entry cannot recover its transient/permanent
classification because APP-031 has no such field. It becomes needs-attention and
has no Retry until a future reviewed durable classification/adoption contract
exists. This conservative limitation avoids silently retrying a known permanent
failure after a restart and avoids crossing APP-038.

### Account and shell lifecycle

A single root lifecycle hook injects an auth-store subscription into the controller.
It reads local outbox state on binding and durable changes only. Account switches,
logout/reset and disposal clear presentation and invalidate asynchronous work by
generation, including A -> signed out -> A. APP-031 cleanup emits synchronous
revocation before draining disk I/O. The sender checks a supplied generation guard
after its session read, immediately before RPC dispatch, and pins the request to
that account's bearer token. Already dispatched remote requests may finish for the
old account, but their completion cannot publish new-session status or acknowledge
after controller invalidation. The existing durable cleanup semantics remain intact.

The banner additionally checks its projection account against the live session at
render, so even a render before effect cleanup cannot flash another account's data.
Legacy sync-status is never rehydrated. Registered local cleanup also resets the
controller; it does not itself delete unrelated durable data.

SyncStatusBanner is one normal-flow sibling immediately below the root Stack,
above Toast/ModuleGate/lock/privacy overlays. It occupies layout space instead of
covering screen content, with bottom/left/right safe-area padding. It is hidden
while signed out, locked or recovering a password. Native modal presentations
can cover root-level siblings until dismissed; no duplicated modal banners or
navigation restructuring are introduced. The floating tab bar remains in its
navigator above this surface. Device verification of native modal and extreme
Dynamic Type geometry remains necessary; renderer tests are not pixel validation.

Text and surfaces use existing theme tokens and Button. English and Danish copy
lives in the existing common i18n namespace without sensitive interpolation.
Messages have a text role and polite live-region semantics; Retry is labeled and
communicates disabled state. Text has no line limit, maximum font scale or fixed
height; vertically stacked action layout allows long Danish/accessibility text.

### Runtime adoption and story boundaries

The shell observer is production code, but no current production write creates
APP-031 entries. Real durable enqueue, observation, explicit send and acknowledgement
are proven with synthetic local tests, including a rendered Retry press. This is
not a claim of universal sync or production module-choice adoption.

Unscoped legacy reportSyncFailure/reportSyncSuccess callbacks are compatibility
no-ops. trackSync retains its boolean control-flow contract. Their former Settings
indicator is removed. Consequently, failures in existing direct-write domains no
longer appear in that legacy indicator; they are not silently mislabeled as durable
outbox work. Broad account-bound domain adoption and replacement of those legacy
seams remain separate work, not a CRUD migration in APP-036.

APP-037 is untouched: no NetInfo, offline state, connectivity observer, automatic
retry, exponential backoff, jitter, foreground/background sync trigger, batching,
polling or automatic outbox draining. Auth changes cause local reads, not sends.
APP-038 is untouched: no migration harness, upgrade fixtures or version framework.
No DB schema, RPC definition, migration, remote data or project link changes.

## Consequences

Tests cover deterministic projection/priority, account isolation, durable one-shot
retry, rapid taps, applied/replayed success, permanent failures, storage failure,
logout, stale completion, legacy metadata exclusion and synthetic sensitive-looking
copy including accessibility props. Prior outbox, adapter, revision, tombstone,
conflict policy and architecture regressions remain required.

There is no persistent green success indicator and no false inference that all
legacy domain changes are synced when the outbox is empty. Empty means only that
this projection has no relevant durable work. Unsupported domains and restored
unclassified failures intentionally cannot be retried through this surface.

## Alternatives considered

- A second persisted status/error queue duplicates truth and increases privacy risk.
- Persisting new safe failure codes changes the local contract and is deferred.
- Treating every restored failure as retryable loses fail-closed conflict semantics.
- Retaining unscoped legacy error reports risks publishing old-account completions.
- Migrating every legacy writer into the outbox would exceed this story's scope.
- Per-screen banners duplicate the shell concern; overlays obscure content.
- Connectivity listeners or an automatic retry worker belong to APP-037.
