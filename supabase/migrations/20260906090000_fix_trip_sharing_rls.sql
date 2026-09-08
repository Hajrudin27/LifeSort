-- Sikkerhedsfix: deling af ture kunne misbruges til at læse/ændre andre brugeres data.
--
-- Tre huller i den oprindelige model:
--   A) INSERT-policyen på trip_participants tjekkede kun auth.uid() = owner_id, men IKKE
--      at turen faktisk tilhørte kalderen. Enhver indlogget bruger kunne indsætte
--      {trip_id: <fremmed tur>, owner_id: sig selv, user_id: sig selv} og derefter
--      sætte status = 'accepted'.
--   B) Den inviterede måtte opdatere HELE sin deltagerrække (kun user_id var låst), og
--      kunne dermed pege sin accepterede invitation over på en anden tur.
--   C) Deltager-policies matchede kun på trip_id. trips har PK (user_id, id) med et
--      klient-genereret tekst-id, så to brugere kan have samme id. En angriber kunne
--      oprette sin egen tur med offerets tur-id og få adgang via kollisionen — det ville
--      omgå en fix af (A) alene.
--
-- En "tur" identificeres derfor herefter altid af parret (trip_id, ejerens user_id).

-- Hjælpefunktion: må jeg (auth.uid()) se en række der hører til turen p_trip_id og er
-- skrevet af p_author? Ja, hvis der findes en tur med det id, hvor jeg er accepteret
-- deltager, og forfatteren enten er turens ejer eller en anden accepteret deltager.
--
-- SECURITY DEFINER er nødvendig: opslaget skal kunne se ANDRE deltageres rækker, hvilket
-- RLS på trip_participants ellers skjuler. search_path er låst, så funktionen ikke kan
-- kapres via en fremmed schema-sti.
create or replace function public.can_access_trip_row(p_trip_id text, p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.trips t
    join public.trip_participants me
      on me.trip_id = t.id
     and me.owner_id = t.user_id
     and me.user_id = auth.uid()
     and me.status = 'accepted'
    where t.id = p_trip_id
      and (
        p_author = t.user_id
        or exists (
          select 1
          from public.trip_participants other
          where other.trip_id = t.id
            and other.owner_id = t.user_id
            and other.user_id = p_author
            and other.status = 'accepted'
        )
      )
  );
$$;
revoke all on function public.can_access_trip_row(text, uuid) from public, anon;
grant execute on function public.can_access_trip_row(text, uuid) to authenticated;
-- (A) Man må kun invitere til ture man selv ejer, og man kan ikke selv skrive at en ANDEN
--     bruger har accepteret. Uden det sidste krav kunne en angriber oprette en tur med
--     samme id som offerets (jf. C) og dertil fabrikere to "accepterede" deltagerrækker
--     — sig selv og offeret — og derved alligevel få adgang til offerets rækker.
--     Kun den inviterede selv kan sætte status til 'accepted' (se B).
drop policy if exists "Owners can invite participants to their trips" on public.trip_participants;
create policy "Owners can invite participants to their trips"
  on public.trip_participants
  for insert
  to authenticated
  with check (
    auth.uid() = owner_id
    and exists (
      select 1 from public.trips t
      where t.id = trip_id and t.user_id = auth.uid()
    )
    and (status = 'pending' or user_id = auth.uid())
  );
-- (B) En inviteret må kun svare på invitationen — ikke flytte den til en anden tur.
--     RLS kan ikke sammenligne med den gamle række, så vi begrænser på kolonneniveau.
revoke update on public.trip_participants from anon, authenticated;
grant update (status) on public.trip_participants to authenticated;
-- (C) Deling bindes til (trip_id, ejer) i stedet for kun trip_id.
drop policy if exists "Participants can view shared trips" on public.trips;
create policy "Participants can view shared trips"
  on public.trips
  for select
  to authenticated
  using (public.can_access_trip_row(id, user_id));
drop policy if exists "Participants can update shared trips" on public.trips;
create policy "Participants can update shared trips"
  on public.trips
  for update
  to authenticated
  using (public.can_access_trip_row(id, user_id))
  with check (public.can_access_trip_row(id, user_id));
drop policy if exists "Participants can view shared trip expenses" on public.trip_expenses;
create policy "Participants can view shared trip expenses"
  on public.trip_expenses
  for select
  to authenticated
  using (public.can_access_trip_row(trip_id, user_id));
drop policy if exists "Participants can insert shared trip expenses" on public.trip_expenses;
create policy "Participants can insert shared trip expenses"
  on public.trip_expenses
  for insert
  to authenticated
  with check (public.can_access_trip_row(trip_id, user_id));
drop policy if exists "Participants can update shared trip expenses" on public.trip_expenses;
create policy "Participants can update shared trip expenses"
  on public.trip_expenses
  for update
  to authenticated
  using (public.can_access_trip_row(trip_id, user_id))
  with check (public.can_access_trip_row(trip_id, user_id));
drop policy if exists "Participants can delete shared trip expenses" on public.trip_expenses;
create policy "Participants can delete shared trip expenses"
  on public.trip_expenses
  for delete
  to authenticated
  using (public.can_access_trip_row(trip_id, user_id));
drop policy if exists "Participants can view shared packing items" on public.trip_packing_items;
create policy "Participants can view shared packing items"
  on public.trip_packing_items
  for select
  to authenticated
  using (public.can_access_trip_row(trip_id, user_id));
drop policy if exists "Participants can insert shared packing items" on public.trip_packing_items;
create policy "Participants can insert shared packing items"
  on public.trip_packing_items
  for insert
  to authenticated
  with check (public.can_access_trip_row(trip_id, user_id));
drop policy if exists "Participants can update shared packing items" on public.trip_packing_items;
create policy "Participants can update shared packing items"
  on public.trip_packing_items
  for update
  to authenticated
  using (public.can_access_trip_row(trip_id, user_id))
  with check (public.can_access_trip_row(trip_id, user_id));
drop policy if exists "Participants can delete shared packing items" on public.trip_packing_items;
create policy "Participants can delete shared packing items"
  on public.trip_packing_items
  for delete
  to authenticated
  using (public.can_access_trip_row(trip_id, user_id));
-- (D) invite_trip_participant() er SECURITY DEFINER og omgår derfor RLS fuldstændigt.
--     Den tjekkede ikke, at turen tilhørte kalderen, så enhver bruger kunne invitere en
--     konto de selv kontrollerede til en VILKÅRLIG tur og derefter acceptere invitationen
--     fra den konto. Det var den letteste vej til en anden brugers rejsedata, og den gik
--     uden om alle policies ovenfor.
--
--     Samtidig: funktionen var kørbar for 'anon' og manglede en låst search_path.
create or replace function public.invite_trip_participant (
  p_trip_id text,
  p_email   text
)
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
  as $function$
declare
  v_user_id uuid;
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Man må kun invitere til sine EGNE ture. Tjekket ligger før email-opslaget, så
  -- funktionen ikke kan bruges som "findes denne email som bruger?"-orakel af nogen
  -- der ikke selv har oprettet en tur.
  if not exists (
    select 1 from public.trips t
    where t.id = p_trip_id and t.user_id = v_owner_id
  ) then
    raise exception 'trip_not_found';
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = lower(btrim(p_email))
  limit 1;

  if v_user_id is null then
    raise exception 'no_account_found';
  end if;

  if v_user_id = v_owner_id then
    raise exception 'cannot_invite_self';
  end if;

  -- Altid 'pending': kun den inviterede selv kan acceptere.
  insert into public.trip_participants (trip_id, owner_id, user_id, invited_email, status)
  values (p_trip_id, v_owner_id, v_user_id, btrim(p_email), 'pending')
  on conflict (trip_id, user_id) do nothing;
end;
$function$;
revoke all on function public.invite_trip_participant(text, text) from public, anon;
grant execute on function public.invite_trip_participant(text, text) to authenticated;
-- (E) Tur-id'er er genereret i appen som `${Date.now()}-${random}` og er derfor IKKE
--     globalt unikke. trip_expenses/trip_packing_items bærer kun trip_id — ikke hvilken
--     ejer turen hører til — så to brugere med samme tur-id deler rækker. Uden dette
--     indeks kan en angriber oprette en tur med offerets id, invitere offeret, og hvis
--     offeret accepterer, læse offerets EGNE rækker med det id.
--     Et globalt unikt id lukker hele den klasse af angreb.
do $$
declare
  dup text;
begin
  select string_agg(id, ', ') into dup
  from (select id from public.trips group by id having count(*) > 1 limit 10) d;

  if dup is not null then
    raise exception
      'Kan ikke gøre trips.id unikt: følgende id''er findes hos flere brugere: %. Ret dem først.', dup;
  end if;
end $$;
create unique index if not exists trips_id_globally_unique on public.trips (id);
-- Ryd op i data skabt af hullerne: deltagerrækker der peger på en tur, som den anførte
-- ejer ikke ejer, kan aldrig være legitime.
delete from public.trip_participants p
where not exists (
  select 1 from public.trips t
  where t.id = p.trip_id and t.user_id = p.owner_id
);
