-- APP-061 / ADR-0049. Additive Home-task canonical sync.
-- Local file only: remote deployment requires a separate reviewed operation.
begin;

alter table public.household_tasks
  add column if not exists time_zone text,
  add column if not exists revision bigint not null default 1,
  add column if not exists updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  add column if not exists deleted_at timestamptz;

comment on column public.household_tasks.time_zone is
  'Fixed IANA recurrence zone. NULL is explicit legacy device-local semantics.';
comment on column public.household_tasks.revision is
  'Server-owned version: insert 1; each accepted active domain update or deletion advances once.';
comment on column public.household_tasks.deleted_at is
  'Server-owned retained tombstone. NULL means active; account deletion may cascade physically.';

-- Home-task mutation is RPC-only. Reads include the caller's tombstones so the
-- client can reconcile explicit deletion; presentation filters them out.
revoke all on table public.household_tasks from public, anon, authenticated;
grant select on table public.household_tasks to authenticated;
drop policy if exists "Users can delete their own household tasks" on public.household_tasks;
drop policy if exists "Users can insert their own household tasks" on public.household_tasks;
drop policy if exists "Users can update their own household tasks" on public.household_tasks;
drop policy if exists "Users can view their own household tasks" on public.household_tasks;
create policy household_tasks_owner_select on public.household_tasks
  for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create or replace function public.stamp_household_task_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    NEW.revision := 1;
    NEW.updated_at := pg_catalog.clock_timestamp();
    NEW.deleted_at := null;
  else
    if OLD.deleted_at is not null then
      raise sqlstate 'PT409' using message = 'entity_deleted';
    end if;
    if NEW.user_id is distinct from OLD.user_id or NEW.id is distinct from OLD.id
      or NEW.created_at is distinct from OLD.created_at
      or NEW.time_zone is distinct from OLD.time_zone
      or NEW.kind is distinct from OLD.kind
    then
      raise sqlstate 'PT400' using message = 'immutable_task_field';
    end if;
    NEW.revision := OLD.revision + 1;
    NEW.updated_at := greatest(pg_catalog.clock_timestamp(), OLD.updated_at + interval '1 microsecond');
    if NEW.deleted_at is not null then NEW.deleted_at := NEW.updated_at; end if;
  end if;
  return NEW;
end;
$$;
revoke all on function public.stamp_household_task_revision()
  from public, anon, authenticated, service_role;

drop trigger if exists household_tasks_server_metadata on public.household_tasks;
create trigger household_tasks_server_metadata
before insert or update on public.household_tasks
for each row execute function public.stamp_household_task_revision();

-- Seven arguments deliberately form a separate overload. The existing six-
-- argument APP-032 module-choice contract and its fingerprints remain unchanged.
create function public.apply_sync_mutation(
  p_mutation_id text,
  p_data_domain text,
  p_entity_type text,
  p_entity_id text,
  p_operation text,
  p_payload jsonb,
  p_base_revision bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_mutation_id uuid;
  v_fingerprint bytea;
  v_existing bytea;
  v_task jsonb;
  v_action text;
  v_row public.household_tasks%rowtype;
  v_time_zone text;
  v_created_at timestamptz;
  v_last_done date;
  v_completed_on date;
begin
  if v_user_id is null or not exists (select 1 from auth.users where id = v_user_id) then
    raise sqlstate 'PT401' using message = 'not_authenticated';
  end if;
  if p_mutation_id is null or p_mutation_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    -- UUIDs, plus pre-APP-030 legacy task IDs (`${Date.now()}-${random}`) already stored.
    or p_entity_id is null
    or p_entity_id !~* '^([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9]{13}-[0-9]{1,7})$'
    or p_data_domain is distinct from 'home.household'
    or p_entity_type is distinct from 'home-task'
    or p_operation is null or p_operation not in ('upsert', 'delete')
  then
    raise sqlstate 'PT400' using message = 'invalid_mutation';
  end if;
  v_mutation_id := p_mutation_id::uuid;
  v_fingerprint := pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(2, p_data_domain, p_entity_type, p_entity_id,
      p_operation, p_payload, p_base_revision)::text, 'UTF8'));

  insert into public.mutation_receipts (user_id, mutation_id, fingerprint)
  values (v_user_id, v_mutation_id, v_fingerprint)
  on conflict (user_id, mutation_id) do nothing;
  if not found then
    select fingerprint into v_existing from public.mutation_receipts
    where user_id = v_user_id and mutation_id = v_mutation_id;
    if v_existing is distinct from v_fingerprint then
      raise sqlstate 'PT409' using message = 'mutation_id_conflict';
    end if;
    return 'replayed';
  end if;

  if p_operation = 'delete' then
    if p_payload is not null and p_payload <> 'null'::jsonb then
      raise sqlstate 'PT400' using message = 'invalid_mutation';
    end if;
    select * into v_row from public.household_tasks
      where user_id = v_user_id and id = p_entity_id for update;
    if not found then raise sqlstate 'PT422' using message = 'mutation_rejected'; end if;
    if v_row.deleted_at is not null then return 'applied'; end if;
    if p_base_revision is null or p_base_revision is distinct from v_row.revision then
      raise sqlstate 'PT409' using message = 'stale_revision';
    end if;
    update public.household_tasks set deleted_at = pg_catalog.clock_timestamp()
      where user_id = v_user_id and id = p_entity_id;
    return 'applied';
  end if;

  if pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_payload -> 'action') is distinct from 'string'
  then
    raise sqlstate 'PT400' using message = 'invalid_mutation';
  end if;
  v_action := p_payload ->> 'action';

  if v_action = 'complete' then
    if (p_payload - 'action' - 'completedOn') <> '{}'::jsonb
      or not (p_payload ?& array['action','completedOn'])
      or (p_payload ->> 'completedOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    then raise sqlstate 'PT400' using message = 'invalid_mutation'; end if;
    v_completed_on := (p_payload ->> 'completedOn')::date;
    if pg_catalog.to_char(v_completed_on, 'YYYY-MM-DD') <> p_payload ->> 'completedOn' then
      raise sqlstate 'PT400' using message = 'invalid_mutation';
    end if;
    select * into v_row from public.household_tasks
      where user_id = v_user_id and id = p_entity_id for update;
    if not found then raise sqlstate 'PT422' using message = 'mutation_rejected'; end if;
    if v_row.deleted_at is not null then raise sqlstate 'PT409' using message = 'entity_deleted'; end if;
    -- Distinct same-day intents are a domain no-op: no second rotation and no revision.
    if v_row.last_done = v_completed_on then return 'applied'; end if;
    if p_base_revision is null or p_base_revision is distinct from v_row.revision then
      raise sqlstate 'PT409' using message = 'stale_revision';
    end if;
    update public.household_tasks
      set last_done = v_completed_on,
          assigned_to = case when rotates then case assigned_to when 'me' then 'partner' else 'me' end else assigned_to end
      where user_id = v_user_id and id = p_entity_id;
    return 'applied';
  end if;

  if v_action not in ('create', 'edit') or (p_payload - 'action' - 'task') <> '{}'::jsonb
    or not (p_payload ?& array['action','task'])
    or pg_catalog.jsonb_typeof(p_payload -> 'task') is distinct from 'object'
  then raise sqlstate 'PT400' using message = 'invalid_mutation'; end if;
  v_task := p_payload -> 'task';
  if (v_task - array['id','kind','title','frequency','lastDone','assignedTo','rotates','createdAt','timeZone']) <> '{}'::jsonb
    or not (v_task ?& array['id','kind','title','frequency','assignedTo','rotates','createdAt','timeZone'])
    or v_task ->> 'id' is distinct from p_entity_id
    or v_task ->> 'kind' not in ('cleaning','maintenance')
    or pg_catalog.jsonb_typeof(v_task -> 'title') is distinct from 'string'
    or length(btrim(v_task ->> 'title')) = 0 or length(v_task ->> 'title') > 500
    or v_task ->> 'frequency' not in ('weekly','monthly','quarterly','yearly')
    or v_task ->> 'assignedTo' not in ('me','partner')
    or pg_catalog.jsonb_typeof(v_task -> 'rotates') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(v_task -> 'createdAt') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_task -> 'timeZone') not in ('string','null')
  then raise sqlstate 'PT400' using message = 'invalid_mutation'; end if;
  v_created_at := (v_task ->> 'createdAt')::timestamptz;
  if v_task ? 'lastDone' then
    if pg_catalog.jsonb_typeof(v_task -> 'lastDone') is distinct from 'string'
      or (v_task ->> 'lastDone') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    then raise sqlstate 'PT400' using message = 'invalid_mutation'; end if;
    v_last_done := (v_task ->> 'lastDone')::date;
    if pg_catalog.to_char(v_last_done, 'YYYY-MM-DD') <> v_task ->> 'lastDone' then
      raise sqlstate 'PT400' using message = 'invalid_mutation';
    end if;
  end if;
  v_time_zone := v_task ->> 'timeZone';
  if v_time_zone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names where name = v_time_zone
  ) then raise sqlstate 'PT400' using message = 'invalid_mutation'; end if;

  if v_action = 'create' then
    if p_base_revision is not null then raise sqlstate 'PT400' using message = 'invalid_mutation'; end if;
    insert into public.household_tasks
      (id, user_id, kind, title, frequency, last_done, assigned_to, rotates, created_at, time_zone)
    values
      (p_entity_id, v_user_id, v_task ->> 'kind', v_task ->> 'title', v_task ->> 'frequency',
       v_last_done, v_task ->> 'assignedTo', (v_task ->> 'rotates')::boolean, v_created_at, v_time_zone);
    return 'applied';
  end if;

  select * into v_row from public.household_tasks
    where user_id = v_user_id and id = p_entity_id for update;
  if not found then raise sqlstate 'PT422' using message = 'mutation_rejected'; end if;
  if v_row.deleted_at is not null then raise sqlstate 'PT409' using message = 'entity_deleted'; end if;
  if p_base_revision is null or p_base_revision is distinct from v_row.revision then
    raise sqlstate 'PT409' using message = 'stale_revision';
  end if;
  if v_row.created_at is distinct from v_created_at
    or v_row.kind is distinct from v_task ->> 'kind'
    or v_row.time_zone is distinct from v_time_zone
  then raise sqlstate 'PT400' using message = 'immutable_task_field'; end if;
  update public.household_tasks
    set title = v_task ->> 'title', frequency = v_task ->> 'frequency',
        last_done = v_last_done, assigned_to = v_task ->> 'assignedTo',
        rotates = (v_task ->> 'rotates')::boolean
    where user_id = v_user_id and id = p_entity_id;
  return 'applied';
exception
  when sqlstate 'PT400' or sqlstate 'PT401' or sqlstate 'PT409' or sqlstate 'PT422' then raise;
  when invalid_datetime_format or datetime_field_overflow then
    raise sqlstate 'PT400' using message = 'invalid_mutation';
  when unique_violation then
    raise sqlstate 'PT409' using message = 'entity_conflict';
  when integrity_constraint_violation then
    raise sqlstate 'PT422' using message = 'mutation_rejected';
  when serialization_failure or deadlock_detected then
    raise sqlstate 'PT503' using message = 'mutation_unavailable';
  when others then
    raise sqlstate 'PT500' using message = 'mutation_failed';
end;
$$;

revoke all on function public.apply_sync_mutation(text, text, text, text, text, jsonb, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_sync_mutation(text, text, text, text, text, jsonb, bigint)
  to authenticated;

commit;
