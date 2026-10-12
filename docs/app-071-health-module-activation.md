# APP-071 — Explicit health module activation (P0)

**Story:** APP-071 · E8 Reproductive health integration · P0
**Acceptance:** "Module setting independent of gender; migration preserves existing users."
**Decision record:** [ADR-0059](./adr/0059-health-sensitive-modules-require-explicit-activation.md)
**Builds on:** APP-010 / [ADR-0010](./adr/0010-module-choice-is-a-filter-not-a-deletion.md) · APP-020 / [ADR-0016](./adr/0016-modules-are-chosen-never-inferred.md) · APP-028 / [ADR-0023](./adr/0023-cycle-health-persistence-is-encrypted-as-one-store.md)

APP-071 is narrow hardening of the existing module-choice platform. Cycle was already an ordinary, user-selectable
module and gender already decided nothing (APP-020). What was left was a *default*: a user who had never answered saw
Cycle. APP-071 makes a health module **off until chosen**, from one registry-derived rule, and preserves the users who
already use Cycle.

## The rule

```ts
defaultModuleEnabled(moduleId) = !getModule(moduleId).sensitivity.includes('health')   // platform modules: always true
isModuleEnabled(moduleId, enablement) = enablement[moduleId] ?? defaultModuleEnabled(moduleId)
```

Both live in `core/modules/moduleEnablement.ts`. A stored `true` or `false` always wins. Nothing else reads "no choice".

| Situation | Cycle |
| --- | --- |
| New user, no stored choice | **Off** |
| User switches it on in onboarding or Settings | On (stored `true`, synced through the outbox) |
| User switches it off | Off (stored `false`); **no data is deleted** |
| User switches it on again | On, with everything it had |
| Existing user, stored `true` or `false` | Unchanged |
| Existing user, no stored choice, has Cycle data on the server | On (preserved by the migration below) |
| Existing user, no stored choice, no Cycle data | Off |
| Any gender, or none | No effect on any row above |
| Server row that cannot be parsed | Treated as no choice: off for Cycle |

Availability (`module_flags`, kill switches) is a separate axis and still restricts an enabled module. A user's choice
remains a filter on tab, launcher and Home, and still does not block `/cycle` routes (ADR-0010).

## What changed

- `core/modules/moduleEnablement.ts` — `defaultModuleEnabled`, and `isModuleEnabled` uses it.
- `app/modules.tsx` — the launcher decided "no choice" itself (`enablement[id] === false`). It now calls
  `isModuleEnabled`. This was the only bypass: the tab layout, `todos/new`, `core/modules/homeSnapshots.ts`, `app/review.tsx`,
  the Life hub, the app-lock suggestion and `ModuleChoiceList` already used the shared helper or hooks.
- Comments in `app/onboarding-modules.tsx` and `app/(tabs)/_layout.tsx` no longer say everything starts enabled.
- `localization/locales/{en,da}/profile.json` `genderHint` said gender was "used to show relevant modules". That has been
  false since APP-020. It now reads "Optional. It does not decide which modules you can use." / "Valgfrit. Det afgør ikke,
  hvilke moduler du kan bruge."
- `supabase/migrations/20261013120000_app071_preserve_cycle_choice.sql` — see below.
- No new screen, no health-specific toggle, no new store.

## The migration

Data-only. For every user who has **no** `user_modules` row for `cycle` **and** at least one row in `cycles`,
`symptom_logs` or `cycle_settings`, insert `(user_id, 'cycle', true)`. Otherwise insert nothing.

- Never reads `profiles.gender` (a test asserts the statement does not mention it).
- Never touches an existing row, true or false. An explicit `false` stays false even with Cycle data.
- Copies no health value: only the user id, the module id and a boolean.
- Changes no schema, RLS or grant, and reads but never writes the health tables.
- Idempotent: `not exists` plus `on conflict do nothing`. The existing APP-033 trigger stamps `revision` and `updated_at`.
- Stored rows from the APP-020 gender seed are left exactly as they are (ADR-0059, Consequences).

Proven by `tests/db/app071.test.cjs` on a disposable local PostgreSQL cluster with the real `user_modules` history
(APP-010, 032, 033, 034) and the legacy `profiles`, `cycles`, `symptom_logs` and `cycle_settings` DDL lifted from the
remote schema. It covers: cycle data, symptom logs and cycle settings each preserving; no data, and `female` with no
data, inserting nothing; other or missing gender with data preserving; explicit false and explicit true surviving;
one row per user across several evidence tables; an unrelated module row not counting as a Cycle choice; the health tables,
schema, policies and grants unchanged; and idempotent re-runs.

The migration reaches Staging and Production only through the gated workflows in
[`database-deployment.md`](./database-deployment.md).

## Tests

| Layer | File |
| --- | --- |
| Default rule, explicit choice, re-enable, parse doubt, future health modules | `__tests__/moduleEnablement.test.ts` |
| Any production reader of the gender field, in any syntax, outside seven files; migrations | `__tests__/noGenderInference.test.ts` |
| Choice list, launcher, tab bar, Home snapshots, hooks, fetch and logout, and "toggling never touches Cycle data" | `__tests__/healthModuleActivation.test.tsx` |
| Migration | `tests/db/app071.test.cjs` |

Account isolation, queued-choice rollback and stale async work are covered by the existing `moduleChoiceAdoption.test.ts`,
and revisions and tombstones by `moduleChoiceSnapshots.test.ts`. Encrypted Cycle storage is `cycleHealthEncryptedStorage.test.ts`
and is untouched.

## Deliberately not in this story

- **A scheduled Cycle reminder is not cancelled when the module is switched off.** Deferred to **APP-073**, which owns the
  health notification class. APP-071 does not change reminder scheduling or cancellation.
- Health storage profile (APP-072), clinical content governance (APP-074), the no-diagnostic-claim review (APP-075), the
  Pregnancy module (APP-076, which will inherit the rule above through its `health` classification), search (APP-077),
  new consent, new health sync and new notification infrastructure.
- Blocking `/cycle` routes for a user who has switched the module off (ADR-0010 stands).
- Android. **DEFERRED — outside v1 release scope** (ADR-0058). The change is shared TypeScript and SQL with no native code.

## Manual iPhone check

1. Fresh account, onboarding: the Cycle switch is off; the other modules are on. Finish onboarding: no Cycle tab, no Cycle
   card on Home, no Cycle row in Modules.
2. Settings → Modules: switch Cycle on. The tab and the launcher row appear. Switch it off: they go, and switching it on
   again brings back the same data.
3. An account that already had Cycle data and no stored choice still shows the tab after the migration is applied.
4. Settings → Profile: the gender hint says it does not decide which modules you can use.
