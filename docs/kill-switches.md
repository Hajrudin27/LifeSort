# LifeSort — Module Kill Switches

**Story:** APP-006 (E0 · Architecture & inventory, P0)
**Owner:** Hajrudin Kardasevic
**Code:** [`core/feature-flags/`](../core/feature-flags/), [`store/useModuleFlagsStore.ts`](../store/useModuleFlagsStore.ts), [`components/ModuleGate.tsx`](../components/ModuleGate.tsx)
**States:** [`docs/module-maturity.md`](./module-maturity.md) (APP-005)
**Migration:** `supabase/migrations/20260907120000_module_flags.sql`

## What this gives the operator

A broken module can be closed **without a store release**. Set one row in
`module_flags`; the app picks it up on next launch.

```sql
-- Close a module that is misbehaving, keeping existing data readable
insert into module_flags (module_id, availability, note)
values ('food', 'maintenance', 'price lookups timing out — INC-4')
on conflict (module_id) do update
  set availability = excluded.availability, note = excluded.note, updated_at = now();

-- Reopen it
delete from module_flags where module_id = 'food';
```

Writes go through the service role only. The app has read access and nothing
else, so a compromised client cannot close a module for anyone.

## Which state to reach for

| Situation | State | Effect in the app |
| --- | --- | --- |
| Module is broken; data must stay readable | `maintenance` | Module opens and reads normally; create and edit screens are blocked with an explanation |
| Module must stop completely | `hidden` | Module is unreachable from navigation, hubs and deep links; data still exportable from Settings |
| Winding a module down | `retired` | Same as hidden, with copy that says the area has closed for good |

**`hidden` is the real stop button.** `maintenance` is the gentler one, and its
limits are spelled out below — read them before relying on it during an
incident.

## The three safety properties

**1. A flag can never take data away.** Every state routes through the APP-005
evaluator, which returns `canExportData` and `canDeleteData` as true for all six
states. Tested end-to-end across every state the server can send. The fallback
screen says so in words too, because a closed module looks like lost data if
nobody says otherwise.

**2. A flag can never lock the user out of the app.** `core-shell` and `account`
are rejected client-side no matter what the server says, and a database check
constraint rejects the row as well. Without that, one bad row would take away
every user's settings, export and account deletion at once.

**3. Unknown input changes nothing.** An unrecognised module id, an unknown
state, a malformed row, a non-array response — all are dropped, and the module
keeps its compiled-in state. Doubt never widens access: a flag only takes effect
if it was understood. One bad row does not cost the other rows.

## Fallback when the server cannot be reached

Flags are fetched once at startup — **before login**, so a closed module is
closed for a signed-out user too — and the last answer is persisted.

If the fetch fails, the app keeps the last known flags. It deliberately does not
fall back to "everything open": that would reopen a broken module in exactly the
situation where the server cannot be reached. Offline, a closed module stays
closed.

The flags are not user data. They survive logout on purpose — a module closed
for everyone is still closed for the next person who signs in.

## What is enforced, and what is not

`ModuleGate` sits in the root layout as an overlay, so it covers every way into a
module: tab, hub link, notification tap and deep link alike. Because it covers the whole
screen, including the tab bar, it always renders a way out: back where there is
history, otherwise Home, which belongs to the shell and can never be blocked. It resolves the
module from the current path via `moduleForPath`, which is tested against every
route in [`docs/app-inventory.md`](./app-inventory.md) §2.

**Fully enforced:** `hidden`, `retired`, `internal`, `beta`. The module cannot be
opened at all.

**Partly enforced:** `maintenance`. Screens named `new` or `edit` are blocked,
which is every creation screen in the repo and both edit screens. A combined
`[id]` screen that shows *and* edits a record — `/habits/abc`, say — is **not**
blocked, because it is also the only way to read that record, and blocking it
would take reading away with writing. Those screens need to consult `canCreate`
and `canEdit` themselves; that is module-by-module work and belongs with the
registry in APP-009.

So: if you need writes to stop with certainty right now, use `hidden`, not
`maintenance`.

**Not enforced:** the store layer. `canCreate` is checked at the route, not in
the Zustand actions, so code that writes without navigating to a `new` screen
still writes. Enforcing at the store is the durable fix and arrives with the
registry.

## Rollout notes

- The flag is read at startup only. A user with the app already open keeps the
  old state until they relaunch. Live invalidation is not built.
- `internal` and `beta` currently read as closed for everyone, because there is
  no role or beta-membership model yet (APP-131, APP-166). Do not use them to
  gate anything users need.
- Feature flags are independent of OTA on purpose (specification §17.2): closing
  a module must not require shipping JavaScript.
