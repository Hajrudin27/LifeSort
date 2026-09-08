create table if not exists public.attachments (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_type text not null check (owner_type in ('warranty', 'expense')),
  owner_id text not null,
  storage_path text not null,
  name text not null,
  kind text not null check (kind in ('image', 'document')),
  created_at timestamptz not null default now()
);
alter table public.attachments enable row level security;
create policy "Users can view own attachments"
  on public.attachments for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert own attachments"
  on public.attachments for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can delete own attachments"
  on public.attachments for delete to authenticated using (auth.uid() = user_id);
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;
create policy "Users can upload own attachment files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can view own attachment files"
  on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can delete own attachment files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
