alter table public.global_recipes add column if not exists published boolean not null default true;
-- Tilføjes først med default true, så EKSISTERENDE tilmeldinger (fra før denne funktion
-- fandtes) automatisk markeres som bekræftede — de blev jo aldrig bedt om at bekræfte noget.
alter table public.waitlist_signups add column if not exists confirmed boolean not null default true;
alter table public.waitlist_signups add column if not exists confirm_token uuid not null default gen_random_uuid();
-- Først NU skiftes standardværdien, så alle NYE tilmeldinger fremover starter ubekræftede,
-- indtil de klikker linket i bekræftelsesmailen.
alter table public.waitlist_signups alter column confirmed set default false;
