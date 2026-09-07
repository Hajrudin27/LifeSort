# LifeSort — Shared Primitive Inventory

**Story:** APP-008 (E0 · Architecture & inventory, P1)
**Owner:** Hajrudin Kardasevic
**Enforced by:** `__tests__/sharedPrimitives.test.ts`, on every `npm test`.
**Decision:** [ADR-0008](./adr/0008-primitives-are-frozen-then-migrated.md)

## Why

When the same idea is implemented twice, the two copies drift, and the drift
shows up as a bug that looks unrelated to its cause. Every item below is a
concrete case of that, already in the app today: money that renders in two
different formats, trip files that never reach the server, a reminder that only
works because another module asked for permission first.

This inventory names the one implementation that should survive for each
primitive, records what the copies do differently, and says which story removes
them.

## Summary

| Primitive | Canonical today | Copies | Consequence of the drift | Migration owned by |
| --- | --- | --- | --- | --- |
| `LocalDate` | ✅ `utils/shared/localDate.ts` | 1 partial | One week calculation bypasses the DST-safe helpers | APP-045 |
| `Money` | ❌ none | 3 renderings, 17 files | The same amount renders in two formats; Danish decimals are wrong | **APP-040** |
| `EntityId` | ❌ none | 2 generators, 16 files | The weaker one can collide inside a single millisecond | **APP-030** |
| `Reminder` | ❌ none | 4 modules | One reminder type only works by accident | **APP-080** |
| `AttachmentRef` | ⚠️ `types/attachment.ts` | 1 divergent copy | Trip attachments never reach the server at all | **APP-058** |

## 1. `LocalDate` — canonical exists

**Canonical:** `utils/shared/localDate.ts` — `'YYYY-MM-DD'` calendar maths that
neither timezone nor DST can shift. It exists because both bugs had already
happened once.

**Divergence:** `utils/food/foodWeek.ts` computes ISO week keys with its own
`Date.UTC` arithmetic, while `utils/habit/habitWeek.ts` computes the same
Monday-start week through the canonical helpers. Both carry the same `|| 7`
Sunday trick, written twice.

**Consequence:** low today — `getISOWeekKey` is deliberately UTC-based and is
correct for that purpose. But the week boundary now has two definitions, and
APP-045 requires Home, Economy and Food to agree on period boundaries.

**Plan:** when APP-045 unifies budget periods, move week and month boundaries
into `core/dates/` beside `localDate`, and let Food consume them.

## 2. `Money` — no canonical implementation

**State:** amounts are plain JavaScript `number` everywhere — `Expense.amount`,
`TripExpense.amount`, `SavingsGoal.targetAmount`, grocery purchases, income.
Specification §8.1 forbids floating point as canonical persisted money.

**Copies — three different renderings of one idea:**

| Rendering | Sites | Example |
| --- | --- | --- |
| `value.toFixed(0)` | 22 | `app/savings/index.tsx` |
| `value.toFixed(2)` | 18 | `app/(tabs)/economy.tsx` |
| `Math.round(value).toLocaleString(locale)` | 3 | `app/expenses/index.tsx` |

APP-011 moved Home's share of these into `features/*/homeSnapshot.ts`; the
duplication moved rather than shrank, and the freeze list follows it.

Plus two separate local `formatCurrency` helpers, in `app/expenses/index.tsx`
and `app/expenses/[category].tsx`, which are not quite the same: one hardcodes
`kr.`, the other reads `t('expenses.currency')`.

**Consequence — user-visible, in the launch market.** `toFixed` does not
localise. In Danish, 1234.5 must render as `1.234,50`; `toFixed(2)` gives
`1234.50` — wrong decimal separator, no thousands separator. A user sees
`1.235 kr.` on the expenses screen and `1234.50 kr.` on the savings screen for
the same kind of value. Seventeen files render money and only three of them do
it correctly.

**Plan (APP-040):** introduce `core/money` with integer minor units as the
canonical representation and one localised formatter. Migrate reads first —
replacing the 43 rendering sites is mechanical and safe. Migrate storage second,
behind a versioned local migration, because it changes persisted shape and needs
the rollback path from APP-038.

## 3. `EntityId` — no canonical implementation

**Copies:**

| Generator | Files |
| --- | --- |
| `` `${Date.now()}-${Math.round(Math.random() * 1e6)}` `` | 11 — ten stores, verbatim, plus `utils/shared/attachmentStorage.ts` |
| `Date.now().toString()` | 5 — `useExpensesStore`, `useSavingsGoalsStore`, `useWarrantiesStore`, `AttachmentList`, `TripAttachmentGrid` |

**Consequence:** the second form has millisecond resolution and nothing else, so
two ids minted in the same tick are identical. `components/AttachmentList.tsx`
mints three in a row and `TripAttachmentGrid` two — attaching several files
quickly is exactly the case that collides. Neither form is collision-resistant
across devices, which matters once the same account writes from two phones.

**Plan (APP-030):** one `core/ids` module over `expo-crypto`'s CSPRNG. New
entities only; existing ids stay as they are, since they are referenced by rows
already in Supabase and by attachment paths in storage. The two generators are
deleted as their call sites move.

## 4. `Reminder` — no canonical implementation

**Copies:** `utils/cycle/cycleReminder.ts`, `utils/expense/incomeReminder.ts`,
`utils/trip/tripReminder.ts`, `utils/warranty/warrantyReminder.ts`. Four modules
that all schedule a local notification at a date derived from an entity.

**What differs between them:**

| | cycle | income | trip | warranty |
| --- | --- | --- | --- | --- |
| Requests permission | **no** | yes | yes | yes |
| Identifier | one constant | one constant | per entity | per entity |
| Guards against a past date | yes | yes | yes | yes |
| Time of day | 09:00 | own rule | own rule | own rule |

**Consequence:** `scheduleCycleReminder` never requests notification permission.
It works today only because `scheduleIncomeReminder` runs at app start and asks
first. Remove or defer the income reminder and cycle reminders silently stop
being delivered — a health feature failing quietly because of an unrelated
module's side effect. This is the accidental coupling a shared primitive
prevents.

**Plan (APP-079/APP-080):** one `core/notifications` reminder service owning
permission, stable identifiers, timezone and DST handling, and cancellation.
Migrate cycle first, because it is the one that is actually broken, and because
its copy is also the one that must become privacy-safe in APP-073.

## 5. `AttachmentRef` — two types, and they behave differently

**Canonical:** `types/attachment.ts`.

```ts
// types/attachment.ts                 // types/trip.ts
interface Attachment {                 interface TripAttachment {
  id: string;                            id: string;
  uri: string;                           uri: string;
  storagePath?: string;   // ←            //  ← missing
  name: string;                          name: string;
  kind: AttachmentKind;                  kind: "image" | "document";
}                                      }
```

**Consequence — data durability, not cosmetics.** `storagePath` is what ties a
local file to its uploaded copy. `AttachmentOwnerType` in
`utils/shared/attachmentSync.ts` is `'warranty' | 'expense'` — trips are not in
the sync path. `TripAttachmentGrid` calls `persistFile` and stops there.

So a receipt attached to an expense is uploaded, re-signed on another device and
removed on account deletion. A boarding pass attached to a trip is a local file
URI and nothing else: it does not survive a reinstall or a new phone, and it
never appears in the `attachments` table. The missing field is why, and the
duplicated type is why the missing field went unnoticed.

**Plan (APP-058):** delete `TripAttachment`, use `Attachment`, and add `'trip'`
to `AttachmentOwnerType`. Existing local-only trip files need a one-time upload
on next open, or they stay local for good — that backfill is the part that needs
care, and it is why this is a story rather than a rename.

## The freeze

`__tests__/sharedPrimitives.test.ts` holds the file lists above as baselines and
fails when a **new** copy appears: a new id generator, a new `*Reminder.ts`, a
third attachment type, or `toFixed` in a file that did not already have it.

Like the other baselines in this repository, it is a ratchet — an entry that is
no longer a duplicate must be deleted from the list, so the lists can only
shrink. Adding a line to make a test pass removes the protection.
