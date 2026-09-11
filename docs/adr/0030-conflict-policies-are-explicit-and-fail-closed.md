# ADR-0030: Conflict policies are explicit per domain/family and fail closed

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-11 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-035 |
| **Superseded by** | - |

## Context

Master Production Specification v1.0 section 5.2 and APP-035 require distinct
settings/logs/tasks/document policies, an ADR and tests, with no global LWW.
ADR-0026 through ADR-0029 establish durable intent, idempotent server effects,
canonical revisions and immutable module-choice tombstones. Those primitives do
not provide three-way conflict semantics or universal runtime adoption.

Canonical `DataDomainId` lives in `core/storage/dataProfileRegistry.ts`. Domains
are broader than entity kinds: `economy.savings` contains editable goals, an
extra-savings scalar, and append-oriented contribution history. `habits.habits`
contains editable definitions and logs that `toggleLogForDate` physically removes.
Habit toggle collections are unsuitable for append-only union. `home.household`
has coupled rotation/assignee/lastDone behavior; the independently editable
`TodoItem` is a smaller, clearer structured-task proof.

## Decision

`core/sync/conflictPolicies.ts` provides a pure, synchronous resolver. There is
no I/O, persistence, clock read, worker, network call or store dependency.
The registry associates canonical domain IDs **and reviewed entity kinds** with
four families. Neither the entire savings domain nor every Profile A/B domain
inherits a policy. Exact lookup returns null for unreviewed domains/kinds,
including prototype property names; resolution fails closed. Mapped types
constrain each entity to its domain and policy. Exhaustive field contracts
require review when existing entity models gain fields.

| Family | Representative domain / entity kind | Reviewed content |
| --- | --- | --- |
| `setting-rebase` | `core.preferences` / `preferences` | Language and theme mode from the two preference stores; Profile A. |
| `append-only` | `economy.savings` / `savings-contribution` | Existing `SavingsContribution` history only; Profile A, no health fixtures. |
| `task-fields` | `tasks.todos` / `todo` | Existing `TodoItem` scalar editable fields; Profile A. |
| `document-manual` | `warranties.attachments` / `attachment` | Attachment ID, name, kind and opaque content identity; Profile B. |

These entity-kind labels describe APP-035 contracts. Only `module-choice`
currently has a server mutation handler; no new server handler is implied.

### Inputs, revisions and outputs

Each call addresses one entity in an account context established by its caller.
It carries a confirmed base, separate pending local upsert/delete intent, and
the newest confirmed remote snapshot. Confirmed snapshots contain entity ID,
value, revision, updatedAt and explicit deletedAt, never optimistic state.
The function validates declared scalar values and refuses extra/complex fields.
It cannot authenticate callers or prove snapshots came from a server.

Confirmed revisions use canonical positive PostgreSQL bigint decimal strings,
matching APP-033's exact transport. Pending baseRevision accepts that string or
a safe positive integer, compatible with APP-031's optional numeric metadata
without changing persistence. Unsafe numbers are refused, never rounded; zero
is not a confirmed base revision.

For existing entities, pending baseRevision must match the supplied base exactly.
Missing evidence is unresolved; a mismatch is an invariant failure. Remote
revision equal to base means no advancement; larger means concurrent advancement.
Older remote yields unresolved/stale-remote and cannot replace the newer base.
Missing remote yields unresolved, never deletion. New entities use null
base/remote and no baseRevision. Concurrent creations without a base are
unresolved, except identical append duplicates or identical known document
versions. The resolver never reconstructs an arbitrary base.

Results are `accept-remote`, `rebase-local`, `merged`, `unresolved` and
`invariant-error`. Rebases/merges contain proposed values and the remote revision
to which they apply (null for a new entity). They manufacture no updatedAt,
revision increment, receipt or confirmed write. Pending deletes remain unresolved
even without advancement: no domain's delete execution rule is introduced here.
Errors contain fixed reason codes, never payloads, names, paths or identifiers.

### Settings

Start with remote values and reapply only locally changed fields. A changed
language coexists with a changed theme. On divergent edits of the same reversible
preference, still-pending explicit local intent may be reapplied. This permission
exists only for reviewed language/theme preferences. Optional local changedFields
represents explicit writes back to a base value; otherwise compare local with
base. No pending change yields remote. Auth, onboarding, operator flags,
financial values and workflow state do not inherit this permission.

### Append-only history

`SavingsContribution` is inserted with a fresh ID and signed amount. Withdrawals
are new negative entries, not edits to old entries. Different IDs coexist.
Same ID plus identical content is idempotent; same ID plus different
goalId/amount/date is an invariant conflict. No timestamp selects a record.
`resolveSavingsHistory` unions IDs, calls the registered policy for each, and
returns one resolution per ID in stable ID order, retaining tombstones. Exact
repeated snapshots/intents deduplicate; ambiguous duplicates within an input
side fail closed. Ordering arranges output and never chooses a winner.

This does not merge goals, recalculate balances, repair transfers or atomically
couple contributions to goal updates. Current `removeGoal` also removes history;
future adoption must supply explicit deletion/parent lifecycle evidence. Missing
entries cannot substitute for that evidence. The store is unchanged and is not
described as universally append-only.

### Structured tasks

Editable fields are title, description, importance, dueDate and completed.
ID and createdAt are immutable identity metadata. Per editable field:

- Only local changed: retain local.
- Only remote changed: retain remote.
- Both produce the same value: accept it.
- Both changed incompatibly: unresolved/field-conflict, without partial merge.

Optional fields can be cleared to undefined. completed=true has no special rank;
reopening follows the same rule. Snapshots cannot reveal a remote
false-to-true-to-false workflow. Optional remoteChangedFields supplies known
intervening writes, and local changedFields supplies explicit pending writes.
With that evidence, completion versus a conflicting reopen is unresolved. A
revision increase alone does not prove which field changed. Evidence claiming
remote writes at the unchanged base revision is rejected.

TodoItem has no recurrence objects, arrays or sets today. Added runtime fields
are rejected rather than reflected/deep-merged; type additions require explicit
field-contract review. Household rotation remains unreviewed. No recurrence or
completion-history storage is invented.

### Documents

Only ID/name/kind and an opaque immutable contentIdentity enter the engine.
It never reads bytes, decrypts files or accepts raw-content/cache/path fields.
Existing Attachment has no trustworthy immutable content version. A future
adapter must supply one, never substituting a mutable storage path, signed URL,
upload completion time or local URI. Unknown content identity cannot prove binary
equality and is unresolved during pending reconciliation.

Identical known versions are idempotent. Differing content or meaningful metadata
requires explicit reconciliation, including non-overlapping and one-sided edits
against an existing remote. This conservative v1 does not auto-overwrite an
existing document. New local proposals may be represented without inspecting
content; this is not permission to upload them. No plaintext caching, sensitive
logging or document transfer is introduced.

### Deletion and canonical-version invariants

Checks precede domain policy execution:

1. Equal revisions require identical canonical content, exact serialized updatedAt
   and deletedAt. Contradictions are invariant errors, even for preferences or a
   purported deletion; they never enter ordinary conflict resolution.
2. A newer confirmed remote tombstone defeats stale active intent in every family.
   The output retains the tombstone and its confirmed metadata. A confirmed
   tombstone is authoritative for deletion, but does not permit an append-only
   entity's immutable content to change: base/remote content equality is checked
   before tombstone acceptance, and divergence yields append-content-conflict.
3. A pending delete against a newer active remote is unresolved. It is not a
   confirmed tombstone and has no global priority over an intervening edit.
4. A confirmed base tombstone followed by a purported active remote is refused.
   No policy clears deletedAt or restores. Older remotes are refused before
   they can regress confirmed state.

Timestamps validate/preserve canonical metadata; relative timestamp ordering never
chooses values. Equal-revision timestamp comparison detects contradictions.

### Runtime integration and scope

No production path invokes these policies. `createModuleChoiceSnapshots` receives
only pending IDs and refuses a fetch with pending work; it lacks the edit's
confirmed base and pending intent. The legacy enablement store mixes confirmed
and optimistic booleans. Replacing that refusal requires orchestration and
durability/lifecycle work. The settings proof uses core.preferences instead of
forcing module-choice integration.

APP-031 outbox format, APP-032 adapter/RPC and APP-033/034 reconciliation are
unchanged. The adapter still rejects baseRevision; no server CAS or revision write
predicate was added. Future orchestration must capture bases and intent, supply
trusted content/workflow evidence, preserve account boundaries, durably handle
proposals and revalidate before sending. A proposal does not guarantee a later
server write is concurrency-safe.

No DB code changes or migration are required. APP-036 sync UX, APP-037 connectivity,
workers/retries and APP-038 migration harness are explicitly unimplemented.

## Consequences

The four families have deterministic synthetic tests, registry anti-fallback
tests and cross-family deletion/version cases. Existing sync tests remain
regression requirements. No new dependency, persistence surface, feature store
migration, sensitive fixture or remote interaction is needed.

Runtime CRUD still bypasses policy resolution. Most domains remain unclassified.
Document metadata may deserve a more permissive policy after separate review.
Unknown fields, coupled workflows and absent history require fail-closed handling.

## Alternatives considered

- Global LWW: discards independent edits, append records and document content.
- Global server-wins: silently discards pending user intent.
- Global local-wins: overwrites concurrent edits and risks resurrection.
- Global delete-wins: confuses pending deletion with confirmed tombstones.
- Timestamp tie-breaker: clock ordering is not domain conflict semantics.
- Habit-toggle append union: would restore deliberately removed logs.
- Whole-domain savings append policy: misclassifies editable goals and balances.
- Reflective deep merge: cannot infer array, recurrence or workflow semantics.
- Immediate store integration: pending IDs cannot support three-way reasoning,
  and existing direct-write paths lack a safe execution contract.
