# ADR-0049: Home tasks use calendar time and the durable sync platform

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-07 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-061 |
| **Superseded by** | – |

## Context

Household tasks previously used approximate day counts for recurrence and direct
table writes for persistence. That was insufficient for month-end, leap-year,
daylight-saving, replay, conflict, account-switch, and deletion safety.

APP-061 applies only to the existing Home HouseholdTask feature. It must preserve
task identity and existing shopping and moving behavior while using the sync
primitives established by APP-032 through APP-035.

## Decision

1. New tasks capture the device IANA time-zone identifier. Legacy tasks retain a
   null time zone and are interpreted explicitly in the current device-local
   calendar.
2. Recurrence is completion-relative calendar arithmetic: seven calendar days,
   one calendar month, three calendar months, or one calendar year. Invalid
   target days clamp to the end of the target month.
3. Household tasks use the existing durable outbox, mutation receipt, sync
   coordinator, revision, conflict, and tombstone architecture. Shopping and
   moving records remain on their existing paths.
4. The local Household store owns a versioned persisted envelope. Confirmed
   revision, planned revision, and tombstone metadata are stored separately from
   the user-visible HouseholdTask.
5. The existing household_tasks table is evolved in place with time_zone,
   revision, updated_at, and deleted_at columns. Direct client writes are closed;
   authenticated reads remain owner-scoped by RLS.
6. The server derives ownership from auth.uid(), validates an exact Home-task
   mutation envelope, uses compare-and-set revisions, records mutation receipts,
   and retains deletions as tombstones.
7. Concurrent Home-task changes use the home-task-coupled conflict policy at
   runtime. After a sender records a non-transient refusal it notifies a core
   refusal-handler registry; the Household store reconciles the blocked chain
   against an authoritative read and replaces it atomically
   (`outbox.supersedeChain`, fresh mutation IDs, latest base revision). Server
   tombstones always win. Disjoint changes merge only when at most one side
   touched the coupled schedule (lastDone/assignedTo/rotates); all other
   divergence is an explicit user choice (keep server version / keep mine).
8. Backup schema v9 includes task content and time-zone semantics but excludes
   sync metadata, receipts, and outbox state. Restoring a backup clears the
   Household sync cache before reconciliation.
9. APP-061 exposes only a pure reminder-candidate calculation. It does not
   schedule or deliver notifications.

## Consequences

- Month-end, leap-year, and DST boundaries do not depend on fixed millisecond
  durations.
- Replayed mutation IDs cannot repeat a server effect.
- Stale clients cannot overwrite newer task revisions or resurrect tombstones.
- Pending local mutations are protected from stale direct-fetch results.
- A 409 can no longer leave a Home task permanently blocked: it is reconciled
  automatically or surfaced as an explicit two-way choice on the task.
- Legacy null-zone tasks follow the device calendar by design and can therefore
  move calendar interpretation when the device zone changes.
- A rollback after the database migration must be a forward migration; dropping
  the new columns would discard sync history.

## Alternatives considered

- Fixed 24-hour intervals were rejected because they are incorrect across DST
  and calendar-month boundaries.
- UTC-only dates were rejected because they change the meaning of a household
  completion date.
- A generic task or template framework was rejected as outside APP-061 scope.
- Last-write-wins updates were rejected because they can silently lose edits and
  resurrect deleted tasks.
- Reusing Todos was rejected because it violates the Home HouseholdTask boundary.
- Notification delivery was rejected because it belongs to later notification
  scope.
