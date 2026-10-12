# ADR-0056: Gifts are a flat, device-local list that joins backups through an injected participant

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-12 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-069 |
| **Superseded by** | – |

> Contacts decision amended by [ADR-0057](./0057-gift-person-labels-may-be-copied-once-from-an-ios-contact-the-user-picks.md) for APP-070. The statement below that APP-069 contains no Contacts integration remains true of APP-069.

## Context

APP-069 asks for a gift planner: "As a user I want to track ideas/budget/occasion without Contacts
permission." The master specification (§8.9) describes a lightweight module: person label, occasions, ideas,
budget, purchase history; no Contacts permission in v1; and a gift budget that references Economy "through a
budget allocation contract, not direct expense-store mutation".

The audit found a greenfield module and three platform facts that shape the design:

- **There is no Economy budget-allocation primitive.** The repository has no typed contract that lets one
  module reserve or allocate part of an Economy budget. APP-059 (Travel budget bridge) is not that contract: it
  creates Economy *expenses* and links them to a trip, which is exactly the "direct expense mutation" the
  specification forbids for Gifts.
- **The backup exporter is core and hard-codes 14 domain stores.** `utils/shared/dataBackup.ts` imports them
  directly (the frozen R6 baseline, `CORE_BASELINE` in `__tests__/architectureBoundaries.test.ts`). A new domain
  that joined it by the same route would grow a frozen baseline that may only shrink.
- **Gifts, like Career, will be local-only**, so a backup file is the only way they can reach a new phone.
  Leaving them out of the backup would mean no recovery at all.

## Decision

1. **One flat entity.** A `Gift` row is the whole model: `id`, `personLabel`, `idea`, optional
   `occasionLabel`, `occasionDate`, `budget`, `purchasedOn`, `paid`, and `createdAt`. There is no Recipient,
   Occasion, GiftIdea or Purchase entity. Optional keys are omitted when absent, never `null` and never an
   empty string, and a persisted row carries no key outside these nine.
2. **The person is a typed label.** `personLabel` is text the user typed (trimmed, 1–100 UTF-16 units, one
   line, any Unicode, duplicates allowed, no case normalisation). It is never resolved against anything. APP-069
   contains **no Contacts integration**: no `expo-contacts`, no contact id, no phone, email or avatar, no
   permission request, no plugin. APP-070 owns any future Contacts work.
3. **Purchase is the presence of `purchasedOn`.** There is no status enum and no event log. A purchased gift
   remains in the list (a "Purchased" section) and is the purchase history. Marking it purchased in the form
   shows today's date as a visible, editable convenience that is saved only when the user saves; un-marking removes
   `purchasedOn` and `paid` together. `paid` is valid only with `purchasedOn`.
4. **Planned budget and actual payment are two values.** `budget` is what the user plans to spend; `paid` is
   what was actually paid. Both are the shared DKK `MinorUnits` primitive (integer, zero allowed, never negative,
   no floating point, no custom parser, no currency model, DKK only). A future purchase date is refused on
   **user input** but never when decoding stored data, so the same bytes decode identically on every day.
5. **Occasion is a label and a date, independently.** There is no enum, no recurrence, no birthday inference,
   no reminder, no calendar or timezone semantics. A past occasion date stays where its date puts it: nothing
   is "overdue".
6. **Profile A, plain local storage, one logical domain.** `gifts.gifts` is Profile A with
   `expectsServerSync: false`; the physical surface is `async-storage:lifesort-gifts` through the existing
   migration-gated plain AsyncStorage pattern (Zustand version 0, greenfield, external owner). The module's
   sensitivity is `personal` and `financial`: a person label is third-party personal data and the amounts are
   personal financial planning values. Under the current data contracts that does not make the domain Profile B
   (nothing here is health, a document or a credential), and an encrypted key would add a failure mode
   (ADR-0023/0024 fail closed) for a list a user can recreate. If the classification is revisited, it is a new ADR.
7. **Local-only, with no server table and no sync.** The store has no Supabase import, no table, no outbox
   entry, no revision, no tombstone and no reconciliation. Durable sync (ADR-0026 to ADR-0030, as used by Home
   tasks in ADR-0049) was **not adopted** because it would add a table, RLS and grants, an idempotent mutation RPC,
   a conflict-policy ADR and a gated database rollout for a list the acceptance criteria do not need to be
   shared, in a module that merges dark. Nothing is mirrored best-effort either: the legacy pattern that
   ADR-0055 removed from Career is not recreated. `supabase/` is unchanged.
8. **One strict decoder.** `core/gifts/persistedGift.ts` is the persisted *format* (limits, exact key set,
   canonical text, strict calendar dates, supported non-negative money, the purchase invariant, a canonical ISO
   instant, stored and backup decoders). It is a documented C2 exception of the same kind as
   `core/career/persistedApplication.ts`, because the backup parser, which is core, must validate what the store
   persists. It reads no clock. Because the domain is greenfield, there is no compatibility mode: stored bytes and a
   backup file are held to the same rules. `features/gifts/domain/gift.ts` holds the live rules and imports core,
   never the reverse.
9. **A gift never touches Economy.** Marking purchased, editing and deleting change the Gifts store and
   nothing else; no expense, income or savings row is created or altered. Gift runtime imports no Economy
   feature, store or util, and no other domain's store; the only shared code it uses is the core money
   primitives. The form says so next to the purchase: "Not added to your expenses."
10. **APPROVED DEVIATION: no Economy allocation link.** The master specification expects an optional
    link from a gift's budget to Economy through a budget-allocation contract. APP-069 does not implement it,
    because (a) the repository has no canonical allocation primitive, (b) inventing one inside Gifts would put an
    Economy concept in the wrong module and violate the module boundaries, (c) APP-059 is not that contract and must not be
    reused, and (d) direct Economy expense mutation is explicitly forbidden. A gift stores its own optional planned
    `budget` only. There is no `budgetAllocationId`, `expenseId`, `savingsGoalId` or `tripBudgetId`, and no
    placeholder that points at an expense or a savings goal. The link is **deferred until a canonical, typed Economy
    allocation contract exists**; it would then arrive as its own story and ADR, with a migration of the persisted
    format and a backup bump.
11. **Backup format 14.** Gifts are included, as `data.gifts = { gifts: [...] }`. The format is bumped from 13
    to 14 so that an older reader refuses the file as `unsupported_version` instead of silently ignoring a
    domain it does not know. The container is exactly `{ gifts: [...] }` and a restore is all-or-nothing: an
    unknown key, a bad value, a `paid` without a purchase, or a repeated id refuses the whole file before any
    store is touched. A file of format 1–13 that carries a `gifts` key was not written by this app and is refused
    as `invalid_format`. Everything else restores exactly as before: no existing domain's validation, mapping or
    key set changed.
12. **An injected participant, not a new core -> store edge.** `utils/shared/dataBackup.ts` gains a minimal
    `BackupParticipant` shape (a `key`, an `exportSnapshot()` and a `restore(validated)`) and takes a list as an
    optional argument of `exportBackup` / `importBackup`. The list, `BACKUP_PARTICIPANTS`, is owned by the
    composition layer (`features/backupParticipants.ts`, the same pattern as `LOCAL_STORE_RESETS`) and handed in by the
    backup screen. Core imports no Gifts store, no feature and nothing from `features/`; the participant's `key`
    is typed as a backup-schema key that no built-in store owns, so it cannot shadow an existing domain; and
    `restore` receives only what the parser has validated. It is deliberately not a service locator: nothing is
    registered and nothing is looked up. `CORE_BASELINE` stays at its 14 edges and `FEATURE_IMPORT_BASELINE`
    stays at its one edge. The other fourteen domains keep the existing path; migrating them is not this story.
13. **Logout and account switch** reset the store through `LOCAL_STORE_RESETS` and the `lifesort-` sweep also
    removes the key, so a second account on the same phone sees nothing of the first.
14. **Merges internal, reachable only from the launcher.** `gifts` is registered with `availability: 'internal'`,
    sensitivity `personal` and `financial`, and route root `/gifts`. It is closed to every ordinary viewer by the
    existing evaluator and `ModuleGate`; it can be opened by the existing remote flag when it is activated, which
    is a separate change after manual QA. No internal-user model is invented here. The module launcher is its
    only entry point: no Life-tab card, no Home snapshot, no Search entry, no notification category and no
    reminder.
15. **No intelligence and no commerce.** No AI, recommendation, product search, image, shop, affiliate link,
    marketplace, price lookup, scraping, advert or web browsing. The planner is deterministic personal CRUD.
    Nothing a gift contains is written to a log, analytics event or generic event, and there is no `console` call.
16. **Order is deterministic and ranks nothing.** Planned: occasion date ascending, undated after dated, then
    creation instant newest first, then id ascending. Purchased: purchase date newest first, then creation
    instant newest first, then id ascending. The current time is never consulted.

## Consequences

- Gifts exist on this device and in a backup file the user keeps. A reinstall or a second phone does not bring
  them back unless the user restores a format-14 file. Gifts are not "production-sync-ready", and nothing may
  describe them as cloud-synced.
- A plaintext backup now carries person labels and amounts. It is the user's own export, shared by the user's
  own action behind re-authentication (APP-024), and it is the price of having any recovery at all; an encrypted
  export belongs to APP-097.
- A stored row that is not a recognisable gift (unknown key, impossible date, wrong type) is not shown and is
  dropped on the next write. This is accepted deliberately: the form cannot write one, so it needs a hand-edited
  or foreign row. A payload from a newer app version fails closed at the migration gate instead of being guessed at.
- A caller of `exportBackup` / `importBackup` that omits the participants gets exactly the pre-existing backup,
  and a file's gifts would be ignored. The optional argument keeps every existing caller and test unchanged. The
  invariant is held by a syntax-tree test (`__tests__/giftBackup.test.ts`), not by a text search: it parses every
  runtime source file in the repository, allows only the backup screen to import `exportBackup` / `importBackup` at
  all, under any import form (named, aliased, namespace, re-export, `require`, dynamic `import()`), and requires
  the screen's two uses to be direct calls that pass `BACKUP_PARTICIPANTS`. A second caller therefore cannot drop
  gifts silently, and a legitimate one is forced through review. (An earlier text-based guard was bypassable by an
  aliased or namespace import and by a file outside the folders it walked.) A required argument was the
  alternative; it would have meant editing 46 calls in nine existing test files without changing any assertion
  about formats 1–13, and an explicit empty list would still have compiled.
- Validation is all-or-nothing; applying is not a transaction. The whole file is validated before any store is
  written, so an invalid file changes nothing. Applying a validated file is a sequence of in-memory store writes,
  exactly as for every other backup domain: there is no cross-store transaction and no rollback if one of them
  were to throw, and none is claimed. Gifts are written last.
- A future Gift sync story must bring a table, RLS and grants, an idempotent mutation RPC, revisions, tombstones,
  reconciliation and a conflict policy, and would migrate the persisted format (Zustand version and backup
  format). It must not reuse a best-effort writer.
- The date picker's default window is 80 years back and 10 forward; the form widens it for a stored date outside
  that window, so any date the format allows can be shown and re-chosen.
- Deleting a gift is local and permanent, and removes a purchased gift's history with it, so it is always
  confirmed and the message says "this device only".

## Alternatives considered

- **A Recipient, Occasion or Purchase entity.** Rejected: a mini-CRM that forces keys, screens and backup
  structure for no user value in a plan the user types by hand. One flat row is the whole truth.
- **A status enum (`idea`, `bought`, `given`).** Rejected: purchased is a fact with a date, and a status would
  need transitions, a history and a decision about each. The presence of `purchasedOn` is enough and cannot
  contradict itself.
- **An append-only purchase event log.** Rejected: correcting a purchase would become an event rather than an
  edit, for a list of a few dozen rows.
- **Link the budget to Economy now.** Rejected, as above: there is no allocation contract, APP-059 is the wrong
  one, and a placeholder id would be a dangling promise. Deferred, not forgotten.
- **Create an Economy expense when a gift is marked purchased.** Rejected: the specification forbids direct
  expense mutation, a second silent write after a gift edit is exactly how a ledger gets duplicated, and the user
  may well have paid with money the ledger already records.
- **Contacts import for the person.** Rejected for v1 by the specification and the story; a permission prompt for
  a typed name is a bad trade. APP-070.
- **Durable sync through the existing outbox.** Rejected for this story (decision 7).
- **Best-effort Supabase mirror.** Rejected: ADR-0055 already removed that pattern from Career for its
  misattributed writes and resurrected deletes.
- **Profile B (encrypted) storage.** Rejected: nothing in the domain is health, a document or a credential, and
  the encrypted adapters fail closed with no cloud copy to refetch from, which is a heavy failure mode for a list
  the user can retype.
- **Leave Gifts out of the backup.** Rejected: with no sync, the backup is the only recovery path, and a format
  that is not bumped would let an older reader ignore the domain silently.
- **Import `useGiftsStore` in `dataBackup.ts`.** Rejected: it would grow the frozen R6 baseline, which may only shrink.
- **Migrate every existing backup domain to participants.** Rejected: a large redesign with regression risk
  across fourteen domains, with no user or security value for this story.
- **A participant registry that domains register into at import time.** Rejected: whether a domain is in the
  backup would then depend on import order, which is how a domain gets dropped silently.
- **Make the participant list a required argument.** Rejected for the reason in Consequences; the syntax-tree
  guard test gives the same protection without rewriting the existing tests.
