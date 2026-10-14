# ADR-0065: Pregnancy sync reconciles canonical state before acknowledgement

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-14 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-076 Phase B2B1 |
| **Superseded by** | – |

## Context

ADR-0064 made the sync coordinator backend-neutral and recorded that a Pregnancy RPC success may not be acknowledged until canonical server state or a tombstone is represented in the protected store. Pregnancy v1.1 (Appendix C) requires pull sync that carries tombstones, remote deletes that remove local sensitive payload, and a client that "marks a matching mutation synced only after acknowledgement". Phase A's server already provides the correctness key: a strictly ascending per-account `change_seq` ledger with metadata-only rows, plus owner-only reads of the canonical rows. B2B1 consumes it; B2B2 owns protected-storage recovery.

## Decision

**Pull before send, one bounded page.** A coordinator cycle runs a backend's optional inbound step first, at most one page of at most 100 ledger rows, and only a backend that is caught up may send in that cycle. A full page asks for a bounded continuation (the engine's existing one-second delay), never a loop, interval or poll. Inbound work runs only inside an active cycle, never from `list`, `plan` or rescheduling. Because the ordinary backend has no inbound step and a blocked or halted backend merely contributes no sends, ordinary due work is never starved by a Pregnancy backlog.

**Canonical reconciliation, revision-ordered.** A ledger page names entities; the client reads exactly those owner rows (explicit columns, batched per type) and treats each as a valid live row or a valid tombstone, parsed strictly and never coerced. A tombstone is recognised before any live validation, because another device may delete an entity between the ledger read and the row read; such a row is legitimate race-forward evidence. Anything neither shape explains fails the page closed and never moves the cursor. Ordering is by revision, never by `updatedAt`: a higher remote revision wins; an equal revision with equal content is a no-op; an equal revision with different content (compared apart from envelope timestamps, and only for an entity with no queued mutation, because a queued edit legitimately differs from the server at its base) persists a protected invariant halt instead of choosing a side; a lower remote revision never overwrites newer local state.

**Tombstones and root deletes.** A remote tombstone removes the local payload and keeps only a payload-free tombstone; deleted data never returns, even from a stale live row. A root tombstone scrubs the root and every child immediately; a queued child upsert beneath it ends as `remote-parent-deleted`; later child tombstones are idempotent. A stale local upsert ends as terminal `remote-deleted`, its payload scrubbed. A local delete is retired only by a tombstone at its own resulting revision (`>= baseRevision + 1`).

**Atomic acknowledgement with repository-verified proof.** Server success is not local success. The repository exposes one narrow `commitRemoteReconciliation` taking typed instructions (validated snapshots, cursor and success proofs). It applies them with its own pure reducer inside one encrypted commit: canonical state or tombstones, the cursor and any acknowledgement land together. A proof names a mutation id, entity, server revision and `deleted`; the mutation is removed only if the resulting state proves it (an existing canonical entity at `>= revision`, or no payload plus a tombstone at `>= revision`). A caller can never pass a blind list of ids to acknowledge, and the blind `acknowledge` was removed from the public repository. An applied `changeSeq` is never assigned to the cursor: the intervening ledger is pulled in order. A replay is acknowledged only when local state already proves it, otherwise it waits for the pull. If a crash lost an applied success before its proof became durable, a pull may also retire a simple upsert only when the remote row is exactly `baseRevision + 1`, exactly equals the queued wire payload, and does not carry a Pregnancy lifecycle transition. This is a satisfaction proof, not an authorship claim: another device making that same simple edit is safely equivalent. Later revisions, creates, payload differences and end/outcome/recovery transitions remain explicit conflict/replay cases.

**Explicit deferred success in the shared engine.** `resolveSuccess` no longer returns a boolean: it reports `resolved`, `deferred`, `unresolved` or `not-success`. A deferred success keeps its mutation durable, is not failed, resent or looped on, and is held in process-local, payload-free metadata (backend, mutation, entity, revision, deleted, optional changeSeq) that is handed to the inbound step so the final page can acknowledge atomically. After a restart the deferral disappears and the durable mutation replays idempotently. The ordinary backend still resolves immediately and is behaviorally unchanged.

**Backend-scoped invalidation.** A Pregnancy epoch change (`backend-invalidated`) invalidates only the Pregnancy sessions and deferrals and earns that backend one fresh pass; an ordinary in-flight send completes normally. Logout, cleanup and account switch still invalidate every backend. There is still one coordinator, one timer and no Pregnancy worker.

**Conflicts and halts.** `revision_conflict` and `parent_unavailable` are not finalised from the RPC error: the mutation is blocked (never retried) and flagged as awaiting reconciliation, and the next inbound pass settles it. A stale upsert loses to the remote row with terminal `revision-conflict`; a stale delete becomes the same terminal conflict and is never silently rebased. A `parent_unavailable` that the parent's tombstone explains ends as `remote-parent-deleted`; one that remote state does not explain after a caught-up pass, or a `revision_conflict` the ledger cannot explain, persists a payload-free backend-wide halt. `mutation_id_conflict` and an unknown conflict persist the halt in the same commit as the failure. A halted Pregnancy backend lists no work and pulls nothing, survives restart, uses no replacement mutation id and never rebinds consent; ordinary sync continues. A child that merely outran its own still-unconfirmed root waits with backoff instead of halting. PT428 `consent_required` keeps ADR-0064's terminal, immutable behavior.

**Protected state moves to v2.** The durable halt, awaiting marker and new terminal reasons need a new encrypted shape, so the decrypted state version moves 1 to 2 (the AES envelope stays v1). A v1 dataset is upgraded in place, deterministically and still encrypted, by one ciphertext replacement; a failed write leaves the readable v1 untouched, and unknown versions or v1 data violating the current rules fail closed. B2B2 must use v3 if it changes the consent structure. Tombstone keys are derived (`type:id`) and a tombstoned entity must be absent from canonical state.

**Not in B2B1.** The Pregnancy backend is registered in no production lifecycle and no startup path can reach the Pregnancy network. Protected recovery and replacement (B2B2), consent reconstruction and UX (B3), and any hosted Supabase or database change are untouched; no migration is required.

## Consequences

Pregnancy sync can now be proven end to end against the Phase A contract with no hidden success path. Recorded limits the next stories must own:

- A crash after server success but before acknowledgement is recovered without a false conflict for the narrowly proven simple-upsert case above. Other upserts retain the receipt replay path; a later or non-identical remote revision, a create, or a lifecycle transition remains a deliberate explicit conflict rather than an unsafe authorship inference.
- A terminal reconciliation status keeps its mutation (and, for conflicts, its encrypted payload) as evidence; there is no queue pruning yet.
- Local canonical state is the last server-confirmed state plus unconfirmed optimistic edits; B3 must derive a new edit's `baseRevision` from the queue tail, not from the canonical revision.
- Settings reconcile only as a live row; value ranges stay server-authoritative; revisions and sequences are `Number.isSafeInteger` and fail closed above 2^53.
- The cause of a halt is a closed technical vocabulary, never a server string, entity or value.

## Alternatives considered

- Acknowledge when the RPC returns `applied`/`replayed`: rejected, it is the merge-only, fire-and-forget failure v1.1 exists to remove.
- A separate acknowledge commit after reconciliation: rejected, a crash between the two writes leaves either an unacknowledged proven mutation or an acknowledged unproven one.
- Accept a list of ids to acknowledge: rejected, authorisation must come from verified state, not from the caller.
- Move the cursor to the applied `changeSeq`: rejected, it would skip other devices' intervening changes.
- A Pregnancy-specific worker or polling pull: rejected, one coordinator, one timer and a bounded continuation keep the lifecycle provable.
- Bump the whole engine generation on a Pregnancy epoch change: rejected, it silently discarded in-flight ordinary results.
- Compare `updatedAt` to order versions: rejected, clocks lie; revisions are the server's order.
