alter table public.timeline_events add column if not exists owners text[];
update public.timeline_events set owners = array[owner] where owners is null;
alter table public.timeline_events alter column owners set not null;
alter table public.timeline_events drop column owner;
alter table public.timeline_events add constraint timeline_events_owners_check
  check (owners <@ array['hajrudin', 'walid']::text[] and array_length(owners, 1) > 0);
