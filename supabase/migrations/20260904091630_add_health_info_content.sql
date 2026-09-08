create table if not exists public.symptom_glossary (
  id text primary key,
  name_da text not null,
  name_en text not null,
  description_da text not null,
  description_en text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.health_conditions (
  id text primary key,
  name_da text not null,
  name_en text not null,
  summary_da text not null,
  summary_en text not null,
  what_it_is_da text not null,
  what_it_is_en text not null,
  common_symptoms text[] not null default '{}',
  what_helps_da text not null,
  what_helps_en text not null,
  when_to_see_doctor_da text not null,
  when_to_see_doctor_en text not null,
  updated_at timestamptz not null default now()
);
alter table public.symptom_glossary enable row level security;
alter table public.health_conditions enable row level security;
-- Alle indloggede app-brugere kan læse (det er oplysningsindhold, ikke personlige data)
create policy "Authenticated users can read symptom glossary"
  on public.symptom_glossary for select to authenticated using (true);
create policy "Authenticated users can read health conditions"
  on public.health_conditions for select to authenticated using (true);
-- Kun admins kan oprette/redigere/slette
create policy "Admins can insert symptom glossary"
  on public.symptom_glossary for insert to authenticated
  with check (exists (select 1 from public.admin_users where id = auth.uid()));
create policy "Admins can update symptom glossary"
  on public.symptom_glossary for update to authenticated
  using (exists (select 1 from public.admin_users where id = auth.uid()))
  with check (exists (select 1 from public.admin_users where id = auth.uid()));
create policy "Admins can delete symptom glossary"
  on public.symptom_glossary for delete to authenticated
  using (exists (select 1 from public.admin_users where id = auth.uid()));
create policy "Admins can insert health conditions"
  on public.health_conditions for insert to authenticated
  with check (exists (select 1 from public.admin_users where id = auth.uid()));
create policy "Admins can update health conditions"
  on public.health_conditions for update to authenticated
  using (exists (select 1 from public.admin_users where id = auth.uid()))
  with check (exists (select 1 from public.admin_users where id = auth.uid()));
create policy "Admins can delete health conditions"
  on public.health_conditions for delete to authenticated
  using (exists (select 1 from public.admin_users where id = auth.uid()));
