# ADR-0047: Travel spend is an Economy projection and undated legacy expenses stay unresolved

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-05 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-059 |
| **Superseded by** | – |

## Context

Travel previously stored a second financial truth in `trip_expenses`: a JavaScript
major-unit amount and no transaction date. APP-039 already defines the reconciled
financial read semantics and APP-040 defines DKK MinorUnits and exact PostgreSQL
`numeric` transport. Counting Travel's old array duplicated Economy and silently
treated undated history as settled spending.

No trustworthy historical transaction date exists. Trip dates, `createdAt`, the
migration time and the current date are all proxies and can change the financial
meaning of the record.

## Decision

`public.expenses` remains the canonical financial source. `trip_expense_links`
contains only the trip relationship, Economy identity, Travel category and legacy
trace/FX metadata; it does not copy the canonical amount. A server-authorized
projection joins the link to Economy and returns only the fields Travel needs.
Owners and currently accepted participants may call it. Pending, declined, removed
and unrelated accounts receive no rows. The link table has RLS enabled and no client
table grants; creation/resolution is one validated `SECURITY DEFINER` transaction.

Deleting a Trip cascades the link but not the Economy expense. Deleting the Economy
expense cascades the link. Trip deletion preview/counting includes links.

Travel uses APP-039 reconciliation for settled spending and APP-040 checked
MinorUnits for budgets, spend and remaining. New Travel expenses require an explicit
valid transaction date and are created directly in Economy plus the link.

**Legacy Travel expenses without a trustworthy transaction date are preserved but
are not converted into canonical Economy expenses or included in settled canonical
trip spend until the user provides the actual transaction date.** No date is
inferred. The encrypted local v0→v1 migration retains the original major-unit amount,
identity, attachments and metadata; it adds a safe supplementary MinorUnits value
only where the APP-040 legacy converter proves one. Unsafe money is preserved without
rounding and remains unresolved. Resolution is explicit and atomic. The legacy Travel
row is removed only after the server has created Economy plus link AND the Economy
expense durably owns the row's local attachments, confirmed by reading back Economy's
own encrypted store. Until both hold, the legacy row stays intact. The server's own
record of the resolution lets a later refresh finish the handoff. Only the row's proven
author may resolve it, and the client fails closed where authorship cannot be
established.

All new Travel expenses require an explicit transaction date. One logical expense
draft carries one client-minted identity across every retry, so the existing
server-side idempotency turns a retry after a lost answer into the same expense instead
of a duplicate. That identity and exact idempotency payload are persisted before the
first mutation in a narrow, account-bound pending Travel draft. Ambiguous drafts survive
restart; only matching same-account retries are allowed, and confirmation is durable
before cleanup. The account is rechecked after the persistence await and after the RPC;
the RPC independently rejects an expected-account value that differs from `auth.uid()`
before any mutation. This is recovery for this one operation, not a general outbox.

The minimal participant projection is cached only inside the existing encrypted,
account-scoped Travel store. A failed refresh keeps the cache but marks it stale. The
UI never presents a cached projection as fresh authoritative data. Freshness exists
only in memory for an answer confirmed during the current session, and everything read
back from disk is stale until revalidated. Logout, account switching and backup restore
discard the cache, and a projection answer is applied only to the dataset, account and
trip it was requested for, and only if no newer request superseded it. No generic sync
engine or outbox is introduced.

Canonical Economy update/delete paths invalidate linked Travel projections immediately
through a narrow expense-id contract. Invalidation marks affected trips stale and
supersedes their request token. When no projection row can map the expense back to a
trip, every trip in the current account's loaded dataset is conservatively invalidated.
A server-confirmed Economy mutation may then refresh; failed writes and refreshes
superseded by a later mutation cannot publish freshness. Queued Economy updates and
deletes retain their initiating account and refuse execution after an account switch,
so a later session cannot become the owner or delete scope of earlier work.

Encrypted Zustand mutations (`setItem` and `removeItem`) are ordered in one FIFO per
persistence key in the existing migration storage adapter. A confirming
attachment-handoff write therefore follows every older snapshot for
`lifesort-expenses`, and a later removal cannot be overtaken by a delayed write. Other
keys are not serialized with it.

## Consequences

- A historical Travel list can contain unresolved rows alongside canonical rows;
  the UI labels and excludes the former from settled spend.
- Current production Economy supports manual booked expenses. The read contract is
  already semantic-aware (refunds subtract, transfers are neutral), but APP-059 does
  not add a new refund/transfer writer or Open Banking source.
- Creation/resolution needs a successful server transaction. There is no newly
  invented offline write queue.
- Foreign-currency metadata is preserved for resolved legacy rows, but APP-059 adds
  no FX provider; new Travel financial entry is DKK.
- A resolution can be saved on the server while its attachment handoff is still
  finishing. That state is reported explicitly (`attachments-pending`), never as a
  failed save, and the legacy row keeps the attachments until the handoff is durable.
- The projection cache belongs to the account whose Travel dataset holds it. A session
  switch without the normal cleanup (another account's password-recovery link) never
  shows it to, or mixes it with, the new account. General local cleanup on that path is
  outside APP-059.

## Alternatives considered

- Infer a legacy date from the trip, creation time or migration time: rejected because
  it fabricates a financial fact.
- Keep `trip_expenses` as a second canonical ledger: rejected because amounts and
  deletion/edit behavior would diverge from Economy.
- Grant participants SELECT on Economy rows: rejected because trip sharing must not
  become general Economy access.
- Copy amount/date into the link: rejected because it creates another financial truth.
- Add an outbox or generic sync engine: outside APP-059 and unnecessary for the read bridge.
