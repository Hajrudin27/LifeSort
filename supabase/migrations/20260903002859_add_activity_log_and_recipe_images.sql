-- Aktivitetslog: append-only, ingen kan redigere eller slette egne (eller andres) log-linjer
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.admin_users(id),
  actor_name text not null,
  action text not null check (action in ('created', 'updated', 'deleted', 'replied', 'invited')),
  entity_type text not null check (entity_type in ('price', 'offer', 'recipe', 'ticket', 'timeline_event', 'admin_user')),
  entity_label text not null,
  created_at timestamptz not null default now()
);
alter table public.activity_log enable row level security;
create policy "Admins can view activity log"
  on public.activity_log for select
  to authenticated
  using (exists (select 1 from public.admin_users where id = auth.uid()));
create policy "Admins can insert activity log"
  on public.activity_log for insert
  to authenticated
  with check (exists (select 1 from public.admin_users where id = auth.uid()));
-- Billeder til opskrifter
alter table public.global_recipes add column if not exists image_url text;
insert into storage.buckets (id, name, public)
values ('recipe-images', 'recipe-images', true)
on conflict (id) do nothing;
create policy "Public can view recipe images"
  on storage.objects for select
  to public
  using (bucket_id = 'recipe-images');
create policy "Admins can upload recipe images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'recipe-images'
    and exists (select 1 from public.admin_users where id = auth.uid())
  );
create policy "Admins can delete recipe images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'recipe-images'
    and exists (select 1 from public.admin_users where id = auth.uid())
  );
