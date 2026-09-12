# ADR-0032: Automatic sync is foreground-only, event-driven and bounded

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-11 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-037 |
| **Superseded by** | - |

## Context

APP-031 supplies a durable, account-scoped outbox with `mutationId`, domain,
entity, operation, payload, optional `baseRevision`, `createdAt`, `status`,
`attempts` and optional `nextRetryAt`, persisted as one ordered JSON array under
`lifesort-outbox`, with metadata-only change events. APP-032 supplies one
idempotent `apply_sync_mutation` RPC that answers `applied` or `replayed` for
the same mutation ID. APP-033/034 own revisions and tombstones, APP-035 owns the
per-domain conflict policies, and APP-036 owns the privacy-safe status
projection and the single explicit Retry action.

Nothing sent anything by itself. A queued mutation sat there until the user
found the banner and tapped Retry, and production module choices never entered
the queue at all: `useEnabledModulesStore` wrote `user_modules` directly and
dropped the result. Offline, that write was simply lost.

APP-037 is the missing sender. The requirement it answers is not "sync more"
but "waste less": a queue that is drained by polling costs battery on every
device that has nothing to send, which is nearly all of them nearly all the
time.

## Decision

### Triggers, and nothing else

Automatic work starts only from something that happened: an account binds while
the shell is mounted, the app becomes active, connectivity changes to online, a
mutation is enqueued for the bound account, or a persisted `nextRetryAt` comes
due. There is no interval, no periodic scan, no `setInterval`, no `while`-drain
and no zero-delay recursion. One timer exists at a time, for the earliest thing
that still has to wait.

Waiting work is rescheduled by rereading the durable outbox, never from what a
finished cycle remembered, so a running app and a cold start arrive at the same
schedule. A timer that fires rereads before it sends.

### Connectivity

`@react-native-community/netinfo` 12.0.1 (the Expo SDK 57 bundled version) is
normalized to `online` / `offline` / `unknown` in `core/sync/connectivity.ts`.
Cellular is connectivity; there is no Wi-Fi-only rule and no large-upload policy
in this story.

Connectivity grants two different permissions, and the coordinator keeps them as
two named predicates rather than one boolean with two meanings:

- `mayRunEventTriggeredPass` — work the user's own action caused: an account
  binding, the app coming forward, an enqueue, the network returning. Allowed
  while `online` **or** `unknown`. Refusing on `unknown` outright would strand
  any device whose platform reports nothing.
- `mayScheduleAutomaticWork` — work the app schedules for itself: the retry
  timer and the batch continuation. Requires `online`.

So `unknown` gets **one event-triggered bounded pass** — up to the batch limit,
sequentially, once — and nothing more. A transient failure in that pass still
counts its attempt and still persists `nextRetryAt`, but arms no timer; work
beyond the batch limit arms no continuation. An unknown link that is really
offline would otherwise fail, earn a retry, fail again, and turn one hopeful
attempt into a series of them. Nothing is lost by waiting: the durable timestamp
is what remembers, and connectivity turning `online` is itself a trigger that
reads it back — running the retry if it is due by then, or scheduling exactly
the remainder of the original wait if it is not.

Leaving `online` disarms the timer, and a timer that fires re-checks
`mayScheduleAutomaticWork` before it does anything: the conditions for the app's
own initiative have to hold when it acts, not only when it was scheduled.
Offline sends nothing at all, as before.

The library's own reachability check is disabled with
`reachabilityShouldRun: () => false`. Left at its defaults it fetches
`https://clients3.google.com/generate_204` every 60 seconds while connected and
every 5 while not, on any platform whose native layer does not answer the
question itself. That is both the waste this story removes and a network
destination the SDK inventory does not declare. Consequently
`isInternetReachable` carries no information and is ignored entirely: only the
OS link state is read. A link that is up but leads nowhere produces a transient
send failure, which is what backoff is for.

### Foreground only

No OS background execution is introduced: no background fetch, no task
scheduler, no `WorkManager`, no `BGTaskScheduler`, no headless JS, no silent
push and no Supabase Realtime. Only `active` counts as foreground; iOS
`inactive` does not. Backgrounding cancels the timer and stops the batch before
the next mutation. A request already in flight may finish and record its result;
returning to the foreground re-reads session, connectivity and durable state.

### One cycle, one sender

The coordinator is single-flight per account generation. Four triggers arriving
together produce one cycle, not four workers; triggers during a cycle are not
queued into more workers, because the cycle ends by rereading durable state,
which is more truthful than any trigger could be.

A process-local, unpersisted, account-and-mutation-scoped claim
(`core/sync/mutationClaims.ts`) is shared by the coordinator and APP-036's
manual Retry. Whoever claims first sends; the other skips. It is always released
in a `finally`, including when the sender throws. It is deliberately not durable:
a claim that survived a restart could strand a mutation nobody is sending.
Durable exclusion belongs to the outbox.

### Attempts, backoff and classification

`attempts` means completed send attempts that were not acknowledged. It starts
at 0, and only a finished unacknowledged send raises it — inspecting a mutation
never does. APP-036's manual Retry previously incremented before sending; it now
counts the same way and writes the same metadata, so one field has one meaning.

Backoff is exponential with equal jitter, over the failure count `n`:

    cap   = min(300_000, 5_000 * 2^(n-1))
    delay = cap/2 + random(0, cap/2)

Roughly 2.5–5s, then 5–10s, 10–20s, 20–40s, capped at five minutes. Half the
window is fixed so a retry is never immediate; the other half is random so
devices that lost the network together do not return together. The clock and the
random source are injected, and large attempt counts clamp to the cap without
overflowing.

Only `unavailable` — transport failure, timeout, 429, 5xx — is retried
automatically. `auth-required`, `validation`, `conflict`, `entity_deleted` and
unknown outcomes, and any unsupported envelope, are permanent: `status` becomes
`failed` and `nextRetryAt` is cleared, which is what marks work as needing a
person rather than another timer. No raw error text, response body or reason is
persisted; the classifier's verdict is expressed solely as the presence or
absence of a timestamp.

Both senders separate three things that a single try/catch would blur together:
the request, the answer, and writing the answer down.

1. **The request.** A sender that throws is one completed unacknowledged
   attempt, classified transient — a thrown transport error is not evidence the
   server refused anything. The coordinator also ends the batch, since the fault
   may belong to the device rather than to that one mutation. For the manual
   action, recording it is what keeps the work from being stranded: the
   coordinator schedules nothing for a mutation someone else has claimed,
   precisely because it expects the claim's owner to leave a durable trace.
2. **The answer.** A typed failure produces exactly one `planFailedAttempt` from
   its own classification, written once.
3. **Writing it down.** Local persistence is bookkeeping, and it can fail on its
   own. When it does, the client loses its record of what happened; it does not
   get to rewrite what happened. A successful `applied`/`replayed` whose
   `acknowledge` cannot be persisted is **not** a failed attempt: nothing is
   counted, no `nextRetryAt` is invented, the mutation stays in the queue, and
   replaying the same ID later is answered `replayed` rather than applied twice.
   A permanent refusal whose metadata cannot be persisted stays a permanent
   refusal — it does not become a transient failure worth retrying. Either way
   the batch stops, and that pass arms no continuation, so a broken disk cannot
   turn into a request every second.

A failure *before* a request was dispatched — the durable lookup, a storage
read, an account that went away — is not an attempt either. Only the window
between dispatch and response counts.

That timestamp also repairs an APP-036 limitation. A restored `failed` entry
lost its transient/permanent classification and became needs-attention. It now
reads `nextRetryAt`: present means the last failure was classified transient and
Retry is offered; absent still fails closed. This refines ADR-0031's restart
conservatism without adding a field, a version or an APP-038 migration.

### Batching and ordering

A cycle attempts at most ten mutations, sequentially. Ten parallel requests are
a burst the radio pays for, and they would let a later mutation overtake an
earlier one. Remaining due work gets exactly one continuation timer, one second
later; the delay is what makes it a schedule rather than a drain loop.

An entity's mutations are a chain keyed by `(dataDomain, entityType, entityId)`,
joined by a NUL separator written as the escape `\u0000` rather than the byte
itself — a source file containing control bytes is binary to git, and a change
whose diff cannot be displayed cannot be reviewed. The chain is ordered by the
outbox's persisted array order, which survives restart. Only a
chain's oldest outstanding mutation is ever eligible, so "off, on, off" can never
arrive as "off, off, on". A blocked head — waiting retry, permanent failure or
unsupported envelope — blocks its own chain and nothing else: one rejected module
must not stop the others. Nothing is coalesced, merged, rewritten or discarded;
compaction would need its own domain semantics and its own decision.

APP-036 explicit Retry obeys the **same per-entity head-of-line ordering rule**
as automatic APP-037 sync. `getEntityChainHeads` in `syncEligibility.ts` is the
shared pure definition for automatic eligibility, status action selection and
manual dispatch. When aggregate status is not `needs-attention`, status prefers
transient failed heads, then pending heads, in durable array order, never UUID
order. A pending follower remains pending;
being blocked limits its actionability, not its status. A permanent failed head
blocks its followers, while unrelated heads remain eligible for automatic sync.
Both senders re-read the full durable outbox under their shared mutation claim
before dispatch, so a stale UI action or automatic batch cannot send an obsolete
head. Explicit Retry may bypass a transient head's future `nextRetryAt`; it may
never bypass an older outstanding mutation or retry a permanent failure blindly.

A permanently blocked entity does not prevent automatic sync of unrelated
entities. However, when aggregate presentation is `needs-attention`, the shared
APP-036 banner exposes no generic Retry action; otherwise the button could appear
to retry the attention condition while actually acting on a different mutation.
This preserves ADR-0031's global presentation rule rather than superseding it.

Reconnecting makes queued work sendable again; it does not make a waiting retry
due. Toggling airplane mode is not a way past backoff.

### Account lifecycle

Everything is scoped to an account and a generation. Account changes, sign-out
and APP-031's cleanup bump the generation, cancel the timer and unbind. A
request already dispatched for the old account may finish, but its result cannot
acknowledge, reschedule, reclassify or publish anything afterwards — and if that
leaves the mutation durable, APP-032's replay makes a later retry safe. The
sender is additionally pinned to the account's bearer token.

### Module-choice runtime adoption

`useEnabledModulesStore.setModuleEnabled` is the one production write migrated.
It updates local state synchronously and enqueues an APP-032-shaped mutation
(`core.module-choice` / `module-choice` / module ID, `upsert` with exactly
`{enabled}`, no `baseRevision`); the switch never awaits storage or the network.
The direct `user_modules` upsert is gone. No other domain, store or table is
migrated.

If the durable enqueue then fails, the switch goes back. A choice that reached no
queue exists nowhere anyone can act on it: there is nothing to send, nothing to
retry, no status to show, and the next fetch would overwrite it anyway — so
leaving it on screen would be the app quietly lying about what it had saved.
Failing closed says it immediately, at the cost of a switch that moves back on
its own.

What it rolls back *to* matters as much as whether it rolls back. An in-memory,
per-module write chain holds the account the chain belongs to, the
sequence number of the write whose value is currently on screen, the last choice
known to have reached the queue, and the sequence that established it. The first
write in a chain captures the value from before it as that stable baseline.
It also tracks the latest activity sequence (never rewound by rollback) and the
number of unsettled enqueues, solely to protect overlapping legacy fetches.

- A successful enqueue makes its value the new stable baseline, unless an even
  newer write has already claimed that role.
- A failure rolls back only if it is still the write on screen, and it rolls back
  to the stable baseline — the last value that actually reached the queue, or the
  value from before the chain if none did. Two failed toggles in a row therefore
  land on the value from before both of them, not on the first toggle's
  never-queued guess.
- A failure from a superseded write changes nothing, so it can never undo a newer
  choice the user has since made.

The chain is account-scoped and cleared by `clearLocal()` — before the choices
themselves — so a completion from before a sign-out, or from the previous
account, cannot write into what follows. The account is read synchronously when
the switch is tapped and travels with the callback, rather than being re-read
from an auth store that may since have changed. Signing out is a different case
again: with no session there is nothing to queue, so the choice is local by
definition and no chain is created; logout clears it with the rest of the local
account data. Nothing here is persisted, and no second queue or status ledger
exists.

`fetchFromSupabase` keeps reading rows directly. At entry it captures the app
session account, module write epoch, starting write sequence and modules with
unsettled enqueues. It reads queued module IDs before querying remote state and
again before merging. Account and epoch are checked after each outbox read,
after `getUser`, after the row query and immediately before publication; the
authenticated Supabase user must match the captured app account. `clearLocal`
invalidates the epoch first, then clears write trackers, then enablement. A late
response cannot publish after logout, into another account, or into a fresh
session of the same account.

The merge preserves current local state for the union of queued-before IDs,
queued-after IDs, enqueues unsettled at entry and modules whose write activity
sequence advanced after entry. This covers acknowledgement during the remote
read, writes during the remote await and writes during the final outbox await,
including activity whose enqueue has already succeeded or rolled back. The
activity check and publication have no intervening await. Failed enqueue still
rolls back to its stable baseline. With no queued work or overlap, server state
updates normally and refreshes settled chains' rollback baseline. Activity
sequences remain available to any older fetch still awaiting its response, so a
later fetch cannot erase its overlap evidence. This is a narrow race guard around
the existing fetch, not a permanent local-wins policy or a new conflict policy.

Remote pull is **not** integrated into the sync cycle. APP-033's
`createModuleChoiceSnapshots` returns confirmed revisions in memory and refuses
any fetch while work is pending; wiring it into the enablement store would need a
local-versus-confirmed merge rule, i.e. a new conflict policy and the beginnings
of a generic pull engine. Deferred on purpose.

## Consequences

Queued module choices now survive a tunnel, an airplane-mode flight and a cold
start, and are sent once the phone is open and connected — without any periodic
wake-up. APP-036's surface is unchanged in shape: pending appears immediately, a
transient failure is retryable and usually disappears on its own before anyone
taps anything, a permanent failure still asks for attention, and success is
silent.

The costs are accepted knowingly:

- Nothing syncs while the app is closed. A choice made offline and never
  reopened online stays queued.
- A permanently failed mutation blocks its module's chain until a person acts,
  and APP-036 offers no discard. That is fail-closed, not finished.
- Sign-out still clears the outbox, so unsent choices are discarded with the
  rest of the local account data (APP-031).
- A module switch can move back on its own if the durable write fails. That is
  the intended signal, but it is a visible one, and there is no message
  explaining it yet — worth revisiting when the Privacy/Sync surfaces grow.
- A cold start with a supported entry that is overdue sends shortly after the
  shell mounts, which is one more request during launch than before.

Tests cover backoff windows, jitter, cap and overflow; eligibility and per-entity
ordering; offline, unknown and reconnect; foreground, background and mid-batch
lifecycle changes; single-flight under simultaneous triggers; the batch cap and
its continuation; transient and permanent classification; `applied`/`replayed`
and the lost-response replay; restart reconstruction; account switch and late
completion; the shared claim in both directions; and the module-choice adoption
end to end. APP-031 through APP-036 regressions remain required.

## Alternatives considered

- **Polling, or a periodic "check for work" timer.** Simple, and it spends
  battery on every device that has nothing to send. The queue already tells us
  when it changed.
- **`setInterval` or a `while (queue.length) drain()` loop.** Unbounded work
  with no place to observe lifecycle, connectivity or account changes between
  items.
- **`Promise.all` over the batch.** A request burst, and it destroys per-entity
  ordering.
- **Background fetch or a task scheduler.** Real value, real cost: OS budgets,
  platform review, a second lifecycle to reason about, and sensitive work
  running while the phone is in a pocket. Not in this story.
- **Supabase Realtime.** A long-lived socket to solve a problem that five
  discrete triggers already solve.
- **Global head-of-line blocking.** One rejected module would freeze every other
  module's sync.
- **Coalescing a chain into its final value.** Cheaper on the wire, but it
  invents domain semantics — and would quietly discard intent the user expressed.
- **A new mutation ID per retry.** Defeats APP-032's replay detection and would
  double-apply the very case retries exist for.
- **Retrying every failure.** Hammers auth and validation errors that will never
  succeed, and hides them from the person who could fix them.
- **Persisting the failure reason to decide retryability.** More durable private
  data for a decision the presence of a timestamp already answers.
- **A persisted claim or lock.** Would survive restarts and strand mutations no
  process is sending.
- **Leaving a failed-to-queue choice on screen.** It looks like the change held,
  and the next fetch silently reverts it — the worst version of both outcomes.
- **Rolling back on any late failure.** Without the write counter, a stale
  failure would undo a newer choice the user had already made.
- **Leaving the reachability probe on.** An undeclared third-party request on a
  timer, in the story whose purpose is to stop wasting battery and data.
- **Migrating every legacy direct writer now.** Each domain needs its own
  envelope, conflict policy and tests. Module choice is one row and one boolean,
  which is why it goes first.
