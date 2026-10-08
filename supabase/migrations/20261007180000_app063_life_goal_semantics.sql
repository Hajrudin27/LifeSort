-- APP-063 / ADR-0051. Additive explicit goal semantics on life_goals.
-- Local file only: remote deployment requires a separate reviewed operation.
--
-- Five nullable columns carry the canonical goal state. All NULL is a LEGACY goal (written
-- by a client that predates APP-063, forever a valid state): it is read as a binary goal
-- whose milestones are `sub_goals`. `sub_goals` is kept, unrenamed, so older clients keep
-- working; their upserts list only the historical columns and so never touch these five.
-- No new table, no RPC and no revoked write path.
begin;

alter table public.life_goals
  add column if not exists goal_type text,
  add column if not exists target_value bigint,
  add column if not exists current_value bigint,
  add column if not exists unit text,
  add column if not exists completed boolean;

comment on column public.life_goals.goal_type is
  'binary | count | amount | duration, or NULL for a legacy goal. Immutable by convention: a type change is a new goal.';
comment on column public.life_goals.target_value is
  'count: items; amount: hundredths of `unit`; duration: minutes. NULL for binary and legacy goals.';
comment on column public.life_goals.completed is
  'Stored only for binary goals. Numeric completion is derived: current_value >= target_value.';

alter table public.life_goals drop constraint if exists life_goals_semantics_check;
alter table public.life_goals
  add constraint life_goals_semantics_check check (
    -- LEGACY: nothing typed at all.
    (goal_type is null and target_value is null and current_value is null and unit is null and completed is null)
    -- BINARY: an explicit boolean and no numbers.
    or (goal_type is not null and goal_type = 'binary'
        and completed is not null
        and target_value is null and current_value is null and unit is null)
    -- COUNT and DURATION: bounded integers, no unit, no stored completion.
    or (goal_type is not null and goal_type in ('count', 'duration')
        and target_value is not null and target_value between 1 and 1000000000000
        and current_value is not null and current_value between 0 and 1000000000000
        and unit is null and completed is null)
    -- AMOUNT: as above plus a required, already-trimmed unit of 1-24 characters.
    or (goal_type is not null and goal_type = 'amount'
        and target_value is not null and target_value between 1 and 1000000000000
        and current_value is not null and current_value between 0 and 1000000000000
        and unit is not null and char_length(unit) between 1 and 24 and unit = btrim(unit)
        and completed is null)
    -- Every branch guards each nullable column with an explicit IS [NOT] NULL: a CHECK also
    -- passes on NULL, and `NULL AND true` is NULL, which let a partial row through in APP-062.
  );

commit;
