# ADR-0013: Sign-up asks only for credentials

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-017 |
| **Superseded by** | – |

## Context

Sign-up asked for email, password, name, age and gender, and all five were
mandatory. Onboarding then asked for name, age and gender **again** — the same
three fields, one screen later.

Age had no reader anywhere in the app. Gender's only uses were colour tints and
gating the cycle tab, and specification §7.1 says gender must never be the sole
gate for reproductive-health features.

A field asked at sign-up is asked at the least trusted moment: before the user
knows what the app does, and while they are deciding whether to bother.

## Decision

Creating an account requires an email and a password. Nothing else.

Name and gender stay in onboarding, and both become **optional** — the app
greets you without a name, and gender only affects tints.

Age is not asked anywhere. It had no purpose, and a field with no purpose is
data with no justification.

## Consequences

- The duplication disappears: what onboarding asks is asked once.
- `hasOnboarded` needed a real home. It had been inferred from
  `!!name && age !== null` — age had accidentally become the proof that
  onboarding was finished. It is now an explicit `profiles.onboarded_at`, and
  the migration backfills it for everyone who already qualified under the old
  rule, so no existing user is sent through onboarding again.
- `signUp` no longer passes `options.data`, so nothing lands in the auth user's
  metadata, where it is hard to see and equally hard to delete.
- **Existing `profiles.age` values are left in place.** The app stops reading
  and writing them, but dropping a column deletes user data, and that is a
  decision to take deliberately rather than as a side effect of a refactor.
- Gender remains a gate for the cycle tab until APP-071. Removing the gate here
  would have shown the cycle tab to every user by default, which is a bigger
  change than this story owns.

## Alternatives considered

- **Keep the fields but make them optional at sign-up.** Rejected: an optional
  field on a sign-up form is still a question at the worst moment, and it kept
  the duplication with onboarding.
- **Drop `profiles.age` in the same migration.** Rejected: irreversible deletion
  of user data does not belong inside a story about which fields a form shows.
- **Infer `hasOnboarded` from the name alone.** Rejected: the name is now
  optional, so it would break for exactly the users who skip it.
