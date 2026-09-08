-- Rollebaseret adgangskontrol for admin-panelet.
--
-- admin_users.role har hidtil kun været dekoration: den blev vist i UI'et, men ingen
-- policy og ingen kode kiggede på den. Alle 27 admin-policies spurgte blot "står du i
-- admin_users?", så en 'support'-admin kunne redigere priser, opskrifter og tidslinje —
-- og fordi admin-panelet skriver direkte fra browseren med anon-nøglen, kunne det gøres
-- ved at kalde Supabase' REST-API udenom UI'et.
--
-- Modellen er streng least-privilege:
--   owner    alt
--   editor   indhold: priser, tilbud, produkter, opskrifter, sundhedsindhold, tidslinje
--   support  kundedata: supportsager og venteliste
-- Aktivitetsloggen kan læses og skrives af alle admins — den er deres fælles revisionsspor.

-- Rolletjek ét sted, så en ændring i modellen ikke kræver 27 policy-rettelser.
-- SECURITY INVOKER er tilstrækkeligt: admin_users har en SELECT-policy der lader en bruger
-- læse sin egen række, og det er præcis den række opslaget rammer.
create or replace function public.admin_has_role(p_roles text[])
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.id = auth.uid()
      and a.role = any(p_roles)
  );
$$;
revoke all on function public.admin_has_role(text[]) from public, anon;
grant execute on function public.admin_has_role(text[]) to authenticated;
-- global_standard_prices
drop policy if exists "Admins can insert global prices" on public.global_standard_prices;
create policy "Admins can insert global prices"
  on public.global_standard_prices
  for insert
  to authenticated
  with check (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can update global prices" on public.global_standard_prices;
create policy "Admins can update global prices"
  on public.global_standard_prices
  for update
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]))
  with check (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can delete global prices" on public.global_standard_prices;
create policy "Admins can delete global prices"
  on public.global_standard_prices
  for delete
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]));
-- global_offers
drop policy if exists "Admins can insert global offers" on public.global_offers;
create policy "Admins can insert global offers"
  on public.global_offers
  for insert
  to authenticated
  with check (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can update global offers" on public.global_offers;
create policy "Admins can update global offers"
  on public.global_offers
  for update
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]))
  with check (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can delete global offers" on public.global_offers;
create policy "Admins can delete global offers"
  on public.global_offers
  for delete
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]));
-- products
drop policy if exists "Admins can insert products" on public.products;
create policy "Admins can insert products"
  on public.products
  for insert
  to authenticated
  with check (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can update products" on public.products;
create policy "Admins can update products"
  on public.products
  for update
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]))
  with check (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can delete products" on public.products;
create policy "Admins can delete products"
  on public.products
  for delete
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]));
-- global_recipes
drop policy if exists "Admins can insert global recipes" on public.global_recipes;
create policy "Admins can insert global recipes"
  on public.global_recipes
  for insert
  to authenticated
  with check (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can update global recipes" on public.global_recipes;
create policy "Admins can update global recipes"
  on public.global_recipes
  for update
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]))
  with check (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can delete global recipes" on public.global_recipes;
create policy "Admins can delete global recipes"
  on public.global_recipes
  for delete
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]));
-- health_conditions
drop policy if exists "Admins can insert health conditions" on public.health_conditions;
create policy "Admins can insert health conditions"
  on public.health_conditions
  for insert
  to authenticated
  with check (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can update health conditions" on public.health_conditions;
create policy "Admins can update health conditions"
  on public.health_conditions
  for update
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]))
  with check (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can delete health conditions" on public.health_conditions;
create policy "Admins can delete health conditions"
  on public.health_conditions
  for delete
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]));
-- symptom_glossary
drop policy if exists "Admins can insert symptom glossary" on public.symptom_glossary;
create policy "Admins can insert symptom glossary"
  on public.symptom_glossary
  for insert
  to authenticated
  with check (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can update symptom glossary" on public.symptom_glossary;
create policy "Admins can update symptom glossary"
  on public.symptom_glossary
  for update
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]))
  with check (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can delete symptom glossary" on public.symptom_glossary;
create policy "Admins can delete symptom glossary"
  on public.symptom_glossary
  for delete
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]));
-- timeline_events
drop policy if exists "Admins can view timeline" on public.timeline_events;
create policy "Admins can view timeline"
  on public.timeline_events
  for select
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can insert timeline" on public.timeline_events;
create policy "Admins can insert timeline"
  on public.timeline_events
  for insert
  to authenticated
  with check (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can update timeline" on public.timeline_events;
create policy "Admins can update timeline"
  on public.timeline_events
  for update
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]))
  with check (public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can delete timeline" on public.timeline_events;
create policy "Admins can delete timeline"
  on public.timeline_events
  for delete
  to authenticated
  using (public.admin_has_role(array['owner','editor']::text[]));
-- support_tickets
drop policy if exists "Admins can view tickets" on public.support_tickets;
create policy "Admins can view tickets"
  on public.support_tickets
  for select
  to authenticated
  using (public.admin_has_role(array['owner','support']::text[]));
drop policy if exists "Admins can update tickets" on public.support_tickets;
create policy "Admins can update tickets"
  on public.support_tickets
  for update
  to authenticated
  using (public.admin_has_role(array['owner','support']::text[]))
  with check (public.admin_has_role(array['owner','support']::text[]));
-- waitlist_signups
drop policy if exists "Admins can view waitlist" on public.waitlist_signups;
create policy "Admins can view waitlist"
  on public.waitlist_signups
  for select
  to authenticated
  using (public.admin_has_role(array['owner','support']::text[]));
-- Opskriftsbilleder i storage følger indholdsrollerne.
drop policy if exists "Admins can upload recipe images" on storage.objects;
create policy "Admins can upload recipe images"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'recipe-images' and public.admin_has_role(array['owner','editor']::text[]));
drop policy if exists "Admins can delete recipe images" on storage.objects;
create policy "Admins can delete recipe images"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'recipe-images' and public.admin_has_role(array['owner','editor']::text[]));
