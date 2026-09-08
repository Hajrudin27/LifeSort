-- Sletning af egen konto.
--
-- Privatlivspolitikken lover retten til at blive glemt og siger, at samtykket til cyklusdata
-- kan trækkes tilbage "ved at slette dine data i appen". Den funktion fandtes ikke:
-- clearAllLocalData() i appen rydder kun lokal state ved log ud, og serverdata blev liggende.
--
-- Appen kender kun Supabase-URL'en — den har ingen adresse på web-API'et — så sletningen
-- ligger som en RPC, altså den kanal appen allerede taler igennem.
--
-- Alle 41 bruger-tabeller har ON DELETE CASCADE fra auth.users, så én sletning i auth.users
-- fjerner hele brugerens indhold i ét hug. Det er med vilje: en liste over tabeller i denne
-- funktion ville blive forældet i samme øjeblik der kom en ny tabel til.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- activity_log.actor_id peger på admin_users uden ON DELETE, så en admin med historik i
  -- revisionssporet kan ikke slettes: cascaden ville blive blokeret af den nøgle og fejle
  -- med en uforståelig databasefejl. Revisionssporet skal netop også overleve, at en admin
  -- forlader projektet, så adgangen fjernes i stedet manuelt i panelet.
  if exists (select 1 from public.admin_users where id = v_user_id) then
    raise exception 'admin_account';
  end if;

  -- Deltagerrækker hvor brugeren var VÆRT for en delt tur. Turen forsvinder med cascaden,
  -- men owner_id har ingen fremmednøgle, så rækkerne ville ellers blive liggende og pege
  -- på en tur der ikke findes.
  delete from public.trip_participants where owner_id = v_user_id;

  delete from auth.users where id = v_user_id;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
-- Cascaden fjerner rækkerne i public.attachments, men ikke selve filerne i storage: de
-- lever i deres eget lag og kan kun slettes gennem Storage-API'et (storage.protect_delete
-- afviser SQL-sletning, netop fordi rækken ellers ville forsvinde uden filen).
--
-- Målt: efter en kontosletning lå brugerens kvittering stadig i attachments-bucket'en.
--
-- Appen rydder sine egne filer inden den kalder delete_my_account(), men det er klientens
-- ansvar, og en klient kan dø midtvejs. Denne funktion udpeger de filer hvis ejer ikke
-- længere findes, så den daglige oprydning kan fjerne dem gennem Storage-API'et. Det er
-- den del der gør sletningen til en garanti frem for et forsøg.
create or replace function public.orphaned_attachment_paths(p_limit int default 500)
returns table (path text)
language sql
stable
security definer
set search_path = public, storage, auth, pg_temp
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'attachments'
    and not exists (
      -- Første mappe i stien ER bruger-id'et; det håndhæves af storage-policyen på upload.
      select 1
      from auth.users u
      where u.id::text = (storage.foldername(o.name))[1]
    )
  order by o.created_at
  limit greatest(1, least(p_limit, 1000));
$$;
revoke all on function public.orphaned_attachment_paths(int) from public, anon, authenticated;
grant execute on function public.orphaned_attachment_paths(int) to service_role;
