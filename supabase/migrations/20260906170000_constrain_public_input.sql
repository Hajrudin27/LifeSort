-- Grænser på det brugere kan skrive ind, håndhævet i databasen.
--
-- Ruterne validerer nu længde og format, men de er også det eneste sted det sker. Går der
-- noget galt i en rute — en ny endpoint, en refaktorering — er der ellers intet der fanger
-- det. Det her er nettet under: en besked på flere megabyte eller en "emailadresse" med
-- linjeskift kommer ikke i tabellen, uanset hvilken vej den kommer fra.
--
-- Alle tilføjes NOT VALID: eksisterende rækker efterlades urørt (de kan ikke laves om med
-- tilbagevirkende kraft), mens alt nyt og alt der opdateres skal overholde dem.

alter table public.support_tickets
  drop constraint if exists support_tickets_name_length,
  drop constraint if exists support_tickets_email_length,
  drop constraint if exists support_tickets_email_shape,
  drop constraint if exists support_tickets_subject_length,
  drop constraint if exists support_tickets_message_length;
alter table public.support_tickets
  add constraint support_tickets_name_length    check (char_length(name) between 1 and 120) not valid,
  add constraint support_tickets_email_length   check (char_length(email) between 3 and 254) not valid,
  add constraint support_tickets_email_shape    check (email !~ '[[:space:]]' and email like '%@%') not valid,
  add constraint support_tickets_subject_length check (char_length(subject) between 1 and 200) not valid,
  add constraint support_tickets_message_length check (char_length(message) between 1 and 5000) not valid;
alter table public.waitlist_signups
  drop constraint if exists waitlist_signups_email_length,
  drop constraint if exists waitlist_signups_email_shape;
alter table public.waitlist_signups
  add constraint waitlist_signups_email_length check (char_length(email) between 3 and 254) not valid,
  add constraint waitlist_signups_email_shape  check (email !~ '[[:space:]]' and email like '%@%') not valid;
