-- Lås søgestien i handle_new_user.
--
-- Funktionen var den sidste SECURITY DEFINER uden `set search_path`. Uden den afgøres
-- opslaget af navne af den search_path, kaldet kommer med, mens kroppen kører med
-- definerens rettigheder — altså den vej, Supabases egen linter flager som
-- function_search_path_mutable.
--
-- Udnyttelsen er svær her: indsættelsen er allerede skemakvalificeret (public.profiles),
-- og standardgrants lader ikke `authenticated` oprette objekter i public. Men funktionen
-- kører som definer ved hver eneste oprettelse af en bruger, og de øvrige seks definer-
-- funktioner har fået søgestien låst — invite_trip_participant fik præcis denne rettelse i
-- 20260906090000_fix_trip_sharing_rls.sql. Denne blev ikke taget med dengang.
--
-- pg_temp står til sidst med vilje: står det først, kan en midlertidig tabel skygge for et
-- rigtigt navn.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, name, age, gender)
  values (
    new.id,
    new.raw_user_meta_data->>'name',
    (new.raw_user_meta_data->>'age')::integer,
    coalesce(new.raw_user_meta_data->>'gender', 'unspecified')
  );
  return new;
end;
$$;
