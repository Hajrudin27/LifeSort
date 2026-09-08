-- "Der skal altid være mindst én owner" håndhæves i dag kun i /api/admin/admins/update:
-- ruten tæller ownere og afviser handlingen, hvis der kun er én tilbage. Det er et
-- check-then-act: to samtidige degraderinger kan begge nå at tælle to ownere, før nogen af
-- dem skriver, og efterlade nul. Så er der ingen tilbage der kan invitere eller udpege en
-- ny owner, og adgangen skal genoprettes manuelt i databasen.
--
-- Reglen flyttes derfor derned hvor den kan håndhæves for alvor.

create or replace function public.ensure_owner_remains()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Uden låsen ville triggeren have præcis samme kapløb som koden: to transaktioner ville
  -- hver især se den andens owner som stadig gældende. Låsen holdes til transaktionen er
  -- færdig, så den anden må vente og ser den nye virkelighed.
  perform pg_advisory_xact_lock(hashtext('admin_users_owner_guard'));

  if exists (select 1 from public.admin_users)
     and not exists (select 1 from public.admin_users where role = 'owner') then
    raise exception 'Der skal altid være mindst én owner i admin_users';
  end if;

  return null;
end;
$$;
revoke all on function public.ensure_owner_remains() from public, anon, authenticated;
-- Kun UPDATE og DELETE kan fjerne den sidste owner. INSERT er udeladt med vilje, så en
-- tom tabel stadig kan få sin første række uden at rækkefølgen betyder noget.
drop trigger if exists admin_users_owner_remains on public.admin_users;
create trigger admin_users_owner_remains
  after update or delete on public.admin_users
  for each statement
  execute function public.ensure_owner_remains();
