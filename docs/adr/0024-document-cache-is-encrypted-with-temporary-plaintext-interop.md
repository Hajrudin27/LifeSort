# ADR-0024: Document cache is encrypted with temporary plaintext interop

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-10 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-029 |
| **Superseded by** | - |

## Context

APP-029 requires the sensitive document cache to avoid plaintext files in
temporary/cache storage, respect OS backup rules and have cleanup tests. The
current app has three Profile B attachment domains:

- `economy.attachments` - receipt files and metadata in `lifesort-expenses`,
  Supabase `attachments` rows and the private `attachments` Storage bucket.
- `warranties.attachments` - warranty, receipt and insurance files and
  metadata in `lifesort-warranties`, Supabase rows and the same bucket.
- `travel.attachments` - trip documents and trip-expense attachments in
  `lifesort-trips`, local-only today.

Before APP-029, local attachment bytes were copied as readable files under
`FileSystem.documentDirectory/attachments/`. Attachment metadata such as file
names, local URIs and remote storage paths lived inside ordinary plaintext
Zustand AsyncStorage payloads. Expense and warranty files sync through
Supabase; travel files do not. APP-029 owns local cache confidentiality, not
the APP-030 ID migration, APP-031 outbox, APP-038 generic migration harness or
APP-058 trip attachment sync.

Expo SDK 57 provides `expo-crypto` AES-GCM over byte inputs, `expo-secure-store`
for small device-backed secrets and `expo-file-system` byte reads/writes. The
AES-GCM API is still whole-input rather than streaming, so the implementation
must bound local attachment encryption instead of pretending arbitrary files are
safe to load in memory.

## Decision

Persistent local attachment bytes are encrypted before they enter
`documentDirectory/attachments/`. The file format is versioned binary data:
an ASCII LifeSort magic header, version byte, IV length, tag length and the
AES-GCM combined bytes from `expo-crypto`. Persistent cache filenames are
opaque `*.lsenc` names and do not keep the original extension.

The document cache uses its own AES-256-GCM key,
`secure-store:lifesort-document-cache-key`, stored with
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`. It is intentionally separate from
`lifesort-cycle-health-key`. The same document key protects both attachment
files and the mixed attachment metadata stores, with different AES-GCM
additional authenticated data for file bytes and per-store metadata payloads.

The mixed `lifesort-expenses`, `lifesort-trips` and `lifesort-warranties`
Zustand payloads remain single physical stores and are encrypted as whole JSON
payloads before they reach AsyncStorage. This encrypts ordinary Profile A data
inside those stores too, but it avoids duplicating attachment state or splitting
feature stores before the sync architecture exists.

Legacy plaintext metadata is migrated at hydration for the three known stores
only. The migration recognizes attachment lists from the real store shapes,
encrypts only referenced legacy files under the owned attachment directory,
rewrites the corresponding attachment URIs to encrypted cache URIs, then writes
the encrypted metadata payload. Migration is staged, not atomic: the app first
creates encrypted replacements, then durably writes encrypted metadata with an
encrypted list of plaintext files that still require required cleanup, and only
then removes those plaintext source files.

A legacy migration is considered fully successful only after the encrypted
replacement file exists, encrypted metadata has been persisted and every
referenced legacy plaintext source file has been deleted. If the required
plaintext delete fails, the app throws a typed protected-data error, keeps the
encrypted replacement and encrypted metadata, and does not revert metadata to
plaintext. The encrypted cleanup list remains in the metadata envelope so the
leftover plaintext file is discoverable and retried on the next protected-store
hydration. If encrypted file creation or the initial encrypted metadata write
fails before required plaintext cleanup starts, the encrypted replacement is
rolled back and the legacy plaintext source remains referenced for retry.

Removing the encrypted pending-cleanup list after successful plaintext deletion
is housekeeping. It is retried opportunistically and must not roll back an
already-required plaintext deletion or delete the encrypted replacement. Cleanup
lifecycle invalidation during logout/account switching remains fatal so cleanup
cannot leave cache bytes behind with a deleted key.

Native image rendering, upload and share flows still require a readable file
URI. For those operations, the app decrypts an encrypted attachment into
`FileSystem.cacheDirectory/lifesort-decrypted-attachments/` with an
unpredictable filename and the original safe extension. These files are
temporary interoperability copies, not canonical cache. Temporary plaintext
uses a creator-owns-cleanup rule: thumbnail hooks delete the temp files they
create on dependency replacement or unmount, the fullscreen image viewer
resolves and deletes its own independently-owned temp file, share/upload flows
delete their own temp file in `finally`, and logout/account-switch cleanup is a
final sweep. Temporary-file deletion is best-effort and nonfatal; legacy
plaintext source deletion during migration is a separate, required security
delete.

Document thumbnails do not resolve attachment bytes. They render an icon from
metadata only, so PDFs and other documents are decrypted only when the user
initiates a share/open flow that actually needs an OS-readable file URI.

When a parent record is deleted locally, the app captures attachment URIs before
removing the record from Zustand and then performs best-effort cleanup of those
encrypted local cache files. This applies to expenses, recurring expense bulk
deletion, warranties, trips, trip documents and trip-expense attachments. These
retention cleanups are intentionally nonfatal and remain separate from the
security-significant required deletion used for legacy plaintext migration.

The document cache cleanup model mirrors the APP-028 lessons without sharing
key material. First-use key creation is single-flight. Cleanup increments an
epoch, blocks protected reads/key creation, drops reset-triggered Zustand writes
as no-ops, invalidates in-flight writes and waits for active guarded writes to
settle. Logout deletes persistent encrypted files, temporary decrypted files and
the document-cache SecureStore key while the cleanup window is held.

Remote Supabase behavior is unchanged. Expense and warranty objects remain
server-readable private bucket objects controlled by existing RLS and Storage
policies; travel attachments remain local-only. Client-side remote object
encryption, durable outbox, idempotency and revisions are later stories.

Because Expo SDK 57's AES-GCM API is whole-buffer, the local encrypted cache
uses the existing product attachment limit of 25 MB. Larger files fail closed
instead of being read into an unbounded JS string or silently copied as
plaintext.

## Consequences

- Local cached receipt, warranty and trip attachment bytes are no longer
  ordinary readable files in persistent document storage.
- Attachment filenames, local URIs and storage paths inside the three mixed
  stores are no longer visible as plaintext AsyncStorage.
- Whole-store encryption means ordinary expense, warranty and trip fields are
  encrypted too. That is acceptable because each physical surface contains
  Profile B attachment metadata.
- Temporary plaintext files still exist when native OS interoperability needs
  them. They are cache-directory files with creator-scoped cleanup, and losing
  them does not lose the canonical encrypted cache.
- Rendering a document attachment list does not decrypt document contents just
  to show a document icon.
- Legacy migration deletion failures fail closed: encrypted metadata is kept,
  plaintext cleanup remains discoverable through an encrypted retry record, and
  the store is not hydrated as if plaintext migration had succeeded.
- Parent-record deletion also clears now-unreferenced encrypted attachment cache
  files on a best-effort basis, without making ordinary deletion fail because a
  cache file could not be removed.
- A permanently missing or invalid document-cache key makes encrypted local
  cache unreadable. The app fails closed rather than replacing protected data
  with default plaintext state.
- The local backup/export archive remains a separate Profile B concern.
  APP-029 does not add attachment bytes to backups and does not implement the
  broader encrypted-backup redesign.

## Alternatives considered

**Reuse `lifesort-cycle-health-key`.** Rejected. Health storage and document
cache have different data classes, cleanup surfaces and failure modes. Separate
keys preserve cryptographic separation.

**Split sensitive attachment metadata into a new encrypted store.** Rejected
for APP-029. It would keep ordinary Profile A trip/expense/warranty fields
plaintext, but it would duplicate state across feature stores and create a
mini-sync architecture before APP-031 through APP-038.

**Encrypt remote Supabase Storage objects client-side.** Rejected. APP-029 is
the sensitive document cache story. Remote object encryption changes server
semantics, sharing, deletion, previews and future sync behavior, and needs its
own story.

**Use Base64-only file envelopes.** Rejected. Encoding is not encryption, and
Base64 would expand memory pressure for documents. The implementation uses byte
reads/writes and stores only a small binary header plus AES-GCM combined bytes.

**Add a native streaming crypto dependency.** Rejected for now. The existing
Expo SDK 57 APIs can satisfy the launch cache requirement under the current
25 MB attachment limit without introducing native dependency risk.

**Encrypt every file found in `documentDirectory`.** Rejected. The migration is
APP-029-specific and uses known attachment metadata under the owned attachment
directory so unrelated files are not touched.
