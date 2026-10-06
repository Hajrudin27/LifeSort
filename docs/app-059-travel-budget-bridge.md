# APP-059 — Travel Budget Bridge

**Story:** APP-059
**Owner:** Hajrudin Kardasevic
**Decision:** [ADR-0047](./adr/0047-travel-spend-is-an-economy-projection-and-undated-legacy-expenses-stay-unresolved.md)
**Database migration:** `supabase/migrations/20261005120000_app059_travel_budget_bridge.sql`
**Local migration:** `core/storage/migrations/travelMoney.ts`

## Implemented architecture

- `public.expenses` is the only canonical current financial record.
- `public.trip_expense_links` has one Economy identity, a trip id, Travel category,
  optional original Travel identity and optional historical FX metadata. It has no
  canonical amount/date/name copy.
- `trip_financial_projection(trip_id)` is the minimal sharing boundary. It joins the
  private Economy row server-side and returns only the linked Travel facts.
- `link_trip_economy_expense(...)` validates access, supported exact-cent DKK money,
  category, non-blank name and explicit date; it creates Economy plus link atomically.
  During explicit legacy resolution it removes only the matching caller-authored
  `trip_expenses` row after those inserts succeed.
- Travel converts the projection into APP-039 `FinancialTransaction`s and calls the
  Economy reconciler. Booked expenses add, refunds subtract, transfers and pending
  entries contribute zero, and duplicate stable identities do not double count.
- Trip budgets are local MinorUnits and exact remote numeric values. Remaining is
  checked MinorUnits subtraction.

## Legacy behavior

**Legacy Travel expenses without a trustworthy transaction date are preserved but
are not converted into canonical Economy expenses or included in settled canonical
trip spend until the user provides the actual transaction date.**

The encrypted `lifesort-trips` payload moves from v0 to v1 in memory before one
encrypted commit. It never writes plaintext. Every legacy expense retains its id,
trip, name, original major-unit amount, category, FX fields, attachments and existing
creation metadata. It receives `resolutionStatus: requires-transaction-date`; it never
receives a guessed transaction date. Safe legacy money additionally receives
`amountMinor`. Unsafe money receives no converted value and is not rounded. Unsafe
budgets are retained in `legacyBudgetMajor` until the user corrects or clears them.
Backup format 7 applies the same rules to older exported Travel state; current
exports omit and never restore the account-scoped projection cache.

The user can continue using the app without resolving old records. The expenses view
labels them, shows that they do not count, and lets one record be resolved at a time by
entering the actual date. A failed/invalid resolution leaves the legacy row intact.

Only the row's proven author is offered, or allowed to send, a resolution. The fetch
maps the server's `trip_expenses.user_id` to `authorId` (and teaches stored rows their
author). A row with no known author is resolvable only on a trip the user owns, because
for owned trips the client reads only the user's own rows. Everything else fails closed:
someone else's trip, an unknown owner, or no session
(`canResolveLegacyTripExpense`). The server still enforces `legacy_author_mismatch`.

A legacy row's attachments are local encrypted files that only that row references.
After the server resolves the row, the row is removed only when
`handOffLegacyAttachments` reports `durable`: Economy holds the resolved expense, every
attachment is on it (merged by id, so retries never duplicate), and an awaited write of
Economy's own encrypted store has been read back with them. The existing migration
storage adapter serializes writes per persistence key, so every older Economy snapshot
finishes before that confirming write and cannot overwrite it afterward. Unrelated
storage keys remain parallel. Until then the legacy row
stays intact and excluded from spend. The server's record of the resolution
(`legacy_trip_expense_id` in the next projection) lets any later refresh finish the
handoff, which covers a lost answer, a failed Economy refresh and a restart in between.
Travel never deletes a legacy file that Economy references. Economy's late attachment
answer for a newly fetched expense merges by id instead of replacing its list.

A resolution the server has confirmed is never reported as a failed save. The result is
`resolved`, or `attachments-pending` while the handoff is still finishing. In the pending
state the edit screen says the expense is saved and its attachments are still being
moved, and offers no resolve or delete action. The list shows the row as saved rather
than unresolved. The legacy row and its attachments stay until the handoff is durable,
and a later refresh or an identical retry completes it. When the resolution's own answer
was lost, it counts as saved only if a projection confirmed in this session shows exactly
this submission (same identity, account and details). A retry whose details differ from
what the server holds is `failed`.

## New expenses and offline state

Every new Travel expense requires a valid explicit calendar transaction date and a
supported non-negative DKK amount. No `createdAt`, trip date or current-date fallback
exists. New entries go directly to Economy plus the link and never enter Travel's
legacy expense array.

One logical expense has one identity. Before the first RPC, Travel writes a narrow
pending draft into the existing encrypted `lifesort-trips` payload: account id, trip id,
crypto expense UUID, exact name/MinorUnits/category/date idempotency payload, and
`pending | ambiguous | confirmed` state. A lost answer changes it to `ambiguous`; a
restart recovers those exact fields only for the same account and retries the same UUID.
Changed details or another account fail closed. Confirmation is persisted before the
draft is cleared; only confirmed success or explicit same-account abandonment ends it,
and the next genuinely new draft receives a new UUID. This remains a single-purpose
recovery record, not an outbox. The server's existing idempotency (owner + id; an
identical replay is a no-op, a changed one is refused) recognises the retry, so it cannot
create a second Economy expense. This is proved on real PostgreSQL, including concurrent
requests with the same id.

The initiating account is rechecked after the durable-draft write and again after the
RPC answer. The RPC also receives that account as `p_expected_account_id` and compares
it with `auth.uid()` before any database mutation. If an in-place session replacement
occurs at either await boundary, the original account's draft remains recoverable and
the replacement account cannot submit, settle or clear it.

Participant projection snapshots live in the existing encrypted Travel store. A
successful complete response replaces one trip's snapshot and records when it was
confirmed (`financialProjectionFreshAt`). A failed or malformed response keeps the prior
snapshot and marks it stale. `fresh` exists only in memory for an answer confirmed during
this app session. It is never persisted as `fresh`, and every snapshot read back from
disk is `stale` until the server confirms it again. Every Travel financial surface (the
yearly total, the trip summary and the expense list) shows a stale snapshot only with
the stale label, and shows "spend unavailable" where no snapshot exists, never zero. Each
surface revalidates the trips it shows.

A projection answer lands only if, when it arrives, it is still that trip's latest
request, for the same signed-in account, in the same local dataset, and the trip is
still present and not deleted. Every account cleanup (log out, and before every log in)
and every backup restore advances that dataset epoch and retires in-flight requests. A
trip fetch that was in flight during a cleanup writes nothing. Logout clears the
projection cache with the rest of the Travel store. A restored backup starts with no
projection cache, cleared in the same write. No generic outbox or sync engine was added.

Edits and deletes through the canonical Economy store use a narrow expense-id → Travel
invalidation contract. Existing projection rows identify the affected trip ids. If no
row is cached, the contract conservatively invalidates every trip currently loaded for
that account; this closes the reverse-index gap without introducing a new cache or event
system. Those trips become stale immediately and receive a newer request token before
the local mutation. An older response therefore cannot become authoritative. Only a
successful Economy server write starts a projection refresh, and a later Economy
mutation supersedes an earlier mutation's refresh token. Failed, offline or
account-mismatched writes leave the previous rows non-authoritative rather than
publishing requested local state as fresh.

Economy's process-local per-expense mutation lane captures the initiating account with
each queued update or delete. Immediately before a queued operation reaches Supabase it
must still match the authenticated account; its row and delete predicates use the
captured account, never whichever session happens to be current later. A session switch
therefore cannot redirect account A's queued mutation into account B.

A session can also switch accounts without that cleanup: another account's
password-recovery link calls `setSession` in place. The projection cache is therefore
bound to the account whose Travel dataset holds it (`myUserId`). An answer lands only in
a dataset of the account that requested it. The financial surfaces show the cache only
to that same signed-in account; to anyone else the spend is unavailable. The new
account's first trip fetch drops the previous account's whole cache and retires that
account's in-flight requests before its own projection populates.

Known limitation, outside APP-059: that recovery path still runs no general local
cleanup. The previous account's other local data (trips, legacy rows, packing items,
participants, and every other store's records) stays on the device under the new
session until the next log out or log in. This is pre-existing APP-021 debt in the auth
flow, and APP-059 deliberately does not widen into it.

## Security and lifecycle

- Economy's existing owner-only policies are unchanged.
- The link table has RLS enabled and no direct client privileges or policies.
- Projection and mutation functions are `SECURITY DEFINER`, pin `search_path`, and
  grant execute only to `authenticated`.
- Projection access is trip owner or a currently accepted participant. Removing a
  participant causes the next server read to return no projection; stale cached data
  remains explicitly non-current until account cleanup removes the encrypted store.
- Trip deletion cascades links only and preserves Economy expenses. Economy deletion
  cascades links. The server preview/matched-delete dependency count includes legacy
  rows plus links.

## Deliberate limits

No Open Banking, FX provider, generic outbox/sync engine, refund/transfer writer,
remote deployment or migration application is part of APP-059.
