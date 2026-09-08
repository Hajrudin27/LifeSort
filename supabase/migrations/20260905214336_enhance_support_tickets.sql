alter table public.support_tickets
  add column if not exists priority text not null default 'normal',
  add column if not exists category text not null default 'general',
  add column if not exists internal_note text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.support_tickets drop constraint if exists support_tickets_priority_check;
alter table public.support_tickets
  add constraint support_tickets_priority_check
  check (priority in ('low', 'normal', 'high', 'urgent'));
alter table public.support_tickets drop constraint if exists support_tickets_category_check;
alter table public.support_tickets
  add constraint support_tickets_category_check
  check (category in ('general', 'bug', 'billing', 'feature', 'account'));
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.support_tickets'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.support_tickets drop constraint if exists %I', constraint_name);
  end loop;
end $$;
alter table public.support_tickets
  add constraint support_tickets_status_check
  check (status in ('open', 'waiting', 'answered', 'closed'));
create index if not exists support_tickets_priority_idx on public.support_tickets (priority);
create index if not exists support_tickets_category_idx on public.support_tickets (category);
create index if not exists support_tickets_updated_at_idx on public.support_tickets (updated_at desc);
