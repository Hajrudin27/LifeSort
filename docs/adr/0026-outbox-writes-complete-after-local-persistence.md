# ADR-0026: Outbox writes complete after local persistence

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-10 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-031 |
| **Superseded by** | – |

## Context

APP-031 requires a persisted mutation queue with identity, status, attempts and
next-retry metadata that survives restart. Existing domain stores usually set
local Zustand state and call Supabase helpers without awaiting them. Todo and
household toggles use `utils/shared/syncQueue.ts`, a memory-only batching helper
that clears entries before sending and discards failures. `useSyncStatusStore`
records failures, not replayable mutations. None is a durable outbox.

The current storage layer is AsyncStorage, with Zustand's JSON storage adapter
and separate encrypted adapters for health and document data. There is no
transaction spanning independently persisted entity stores and an outbox.

## Decision

`core/sync/outbox.ts` owns a provider-independent queue. It imports no feature,
domain store or Supabase client. `createOutbox(accountId)` binds a handle to the
authenticated account ID supplied by its caller. It exposes four async methods:

- `enqueue(input)` snapshots a JSON payload and returns the persisted entry.
- `list()` reads every unacknowledged entry, including failures, in enqueue order.
- `updateMetadata(id, patch)` sets status, attempts and/or nextRetryAt; null clears
  the retry timestamp. It returns false for an unknown ID.
- `acknowledge(id)` removes the entry; false means it was already absent.

New mutation IDs come exclusively from APP-030's `newEntityId()`. Entity IDs stay
opaque; repeated mutations of the same entity remain separate. createdAt is an
ISO timestamp. Optional baseRevision is stored without interpreting it.

Every input and persisted mutation carries two separate identifiers:

- `dataDomain: DataDomainId` is the APP-027 logical domain used for sensitivity
  and storage classification. It is the only field used for the profile gate.
- `entityType: string` is a stable, non-empty LifeSort-owned entity-kind identifier
  retained as the durable mutation identity/routing key. It is not authorization
  or a Supabase table name. APP-031 stores it without dispatching or mapping it.

For example, `home.household` can classify both `household.task` and
`household.shopping-item` mutations. The concrete kind is never inferred from
the broad domain, entity ID or payload shape. Enqueue and rehydration validate
both an allowed dataDomain and a non-empty entityType. No dispatch registry,
server mapping, worker or production household integration is introduced.

Status has two values: `pending` means queued work; `failed` records an unsuccessful
processing outcome for future retry handling. Both remain durable until explicitly
acknowledged. Updating status never sends, schedules or discards a mutation.
Attempts is a nonnegative integer set explicitly by a future processor.

The single `lifesort-outbox` AsyncStorage value is
`{ version: 1, state: { accountId, mutations: [...] } }`, using the existing
`createJSONStorage` adapter. There is no separate in-memory Zustand store or
automatic hydration: each operation reads and validates the persisted value.
Writes resolve only after setItem completes. A shared promise lane serializes
read/modify/write operations across handles in one JS runtime. Array insertion
order is authoritative, including timestamp ties. Bad JSON, unsupported versions,
invalid entries and storage failures reject instead of replacing data with an
empty queue. No migration framework is introduced.

Account cleanup uses `withOutboxCleanup` inside the existing APP-021 cleanup
windows. It synchronously revokes existing handles and blocks new ones, drains
in-flight I/O, and removes the persisted value before the ordinary user-key sweep.
The existing `lifesort-` sweep also covers an unopened queue. There is no cached
queue to register in `LOCAL_STORE_RESETS`. Disk-removal failure still runs the
remaining cleanup and rejects. The persisted account ID independently hides old
entries from another account and prevents overwriting them without cleanup.
Existing logout, pre-login cleanup and successful account deletion use this path.
No authentication or account-deletion protocol is redesigned.

The physical queue is classified as `core.outbox`, Profile A. Enqueue and reads
validate each mutation's `dataDomain`, accepting only registered Profile A domains
that expect server sync and have no
Profile B storage surface. This conservatively also blocks ordinary expense,
trip and warranty records from mixed sensitive stores. Unknown domains, B, C, D
and local-only bookkeeping are rejected. Callers must classify payloads correctly;
a domain label is not a content scanner. No sensitive domain is integrated, no
plaintext fallback is added, and APP-028/029 encryption and keys are unchanged.
Future sensitive integration requires a reviewed encrypted persistence path.

## Consequences

Awaited successful writes survive handle/module recreation and application
restart through AsyncStorage. Snapshotting and storage-first reads prevent caller
object mutation or delayed hydration from replacing queued data. Tests retain
only persisted bytes across module restarts and cover removals, metadata, failures,
concurrency and cleanup during in-flight I/O.

The only write unit is one complete outbox value passed to AsyncStorage.setItem.
The JS lane prevents lost updates within this runtime; it is not a cross-process
lock, a database transaction or an additional power-loss/fsync guarantee. Entity
and outbox persistence are NOT atomic together. A crash between domain persistence
and enqueue could still lose an intent once a domain is integrated. This story
does not wire any domain flow or claim to solve that gap.

APP-032 through APP-038 remain unimplemented: no server idempotency, revision
rollout/reconciliation, tombstones, conflict policy, sync UX, connectivity/retry
scheduler or migration harness. There are no remote calls, new dependencies,
database migrations or changes to the existing best-effort mutation flows.

## Alternatives considered

- Reuse the timer queue: fails restart durability and loses failed batches.
- Ordinary Zustand persist actions: expose new in-memory state before asynchronous
  persistence completes; callers need an explicit durable completion contract here.
- A generic plaintext queue accepting arbitrary domain names: could duplicate
  encrypted health or document payloads into unprotected storage.
- A new transactional database or universal encrypted sync engine: exceeds the
  foundation story and would require broad storage/domain migration.
