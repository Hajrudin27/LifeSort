# APP-072 — Health storage profile (P0)

**Story:** APP-072 · E8 Reproductive health integration · P0
**Acceptance:** "Both domains on sensitive adapter; clear/logout/backup tests."
**Decision record:** [ADR-0023](./adr/0023-cycle-health-persistence-is-encrypted-as-one-store.md) (amended) · [ADR-0017](./adr/0017-logout-clears-by-sweep-not-by-list.md) (amended)
**Builds on:** APP-021 · APP-027 · APP-028 · APP-038 · APP-071 / [ADR-0059](./adr/0059-health-sensitive-modules-require-explicit-activation.md)

APP-028 already did the hard part: Cycle persists as one AES-256-GCM envelope with its key in SecureStore. APP-072 is narrow
security and lifecycle hardening around it. It rebuilds nothing and changes no crypto, envelope, key name or migration.

## What was wrong, and is fixed

| | Finding | Fix |
| --- | --- | --- |
| F1 | `clearLocalUserData` deleted the document-cache key and then the Cycle key in sequence. If the first threw, the Cycle key was never deleted. | Both deletions are independent mandatory cleanups: both are always attempted; the earliest failure is rethrown afterwards. Cleanup windows are untouched. |
| F2 | `useCycleStore.fetchFromSupabase` had no account or dataset retirement. A response for A resolving after logout, or during B's session, set A's rows into memory and, through persist, into the next session's encrypted store. | Habits-style `datasetEpoch` and initiating account, rechecked after every await. `clearLocal()` bumps the epoch and resets the user-owned fields; the logout registry calls it. |
| F3 | Every best-effort Cycle write resolved its owner asynchronously (`getUser`), so an action by A could be re-owned by B. | The account is captured synchronously when the user acts, passed to the helper, and the live session is re-verified before the request. RLS stays the final boundary. |

`clearLocal()` resets cycles, symptom logs, cycle length (28), luteal length (14) and reminder settings (off, 1 day). The
reviewed reference content (`healthConditions`, `symptomGlossary`, Profile D) is not the user's and is kept.

Writes stay best-effort: no outbox, retry, revisions, tombstones or reconciliation. That is APP-076.

## Backup: what "backup tests" means here

The portable backup is an **unencrypted** JSON file. Cycle is encrypted Profile B special-category data, so it stays **out**:

- Export writes no Cycle section and none of its values (tests use unique sentinels through the real `exportBackup`).
- An imported file with a top-level `cycle` payload, or Cycle fields smuggled into other stores, changes nothing: the parser
  reads only its whitelist, so the Cycle store and every persisted store stay clean.
- A structural guard fails if `dataBackup.ts` imports the Cycle store, if the validated schema or the participants gain a
  health key or field, or if the validator names Cycle fields. It is deliberately specific to health; other historical
  Profile B backup considerations belong to APP-097.

An encrypted portable health backup (needing a passphrase or key-sharing design), loss messaging and protected export are
**APP-097**, not this story.

## iOS device backup and portability

- `@react-native-async-storage/async-storage` 2.2.0 excludes its iOS storage directory from iCloud/iTunes backup by default
  unless `RCTAsyncStorageExcludeFromBackup` says otherwise. LifeSort does not set it, so no native config was added.
  `healthStorageProfile.test.ts` fails if an active Expo config sets it to false and pins the installed default.
  **Reverify the default on every native or AsyncStorage dependency upgrade.**
- The Cycle key is `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (also asserted for every SecureStore call), so it does not migrate to
  another device.
- So on a new iPhone, after a restore, or after a reinstall, ciphertext and key do not travel and Cycle starts empty;
  `fetchFromSupabase` returns what had synced. **Cycle data that never reached the server is lost with the device.** Privacy
  was chosen over recoverability.
- Not repo-provable: Apple's exact handling of `ThisDeviceOnly` items in an encrypted same-device backup. Cite Apple's
  documentation when APP-097 designs recovery.

## Failure and recovery (no UI in this story)

A tampered, unsupported-version or key-less payload still fails closed: the store keeps its defaults and writes to that key
stay blocked so ciphertext is never replaced by defaults. There is no screen for it. **Recovery today: sign out and back
in** (the sweep removes the ciphertext and key; synced rows return). A recovery/rebaseline experience belongs to APP-076. A
transient key-read failure (for example a locked device) blocks writes until the next launch.

## Pregnancy

Not implemented, and nothing here creates it (no ModuleId, store, route, table, consent or UI). The rule binding its future
storage is a test, not an abstraction: every module whose sensitivity includes `health` must own a Profile B domain, and
every device surface carrying it must require encryption. It passes for Cycle today and **fails the day APP-076 adds a
health `ModuleId` without such a contract**. The Cycle adapter is not generalised for a domain that does not exist yet.

## Not changed

- `core/storage/cycleHealthEncryptedStorage.ts` (encryption, key, migration, epochs) — untouched.
- The data profile registry — no classification changed; the module-choice boolean and Home layout metadata remain core
  Profile A state, not the Cycle payload.
- Cycle notification wording and scheduling (**APP-073**), clinical content (APP-074), claims (APP-075), Pregnancy and reliable
  sync (APP-076).
- Database: no migration, schema, RLS or grant change.

## Tests

| Layer | File |
| --- | --- |
| Both keys deleted independently; windows released; success unchanged (F1) | `__tests__/logoutCleanup.test.ts` |
| Stale fetch, `clearLocal`, account-bound writes for all ten mutations (F2, F3) | `__tests__/cycleAccountIsolation.test.ts` |
| The real store persists through the real adapter; raw disk holds no sentinel; hydration; fail-closed | `__tests__/cycleStoreEncryptedWiring.test.ts` |
| Export/import exclusion and structural guard | `__tests__/cycleBackupExclusion.test.ts` |
| Health-module → Profile B/encrypted invariant; iOS backup posture; key accessibility; no Pregnancy product | `__tests__/healthStorageProfile.test.ts` |
| Existing encryption, tamper, migration and race coverage (unchanged) | `__tests__/cycleHealthEncryptedStorage.test.ts` |

## Manual iPhone check (not performed; do not mark PASS until run)

Log in, enable and open Cycle, log a day, sign out, sign in again: synced Cycle data comes back and nothing from a previous
account is shown. Android is **DEFERRED — outside v1 release scope** (ADR-0058); the change is shared TypeScript, no native code.
