# ADR-0015: Passwords are measured by length only

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-019 |
| **Superseded by** | – |

## Context

The app enforced a six-character minimum on **both** sign-in and sign-up. On
sign-in that is a client rule applied to a credential the server already
accepted: a user with an older, shorter password would be locked out of their
own account by a rule we changed afterwards, and the message tells a stranger
what the rule is.

There was no password reset at all, so a forgotten password meant a lost
account.

The fields also lacked the hints a password manager needs, which is what turns
"use a strong generated password" from advice into something that actually
happens.

## Decision

**One requirement: length, eight characters.** No composition rules.

Composition rules do not make passwords stronger — they make them predictable.
`Sommer2026!` satisfies every classic rule and is among the first an attacker
tries, while a long generated passphrase fails a "must contain a digit" check.
The rules punish exactly the behaviour they should reward.

**The rule applies to new passwords only** — sign-up and reset, never sign-in.

**The fields tell the platform what they are.** `username` on the email field;
`current-password` when signing in and `new-password` when signing up, which is
the difference between a manager offering to *fill* and offering to *generate*.
`passwordRules` states our actual minimum, so iOS does not invent requirements
and generate a password the app then rejects.

**Reset exists**, and the link is treated as hostile input. `parseRecoveryLink`
requires `type=recovery` explicitly: without that check, any link carrying
tokens could open a session, which would be an open door rather than a reset.
It returns null on anything malformed and never throws.

## Consequences

- Raising six to eight affects new passwords only. No existing user is locked
  out, and no one is asked to change anything.
- Reset requests answer identically whether or not the address exists, per
  ADR-0014. The outcome of `resetPasswordForEmail` is deliberately discarded so
  it cannot leak into a message.
- The recovery link carries tokens in the URL fragment. It is parsed in the app
  because the Supabase client runs with `detectSessionInUrl: false`, which is a
  web-only convenience.
- The reset **email round-trip cannot be unit-tested**. What is tested is the
  part most likely to be wrong: parsing a link that anyone can craft. The
  end-to-end journey belongs to the Maestro suite in APP-142.

## Alternatives considered

- **Keep six characters** to match Supabase's default. Rejected: two extra
  characters are free for a generated password and meaningful against a guessed
  one.
- **Require a digit and a symbol.** Rejected, as above — it is the rule that
  produces `Sommer2026!`.
- **Check new passwords against a breach list.** Not rejected, just not now: it
  needs a server-side k-anonymity lookup, which is a network dependency in the
  sign-up path and deserves its own story.
