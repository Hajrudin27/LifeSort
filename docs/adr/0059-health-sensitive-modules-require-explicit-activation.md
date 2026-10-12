# ADR-0059: Health-sensitive modules require explicit activation

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-13 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-071 |
| **Superseded by** | – |

## Context

APP-020 (ADR-0016) took the Cycle tab away from `profile.gender === 'female'` and made it a user choice stored in
`user_modules`. It kept one rule from before: **a module with no stored choice is on.** ADR-0010 states it ("the default
is on, and doubt resolves to on") and ADR-0016 repeats it ("everything starts enabled").

For most modules that is right. It means an upgrade never hides data a user already has. For Cycle it is wrong. A
brand-new account of any gender, with no choice stored, saw the Cycle tab, the launcher entry, the Home card and the
task phase hint. Nobody had asked for them. Gender no longer decided that, but a *default* still did: the app was
deciding, for everyone who had not answered, that they have a reproductive-health need. Specification section 8.7 and
APP-071 ask for the opposite: reproductive-health features follow an explicit choice, never an inference, and
"module setting independent of gender; migration preserves existing users."

Pregnancy does not exist yet (no `ModuleId`, route, store or table; APP-076). Whatever rule is chosen now should apply
to it when it arrives without anyone remembering to write it again.

## Decision

**The stored choice in `user_modules` is the only activation authority**, and a missing choice resolves through one
registry-derived default:

```ts
defaultModuleEnabled(moduleId) = !MODULE_REGISTRY[moduleId].sensitivity.includes('health')   // platform modules: always true
isModuleEnabled(moduleId, enablement) = enablement[moduleId] ?? defaultModuleEnabled(moduleId)
```

- **Explicit true is enabled; explicit false is disabled.** A stored value always wins.
- **A module whose `sensitivity` includes `'health'` is off until the user switches it on.** Today that is Cycle only.
- **Every other toggleable module keeps the existing default-on behaviour** (ADR-0010). Nothing changes for them.
- **The platform modules (`core-shell`, `account`) are always on** and cannot be chosen away.
- **Gender and every other profile field never influence activation**, for any user, ever. `defaultModuleEnabled` takes a
  module id and nothing else. `__tests__/noGenderInference.test.ts` now fails on *any* production file outside a seven-file
  list that names the gender field, whatever the syntax (`!==`, `switch`, destructuring, `includes()`, a helper, a string
  key), and it fails if that list holds a file that no longer reads it.
- **Disabling hides; it does not delete.** Switching Cycle off writes one `user_modules` row and touches no Cycle data,
  locally or remotely, and does not touch the encrypted Cycle store (ADR-0023). It is reversible: switching it on again
  restores everything. ADR-0010's direct-route behaviour is unchanged: a user's choice is a filter on navigation, Home
  and the launcher, and does not block `/cycle` routes. Server kill switches (`module_flags`) stay a separate axis and can
  still restrict an enabled module.
- **Unparseable server rows no longer fall to "on" for a health module.** They resolve to the module's default, which for
  Cycle is off. A malformed response can therefore hide a feature but can never activate special-category data.
- **Every reader uses the shared answer.** There is no screen-local reading of "no choice". `app/modules.tsx` was the only
  bypass (`enablement[id] === false`) and now calls `isModuleEnabled`.
- **Existing users who already use Cycle are preserved by a data-only migration**, `20261013120000_app071_preserve_cycle_choice`.
  For a user with no `cycle` row in `user_modules` who has at least one row in `cycles`, `symptom_logs` or `cycle_settings`,
  it inserts `cycle = true`. It never reads `profiles.gender`, never touches an existing row (true or false), never copies
  any health value, and changes no schema, RLS or grant. It is idempotent.
- **Future Pregnancy inherits the rule by classification.** A module that declares `sensitivity: ['health', …]` is off by
  default with no further code. `moduleEnablement.test.ts` registers a synthetic health module to prove it.

## Consequences

- New users start with Cycle off. Onboarding and Settings render the Cycle switch off, using the same
  `ModuleChoiceList` as every other module; there is no health-specific toggle and no new screen.
- A user who is signed in on a new device sees Cycle appear once their choice has been fetched. Until then it is off. That
  is the private direction to fail in, and it hides nothing that cannot be re-enabled.
- The app-lock suggestion (ADR-0020), which recommends a lock when a health module is enabled, now appears only after
  Cycle is chosen. Before, it appeared for everyone, because Cycle counted as enabled.
- **Stored rows that came from the APP-020 gender seed are unchanged.** A `true` row seeded for a `female` profile with no
  Cycle data is indistinguishable from a deliberate choice, and removing it would hide a feature from an existing user with
  no evidence they wanted that. It is visible and reversible in Settings. A `false` row seeded for another gender stays
  false. APP-071 does not revisit either.
- **Server evidence cannot see data that was never synced.** A user with local-only Cycle data and no row loses the tab
  until they switch it on in Settings. Nothing is deleted. This is judged acceptable: the data is intact and the fix is one
  switch.
- **This partly reverses an alternative ADR-0016 rejected** ("default cycle off for everyone": existing users would lose a
  feature they use). The reason it was rejected is answered, not ignored: a user with Cycle data on the server gets an
  explicit `true` row first, so only a user with no choice and no server-side evidence starts off. The one case that cannot
  be answered is local-only data, above.
- **Apply the migration before, or together with, the build that carries the new default.** A build with the new default and
  no migration hides Cycle from users who have data and no row until the migration runs; the other order changes nothing for
  anyone, because the old default and the inserted `true` row agree.
- **Known residual, deferred to APP-073:** a Cycle reminder that was scheduled before the module was switched off stays
  scheduled. Disabling is a visibility choice and does not cancel notifications. Notification privacy and cleanup belong to
  APP-073, which owns the health notification class, and APP-071 does not change reminder scheduling or cancellation.
- ADR-0010 and ADR-0016 are not superseded. Their "default on / everything starts enabled" statements now have a health
  exception, recorded as dated amendments pointing here.

## Alternatives considered

- **Keep default-on and fix only the copy.** Rejected: a new user of any profile would still have reproductive-health UI
  switched on by default. A default is still an inference about need, which the specification rules out.
- **Backfill `cycle = true` for every user missing a row.** Rejected: it would turn "never answered" into a stored choice for
  a special-category module, the same inference pattern ADR-0016 ran once and then closed. Only direct evidence of use
  justifies it.
- **Re-derive or delete the gender-seeded rows.** Rejected: they cannot be told apart from real choices, so any rule would
  hide Cycle from someone who uses it.
- **A health-specific activation store, flag or toggle.** Rejected: `user_modules`, revisions, tombstones and the outbox
  already do this for every module. A second mechanism would drift.
- **A per-screen check ("if module is Cycle, default off").** Rejected: it is the bug this ADR removes. The rule lives in one
  function and is derived from the registry's classification.
- **Block `/cycle` routes while the module is off.** Rejected here: it would change ADR-0010 for every module. It can be
  decided separately.
- **Cancel the Cycle reminder when the module is switched off.** Deferred to APP-073, which owns notification behaviour.
