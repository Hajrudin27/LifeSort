# ADR-0063: Pregnancy state and sync intent share one encrypted commit boundary

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-14 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-076 Phase B1 |
| **Superseded by** | – |

## Context

Pregnancy is an isolated Profile-B health domain. A local-first Pregnancy command must not leave accepted canonical health state without durable sync intent, or a durable intent whose state was never accepted. The ordinary `lifesort-outbox` is intentionally plaintext and Profile-A-only; ADR-0026 records that it is not atomic with separate domain persistence.

## Decision

Pregnancy persists one AES-256-GCM ciphertext at `lifesort-pregnancy`, using the separate SecureStore key `lifesort-pregnancy-health-key` and fixed AAD `lifesort-pregnancy:v1`. The authenticated plaintext is `PregnancyProtectedStateV1`, containing account binding, dataset epoch, canonical Pregnancy state, encrypted durable mutation intent, cursor, technical consent state, and payload-free local tombstones.

One full ciphertext replacement is the application-level commit boundary for state plus intent. This is the strongest single-key boundary available in the current architecture; it is not a claim of formal AsyncStorage fsync or power-loss transactional guarantees. A malformed, plaintext, corrupt, unsupported, or key-less existing dataset fails closed and blocks ordinary writes until an explicit future protected-storage recovery/rebaseline action.

This refines ADR-0062's future-mutation sequence ("write encrypted local state, enqueue encrypted durable intent"): in B1 those two steps are one ciphertext replacement. Handles bind the account through a mandatory live-account callback checked at every step (an unguarded handle created by a stale session after logout could otherwise recreate ciphertext and key), plus the runtime generation, and may be pinned to a protected dataset epoch (`datasetEpoch` option; B2 should always pin it). The epoch is stored inside the ciphertext and moves only through `rebaseline()`, which also invalidates every existing handle. Cleanup revokes handles before removing ciphertext and key. Consent withdrawal terminally marks matching encrypted upserts ineligible without changing their consent identifier; deletes remain eligible. Cursor and tombstones commit with state, so B2 can reconcile a page and advance its cursor in one protected transaction.

## Consequences

Pregnancy gets no second queue blob, transaction journal, WAL, generic encrypted outbox, or independent retry engine. The ordinary plaintext outbox remains Profile-A-only, Cycle remains unchanged, and B2 will inject the Pregnancy queue/transport into shared coordinator semantics separately. The protected queue retains common identity, attempts, status and retry-time fields, while its payload never reaches plaintext persistence.

## Known limits and obligations for B2/B3

These are deliberate B1 boundaries, not implemented behaviour:

- **No recovery path yet.** A key-less, corrupt, unsupported or plaintext dataset blocks every repository operation, including `rebaseline()`, which needs a readable dataset. Explicit protected-storage recovery is B2/B3 work; there is no automatic reset.
- **Backup/restore.** The SecureStore key is `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, but the AsyncStorage ciphertext can still be carried by a device backup or migration. Restored ciphertext without its key is the key-less case above: `key-missing`, no replacement key, no overwrite. The plaintext portable backup excludes Pregnancy; protected portability is APP-097.
- **Partial logout failure.** If ciphertext removal fails while key deletion succeeds, the ciphertext stays unreadable and any later hydration (for any account) fails closed with `key-missing`; a new key is never generated over it. If key deletion fails, the original error is still reported after every sibling key deletion was attempted.
- **Retry eligibility is per item.** `pregnancyMutationIsAutomaticallyEligible` is only a predicate. B2 needs its own Pregnancy eligibility adapter: the ordinary `planSyncWork` entity-chain ordering would let a terminal withdrawn upsert at a chain head block a later DELETE of the same entity, which must stay sendable.
- **No public generic transaction.** The generic protected-state commit primitive is private implementation detail. User-originated writes go only through `commitLocalMutation`, whose callback receives only a cloned canonical-domain draft and cannot reach queue, cursor, consent, tombstones, account, or epoch metadata. B2 must introduce a separate, narrow reviewed remote-reconciliation operation for canonical remote state, tombstones, and cursor; B1 does not expose or implement it.
- **Consent.** `withdrawConsent` takes one consent id and terminalizes only upserts bound to it; the server withdraws every active consent of a purpose, so B2 must withdraw every id it holds for that purpose. A pending upsert under a withdrawn consent is an invalid dataset, and a withdrawn id cannot bind a new mutation.
- **Validation is structural.** Value ranges (weight, measurement, recovery days, title length) stay authoritative on the server and in B3's domain validators; rejecting a whole encrypted dataset over a range would let a policy change brick user data.

## Alternatives considered

- Separate encrypted state and queue blobs: rejected because either write order permits a crash-inconsistent outcome; a correct journal/recovery protocol adds surfaces and complexity without a product benefit.
- Reuse or widen `lifesort-outbox`: rejected because it would weaken the Profile-B boundary and still would not be atomic with Pregnancy state.
- Add Pregnancy data to Cycle storage: rejected by ADR-0062 because it shares key, ciphertext and recovery blast radius.
