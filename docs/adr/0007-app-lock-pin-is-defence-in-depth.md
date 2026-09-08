# ADR-0007: The app-lock PIN is defence in depth, not an authorisation boundary

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | Pre-existing; recorded by APP-007 |
| **Superseded by** | – |

## Context

LifeSort offers a local app lock with biometrics and a four-digit PIN fallback.
A four-digit PIN has ten thousand possibilities. No key-derivation function
makes that unguessable to an attacker who already holds the stored record, so it
is important to be honest about what the lock is for.

Implemented in `utils/auth/pinAuth.ts` and `utils/auth/pinLockout.ts`.

## Decision

Treat the app lock as a local defence against someone picking up an unlocked
phone — not as an authorisation boundary. Server-side authorisation and RLS
remain the only thing standing between a user and someone else's data.

The stored record is nonetheless built properly:

- **PBKDF2-SHA256, 100 000 iterations, 16-byte CSPRNG salt**, so each offline
  guess costs something without making unlock feel slow.
- **A versioned record** (`v`, `salt`, `hash`, `iterations`), so the parameters
  can be raised later without locking existing users out.
- **Timing-safe comparison**, so the check does not leak how many bytes matched.
- **`WHEN_UNLOCKED_THIS_DEVICE_ONLY`** in SecureStore: stricter than the session
  (ADR-0006), because nothing needs to read the PIN in the background.
- **Attempt lockout** with escalating delay, which is where the real protection
  against guessing lives.

## Consequences

- The lock must never be used to gate anything the server should be checking.
  Specification §13.1 says the same: app lock is extra defence, not the
  foundation.
- Raising the iteration count later is a data-compatible change thanks to the
  version field.
- Recovery from a forgotten PIN is signing out, because the PIN is not
  recoverable by design. **This was stated here before it existed** — the lock screen offered no way out until APP-026 added one. A decision recorded but not built is worth no more than one never taken.

## Alternatives considered

- **A raw unsalted SHA-256 hash**, which version 1 of the record used. Superseded
  by the salted PBKDF2 record; the version field exists so that upgrade could
  happen without logging anyone out.
- **Requiring a longer passphrase.** Rejected: it would push users away from
  enabling the lock at all, and the lock's value is that it is on.
