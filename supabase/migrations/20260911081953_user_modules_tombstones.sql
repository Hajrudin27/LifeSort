-- APP-034 / ADR-0029. Local only; remote deployment requires separate review.
begin;
alter table public.user_modules add column deleted_at timestamptz;
comment on column public.user_modules.deleted_at is
  'Server-owned deletion version time; NULL means active. Retain until a reviewed future purge policy or account deletion.';
comment on column public.user_modules.revision is
  'Server-owned version: insert 1; each active UPDATE, including first deletion, adds 1. Tombstones are immutable; receipt replay and repeated deletion do not write.';

-- Close ordinary physical deletion (including inherited PUBLIC/TRUNCATE access).
-- Account deletion uses the existing privileged auth.users cascade, not this grant.
revoke delete, truncate on public.user_modules from public, anon, authenticated;
drop policy user_modules_owner_delete on public.user_modules;

create or replace function public.stamp_user_module_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    NEW.revision := 1;
    NEW.updated_at := pg_catalog.clock_timestamp();
    -- Inserts create active entities only. Clients cannot supply deletion history.
    NEW.deleted_at := null;
  else
    if OLD.deleted_at is not null then
      -- Reject even same-value writes or attempts to rename the retained identity.
      raise sqlstate 'PT409' using message = 'entity_deleted';
    end if;
    NEW.revision := OLD.revision + 1;
    NEW.updated_at := greatest(pg_catalog.clock_timestamp(), OLD.updated_at + interval '1 microsecond');
    if NEW.deleted_at is not null then
      NEW.deleted_at := NEW.updated_at;
    end if;
  end if;
  return NEW;
end;
$$;
revoke all on function public.stamp_user_module_revision()
  from public, anon, authenticated, service_role;

-- One allowlisted dispatcher, never client-selected SQL/tables/functions.
-- Definer privileges are needed for the inaccessible receipt table. All domain
-- ownership is explicitly auth.uid(), not a caller argument. Fully qualified
-- objects + empty search_path prevent caller-controlled name resolution.
create or replace function public.apply_sync_mutation(
  p_mutation_id text,
  p_data_domain text,
  p_entity_type text,
  p_entity_id text,
  p_operation text,
  p_payload jsonb
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
begin
  if v_user_id is null or not exists (select 1 from auth.users where id = v_user_id) then
    raise sqlstate 'PT401' using message = 'not_authenticated';
  end if;
  -- Text input permits safe validation errors without echoing malformed UUIDs.
  if p_mutation_id is null or p_mutation_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise sqlstate 'PT400' using message = 'invalid_mutation';
  end if;
  v_mutation_id := p_mutation_id::uuid;

  -- APP-031 envelope identity, excluding local scheduling/revision metadata.
  -- Preserve APP-032 fingerprints exactly. Delete uses canonical null payload;
  -- operation is already part of identity, so upsert/delete reuse conflicts.
  v_fingerprint := pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(1, p_data_domain, p_entity_type, p_entity_id,
      p_operation, p_payload)::text, 'UTF8'));

  insert into public.mutation_receipts (user_id, mutation_id, fingerprint)
  values (v_user_id, v_mutation_id, v_fingerprint)
  on conflict (user_id, mutation_id) do nothing;

  if not found then
    -- Under READ COMMITTED this statement sees the competing committed insert.
    -- Stronger isolation may abort with serialization_failure; never apply twice.
    select fingerprint into v_existing from public.mutation_receipts
    where user_id = v_user_id and mutation_id = v_mutation_id;
    if v_existing is distinct from v_fingerprint then
      raise sqlstate 'PT409' using message = 'mutation_id_conflict';
    end if;
    return 'replayed';
  end if;

  if p_data_domain is distinct from 'core.module-choice'
    or p_entity_type is distinct from 'module-choice'
    or p_operation is null or p_operation not in ('upsert', 'delete')
    or p_entity_id is null or length(btrim(p_entity_id)) = 0 or length(p_entity_id) > 100
  then
    raise sqlstate 'PT400' using message = 'invalid_mutation';
  end if;
  if p_operation = 'delete' then
    -- SQL NULL and JSON null have the same fingerprint and delete semantics.
    if p_payload is not null and p_payload <> 'null'::jsonb then
      raise sqlstate 'PT400' using message = 'invalid_mutation';
    end if;
    -- UPDATE locks the row and rechecks deleted_at after a concurrent writer.
    -- The trigger owns the timestamp; this value expresses deletion intent only.
    update public.user_modules set deleted_at = pg_catalog.clock_timestamp()
    where user_id = v_user_id and module_id = p_entity_id and deleted_at is null;
    if not found and not exists (
      select 1 from public.user_modules
      where user_id = v_user_id and module_id = p_entity_id and deleted_at is not null
    ) then
      raise sqlstate 'PT422' using message = 'mutation_rejected';
    end if;
    -- A distinct delete ID on an existing tombstone claims a receipt but performs
    -- no entity write. One logical deletion version, even across concurrent deletes.
  else
    if jsonb_typeof(p_payload) is distinct from 'object'
      or jsonb_typeof(p_payload -> 'enabled') is distinct from 'boolean'
      or (p_payload - 'enabled') <> '{}'::jsonb
    then
      raise sqlstate 'PT400' using message = 'invalid_mutation';
    end if;
    -- The database trigger rejects every UPDATE of a tombstone, including the
    -- conflict branch of this upsert and legacy direct writes. No implicit restore.
    insert into public.user_modules (user_id, module_id, enabled, updated_at)
    values (v_user_id, p_entity_id, (p_payload ->> 'enabled')::boolean, now())
    on conflict (user_id, module_id) do update
      set enabled = excluded.enabled, updated_at = excluded.updated_at;
  end if;
  return 'applied';
exception
  -- Every exception rolls back BOTH writes within this function's block.
  -- Only stable errors escape the API; no payloads, IDs or SQL diagnostics.
  when sqlstate 'PT400' or sqlstate 'PT401' or sqlstate 'PT409' or sqlstate 'PT422' then raise;
  when integrity_constraint_violation then
    raise sqlstate 'PT422' using message = 'mutation_rejected';
  when serialization_failure or deadlock_detected then
    raise sqlstate 'PT503' using message = 'mutation_unavailable';
  when others then
    raise sqlstate 'PT500' using message = 'mutation_failed';
end;
$$;
revoke all on function public.apply_sync_mutation(text, text, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_sync_mutation(text, text, text, text, text, jsonb)
  to authenticated;

commit;
