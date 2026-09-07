-- APP-010 — brugerens valg af moduler.
--
-- I modsætning til module_flags (APP-006), som er operatørens og fælles for
-- alle, hører de her rækker til én bruger. Derfor RLS på ejerskab, og derfor
-- cascade fra auth.users: valget skal forsvinde med kontoen.
--
-- Én række pr. modul frem for ét array, så to enheder kan ændre hvert sit modul
-- uden at overskrive hinandens svar.

create table if not exists public.user_modules (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  module_id   text        not null,
  enabled     boolean     not null,
  updated_at  timestamptz not null default now(),

  primary key (user_id, module_id),

  -- Skallen og kontoen kan ikke fravælges. Slog man dem fra, ville brugeren
  -- være låst ude af sine egne indstillinger — og af sletningen af sin konto.
  -- Klienten afviser det også selv; det her er andet lag.
  constraint user_modules_not_platform
    check (module_id not in ('core-shell', 'account'))
);

comment on table public.user_modules is
  'Brugerens til/fra-valg pr. modul. At slå fra skjuler; det sletter aldrig data.';

alter table public.user_modules enable row level security;

drop policy if exists user_modules_owner_select on public.user_modules;
create policy user_modules_owner_select
  on public.user_modules for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_modules_owner_insert on public.user_modules;
create policy user_modules_owner_insert
  on public.user_modules for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_modules_owner_update on public.user_modules;
create policy user_modules_owner_update
  on public.user_modules for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_modules_owner_delete on public.user_modules;
create policy user_modules_owner_delete
  on public.user_modules for delete to authenticated
  using (auth.uid() = user_id);

revoke all on public.user_modules from anon, authenticated;
grant select, insert, update, delete on public.user_modules to authenticated;
