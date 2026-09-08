-- APP-017 — eksplicit "onboarding fuldført" i stedet for at udlede det af alder.
--
-- Hidtil betød "brugeren er kommet igennem onboarding" i praksis "profiles.age
-- er ikke null". Alderen bliver ikke længere spurgt om — ingen funktion i appen
-- læser den — og så skal det, den utilsigtet var blevet til et bevis for, stå
-- for sig selv.
--
-- Bemærk: profiles-tabellen selv er ikke versionsstyret endnu (se
-- docs/app-inventory.md §8-F10). Migrationen her udvider en tabel, der allerede
-- findes i projektet, og forudsætter derfor at den er der.

alter table public.profiles
  add column if not exists onboarded_at timestamptz;

comment on column public.profiles.onboarded_at is
  'Hvornår brugeren fuldførte onboarding. Erstatter udledningen fra name+age (APP-017).';

-- Backfill: alle der allerede ER igennem, skal ikke sendes igennem igen. Det
-- gamle kriterium var navn + alder, så det er dét, der oversættes.
update public.profiles
   set onboarded_at = coalesce(onboarded_at, now())
 where onboarded_at is null
   and name is not null
   and name <> ''
   and age is not null;

-- Alderskolonnen bliver stående indtil videre. At droppe en kolonne sletter
-- brugerdata, og det er en beslutning, der skal træffes bevidst — ikke som en
-- sidegevinst ved en refaktorering. Appen holder op med at skrive til den her.
