alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log
  add constraint activity_log_action_check
  check (action in ('created', 'updated', 'deleted', 'replied', 'invited', 'confirmed'));
alter table public.activity_log drop constraint if exists activity_log_entity_type_check;
alter table public.activity_log
  add constraint activity_log_entity_type_check
  check (entity_type in ('price', 'offer', 'recipe', 'ticket', 'timeline_event', 'admin_user', 'waitlist_signup'));
create index if not exists activity_log_created_at_idx on public.activity_log (created_at desc);
create index if not exists activity_log_actor_lookup_idx on public.activity_log (actor_name, created_at desc);
