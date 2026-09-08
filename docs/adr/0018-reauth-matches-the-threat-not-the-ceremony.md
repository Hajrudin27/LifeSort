# ADR-0018: Re-authentication matches the threat, not the ceremony

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-024 |
| **Superseded by** | – |

## Context

The threat here is not a remote attacker. It is an unlocked phone on a table, or
one taken from a hand. Whoever holds it is already signed in, and two actions do
disproportionate damage in that state: exporting everything into a single file,
and sharing a document out of the app.

Account deletion was already protected by the account password. Export and share
were not protected at all.

## Decision

**Ask for a proof, and pick the cheapest one the device actually has:**
biometrics if enrolled, otherwise the app-lock code if set, otherwise the account
password. Falling down the ladder rather than insisting on one factor keeps the
friction proportionate to what is being protected.

**The proof matches where the action happens.** Export and share are local, so a
local proof answers the local threat — biometrics or the app-lock code are
enough. Account deletion happens on the server, so it keeps the account
password, because ADR-0007 says the app lock is never an authorisation boundary.

**A proof lasts five minutes, and is forgotten when the app has been in the
background.** Exporting twice in a row should not mean proving yourself twice;
a phone that has been out of sight may have changed hands.

**A user with no factor at all is not locked out.** If there is no biometry, no
app-lock code and no password to hand, blocking the action would keep the owner
from their own data without making anyone safer.

## Consequences

- Viewing your own content in the app is deliberately *not* protected. Requiring
  a proof to look at your own receipt is friction with no gain — the proof
  belongs where data leaves the app.
- The window is in memory, so a fresh launch always asks. That is the correct
  default: a relaunch is exactly when a phone may have changed hands.
- Two screens use the hook today. Adding a third is one line plus rendering the
  prompt, and the tests assert each gated call site actually calls it.
- A clock moved forward cannot extend a proof: a timestamp in the future is
  treated as expired rather than as valid for hours.

## Alternatives considered

- **Always require the account password.** Rejected: it is the wrong factor for
  a local threat, it needs a network round-trip, and the friction would push
  people away from exporting their own data — which is a right, not a favour.
- **Require the app lock to be enabled before allowing export.** Rejected: it
  turns an optional local convenience into a precondition for data portability.
- **No window — ask every time.** Rejected: it trains people to enter a code
  reflexively, which is how a code stops meaning anything.
