# ADR-0064: Sync coordinator is backend-neutral and Pregnancy success requires reconciliation

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-14 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-076 Phase B2A |
| **Superseded by** | – |

## Context

APP-037's coordinator was coupled to the plaintext Profile-A outbox. Pregnancy's Profile-B encrypted queue needs the same bounded foreground lifecycle, but an RPC success cannot be acknowledged until B2B has reconciled canonical server state and commits that state/tombstone with the ACK.

## Decision

The lifecycle, connectivity gates, serialized sending, claims, retry timer and bounded continuation are backend-neutral. `createSyncCoordinator()` remains the unchanged ordinary-outbox wrapper. A single engine can later host multiple sequential backends under one account lifecycle and timer; it does not create an independent Pregnancy worker or polling loop.

Each backend owns queue planning, durable failure recording, transport and success resolution. Ordinary success continues to acknowledge immediately. Pregnancy has its own encrypted queue planner and transport: terminal consent-bound upserts remain immutable evidence but do not block a later DELETE. A later non-terminal mutation of the same entity, including an upsert bound to a newer consent, proceeds in persisted FIFO order behind the skipped terminal item; it is neither ordered by nor rebound to it, and a terminal item is never edited, retried or revived by time, restart or adapter recreation. A permanent non-terminal refusal still blocks its own chain. Whether the product must surface a skipped intent is a B3 consent-UX decision. Pregnancy success is deliberately not acknowledged in B2A. B2B must supply pull, canonical reconciliation and one protected reconciliation-plus-ACK commit before production registration.

The Pregnancy queue emits metadata-only changed, cleanup and epoch-invalidated events after successful protected commits or invalidation. No Pregnancy backend is registered in the production lifecycle in B2A. No database change is required.

## Consequences

Ordinary sync retains its public API and behavior, including that a permanent refusal is announced only while the account that earned it is still live; the engine hands each backend that liveness check for exactly this reason. Future encrypted backends reuse proven lifecycle semantics without sharing plaintext persistence. Rebaseline/cleanup can invalidate old encrypted handles before an in-flight network result records metadata.

Obligations this places on B2B, which the engine does not paper over: the engine has no "deferred success" outcome, so a backend's `resolveSuccess` must complete its durable resolution (for Pregnancy, canonical reconciliation plus the ACK in one protected commit) or the mutation, still due, is resent on every continuation pass; failure bookkeeping that throws is treated as unrecorded and arms no continuation; and an epoch invalidation restarts the whole engine pass, so an in-flight claimed ordinary send is skipped until the next trigger rather than retried at once.

## Alternatives considered

- A separate Pregnancy coordinator: rejected because it duplicates lifecycle, timer and claim behavior.
- Generic success-means-ACK behavior: rejected because it would lose the canonical-reconciliation commit boundary.
- Register Pregnancy immediately and retain successful mutations as failed: rejected because it would create an unsafe, misleading interim production path.
