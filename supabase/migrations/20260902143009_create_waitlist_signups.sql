create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  unique (email, platform)
);
alter table public.waitlist_signups enable row level security;
create policy "Anyone can join the waitlist"
  on public.waitlist_signups
  for insert
  to anon, authenticated
  with check (true);
create policy "Admins can view waitlist"
  on public.waitlist_signups
  for select
  to authenticated
  using (exists (select 1 from public.admin_users where id = auth.uid()));
