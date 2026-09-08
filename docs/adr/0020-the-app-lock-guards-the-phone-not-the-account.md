# ADR-0020: The app lock guards the phone, not the account

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-026 |
| **Superseded by** | – |

## Context

ADR-0007 established what the app lock is: a local defence against someone
picking up an unlocked phone, never an authorisation boundary. It also stated
that recovery from a forgotten code is signing out.

That last part was not true. The lock screen offered biometrics and a code, and
nothing else. A user who forgot the code and had no working biometrics was shut
out of the app entirely — the only escape being a reinstall, which destroys
local-only files such as trip documents.

The lock was also invisible unless someone went looking for it in Settings,
including for the people who most need it.

## Decision

**There is always a way out.** The lock screen offers signing out, and says
plainly what it costs: the code cannot be recovered because it exists only on
this phone; synced data returns on the next sign-in; files that never reached
the server are lost.

**The lock is suggested where it matters, once.** When a module holding health
data is enabled and the lock is off, Settings offers to turn it on. Only health
triggers it — nearly every module holds *some* sensitive class, so a broader
rule would make the suggestion background noise. It can be dismissed and does
not return in that session.

**The boundary is stated where the user meets it.** Both the lock screen and the
suggestion say the lock protects this phone only, and that the account is
protected by the password.

**And the boundary is enforced by test.** A test enumerates every file that may
read `useAppLockStore` — currently six, all of which are the lock itself, its
settings, or logout. If the app lock appears in something that writes to the
server, it has stopped being a local convenience and become an authorisation,
and the suite fails.

## Consequences

- Signing out from the lock screen destroys local-only files. That is stated in
  the confirmation rather than discovered afterwards, and it is one more reason
  finding D15 (trip attachments never uploaded) deserves fixing.
- The suggestion is dismissible per session rather than permanently. A nagging
  reminder is one people learn to dismiss without reading; a forgotten one never
  helps at all. If this proves annoying, persist the dismissal.
- Enabling the lock without biometrics requires setting a code first, so the
  toggle cannot leave someone with a lock they have no key to.

## Alternatives considered

- **A recovery code or security question.** Rejected: it is another secret to
  lose, and it would create a second path to local data that is weaker than the
  first.
- **Let the account password unlock the app.** Rejected: it needs the network,
  so the lock would stop working offline — and the lock exists for a threat that
  does not involve the network at all.
- **Turn the lock on automatically when a health module is enabled.** Rejected:
  a lock the user did not choose is a door they have no key to, and it would be
  the app deciding how careful someone needs to be with their own phone.
