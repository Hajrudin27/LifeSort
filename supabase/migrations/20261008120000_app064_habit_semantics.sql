-- APP-064 / ADR-0052. Additive explicit habit semantics on habits.
-- Local file only: remote deployment requires a separate reviewed operation.
--
-- Two nullable columns carry the canonical habit state. Both NULL is a LEGACY habit (written
-- by a client that predates APP-064, forever a valid state): it is read through the same
-- mapping as the local migration, with `target_per_week` as its schedule. `logs` stays an
-- embedded jsonb array of { id, date } and `target_per_week` stays, unrenamed, as a
-- compatibility MIRROR (the weekly target in effect when the row was written, otherwise NULL): older clients
-- keep working, and their upserts list only the historical columns so they never touch the
-- two new ones. A current client ignores `target_per_week` whenever `schedule_history` is
-- present. No new table, no RPC and no revoked write path.
--
-- Element-level validation of `schedule_history` (kinds, weekday lists, strictly increasing
-- dates, one entry per date in `logs`) stays in the client decoder, which drops a row that
-- fails it. The CHECK only enforces the shape that makes the two columns one unit.
begin;

alter table public.habits
  add column if not exists start_date date,
  add column if not exists schedule_history jsonb;

comment on column public.habits.start_date is
  'First local calendar date the habit counts from. NULL only for a legacy habit, together with schedule_history.';
comment on column public.habits.schedule_history is
  'Effective-dated schedule periods [{ effectiveFrom, schedule }], first effective on start_date. NULL only for a legacy habit.';
comment on column public.habits.target_per_week is
  'Compatibility mirror for older clients: the weekly target in effect when the row was written, otherwise NULL; a weekly change still waiting for Monday is not mirrored yet. Ignored by current clients when schedule_history is present.';

alter table public.habits drop constraint if exists habits_semantics_check;
alter table public.habits
  add constraint habits_semantics_check check (
    -- LEGACY: neither canonical column.
    (start_date is null and schedule_history is null)
    -- CANONICAL: both, and the history is a non-empty array whose first period starts on start_date.
    or (start_date is not null and schedule_history is not null
        and case
              when jsonb_typeof(schedule_history) = 'array'
                then jsonb_array_length(schedule_history) >= 1
                  and coalesce((schedule_history #>> '{0,effectiveFrom}') = to_char(start_date, 'YYYY-MM-DD'), false)
              else false
            end)
    -- Each nullable column is guarded with an explicit IS [NOT] NULL, and the path comparison with
    -- coalesce: a CHECK also passes on NULL, and `NULL AND true` is NULL (the APP-062 lesson). The
    -- CASE's ELSE and the coalesce would already refuse a NULL history, a NULL start date and an
    -- empty array on their own; the explicit guards are kept on purpose so that the intent survives
    -- a later edit of either expression. The disposable-database test enumerates the combinations
    -- against an independent oracle and fails if any behaviour (as opposed to a guard) is removed.
  );

commit;
