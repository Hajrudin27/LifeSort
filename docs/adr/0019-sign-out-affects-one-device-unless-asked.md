# ADR-0019: Signing out affects one device unless the user asks otherwise

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-025 |
| **Superseded by** | – |

## Context

`supabase.auth.signOut()` defaults to the **global** scope. The app called it
with no argument, so tapping "log out" on a phone silently ended the user's
session on every other device they owned — something nobody asked for and
nothing told them about.

Meanwhile the thing a user actually needs after losing a device — closing the
sessions they cannot reach — did not exist.

## Decision

Three explicit actions, none of them a default:

| Action | Scope | This device |
| --- | --- | --- |
| Log out | `local` | signed out |
| Sign out of all other devices | `others` | **stays signed in** |
| Sign out everywhere | `global` | signed out |

Local clean-up follows the scope: `local` and `global` clear this phone,
`others` deliberately does not — running the clean-up there would log the user
out of the very device they chose to keep.

**Sessions cannot be listed, and the app says so.** The Supabase client exposes
no API for it; only the admin API can, and that needs the service key, which
must never be in an app. Rather than show an empty list — which would read as
either a bug or as "no other devices are signed in", something we do not know —
the screen states the limitation and offers the action a list would have been
used for anyway.

## Consequences

- Logging out on one device no longer disturbs the others. That is the
  behaviour users expect, and it was previously wrong.
- After losing a phone, the recovery is "sign out of all other devices" from any
  device still in hand, and it keeps the current session alive.
- What the app *can* show is the current session's sign-in time, so the screen
  is not empty.
- A real device list needs an Edge Function calling the admin API on the user's
  behalf — a separate piece of work with its own authorisation surface, not
  something to fake in the client.

## Alternatives considered

- **Leave the global default and call it "log out all devices".** Rejected: it
  makes the common action destructive to sessions the user never thought about,
  and it leaves no way to sign out of just this one.
- **Show an empty or fabricated device list.** Rejected: an empty list would
  assert something we cannot know.
- **Require re-authentication before revoking.** Rejected: revoking sessions
  removes access rather than granting it, and someone holding the unlocked phone
  gains nothing by doing it. The confirmation dialog is the right weight.
