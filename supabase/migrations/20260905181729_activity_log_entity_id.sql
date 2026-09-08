alter table public.activity_log add column if not exists entity_id text;
create index if not exists activity_log_entity_lookup on public.activity_log (entity_type, entity_id);
