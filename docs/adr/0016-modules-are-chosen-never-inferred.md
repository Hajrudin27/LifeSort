# ADR-0016: The app asks which modules you want; it never infers them

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-020 |
| **Superseded by** | – |

## Context

The cycle module appeared if `profile.gender === 'female'`. A demographic field
decided which features someone had.

That inference is wrong in both directions and for the same reason: it answers a
question the user is perfectly able to answer themselves. A woman who does not
want cycle tracking got it anyway; anyone else who wanted it could not have it,
whatever they set. And the field doing the deciding is adjacent to a special
category of data, being used for something it was never collected for.

Specification §7.1 puts it plainly: "Hvad vil du have hjælp til?" is more
valuable than inferring modules from gender.

## Decision

Onboarding asks. Step one takes an optional display name; step two is the module
list — the same list, from the same registry, that Settings shows, so the two
can never say different things.

Everything starts enabled. Onboarding is an opportunity to opt out, not a gate
to force: an empty app is a worse first impression than a full one.

Gender is no longer asked during onboarding and decides no module anywhere. It
remains an optional field in Settings.

**The old inference is converted once, in SQL.** Existing users get an explicit
`user_modules` row for cycle, seeded from their current gender, so the person who
saw the tab yesterday still sees it tomorrow and the person who did not is not
suddenly given it. After that migration, gender is never read to decide what
someone has.

## Consequences

- Running the inference one final time to preserve behaviour is the opposite of
  keeping it: it turns a permanent guess into a stored choice the user owns and
  can change. The migration skips anyone who has already chosen.
- A test enumerates every file allowed to read gender. It is currently seven —
  the profile screen, four tint hooks, the store and the type. Anything else
  comparing gender fails the suite.
- The remaining use is colour palettes. That is not module inference, but it is
  a thin purpose for collecting the field at all, and it is now the *only*
  reason the field exists. Recorded as D2.
- Onboarding is two screens rather than one, and neither can be failed — both
  can be completed without entering anything.

## Alternatives considered

- **Default cycle off for everyone and let users find it.** Rejected: existing
  users would lose a feature they use, with no notice and no obvious way back.
- **Keep the gender gate and add the module choice on top**, as APP-010 and
  APP-017 both had to. Rejected: two gates where one belongs to the app's
  guesswork means the user's own choice can still be overruled.
- **Ask for gender in onboarding anyway, for the tints.** Rejected: a colour
  palette does not justify asking, at the moment when people are most reluctant
  to answer.
