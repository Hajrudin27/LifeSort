# ADR-0033: Local persisted-data migrations are versioned, deterministic and fail closed

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-12 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-038 |
| **Superseded by** | - |

## Context

Zustand hydrates during module evaluation, before the root layout mounts.
Supabase also starts session initialization eagerly. An await in an existing
root effect cannot protect either boundary. The durable outbox has its own
serialized read/write lane and a v1 envelope; rewriting it would needlessly
risk account binding, mutation identity, durable order and retry metadata.

Git history identifies Home layout at c4715e6 (pinned, hidden, lastOpenedAt) and
5898ce5 (adds detail). Both used Zustand's default version 0, including at the
pre-story baseline d417466. The empty detail map is the existing privacy
policy's default, not a guess about a user's health or module preferences.

## Decision

The existing data-profile registry declares a migration policy and owner for
every device surface. `versioned` surfaces provide a generic definition;
`external` surfaces retain specialized or feature-owned contracts;
`cleanup-only` surfaces are never hydrated; `immutable/no-schema` values are
opaque/scalar and are not rewritten to impose a schema. External Zustand
payload versions are also declared per surface, not a global app version.

The generic contract preserves each store's serialization. It reads original
bytes once, safely parses JSON, detects the source version, applies every
N-to-N+1 step in memory, validates the final candidate, serializes and commits
once. No intermediate writes, backup keys, removal, random identifiers,
current clock, auth lookup or network dependencies are available to transforms.
A known unversioned Home state can be identified as v0 by shape; arbitrary
unversioned JSON is refused. Actual release fixtures retain their real
Zustand `version: 0` field. Outbox has no known v0 and remains v1.

Home v0 becomes v1 with the existing fields preserved and detail defaulted to
an empty map only when absent. Both historical v0 shapes are retained. Outbox
v1 validates using the same implementation as ordinary outbox input/state
validation; it does not migrate, regenerate, coalesce, reorder or rewrite.

A successful current-version read performs zero migration writes. Failed
reads, invalid JSON, unsupported/future versions, missing steps, transform,
validation, serialization and write failures have safe typed codes with no
raw values or nested causes. A failed boot remains closed; restarting creates
a new attempt. Ordinary writes behind failed hydration cannot reset that key.

### Startup and cleanup

Every Zustand adapter is wrapped before `createJSONStorage` parses anything.
The shared migration gate finishes first, then specialized adapter reads and
encrypted migrations run. The root waits for all import-time reads and the
Home store's hydration before mounting its existing auth/fetch/coordinator
effects. The Supabase session storage read also awaits the complete adapter
read barrier, preventing eager refresh from racing secure migrations. Root owns
`finalizeStartupStorage`; auth's `waitForStartupStorage` only waits. Finalization
is shared and drains read registrations until a stable generation before sealing,
including reads added while waiting. Failures remain sticky for all waiters;
lazy post-seal reads remain individually guarded without reopening boot. Each
outbox operation additionally waits for the generic migration gate and then
validates within the existing serialized outbox lane.

APP-021 cleanup invalidates delayed ordinary writes, waits for migrations and
in-flight writes, then performs existing secure/outbox cleanup and the key
sweep. Cleanup remains an explicit user/account lifecycle action, never a
response to migration failure. No large bootstrap relocation is required.

### Specialized sensitive storage

APP-028 cycle health encryption remains in its adapter: legacy plaintext is
validated in memory and committed only as AES-GCM ciphertext. Its retained
raw synthetic fixture runs with the existing crypto tests. APP-029 document
metadata and file migrations keep their encrypted cleanup journal and file
rollback behavior. Both adapters now refuse unsupported inner Zustand schema
versions before upgrading plaintext or handing decrypted data to hydration.
The audited history contains explicit inner version 0 only (see the store snapshot
list in `docs/local-migrations.md`); both validators require `version === 0`.
Versionless/future plaintext is refused before encryption, key creation or file
migration, and unsupported decrypted data before rewrites or cleanup. Tests use
the actual generic-wrapped adapters to verify agreement and byte preservation.
No generic code decrypts health/documents or writes plaintext staging files.
Their cryptographic randomness is transport/encryption behavior, not a generic
schema transformation. Existing auth chunking and PIN-on-verification upgrades
remain external; they are not claimed to meet the single-key generic contract.

### Compatibility and rollback

Rollback safety means a failed forward migration must preserve the last
committed readable state. It is **not binary downgrade compatibility**. The
harness never attempts down-migrations. A future version is preserved and
refused. Pre-APP-038 binaries lack these guards: particularly, old Home code
may reject/reset newer v1 data. No compatibility promise is made for them.

Before commit, original bytes are untouched. On a rejected write the harness
never clears or attempts a second compensating write. Native storage must
provide replacement semantics; an OS crash/ambiguous native write cannot be
made transactionally durable by this JS harness. There is no multi-key
transaction or general backup/DR framework. Independent stores may commit
independently; a later failed store does not undo earlier successful upgrades.

### Tests and retention

Raw JSON fixtures name their registered store/key, source git commit, source
and target version, serialization and synthetic/sensitivity status in a
machine-checked manifest. Source commits must remain available to verification
(checkouts need the referenced history). Fixtures are test-only and retained
until an explicit supported-upgrade policy authorizes removal. Protocol tests
for multiple sequential steps are not fictional release fixtures.

The suite tests transforms, invalid/future inputs, serialization, final-write
failure and restart retry, current no-op, independent keys, outbox byte
compatibility, secure migration, actual coordinator startup ordering, eager
auth storage ordering and zero network calls during a controlled migration.
Existing inventory gates cover newly introduced stores; migration governance
requires explicit ownership and fixture coverage for every generic definition.

## Alternatives considered

- A global app storage version would couple unrelated stores and was rejected.
- Zustand's built-in migrate callback alone would not cover outbox, raw byte
  validation or specialized adapters, and may write after partial hydration.
- Moving the entire application to manual hydration would unnecessarily change
  its lifecycle. Intercepting existing adapters is sufficient for this story.
- Rewriting every feature schema would exceed APP-038. Existing domain callbacks
  remain external; the common guard validates their envelope/version, not every
  nested feature record. Future owners must add domain validators/fixtures when
  taking a feature into the generic contract.

## Consequences and non-goals

No SQL, remote database changes, deployment, Supabase relinking, OTA governance,
APP-039 financial read model, APP-040 money conversion, arbitrary downgrade,
network-dependent migration or plaintext migration backup is introduced.
Malformed compatible-version feature records still depend on their owner's
validation; this milestone does not claim comprehensive feature-schema repair.
A failed startup currently offers restart/newer-version guidance, not an export,
repair or reset flow. Sensitive unavailable keys correctly keep startup closed. The message uses system
appearance with static light/dark tokens, SafeArea and scalable/wrapping DA/EN
alert text; it does not depend on persisted theme state.
