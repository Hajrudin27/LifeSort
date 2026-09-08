-- Eksisterende "begge"-poster tildeles Hajrudin som standard.
-- Ret dem manuelt i admin-panelet bagefter, hvis nogen reelt hører til Walid.
update public.timeline_events set owner = 'hajrudin' where owner = 'begge';
alter table public.timeline_events drop constraint if exists timeline_events_owner_check;
alter table public.timeline_events add constraint timeline_events_owner_check check (owner in ('hajrudin', 'walid'));
