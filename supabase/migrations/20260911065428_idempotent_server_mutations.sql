-- APP-032 / ADR-0027. Local migration only; deploy separately after review.
-- Server-owned receipts follow the existing public + RLS/no-policy convention.
create table public.mutation_receipts (
  user_id uuid not null references auth.users (id) on delete cascade,
  mutation_id uuid not null,
  fingerprint bytea not null check (octet_length(fingerprint) = 32),
  processed_at timestamptz not null default now(),
  primary key (user_id, mutation_id)
);
alter table public.mutation_receipts enable row level security;
revoke all on public.mutation_receipts from public, anon, authenticated, service_role;
comment on table public.mutation_receipts is
  'APP-032: server-owned replay evidence, retained until account deletion. No payloads or response bodies.';

-- One allowlisted dispatcher, never client-selected SQL/tables/functions.
-- Definer privileges are needed for the inaccessible receipt table. All domain
-- ownership is explicitly auth.uid(), not a caller argument. Fully qualified
-- objects + empty search_path prevent caller-controlled name resolution.
create function public.apply_sync_mutation(
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
  -- JSONB normalizes key order/whitespace; the only supported payload is one
  -- boolean. A version tag freezes this fingerprint contract for future handlers.
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
    or p_operation is distinct from 'upsert'
    or p_entity_id is null or length(btrim(p_entity_id)) = 0 or length(p_entity_id) > 100
    or jsonb_typeof(p_payload) is distinct from 'object'
  then
    raise sqlstate 'PT400' using message = 'invalid_mutation';
  end if;
  if jsonb_typeof(p_payload -> 'enabled') is distinct from 'boolean'
    or (p_payload - 'enabled') <> '{}'::jsonb
  then
    raise sqlstate 'PT400' using message = 'invalid_mutation';
  end if;

  -- Real Profile A entity write. Existing updated_at behavior is preserved;
  -- this adds no revision field, merge/reconciliation or ordering policy.
  insert into public.user_modules (user_id, module_id, enabled, updated_at)
  values (v_user_id, p_entity_id, (p_payload ->> 'enabled')::boolean, now())
  on conflict (user_id, module_id) do update
    set enabled = excluded.enabled, updated_at = excluded.updated_at;
  return 'applied';
exception
  -- Every exception rolls back BOTH writes within this function's block.
  -- Only stable errors escape the API; no payloads, IDs or SQL diagnostics.
  when sqlstate 'PT400' or sqlstate 'PT401' or sqlstate 'PT409' then raise;
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
