# ADR-0060: Health notifications are generic unless rich copy is explicitly enabled

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-13 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-073 |
| **Superseded by** | – |

## Context

Cycle reminders used one stable local-notification identifier but scheduled text that revealed an expected period and a
prediction based on the user's history. The OS retains scheduled requests across an app update, while the old reminder
was only refreshed when the Cycle tab mounted. This exposed reproductive-health information on a lock screen and let a
legacy request survive until a user opened that screen.

Cycle is Profile-B health data (ADR-0022/0023) and health-module activation is an explicit user choice (ADR-0059).
Reminder enablement asks for a reminder; it is not consent to display health detail on a lock screen.

## Decision

- The default Cycle notification title/body is generic in every supported locale and carries no health data payload.
- Rich Cycle copy is available only when `richNotificationCopyEnabled` is explicitly `true`. It defaults to false in
  fresh, legacy, missing, malformed, and new-login states, and any non-boolean value is treated as false.
- **Rich consent is device-local.** The preference lives only in the encrypted `lifesort-cycle` Profile-B surface. It is
  not stored in, read from or reconciled with the cloud: APP-073 changes no `cycle_settings` schema, migration, RLS or
  grant, and no Supabase fetch may enable it. Only an explicit local action on this device can change `false` to `true`.
  It survives an ordinary restart on the same device, and the existing Cycle logout/account cleanup resets it, so a new
  login, fresh device or reinstall starts at `false`. Existing reminder timing preferences keep their current cloud
  behavior unchanged.
- Existing Cycle Zustand v0 payloads remain compatible through the new store's false initial state; the inner v0 and
  AES-GCM envelope v1 formats are not changed.
- On the first start of updated code after protected Cycle storage hydrates, the stable legacy identifier is cancelled
  before any replacement may be scheduled. The refresh never asks notification permission, works offline, and only
  schedules if permission already allows it.
- Scheduling also requires a live owning account, explicit Cycle-module enablement, reminders enabled, and a valid
  predicted date. A serialized lane plus account checks before and after each native await prevent stale work from
  recreating a former account's request.

## Why consent is device-local

Lock-screen disclosure is a device privacy choice. Opting into rich reproductive-health copy on device A does not
authorize device B to expose it. It also means a stale or failed cloud write can never undo a local privacy decision
(a best-effort sync could otherwise revert an opt-out into an opt-in). APP-079 may revisit notification-settings
architecture, but must not silently weaken this explicit per-device exposure rule.

## Consequences

- An update cannot alter a legacy OS request that fires before the user first runs updated app code. Once the update has
  started, its legacy Cycle request is cancelled/replaced without opening Cycle.
- Disabling Cycle cancels the stable request without deleting Cycle data or preferences. Re-enabling uses retained
  reminder and rich-copy choices.
- APP-073 deliberately stays a Cycle adapter. APP-079/080 retain central permission/category and timezone/DST ownership;
  APP-082 retains notification action routing; APP-084 retains push.

## Alternatives considered

- **Treat reminder enablement as consent.** Rejected: a reminder can be useful without exposing health detail publicly.
- **Add a general notification framework now.** Rejected: one stable Cycle identifier and the focused warranty refresh
  pattern solve this privacy boundary without pre-empting APP-079/080.
- **Keep historical rich requests until the Cycle tab opens.** Rejected: it leaves an avoidable lock-screen disclosure.
- **Sync the consent to `cycle_settings` (with downgrade-only reconciliation or a durable outbox).** Rejected by owner
  decision: cross-device consent propagation is not wanted, and the device-local rule removes the conflict problem.
- **Bump the encrypted envelope or inner Zustand version.** Rejected: the retained v0 payload safely merges the absent
  field to false; a format migration would add risk without changing encrypted transport or schema semantics.
