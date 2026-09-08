create table if not exists public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_date date not null,
  status text not null default 'upcoming' check (status in ('upcoming', 'in_progress', 'done')),
  owner text not null default 'begge' check (owner in ('hajrudin', 'walid', 'begge')),
  created_at timestamptz not null default now()
);
alter table public.timeline_events enable row level security;
create policy "Admins can view timeline"
  on public.timeline_events for select
  to authenticated
  using (exists (select 1 from public.admin_users where id = auth.uid()));
create policy "Admins can insert timeline"
  on public.timeline_events for insert
  to authenticated
  with check (exists (select 1 from public.admin_users where id = auth.uid()));
create policy "Admins can update timeline"
  on public.timeline_events for update
  to authenticated
  using (exists (select 1 from public.admin_users where id = auth.uid()))
  with check (exists (select 1 from public.admin_users where id = auth.uid()));
create policy "Admins can delete timeline"
  on public.timeline_events for delete
  to authenticated
  using (exists (select 1 from public.admin_users where id = auth.uid()));
