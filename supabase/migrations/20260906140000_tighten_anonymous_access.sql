-- Strammer hvad en uautentificeret klient kan gøre med den offentlige anon-nøgle.
-- Nøglen ligger i både web-bundlen og mobil-appen, så den skal betragtes som offentligt
-- kendt: alt hvad 'anon' må, må enhver på internettet.

-- 1) Venteliste: policyen lod anon indsætte vilkårlige rækker direkte i tabellen og dermed
--    gå uden om /api/join-waitlist's rate limit og honeypot — og sætte confirmed/confirm_token
--    selv. Policyen er allerede fjernet manuelt i produktion, men stod stadig i migrationerne,
--    så den ville komme igen ved enhver genopbygning af databasen. Tilmeldinger oprettes
--    udelukkende af API-ruten med service role-nøglen.
drop policy if exists "Anyone can join the waitlist" on public.waitlist_signups;
-- 2) Det admin-kuraterede madkatalog var læsbart for anon. Appen henter først disse data
--    efter login (useFoodStore.fetchFromSupabase returnerer tidligt uden en bruger), og
--    hjemmesiden læser dem slet ikke — så der er ingen grund til at lade hele pris- og
--    opskriftsdatabasen kunne hentes af enhver med anon-nøglen.
--    products var i forvejen begrænset til 'authenticated'; det her gør resten konsistent.
drop policy if exists "Anyone can view global prices" on public.global_standard_prices;
create policy "Authenticated users can view global prices"
  on public.global_standard_prices for select
  to authenticated
  using (true);
drop policy if exists "Anyone can view global offers" on public.global_offers;
create policy "Authenticated users can view global offers"
  on public.global_offers for select
  to authenticated
  using (true);
drop policy if exists "Anyone can view global recipes" on public.global_recipes;
create policy "Authenticated users can view global recipes"
  on public.global_recipes for select
  to authenticated
  using (true);
