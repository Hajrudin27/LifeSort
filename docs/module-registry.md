# LifeSort — Module Registry

**Story:** APP-009 (E1 · Module registry & Home, P0)
**Owner:** Hajrudin Kardasevic
**Code:** [`core/modules/moduleRegistry.ts`](../core/modules/moduleRegistry.ts)
**Enforced by:** `__tests__/moduleRegistry.test.ts`
**Decision:** [ADR-0009](./adr/0009-registry-is-the-single-source-of-module-metadata.md)

## Why

Adding a module to LifeSort currently means editing Home, Search, logout,
backup, notifications and the flag table in six unrelated places — and forgetting
one of them is invisible until a user notices. `utils/shared/dataBackup.ts`
already forgot cycle, so exporting a backup silently omits health data
([`app-inventory.md`](./app-inventory.md) §8-F8).

The registry is one place that knows which modules exist and what they are.
Everything else asks it.

## The contract

Specification §4.1, implemented as written:

```ts
interface ModuleDefinition {
  id: ModuleId;
  availability: ModuleAvailability;
  sensitivity: DataSensitivity[];
  routeRoots: string[];
  requiredEntitlements?: EntitlementKey[];
  notificationCategory?: NotificationCategory;
  homeSnapshot?: () => Promise<HomeSnapshot | null>;
  searchEntries?: () => Promise<SearchEntry[]>;
  exportHandler?: ExportHandler;
  deleteHandler?: DeleteHandler;
}
```

`routeRoots` is the one addition to the specification's shape. The shell needs
to resolve a path to a module so a kill switch applies however the user
arrived — tab, hub, notification or deep link — and that mapping belongs beside
the rest of a module's metadata rather than in a second table.

## What is filled in, and what is not

| Field | State |
| --- | --- |
| `id`, `availability`, `sensitivity`, `routeRoots` | Populated for all twelve modules |
| `notificationCategory` | Set for the four modules that schedule reminders today |
| `requiredEntitlements` | Typed, unused — there is no entitlement model yet (APP-131) |
| `homeSnapshot` | **Undefined.** APP-011 |
| `searchEntries` | **Undefined.** APP-077 |
| `exportHandler`, `deleteHandler` | **Undefined.** APP-097, APP-098 |

The registry declares the shape; it does not invent the contents. A test asserts
the four handlers are still undefined, so when one lands it lands with the story
that gives it meaning — and that test has to be updated deliberately.

`SearchEntry` is provisional: the specification names the type without
describing it, and APP-077 owns what may be indexed at all.

## Sensitivity is about ownership, not display

A module's `sensitivity` lists the classes of data **it holds**. `core-shell` is
`['ordinary']` even though Home renders financial and health values, because
those belong to Economy and Cycle. Rendering is not ownership, and conflating
the two would make the shell look like a health data controller to the privacy
tooling that will read this registry.

Building the registry surfaced three places where the inventory disagreed with
itself on this: `core-shell` claimed health data while listing only ordinary
stores, `economy` omitted the receipt attachments it holds, and `useTripsStore`
was not classified `document` despite holding trip files. All three are now
reconciled, and a test keeps registry and inventory in step.

## What already reads it

- **Kill switches** — `resolveModuleAvailability` reads `availability` here.
- **Route resolution** — `moduleForPath` derives its prefixes from `routeRoots`,
  sorted longest-first so correctness does not depend on the order of a table.
- **The user's module choice** (APP-010) — "My modules" in Settings lists
  `TOGGLEABLE_MODULE_IDS` and renders each module's `titleKey` and
  `descriptionKey`, so a new module appears there without touching the screen.
- **Navigation** — the tab bar and the Life hub filter on the user's choice.

## Two axes, deliberately separate

| Question | Owner | Where |
| --- | --- | --- |
| Is this module released? | The operator | `availability` + kill switches |
| Has the user chosen it? | The user | `user_modules` + `moduleEnablement` |

A kill switch blocks a module's routes. A user's choice only removes it from
navigation — following an old link still reaches their data. See ADR-0010.

## Adding a module

1. Add the id to `MODULE_IDS` and a definition to `MODULE_REGISTRY`.
2. Add the row to [`app-inventory.md`](./app-inventory.md) §1 — the test compares them.
3. Give it `routeRoots` if it owns routes, or the kill switch will not reach it.
4. Set `notificationCategory` if it schedules anything, or the lock screen has no
   privacy class to apply.

Handlers come later, with the stories that own them.
