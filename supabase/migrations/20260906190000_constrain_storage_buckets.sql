-- Serverside-grænser på upload.
--
-- Type- og størrelsestjek fandtes kun i browseren (app/admin/.../food/recipes/page.tsx),
-- og en browserkontrol er kun en hjælp til den ærlige bruger — den ligger på angriberens
-- egen maskine. Storage-policyen tjekkede kun bucket og rolle, ikke hvad der blev lagt op.
--
-- Målt før dette fix kunne en 'editor' lægge en SVG med et indlejret <script> i den
-- OFFENTLIGE recipe-images-bucket. Supabase serverer den med image/svg+xml, så scriptet
-- kører når URL'en åbnes — og filen ligger frit tilgængelig på et domæne der ser ud til at
-- høre til LifeSort. En 12 MB-fil gik også igennem, selvom klienten sagde 10 MB.
--
-- SVG er bevidst udeladt af listen: det er det eneste billedformat der kan indeholde
-- eksekverbart indhold, og appen bruger det ikke. Klienten komprimerer i forvejen alt til
-- JPEG; png og webp er med, fordi de kan vælges før komprimering.
update storage.buckets
set
  file_size_limit = 10 * 1024 * 1024,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'recipe-images';
-- attachments er privat med en mappe pr. bruger, og appen lader med vilje brugeren
-- vedhæfte vilkårlige dokumenttyper (kvitteringer, garantibeviser). Derfor kun en
-- størrelsesgrænse: uden den kan enhver indlogget bruger fylde jeres storage-kvote.
-- 25 MB er rigeligt til et foto eller en PDF; hæv den her hvis I møder en reel grænse.
update storage.buckets
set file_size_limit = 25 * 1024 * 1024
where id = 'attachments';
-- Grænserne gælder kun fremadrettet: filer der allerede ligger i bucket'en bliver ikke
-- rørt. Her advares der blot, hvis der er noget der ikke ville være tilladt i dag — så
-- kan I selv se på det i Supabase Storage frem for at få det slettet under jer.
do $$
declare
  afvigende int;
begin
  select count(*) into afvigende
  from storage.objects
  where bucket_id = 'recipe-images'
    and coalesce(metadata->>'mimetype', '') not in ('image/jpeg', 'image/png', 'image/webp');

  if afvigende > 0 then
    raise warning 'recipe-images indeholder % fil(er) der ikke er jpeg/png/webp. Gennemgå dem i Supabase Storage.', afvigende;
  end if;
end $$;
