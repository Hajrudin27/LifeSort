# ADR-0062: Pregnancy is an isolated encrypted health domain

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-13 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-076 Phase A |
| **Superseded by** | – |

## Decision

Pregnancy is a separate, internal, Profile-B health domain. It has separate planned ciphertext, SecureStore key, AES-GCM AAD (`lifesort-pregnancy:v1`), envelope v1 and dataset epoch; it never shares Cycle's blob, key, Zustand store or recovery blast radius. Phase A deliberately creates no local adapter or payload.

Future local-first mutations must validate, write encrypted local state, enqueue encrypted durable intent, then use the existing queue/coordinator semantics. Plaintext AsyncStorage, backup, generic outbox and fallback persistence are forbidden. The implemented server command is authenticated, receipt-idempotent and revision-aware for root, logs, appointments and settings, and tombstone-aware for root, logs and appointments; a tombstone wins over a stale upsert. Settings are one revisioned row per account with no delete command (account deletion removes them). A transaction-held per-account sync-state lock allocates monotonic `change_seq` records, and pull pagination uses only that ordered sequence—never timestamps—as its correctness cursor. Receipts and the change ledger are deliberately payload-free. Root deletion scrubs/tombstones children and emits their reconciliation changes in the same transaction. Recovery/rebaseline must fail closed and must never restore predictions automatically.

Versioned consent is distinct from module enablement. A consent must reference a server-controlled supported/current Pregnancy policy; APP-076 seeds no production policy or legal copy, so production mutation remains fail-closed until an approved process configures one. Withdrawal is per purpose: it withdraws every active consent of that purpose, blocks every consent-gated upsert (which includes recovery-state writes) and never blocks reads, pulls or deletes. After withdrawal the owner may still read, pull, delete, delete the account, inspect and re-grant consent and use local-only recovery actions; no recovery-state server write or new health sync happens until a new valid consent exists (v1.1: withdrawal stops further consent-based sync). Pregnancy is internal and registry maturity is a public-discovery ceiling: remote flags may restrict it but cannot promote it. Its start gate controls only new starts. No Home, Search, notification, public content or route is introduced. No clinical content table exists in Phase A: governed week content is deferred to a clinical-content story that must follow APP-074's immutable, source-and-review-gated lifecycle; APP-075's intended-purpose boundary remains in force. Protected portability is APP-097.

## Rejected alternatives

- Pregnancy fields inside Cycle or a generic shared health store — shared state and crypto failure blast radius.
- Direct Supabase DML — bypasses revision, idempotency and tombstone invariants.
- A second sync engine or plaintext outbox — duplicates/reduces reliable-sync guarantees.
- Automatic local reset after crypto failure — can silently destroy protected data.

## Phase A limit

Implemented now: module/domain/schema/server contracts, the safe sync command and change-sequence pull contract, consent-policy technical contract, and planned storage identities/seams. Planned for Phase B+: actual Pregnancy encrypted store, encrypted queue backend, client coordinator, hydration/persist, rebaseline UX/state machine, consent UX and user workflows. Not approved: public Pregnancy availability, production consent legal wording, clinical content, Home/Search/notifications, protected portability or physical QA.

The request hash includes the consent identifier on purpose: a queued mutation remains bound to the consent under which it was created and is never rebound to a newly granted one; after withdrawal and re-grant a genuinely new operation receives a new mutation id, and a changed consent id on an old mutation id is `mutation_id_conflict`. Applied identical retries may replay only their safe ACK. Receipt rows retain no raw payload, but the deterministic unsalted digest can permit low-entropy inference to a sufficiently privileged database reader; this is an accepted internal Phase-A residual, not public-launch approval, and must be revisited during Phase B security/privacy sign-off. Live TypeScript entities also intentionally do not model scrubbed server tombstones; Phase B reconciliation must add explicit tombstone variants. Notes and outcome notes remain unbounded because v1.1 does not specify an exact limit.
