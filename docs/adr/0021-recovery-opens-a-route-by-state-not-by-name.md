# ADR-0021: Password recovery opens a route by state, never by name

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-09 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-019 / APP-020 (onboarding guard follow-up) |
| **Superseded by** | – |

## Context

The onboarding guard (`shouldRedirectToOnboarding`) sends any authenticated user
with `onboarded_at === null` to `/onboarding-profile` from every route that is
not part of the onboarding flow. `/new-password` is not part of that flow, so it
was redirected away.

That closes the only door out of a real corner. A user who signed up, never
finished onboarding, and later forgot their password taps the link from the
reset email. The app exchanges the link's tokens for a session, pushes
`/new-password`, and the guard immediately replaces it with the onboarding
profile step. The reset link is consumed, the password is never changed, and the
next time the session expires the account is unreachable.

The obvious fix — adding `/new-password` to `ONBOARDING_ROUTES` — trades one
defect for a worse one. Every route on that list is open *because of its name*.
A permanently open `/new-password` is a route anyone can navigate to in order to
sit outside onboarding, and it puts a password-change form in front of a session
that arrived by ordinary sign-in.

## Decision

**Access to `/new-password` is granted by recovery state, not by route name.**

`useAuthStore` gains `isRecoveringPassword`. It becomes true in exactly one
place: inside `beginPasswordRecovery`, *after* `supabase.auth.setSession`
returns without an error. Reaching that point requires a link that
`parseRecoveryLink` accepted (`type=recovery` plus both tokens) and tokens the
server itself validated. It is cleared when the new password is set, when the
user signs in normally, and whenever the session goes away.

The guard's exception is a conjunction:

```ts
if (isRecoveringPassword && isPasswordRecoveryRoute(pathname)) return false;
```

Neither half is sufficient. The route name alone grants nothing; the state alone
does not open any other route.

The flag is deliberately **not persisted**. It lives in a plain Zustand store, so
it dies with the process and a restart cannot resurrect access to the screen.

## Consequences

- A user with incomplete onboarding can complete a password reset, and lands
  back in onboarding afterwards — `onboarded_at` is still the only thing that
  says onboarding is done.
- The recovery deep link now uses `replace` rather than `push`, and
  `/new-password` leaves via `dismissTo('/')`, so no step of either flow stays
  in the navigation stack. Consistent with the onboarding navigation fix in
  `cf5a7ee`.
- If the app is killed mid-recovery, the flag is gone on restart and the user is
  sent to onboarding. They still hold a valid session and can change the
  password from settings, or request a new link. Losing the flag fails closed,
  which is the direction we want.
- The guard's state object grew a field, so every call site must say what the
  recovery state is. That is the point: it cannot be forgotten silently.

## Alternatives considered

- **Add `/new-password` to `ONBOARDING_ROUTES`.** Rejected: a permanent
  route-name exception is a bypass anyone can navigate to, and it decouples the
  screen from the authorisation that should justify it.
- **Let the guard skip while any redirect is in flight.** Rejected: a
  time-shaped window is a bypass window, and it would need a timer to close.
- **Derive recovery from the session** (an AAL claim, or a token attribute).
  Rejected: Supabase does not distinguish a recovery session from an ordinary
  one on the client once `setSession` has run, so this would be inference
  dressed as fact — the same mistake ADR-0016 records about inferring modules.
- **Force onboarding first, then the password.** Rejected: it asks a user who
  cannot get into their account to answer product questions first, and the reset
  link expires while they do.
