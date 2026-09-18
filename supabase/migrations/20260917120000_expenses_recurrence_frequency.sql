-- APP-042: explicit recurrence cadence and day anchor for manual expenses.
-- Forward-only. Written and verified against a scratch PostgreSQL cluster
-- (tests/db/app042.test.cjs); NOT applied to any remote project.
-- No RLS change: the columns live in the existing user-scoped expenses table.

-- 1. Nullable columns first, so the table is writable throughout.
alter table public.expenses add column if not exists recurrence_frequency text;
alter table public.expenses add column if not exists recurrence_anchor_day smallint;

-- 2. Backfill history. Every shipped build materialized a recurring expense once
-- per month on the day of its payment date, so the historical meaning of
-- is_recurring = true is exactly 'monthly' anchored to that day. next_payment_date
-- is a real DATE here, so the invalid-day strings that could exist in local
-- storage cannot occur. One-time rows stay NULL. Idempotent.
update public.expenses
  set recurrence_frequency = coalesce(recurrence_frequency, 'monthly'),
      recurrence_anchor_day = coalesce(recurrence_anchor_day, extract(day from next_payment_date)::smallint)
  where is_recurring
    and (recurrence_frequency is null or recurrence_anchor_day is null);

-- 3. Compatibility with the immediately previous app version, which knows
-- is_recurring and next_payment_date but neither new column. There is no
-- forced-update or minimum-version mechanism, so without this a client that has
-- not been updated could no longer create, edit or un-recur a recurring expense
-- (its writes are upserts, and the omitted columns arrive NULL).
--
-- What counts as the legacy shape differs by operation, because a row trigger
-- cannot see which columns a statement listed:
--   INSERT: both new columns are NULL.
--   UPDATE: both new columns are UNCHANGED relative to OLD. A column the statement
--           did not set still carries the stored value, which is indistinguishable
--           from a caller that explicitly re-sent that same value.
-- Within that shape the trigger never invents a cadence for a row that already has
-- one. Partial or invalid modern metadata is the caller's own input, is left
-- untouched, and is still rejected by the strict CHECK below.
--
-- KNOWN AMBIGUITIES, inherent to a BEFORE row trigger, each pinned by a test:
--  1. A caller that explicitly sends both columns as NULL on a recurring row looks
--     exactly like an old client that omitted them, and is normalized the same way.
--  2. A write that moves next_payment_date while re-sending the stored anchor is
--     re-anchored to the new date. The APP-042 client always derives the anchor
--     from the date it stores, so this matches what it would have sent.
--  3. An UPDATE that re-sends the stored recurrence_frequency and
--     recurrence_anchor_day while changing is_recurring is treated as legacy
--     compatibility too: turning recurrence off that way clears both columns
--     instead of being rejected as incoherent. The same values sent as an UPSERT
--     are still rejected, because the proposed INSERT row is incoherent and is
--     validated before the conflict resolves.
-- All three are acceptable for the temporary compatibility window: stored state
-- still satisfies the strict CHECK, the APP-042 client does not produce such a
-- write, and removing this trigger removes the ambiguity. Remove this function and
-- its trigger in a later migration once old-client compatibility is no longer
-- needed.
create or replace function public.expenses_legacy_recurrence_defaults()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_recurring boolean;
  v_frequency text;
  v_anchor_day smallint;
  v_date date;
  v_found boolean := false;
begin
  if tg_op = 'UPDATE' then
    -- Unchanged means the statement did not set these columns — how an old client's
    -- upsert looks — or re-sent exactly the stored values, which is indistinguishable
    -- from it. Anything it did change is its own input and is left alone.
    if new.recurrence_frequency is distinct from old.recurrence_frequency
       or new.recurrence_anchor_day is distinct from old.recurrence_anchor_day then
      return new;
    end if;
    v_found := true;
    v_is_recurring := old.is_recurring;
    v_frequency := old.recurrence_frequency;
    v_anchor_day := old.recurrence_anchor_day;
    v_date := old.next_payment_date;
  else
    if new.recurrence_frequency is not null or new.recurrence_anchor_day is not null then
      return new;
    end if;
    -- An upsert evaluates this INSERT candidate before resolving ON CONFLICT, so
    -- the row it is about to replace is looked up by its identity. SECURITY
    -- INVOKER keeps this read under the caller's RLS policies.
    select e.is_recurring, e.recurrence_frequency, e.recurrence_anchor_day, e.next_payment_date
      into v_is_recurring, v_frequency, v_anchor_day, v_date
      from public.expenses e
     where e.user_id = new.user_id and e.id = new.id;
    v_found := found;
  end if;

  -- Turning recurrence off, or a one-time row: no cadence, no anchor.
  if not new.is_recurring then
    new.recurrence_frequency := null;
    new.recurrence_anchor_day := null;
    return new;
  end if;

  if v_found and v_is_recurring and v_frequency is not null then
    -- An existing schedule keeps its cadence; only a changed date re-anchors it.
    new.recurrence_frequency := v_frequency;
    new.recurrence_anchor_day := case
      when v_anchor_day is null or new.next_payment_date is distinct from v_date
        then pg_catalog.date_part('day', new.next_payment_date)::smallint
      else v_anchor_day
    end;
  else
    -- A new row, or one that was one-time until now: the pre-APP-042 behaviour.
    new.recurrence_frequency := 'monthly';
    new.recurrence_anchor_day := pg_catalog.date_part('day', new.next_payment_date)::smallint;
  end if;

  return new;
end;
$$;

drop trigger if exists expenses_legacy_recurrence_defaults on public.expenses;
create trigger expenses_legacy_recurrence_defaults
  before insert or update on public.expenses
  for each row execute function public.expenses_legacy_recurrence_defaults();

-- 4. The canonical invariant, unchanged and strict: a one-time cost has neither
-- field, and a recurring cost has exactly one supported cadence and a 1–31 day
-- anchor. The NULL checks are explicit, because `recurrence_frequency in (...)` is
-- NULL rather than false for a NULL value and a CHECK only rejects false — without
-- them, a recurring row with no cadence would pass. Dropping first keeps this
-- migration re-runnable.
alter table public.expenses
  drop constraint if exists expenses_recurrence_frequency_coherent;
alter table public.expenses
  add constraint expenses_recurrence_frequency_coherent check (
    case
      when is_recurring
        then recurrence_frequency is not null
          and recurrence_frequency in ('monthly', 'quarterly', 'yearly')
          and recurrence_anchor_day is not null
          and recurrence_anchor_day between 1 and 31
      else recurrence_frequency is null and recurrence_anchor_day is null
    end
  );

-- 5. Comments.
comment on column public.expenses.recurrence_frequency is 'APP-042: NULL for one-time expenses; monthly/quarterly/yearly for recurring ones.';
comment on column public.expenses.recurrence_anchor_day is 'APP-042: NULL for one-time expenses; the 1-31 day the schedule is anchored to. A short month clamps one occurrence, never this anchor.';
comment on function public.expenses_legacy_recurrence_defaults() is 'APP-042 compatibility for the previous app version, which sends neither recurrence column. Normalizes writes whose recurrence columns are NULL on insert or unchanged on update; remove once old clients are no longer supported.';
