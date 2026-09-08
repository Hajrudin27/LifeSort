-- APP-006 — kill switches for moduler.
--
-- Et fejlramt modul skal kunne stoppes uden en ny store-udgivelse. Tabellen er
-- global læse-indhold (dataprofil D i specifikationen §5.1): den hører ikke til
-- en bruger, alle læser den samme række, og kun serveren må skrive.
--
-- Bemærk: det her er repoets FØRSTE migration. Skemaet har hidtil kun levet i
-- Supabase-projektet (se docs/app-inventory.md §8-F10). Tabellen herunder er
-- derfor den eneste, der er versionsstyret; resten skal hentes ned som en
-- baseline-migration i APP-141.

create table if not exists public.module_flags (
  module_id     text primary key,
  availability  text        not null,
  note          text,
  updated_at    timestamptz not null default now(),

  -- En stavefejl må ikke kunne udgives. Værdierne skal matche
  -- MODULE_AVAILABILITY_STATES i core/modules/moduleAvailability.ts.
  constraint module_flags_availability_valid
    check (availability in ('hidden', 'internal', 'beta', 'available', 'maintenance', 'retired')),

  -- core-shell og account ER appen. Slog man dem fra, ville brugeren være låst
  -- ude af sine egne data — og af sletningen af sin konto. Klienten afviser det
  -- også selv; det her er andet lag.
  constraint module_flags_not_platform
    check (module_id not in ('core-shell', 'account'))
);

comment on table public.module_flags is
  'Operator kill switches per modul. Kun servicerollen skriver; alle læser.';

alter table public.module_flags enable row level security;

-- Læsning er åben, også uden login: et flag er ikke brugerdata, og appen skal
-- kunne finde ud af at et modul er lukket, før nogen når at logge ind.
drop policy if exists module_flags_read_all on public.module_flags;
create policy module_flags_read_all
  on public.module_flags
  for select
  to anon, authenticated
  using (true);

-- Ingen insert/update/delete-policy. Uden en policy kan hverken anon eller
-- authenticated skrive — kun service_role, der går uden om RLS. Skrivning sker
-- fra admin-fladen, aldrig fra appen.
revoke all on public.module_flags from anon, authenticated;
grant select on public.module_flags to anon, authenticated;
