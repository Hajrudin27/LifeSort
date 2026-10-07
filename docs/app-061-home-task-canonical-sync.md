# APP-061 — Home task calendar recurrence and canonical sync

## Scope

APP-061 upgrades only the existing Home HouseholdTask feature. It does not
create a generic task system, change Todos, change shopping or moving
synchronization, or deliver notifications.

## Calendar semantics

- A newly created task stores the device IANA time zone.
- A legacy task stores null and is evaluated in the device-local calendar.
- Completion stores a calendar date, not an elapsed duration.
- Weekly recurrence adds seven calendar days.
- Monthly, quarterly, and yearly recurrence adds one month, three months, or one
  year and clamps to the last valid day.
- The pure reminder-candidate helper reports eligibility only; it has no
  notification side effects.

## Local persistence

The Household profile is version 1. Its Z0-to-Z1 migration preserves all
existing tasks, shopping items, and moving items, fills the former hydration
defaults (assignedTo: 'me', rotates: false) for pre-rotation tasks, adds
timeZone: null to legacy tasks, and initializes an empty taskSync map. Future
versions fail closed. Backup formats 1–8 apply the same defaults.

The task sync map also holds `confirmed`, the last server-confirmed content at
its revision, used only as the conflict base. It is never exported.

The Zustand persistence boundary stores task content and task sync metadata.
Runtime account identity and actions are not persisted. The task sync map holds
confirmed revision, planned revision, update time, and tombstone time
independently from the user-visible task.

Task changes are optimistic but durable enqueue is serialized. If enqueue
fails, the optimistic state is rolled back. Account identity and a local dataset
epoch are checked after asynchronous boundaries so callbacks from a previous
account cannot repopulate the active store.

Direct fetch reconciliation:

- accepts only strictly validated owner-scoped rows;
- applies only monotonic revisions;
- removes tasks represented by newer tombstones;
- does not infer deletion from a missing row;
- protects entity IDs with pending outbox work before and after the fetch;
- is discarded when the session, account, or local dataset epoch changes.

## Server persistence and authorization

Migration 20261007104454_app061_home_task_sync.sql evolves household_tasks in
place. It adds time_zone, revision, updated_at, and deleted_at. Existing rows
remain valid with a null time zone and revision 1.

Authenticated clients may select only rows where user_id equals auth.uid().
Direct insert, update, and delete privileges are revoked. Home-task writes use
the overloaded seven-argument apply_sync_mutation function:

- the authenticated user is derived only from auth.uid();
- domain and entity type are exact allowlists;
- mutation payload fields are exact allowlists;
- receipt fingerprints include the base revision;
- create has no base revision;
- edit, completion, and delete use compare-and-set revision checks;
- each accepted active-row change advances the revision once;
- replaying a mutation ID returns replayed without repeating its effect;
- delete creates an immutable tombstone;
- stale or conflicting operations fail closed.

The function is security definer with an empty pinned search path, explicit
schema qualification, and execute permission only for authenticated.

## Conflict behavior

A refused Home-task write (HTTP 409 `stale_revision`, `entity_deleted` or
`entity_conflict`, or 422 for a missing row) is durably recorded by the sender as a
permanent failure, exactly as before. Both senders — the APP-037 coordinator and
the APP-036 manual retry — then notify `core/sync/refusalHandlers`, where the
Household store has registered itself (core never imports the domain). The store
performs an authoritative owner read and reconciles every blocked Home chain
against it inside its own write lane:

| Server state | Outcome |
| --- | --- |
| Tombstone | Server wins. The whole local chain is retired, the task disappears locally and nothing that could recreate it is queued. |
| No row (tombstones are retained, so: never created) | The local task is queued as a `create`; a refused local delete is simply retired. |
| Same revision as the refused base | Not a revision conflict (e.g. validation); left alone. |
| Equal to the local state | Accepted; the chain is retired. |
| Diverged | The `home-task-coupled` policy decides from base, local and remote. |

The base is the last server-confirmed snapshot (`taskSync.confirmed`), used only
when the refused head was built on exactly that revision. A refused `create`
whose row is still at revision 1 uses that row as base (this device's own earlier
create). Without a provable base the outcome is manual.

The policy merges automatically only when the two sides changed disjoint fields
and at most one side touched the coupled schedule (`lastDone`, `assignedTo`,
`rotates`): for example a title edit against a remote completion, or a completion
against a remote title edit. A merged or rebased result is sent as one `edit` of
the full state on the latest revision, so it never rotates a second time. Two
completions for the same civil date are a server no-op (one rotation). Everything
else — same-field edits, edit vs completion on coupled fields, completions on
different dates, and a delete against a changed row — is manual.

Manual conflicts are listed in the runtime-only `taskConflicts` map, shown as
"Needs review" in the task list and as a choice on the task screen: keep the
other device's version (retire the chain, show the server row) or keep mine (one
explicit `edit`, or `delete`, on the latest revision). The global sync status
keeps showing needs-attention until the choice is made. The map is recomputed by
the startup read after a restart.

Every replacement goes through `outbox.supersedeChain`: one storage write that
compare-and-sets the entity's exact queued IDs, removes them and appends the
replacement with a fresh mutation ID. A crash therefore leaves either the old
chain or the new one; a concurrent local write makes the call a no-op that the
next refusal or read reconsiders. Refused mutation IDs are never resent with a new
meaning. Each reconciliation re-checks account and dataset epoch after every
await, and outbox handles are revoked by logout cleanup.

A follow-up write for a task whose `create` is still queued (or whose sync cache
was lost) is queued as an `edit` on the chain-derived revision, closing the
duplicate-create window; a second `create` refused after the first applied is
rebased automatically by the rule above.

## Local-only and legacy tasks

Tombstones are retained server-side, so a task missing from a complete owner
read was never created remotely (restored backup, or a pre-APP-061 write that
never reached the server). After such a fetch the store enqueues a `create` for
it; until then completion and deletion of that task roll back because no base
revision exists. Absence is not trusted when the read hits PostgREST's default
1000-row cap.

Tasks created before crypto UUIDs (APP-030) have `<13-digit ms>-<random>` IDs.
The client envelope and the SQL function accept exactly that legacy shape in
addition to UUIDs.

## Backup and restore

Backup schema v9 exports only task product data plus shopping and moving data.
It intentionally excludes revisions, tombstones, pending mutations, receipts,
account identity, and coordinator state.

Versions 1 through 8 migrate Household tasks to timeZone: null. Version 9
strictly validates time zones and rejects sync metadata smuggled into task
content. Restore clears Household sync metadata and account binding so the
restored content reconciles through the active account.

## Operational notes

- Apply the migration through the normal reviewed deployment process. This
  implementation does not deploy it.
- Rollback after migration must be a new forward migration. Do not drop columns
  when production rows may contain revisions or tombstones.
- No remote Supabase project is contacted by the local database verification.
