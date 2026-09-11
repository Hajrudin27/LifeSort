-- APP-033 / ADR-0028. Apply only through a separately reviewed deployment.
-- One atomic baseline: old client-supplied timestamps are not trusted history.
begin;
alter table public.user_modules
  add column revision bigint not null default 1 check (revision > 0);
update public.user_modules set updated_at = statement_timestamp();

comment on column public.user_modules.revision is
  'Server-owned per-row version: baseline/insert 1, every accepted UPDATE adds 1. Replays do not write.';
comment on column public.user_modules.updated_at is
  'Server-owned version write time, strictly increasing per surviving row; not a conflict policy or commit timestamp.';

create function public.stamp_user_module_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    NEW.revision := 1;
    NEW.updated_at := pg_catalog.clock_timestamp();
  else
    -- Ignore both supplied metadata fields, including legacy client clocks.
    -- Overflow aborts the write rather than wrapping a long-lived row's version.
    NEW.revision := OLD.revision + 1;
    NEW.updated_at := greatest(pg_catalog.clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  end if;
  return NEW;
end;
$$;
revoke all on function public.stamp_user_module_revision()
  from public, anon, authenticated, service_role;

-- Covers direct INSERT/UPDATE/UPSERT and APP-032's existing domain UPSERT.
-- Its receipt replay branch never reaches this trigger. No RPC/grant/RLS changes.
create trigger user_modules_revision
before insert or update on public.user_modules
for each row execute function public.stamp_user_module_revision();
commit;
