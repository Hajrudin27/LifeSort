# ADR-0027: Server mutations claim receipts in the domain transaction

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-11 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-032 |
| **Superseded by** | – |

## Context

APP-031 persists cryptographic mutation IDs but does not send them. Existing
stores issue direct Supabase writes, usually best effort. Existing trusted server
operations use Postgres RPCs; server-only tables use public schema, RLS with no
policies, and explicit privileges. There is no private schema convention, Edge
Function mutation layer, pgTAP suite or checked-in local Supabase configuration.
`docs/migration-verification.md` documents testing in a scratch PostgreSQL cluster
with minimal Supabase auth fixtures; its historical remote environment description
is not current deployment authorization.

The master specification §5.2 and APP-032 require server uniqueness and harmless
replay. Receipt registration separate from a domain write cannot guarantee this
across concurrent requests or failure between calls.

## Decision

`public.apply_sync_mutation` is one generic envelope RPC with an explicit
allowlist of domain handlers. APP-032 implements exactly one handler:
`core.module-choice` / `module-choice` / `upsert`, with entityId = module ID and
payload `{ "enabled": boolean }`. Unknown fields and unsupported shapes fail
closed. No dynamic SQL, client-selected table, callback or claim-only RPC exists.

The proof writes the existing Profile A `user_modules` table. Compared with todo
completion (related habit/cycle behavior), household tasks (rotation/shared
semantics), and categories (free-text names), module choice has a single boolean
payload and account-scoped composite key. It requires no reconciliation, sensitive
content, or fetch changes. The existing constraint protecting core-shell/account
still applies. Existing `updated_at` behavior is preserved without adding fields
or a reconciliation protocol.

`core/sync/serverMutations.ts` sends an explicitly supplied APP-031 entry and
returns a typed result. The caller supplies the outbox account binding; a mismatched
session is rejected and the request pins the matching session's bearer token to
avoid an account switch changing its authorization. The server remains the
security boundary. This helper does not generate a new ID, enqueue, acknowledge,
scan, or retry. Tests pass a persisted outbox entry through this adapter. Existing
UI/store write paths are unchanged; only explicit calls to this new RPC receive
the guarantee. Deploying the local migration is required before using the adapter.
A supplied baseRevision is rejected by the adapter, since this story implements
no revision precondition.

### Identity and privacy

The primary key on `mutation_receipts` is `(user_id, mutation_id)`: one mutation ID
per account across all handlers, not per entity or operation. Different accounts
can independently use the same ID; neither receives the other's replay status.
Mutation IDs must have UUID v4 syntax, matching APP-030. UUID case is normalized by
the PostgreSQL UUID type. A reused ID with different content returns SQLSTATE
`PT409` / `mutation_id_conflict`, including changes to domain/kind/entity/operation.

Receipts contain only owner ID, mutation UUID, a 32-byte SHA-256 fingerprint, and
processed_at. The hash covers PostgreSQL JSONB's text representation of this array:
`[1, dataDomain, entityType, entityId, operation, payload]`. The leading 1 is the
identity-contract version. JSONB normalizes object order and whitespace; the sole
supported payload contains one boolean, avoiding numeric canonicalization issues.
No arbitrary JSON canonicalizer or custom crypto is introduced: hashing uses the
built-in `sha256(convert_to(..., 'UTF8'))`. Future handlers must preserve existing
identity semantics and review their payload normalization before being admitted.
Local createdAt, attempts, status, nextRetryAt and baseRevision are not transmitted
or fingerprinted. The authenticated owner is the other part of identity.

No response caching is needed: `applied` and `replayed` are sufficient deterministic
outcomes, and replay never re-reads or returns domain data. No request bodies,
health data, notes, documents, tokens or cached responses are persisted in receipts
or logged by the adapter. Fingerprints are replay evidence, not encryption; low
entropy input could be guessed by a privileged database reader. There is no expiry
or purge: deleting receipts would remove the replay guarantee. Account deletion
cascades them with the rest of the account's rows.

### Atomicity and concurrency

The receipt INSERT uses `ON CONFLICT DO NOTHING` against the primary key. A first
claim executes the allowlisted domain write before returning `applied`. A duplicate
waits for the conflicting transaction to commit/abort. At READ COMMITTED, the
subsequent SELECT sees its committed fingerprint, returns `replayed` for equality,
or raises the safe conflict error. It never dispatches the domain write again.
If the first transaction aborts, the waiting insert can claim and apply instead.
Higher isolation can abort with a serialization error, mapped to a safe unavailable
result; no guarantee is made that every competing request succeeds on its first
attempt under stronger isolation.

Both inserts run within the RPC's database transaction and the same PL/pgSQL
exception block. An error in either write rolls back the entire block. An outer
transaction rollback also removes both. PostgreSQL transaction commit makes both
durable together: a lost response after commit is safely replayable, while a
failure before commit leaves neither. No external/nontransactional effect is
supported or claimed. The guarantee assumes retained receipts and writes through
this RPC; existing direct writes and privileged manual changes are outside it.

### Authorization and errors

Ownership derives only from `auth.uid()` and a live auth.users row, never a
user_id argument or payload. All domain and receipt statements use that owner.
The definer RPC follows existing LifeSort public RPC conventions because clients
must not be able to forge a receipt. It has an empty search_path and fully
qualified database objects. The receipt table enables RLS, has no policies, and
revokes all access from PUBLIC, anon, authenticated and service_role. Only
`authenticated` receives EXECUTE on this RPC; PUBLIC, anon and service_role are
explicitly revoked. No domain table permissions are broadened. RLS on user_modules
continues to protect direct writes; the privileged RPC enforces the same ownership
explicitly. No service/secret key is involved in mobile code.

Safe SQLSTATE/message pairs are PT400/invalid_mutation, PT401/not_authenticated,
PT409/mutation_id_conflict, PT422/mutation_rejected, PT503/mutation_unavailable,
and PT500/mutation_failed. Constraint and unexpected errors do not return original
SQL diagnostics. Direct access denied by Postgres privileges uses standard 42501;
the client maps authorization, validation, conflict and unavailable without copying
server details. Cancellation may abort the request; PostgreSQL still rolls back.

## Consequences

The guarantee is database-backed across requests, restarts, concurrency, and
response loss. Duplicate replay does not overwrite a later, independent mutation.
Distinct mutation IDs retain the existing domain write behavior; no ordering or
multi-device conflict policy is added.

`node --test tests/db/app032.test.cjs` starts and stops a uniquely located scratch
Postgres cluster with TCP disabled, applies the existing user_modules migration
and this migration, then tests real SQL, roles/RLS, failures, rollbacks and
concurrency. Set `APP032_PG_BIN` to a full PostgreSQL bin directory. Concurrency
uses two sessions and observes the second blocked on a database lock before
releasing the first. A test-only trigger counts actual entity writes. This is an
APP-032 test fixture, not a general migration harness. It does not read .env or
use the linked Supabase project. It cannot verify hosted PostgREST/JWT integration
or production schema drift. Jest separately verifies durable-ID transport, pinned
authorization, errors and absence of automatic retries.

Explicit non-goals, all unimplemented: APP-033 revision/updated_at reconciliation;
APP-034 tombstones; APP-035 conflict policies; APP-036 sync status UX; APP-037
connectivity, workers, batching and retries; APP-038 local migration harness.
No entity/outbox atomic local transaction is claimed. No existing store is
migrated to this send path, and no remote migration is applied by this story.

## Alternatives considered

- Separate receipt check/write/registration calls: crash and race windows.
- Client-only deduplication or entity upsert alone: no durable logical-mutation
  identity, no collision rejection, and repeated update triggers still execute.
- Generic SQL/function callbacks: unnecessarily expose a privileged execution API.
- A separate private-schema pattern or Edge Function layer: duplicates established
  server boundaries without improving the single-transaction guarantee here.
- Wiring every store or a worker now: pulls in scheduling and reconciliation work
  outside APP-032 and changes existing production behavior before migration review.
