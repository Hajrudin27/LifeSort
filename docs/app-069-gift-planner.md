# APP-069 — Gift planner (P1)

**Story:** APP-069 · E7 Goals, habits, career & gifts · P1
**Acceptance:** "Manual people labels; optional budget link; no contacts permission v1."
**Decision record:** [ADR-0056](./adr/0056-gifts-are-a-flat-device-local-list-that-joins-backups-through-an-injected-participant.md)

APP-069 adds a small, private gift planner: who a gift is for, what it could be, an optional occasion and
planned budget, and — once bought — when and for how much. It is **device-only** and merges **internal**.

## What a gift is

One flat entity. There is no recipient, occasion, idea or purchase entity.

```
{ id, personLabel, idea, occasionLabel?, occasionDate?, budget?, purchasedOn?, paid?, createdAt }
```

Optional keys are omitted when absent: never `null`, never an empty string. A persisted row carries no other key.

| Field | Rule (new input) | Rule (stored and backup — one strict decoder) |
| --- | --- | --- |
| `id` | `newEntityId()` (UUID v4); never changes | any non-blank string |
| `personLabel` | trimmed; 1–100 UTF-16 units; one line; any Unicode; duplicates allowed; no case normalisation | the same, and already trimmed |
| `idea` | trimmed; 1–200; one line | the same |
| `occasionLabel` | optional; trimmed; 1–100; one line; empty means absent | the same |
| `occasionDate` | optional; strict `YYYY-MM-DD`; any valid year; past and future allowed | strict calendar date |
| `budget` | optional; DKK `MinorUnits`; zero allowed; never negative; empty means absent | supported, non-negative integer |
| `purchasedOn` | optional; strict date; **a future date is refused on input** | strict date; **the clock is never read** |
| `paid` | optional; DKK `MinorUnits`; zero allowed; only with a purchase | supported, non-negative integer; requires `purchasedOn` |
| `createdAt` | set once, immutable | canonical ISO instant (`YYYY-MM-DDTHH:mm:ss.sssZ`) |

"One line" means no C0 or C1 control character (tab, line feed, NUL included) and neither Unicode line nor
paragraph separator. A new input that is out of range gets a fixed error code under its field and nothing is
saved; no typed text ever travels in an error.

## Purchase

There is no status. A gift is **purchased exactly when `purchasedOn` is present**, and the row itself is the
purchase history: it stays visible in a "Purchased" section and is never archived or hidden.

- In the form, switching **Purchased** on shows today's date as a visible, editable convenience. It becomes the
  gift's purchase date only when the user saves. An optional **Paid** amount appears.
- Switching it off and saving removes `purchasedOn` and `paid` together. A purchase can be corrected by editing.
- **Budget** is what the user plans to spend; **Paid** is what was actually paid. They are separate fields with
  separate labels and helper text. Neither is an expense: the form says "Not added to your expenses."

## Order

Deterministic, independent of input order, and it never consults the current time. It ranks nothing: no
"overdue", "due soon" or priority.

- **Planned:** occasion date ascending; undated gifts after dated ones; then newest created first; then id.
- **Purchased:** purchase date newest first; then newest created first; then id.

A past occasion therefore stays where its date puts it until the user edits or purchases it. That is accepted.

## Where it lives

| Concern | File |
| --- | --- |
| Persisted format and decoders (core, clock-free) | [`core/gifts/persistedGift.ts`](../core/gifts/persistedGift.ts) |
| Live rules: validate, create, edit, purchase, order (pure) | [`features/gifts/domain/gift.ts`](../features/gifts/domain/gift.ts) |
| Entity type | [`types/gift.ts`](../types/gift.ts) |
| Store (local-only, plain AsyncStorage) | [`store/useGiftsStore.ts`](../store/useGiftsStore.ts) |
| One form for create and edit | [`components/GiftForm.tsx`](../components/GiftForm.tsx) |
| Screens | `app/gifts/{index,new,[id]}.tsx` |
| Backup participant | [`features/backupParticipants.ts`](../features/backupParticipants.ts) |
| Copy | `localization/locales/{en,da}/gifts.json` |

## Storage and what "device-only" means

- **Profile A**, logical domain `gifts.gifts`, `expectsServerSync: false`. Physical surface:
  `async-storage:lifesort-gifts`, plain, migration-gated, Zustand version 0 (greenfield). The module is
  classified `personal` and `financial`: a person label is third-party personal data and the amounts are personal
  planning values. Under the current data contracts that does not make it Profile B.
- **Local-only.** No Supabase client, no table, no outbox, no revision, no tombstone, no mirror. `supabase/` is unchanged. Nothing a gift
  contains is logged or sent anywhere.
- **Reinstall and second device.** A reinstall or a second phone does **not** bring gifts back. The only recovery
  is a backup file the user exported (below). Gifts are **not** cloud-synced and are not "production-sync-ready".
- **Hydrate decodes.** A stored row that is not a recognisable gift is not rendered and is dropped on the next
  write. Unreadable bytes and a payload from a newer app version fail closed and are never overwritten.
- **Logout and account switch** clear the store and its key, so the next account on the phone sees nothing.
- **Account deletion** removes it with the rest of the device's data. There is no server copy to delete.

## Backup (format 14)

Gifts are included: `data.gifts = { gifts: [...] }`, each gift with exactly its keys in canonical order. The
format went from 13 to 14 so an older app refuses the file as `unsupported_version` rather than ignoring gifts.

- A restore is **all-or-nothing** and validated before anything is written: an unknown key, a bad text, an
  impossible date, a negative or unsupported amount, a `paid` without a purchase, a malformed container or a repeated id
  refuses the whole file (`invalid_format`), including every other domain in it. Applying a validated file is a
  sequence of in-memory store writes, the same for every domain: there is no cross-store transaction and no rollback
  if a write were to throw, and none is claimed.
- A file of format 1–13 carrying a `gifts` key is refused. Formats 1–13 otherwise restore exactly as before, and a
  restore without gifts leaves the gifts on the device alone.
- Career applications and the CV are still excluded (format 13); gifts do not change that.

### How it joins without a new core -> store edge

`utils/shared/dataBackup.ts` gained a minimal `BackupParticipant` shape and takes a list as an optional argument.
The list lives in `features/backupParticipants.ts` (composition layer) and the backup screen passes it in. Core
imports no Gifts store and nothing from `features/`; `CORE_BASELINE` (14 edges) and `FEATURE_IMPORT_BASELINE`
(1 edge) are unchanged. A syntax-tree test lets only the backup screen import `exportBackup` / `importBackup` (in any
import form) and requires its two calls to pass `BACKUP_PARTICIPANTS`, so a second caller cannot drop gifts
silently. See ADR-0056.

## Approved deviation: no Economy budget link

The master specification expects an optional link from a gift's budget to Economy through a budget-allocation
contract. APP-069 does **not** implement it:

- the repository has no canonical Economy allocation primitive;
- inventing one inside Gifts would put an Economy concept in the wrong module and violate the module boundaries;
- APP-059 (Travel budget bridge) is not that contract — it creates Economy expenses — and is not reused;
- direct Economy expense mutation is explicitly forbidden.

A gift stores its own optional planned `budget` only. There is no `budgetAllocationId`, `expenseId`,
`savingsGoalId` or `tripBudgetId`, and no placeholder pointing at an expense or a savings goal. The link is
**deferred until a canonical, typed Economy allocation contract exists.** Marking a gift purchased never creates
or changes an Economy expense (tested against the real Economy stores).

## No Contacts

APP-069 itself has zero Contacts integration: no `expo-contacts`, no contact id, no phone, email or avatar, no permission
request, no `app.json` plugin or permission. The person is a label the user types.

> **Amended later by APP-070.** APP-070 adds an optional, iOS-only "Choose from Contacts" action that copies the first
> and last name of one picked contact into the Person field, one way, with no permission request, no stored reference
> and no schema change. The statement above remains true of APP-069 as shipped. See
> [APP-070](./app-070-contacts-import.md) and [ADR-0057](./adr/0057-gift-person-labels-may-be-copied-once-from-an-ios-contact-the-user-picks.md).

## Visibility

`gifts` is registered with **`availability: 'internal'`**, sensitivity `personal`/`financial`, route root
`/gifts`. The existing evaluator and `ModuleGate` close it to an ordinary user; no internal-user model is invented
here. The entry points are the **module launcher** and, after physical QA, a card on the **Life tab** (shown only when the
user has the module on and its effective availability allows navigation, so it is as dark as the launcher). No Home
card or snapshot, no Search entry, no notification category, no reminder. Activating it is a separate change after manual QA (a remote flag or the
registry default); until then it is invisible. Module choice already handles any module id, so no server schema
changed (`user_modules` only excludes the platform modules).

## Non-goals

Contacts or any contact-derived field (APP-069 itself; APP-070 later adds a one-way iOS name copy only); an Economy link, expense, savings goal or trip link; sync, a server table,
a mirror; reminders, notifications, calendar; recurrence or birthday inference; "overdue" or priority; a status
enum, an archive, filters, grouping or search; a Recipient/Occasion/Purchase entity or a purchase event log;
AI suggestions, recommendations, product search, images, shops, affiliate links, price lookup, scraping, adverts;
a Home snapshot, Life card or global Search entry; analytics; multi-currency.

## Verification

Automated: domain and decoder rules (`giftDomain`), the store and its persistence, logout and account isolation, and
Economy immutability (`giftStore`), the screens, accessibility roles and EN/DA (`giftsUi`), backup format 14 and the
mutation checks M1–M7 (`giftBackup`), the dependency and scope guards (`giftDomainBoundary`), registry, launcher,
profile classification and copy (`giftModule`).

## Manual QA still required

Not claimed by the automated tests:

- VoiceOver (iOS) and TalkBack (Android) on the list, create, edit and delete flows, including the purchase
  switch and the "Remove date" action;
- the largest Dynamic Type / font size on all three screens, on a physical device;
- dark mode on a physical iOS device and a physical Android device;
- Danish copy review;
- decimal-comma money entry on a device keyboard, and the amount shown back correctly;
- the purchase flow on a device: switch, today's date, change the date, paid amount, save, reopen, un-purchase;
- the internal/available launcher visibility on a device (how the module is activated for the test);
- backup export and restore on a device, including a restore onto a phone that has other gifts;
- a Gifts account A -> log out -> account B sequence on a device.
