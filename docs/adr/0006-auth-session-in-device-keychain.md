# ADR-0006: The auth session lives in the device keychain, chunked

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | Pre-existing; recorded by APP-007 |
| **Superseded by** | – |

## Context

Supabase's client stores its session — access token and refresh token — through
whatever storage adapter it is given. The default in React Native is
AsyncStorage, which is unencrypted inside the app sandbox: readable on a rooted
or jailbroken device, and extractable from an unencrypted device backup.

A stolen refresh token is full account access, and it is long-lived.

This decision is already implemented in `utils/auth/secureSessionStorage.ts`. It
is recorded here because it is quietly easy to undo — the default adapter is one
line shorter than the right one.

## Decision

Supply a `SecureStore`-backed storage adapter to `createClient`, with:

- `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. Tokens must refresh while the screen is
  locked, so `WHEN_UNLOCKED` is too strict; `THIS_DEVICE_ONLY` keeps them out of
  the iCloud keychain and off any new device the user migrates to.
- **Chunking at 1024 characters.** iOS rejects keychain values over roughly 2 KB
  and a Supabase session exceeds that. Chunks are counted in characters, not
  bytes, so non-ASCII in a display name still fits. A stale chunk from a longer
  previous value is deleted before writing, or it would leave valid tokens
  behind.
- **A one-time migration** from AsyncStorage, so an existing user is not logged
  out by the upgrade, and the unencrypted copy is removed once the move succeeds.
- **Web falls back to AsyncStorage**, because SecureStore does not exist there.
  The web target is not part of the mobile store release.

## Consequences

- Reading a session is several keychain calls instead of one. Not measurable at
  app start.
- A missing chunk is reported as "no session" rather than parsed half-way, so
  Supabase fetches a fresh one instead of failing oddly.
- Changing this file requires an ADR (see `docs/adr/README.md`).

## Alternatives considered

- **AsyncStorage, the default.** Rejected: see Context.
- **Encrypt the session ourselves and keep it in AsyncStorage.** Rejected: the
  key would have to live somewhere, which is the same problem again, and
  specification §25 forbids custom crypto.
