# ADR-0014: Auth errors never reveal whether an account exists

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-018 |
| **Superseded by** | – |

## Context

The sign-in and sign-up screens showed the provider's own error text
(`setError(signInError)`). That text includes messages such as "User already
registered", which answers a question nobody should be able to ask: *does this
person have a LifeSort account?*

For an app holding financial and reproductive-health data, that answer is worth
protecting on its own. Someone who can enumerate addresses learns who uses the
app before ever attempting a password.

The same text was also untranslated English in a Danish-first app.

## Decision

Provider text never reaches the screen. Errors are mapped to a small set of
translated keys, and everything unrecognised falls to one generic message.

Two rules carry the security weight:

1. **Sign-up gives one answer.** "Address already registered" and "we have sent
   you a link" become the same outcome: *check your inbox*. The person who owns
   the address gets an email from the server either way and can continue.
   Someone who does not own it learns nothing. There is deliberately no error
   key for "already registered" — a key that does not exist cannot be shown by
   accident.
2. **Sign-in gives one answer for a wrong password and an unknown user.**
   Supabase already returns a single message here; the mapping is what stops us
   helpfully splitting it into two later.

Email confirmation gates inviting other people. An invitation leaves the app and
lands in a stranger's inbox, apparently from an address the sender has not
proven they own.

Resending the confirmation is throttled to once a minute, and the receipt is the
same regardless of what the server said — a different acknowledgement for an
unknown address would reintroduce enumeration through the back door.

## Consequences

- Debugging auth is harder: the generic message hides the cause. Acceptable —
  the provider's message is still available in the server logs, where the person
  reading it is authorised to.
- A user who mistypes their address at sign-up sees "check your inbox" and no
  email arrives. That is the cost of the property, and it is the standard one.
- The throttle timestamp is recorded even when the send fails, so a failing
  server cannot be used to send unlimited attempts.
- If email confirmation is turned off in the Supabase project, every user is
  verified on creation, the banner never appears and the invite gate never
  fires. The client behaves correctly either way rather than assuming.

## Alternatives considered

- **Show "this email is already registered" because it is friendlier.**
  Rejected: it is precisely the enumeration oracle, and the friendliness is
  available from the email the server sends instead.
- **Gate more features on verification** — uploads, sync. Rejected for now:
  inviting a third party is the case where an unverified address causes harm to
  *someone else*. Blocking a user's own local-first data would punish them for
  the server's configuration.
