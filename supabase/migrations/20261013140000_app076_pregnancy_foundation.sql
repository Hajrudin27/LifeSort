-- APP-076 Phase A. Additive pregnancy-health foundation only; governed content
-- and client orchestration remain outside this migration.
create table public.pregnancies (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  method text check (method is null or method in ('lmp','conception','dueDate')), lmp_date date, conception_date date, due_date_override date,
  due_date_source text check (due_date_source is null or due_date_source in ('user','lmp','scan','clinician')),
  ended_at date, outcome text check (outcome is null or outcome in ('birth','stillbirth','miscarriage','termination','other','preferNotToSay')),
  outcome_notes text, recovery_ended_at date, revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(), deleted_at timestamptz, created_at timestamptz not null default now(),
  constraint pregnancies_active_shape check (deleted_at is not null or (method is not null and ((ended_at is null and outcome is null) or (ended_at is not null and outcome is not null)))),
  unique (id, user_id)
);
create unique index pregnancies_one_active_per_user on public.pregnancies(user_id) where ended_at is null and deleted_at is null;

create table public.pregnancy_symptom_logs (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, pregnancy_id uuid not null,
  date date, symptoms text[] default '{}', weight_kg numeric check (weight_kg is null or weight_kg between 30 and 250),
  belly_measurement_cm numeric check (belly_measurement_cm is null or belly_measurement_cm between 50 and 150), notes text,
  revision bigint not null default 1 check (revision > 0), updated_at timestamptz not null default now(), deleted_at timestamptz,
  foreign key (pregnancy_id, user_id) references public.pregnancies(id, user_id) on delete cascade,
  constraint pregnancy_symptom_logs_active_shape check (deleted_at is not null or (date is not null and symptoms is not null)),
  constraint pregnancy_symptom_logs_known_symptoms check (symptoms is null or symptoms <@ array['nausea','fatigue','backache','heartburn','swelling','cramps','moodSwings','braxtonHicks','insomnia','other']::text[])
);
create unique index pregnancy_symptom_logs_active_date on public.pregnancy_symptom_logs(pregnancy_id, date) where deleted_at is null;

create table public.pregnancy_appointments (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, pregnancy_id uuid not null,
  starts_at timestamptz, time_zone text default 'Europe/Copenhagen', title text,
  notes text, completed boolean not null default false, reminder_enabled boolean not null default false,
  revision bigint not null default 1 check (revision > 0), updated_at timestamptz not null default now(), deleted_at timestamptz,
  foreign key (pregnancy_id, user_id) references public.pregnancies(id, user_id) on delete cascade,
  constraint pregnancy_appointments_active_shape check (deleted_at is not null or (starts_at is not null and time_zone is not null and btrim(time_zone) <> '' and title is not null and char_length(btrim(title)) between 1 and 80))
);

create table public.pregnancy_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  recovery_display_days integer not null default 42 check (recovery_display_days between 0 and 120), privacy_mode boolean not null default false,
  updated_at timestamptz not null default now(), revision bigint not null default 1 check (revision > 0)
);
create table public.health_consents (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, purpose text not null check (length(btrim(purpose)) between 1 and 120),
  consent_version text not null check (length(btrim(consent_version)) between 1 and 80), granted_at timestamptz not null, withdrawn_at timestamptz,
  check (withdrawn_at is null or withdrawn_at >= granted_at), unique(user_id, purpose, consent_version, granted_at)
);
create table public.pregnancy_consent_policies (
  purpose text not null, consent_version text not null, supported boolean not null default false, is_current boolean not null default false,
  primary key (purpose, consent_version), constraint pregnancy_consent_policies_current_supported check (not is_current or supported)
);
create unique index pregnancy_consent_policies_one_current on public.pregnancy_consent_policies(purpose) where is_current;
create table public.pregnancy_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade, next_change_seq bigint not null default 0 check (next_change_seq >= 0)
);
create table public.pregnancy_changes (
  user_id uuid not null references auth.users(id) on delete cascade, change_seq bigint not null,
  entity_type text not null check (entity_type in ('pregnancy','log','appointment','settings')),
  entity_id uuid not null, revision bigint not null check (revision > 0), deleted boolean not null default false,
  created_at timestamptz not null default now(), primary key (user_id, change_seq)
);
create table public.pregnancy_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade, mutation_id uuid not null,
  request_hash bytea not null check (octet_length(request_hash) = 32), entity_type text not null check (entity_type in ('pregnancy','log','appointment','settings')),
  entity_id uuid not null, resulting_revision bigint not null, deleted boolean not null default false, processed_at timestamptz not null default now(),
  primary key (user_id, mutation_id)
);

alter table public.pregnancies enable row level security;
alter table public.pregnancy_symptom_logs enable row level security;
alter table public.pregnancy_appointments enable row level security;
alter table public.pregnancy_settings enable row level security;
alter table public.health_consents enable row level security;
alter table public.pregnancy_consent_policies enable row level security;
alter table public.pregnancy_sync_state enable row level security;
alter table public.pregnancy_changes enable row level security;
alter table public.pregnancy_mutation_receipts enable row level security;
create policy pregnancy_read_own on public.pregnancies for select to authenticated using (auth.uid() = user_id);
create policy pregnancy_log_read_own on public.pregnancy_symptom_logs for select to authenticated using (auth.uid() = user_id);
create policy pregnancy_appointment_read_own on public.pregnancy_appointments for select to authenticated using (auth.uid() = user_id);
create policy pregnancy_settings_read_own on public.pregnancy_settings for select to authenticated using (auth.uid() = user_id);
create policy health_consent_read_own on public.health_consents for select to authenticated using (auth.uid() = user_id);
revoke all on public.pregnancies, public.pregnancy_symptom_logs, public.pregnancy_appointments, public.pregnancy_settings, public.health_consents, public.pregnancy_consent_policies, public.pregnancy_sync_state, public.pregnancy_changes, public.pregnancy_mutation_receipts from public, anon, authenticated;
grant select on public.pregnancies, public.pregnancy_symptom_logs, public.pregnancy_appointments, public.pregnancy_settings, public.health_consents to authenticated;

create function public.grant_health_consent(p_purpose text, p_consent_version text)
returns public.health_consents language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_row public.health_consents;
begin
  if v_user is null then raise sqlstate 'PT401' using message='not_authenticated'; end if;
  if not exists (select 1 from public.pregnancy_consent_policies where purpose=p_purpose and consent_version=p_consent_version and supported and is_current) then raise sqlstate 'PT422' using message='unsupported_consent'; end if;
  insert into public.health_consents(id,user_id,purpose,consent_version,granted_at) values(gen_random_uuid(),v_user,p_purpose,p_consent_version,now()) returning * into v_row;
  return v_row;
exception when sqlstate 'PT401' or sqlstate 'PT422' then raise; when others then raise sqlstate 'PT500' using message='consent_failed'; end; $$;

create function public.withdraw_health_consent(p_consent_id uuid)
returns public.health_consents language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_row public.health_consents;
begin
  if v_user is null then raise sqlstate 'PT401' using message = 'not_authenticated'; end if;
  select * into v_row from public.health_consents where id=p_consent_id and user_id=v_user;
  if not found then raise sqlstate 'PT401' using message = 'not_authorized'; end if;
  update public.health_consents set withdrawn_at = now() where user_id=v_user and purpose=v_row.purpose and withdrawn_at is null;
  select * into v_row from public.health_consents where id=p_consent_id and user_id=v_user;
  return v_row;
exception when sqlstate 'PT401' then raise; when others then raise sqlstate 'PT500' using message = 'consent_failed'; end; $$;

create function public.apply_pregnancy_sync_mutation(p_mutation_id uuid, p_entity_type text, p_entity_id uuid, p_operation text, p_expected_revision bigint, p_payload jsonb, p_consent_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_hash bytea; v_receipt public.pregnancy_mutation_receipts;
  v_revision bigint; v_deleted boolean := false; v_seq bigint; v_parent uuid; v_deleted_at timestamptz; v_child record;
begin
  if v_user is null then raise sqlstate 'PT401' using message='not_authenticated'; end if;
  if p_mutation_id is null or p_entity_id is null or p_entity_type is null or p_entity_type not in ('pregnancy','log','appointment','settings') or p_operation is null or p_operation not in ('upsert','delete') or (p_expected_revision is not null and p_expected_revision < 0) then raise sqlstate 'PT400' using message='invalid_mutation'; end if;
  if p_entity_type='settings' and p_operation='delete' then raise sqlstate 'PT422' using message='invalid_mutation'; end if;
  if p_entity_type='settings' and p_entity_id <> v_user then raise sqlstate 'PT401' using message='not_authorized'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 76));
  insert into public.pregnancy_sync_state(user_id) values(v_user) on conflict do nothing;
  perform 1 from public.pregnancy_sync_state where user_id=v_user for update;
  v_hash := pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(2,p_entity_type,p_entity_id,p_operation,p_expected_revision,p_payload,p_consent_id)::text,'UTF8'));
  select * into v_receipt from public.pregnancy_mutation_receipts where user_id=v_user and mutation_id=p_mutation_id;
  if found then
    if v_receipt.request_hash is distinct from v_hash then raise sqlstate 'PT409' using message='mutation_id_conflict'; end if;
    return pg_catalog.jsonb_build_object('status','replayed','entityType',v_receipt.entity_type,'entityId',v_receipt.entity_id,'revision',v_receipt.resulting_revision,'deleted',v_receipt.deleted);
  end if;
  if p_operation='upsert' and not exists (select 1 from public.health_consents c join public.pregnancy_consent_policies q on q.purpose=c.purpose and q.consent_version=c.consent_version and q.supported and q.is_current where c.id=p_consent_id and c.user_id=v_user and c.withdrawn_at is null) then raise sqlstate 'PT428' using message='consent_required'; end if;
  if p_operation='upsert' and jsonb_typeof(p_payload)='object' and exists (
    select 1 from jsonb_each(p_payload) e where (e.key in ('lmpDate','conceptionDate','dueDateOverride','endedAt','recoveryEndedAt','date') and jsonb_typeof(e.value)<>'null' and (jsonb_typeof(e.value)<>'string' or (e.value #>> '{}' <> '' and e.value #>> '{}' !~ '^\d{4}-\d{2}-\d{2}$'))) or (e.key='startsAt' and (jsonb_typeof(e.value)<>'string' or e.value #>> '{}' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'))
  ) then raise sqlstate 'PT400' using message='invalid_mutation'; end if;
  if p_entity_type='pregnancy' then
    if p_operation='upsert' then
      if coalesce(jsonb_typeof(p_payload),'')<>'object' or coalesce(jsonb_typeof(p_payload->'method'),'')<>'string' or (p_payload->>'method') not in ('lmp','conception','dueDate') then raise sqlstate 'PT400' using message='invalid_mutation'; end if;
      select revision into v_revision from public.pregnancies where id=p_entity_id and user_id=v_user for update;
      if found then
        if p_expected_revision is null or v_revision<>p_expected_revision or exists(select 1 from public.pregnancies where id=p_entity_id and user_id=v_user and deleted_at is not null) then raise sqlstate 'PT409' using message='revision_conflict'; end if;
        update public.pregnancies set method=p_payload->>'method',lmp_date=nullif(p_payload->>'lmpDate','')::date,conception_date=nullif(p_payload->>'conceptionDate','')::date,due_date_override=nullif(p_payload->>'dueDateOverride','')::date,due_date_source=nullif(p_payload->>'dueDateSource',''),ended_at=nullif(p_payload->>'endedAt','')::date,outcome=nullif(p_payload->>'outcome',''),outcome_notes=nullif(p_payload->>'outcomeNotes',''),recovery_ended_at=nullif(p_payload->>'recoveryEndedAt','')::date,revision=revision+1,updated_at=now() where id=p_entity_id and user_id=v_user returning revision into v_revision;
      elsif p_expected_revision is not null then raise sqlstate 'PT409' using message='revision_conflict';
      else insert into public.pregnancies(id,user_id,method,lmp_date,conception_date,due_date_override,due_date_source,ended_at,outcome,outcome_notes,recovery_ended_at) values(p_entity_id,v_user,p_payload->>'method',nullif(p_payload->>'lmpDate','')::date,nullif(p_payload->>'conceptionDate','')::date,nullif(p_payload->>'dueDateOverride','')::date,nullif(p_payload->>'dueDateSource',''),nullif(p_payload->>'endedAt','')::date,nullif(p_payload->>'outcome',''),nullif(p_payload->>'outcomeNotes',''),nullif(p_payload->>'recoveryEndedAt','')::date) returning revision into v_revision;
      end if;
    else
      select revision into v_revision from public.pregnancies where id=p_entity_id and user_id=v_user and deleted_at is null for update;
      if not found or p_expected_revision is null or v_revision<>p_expected_revision then raise sqlstate 'PT409' using message='revision_conflict'; end if;
      v_deleted_at := now();
      update public.pregnancies set method=null,lmp_date=null,conception_date=null,due_date_override=null,due_date_source=null,ended_at=null,outcome=null,outcome_notes=null,recovery_ended_at=null,deleted_at=v_deleted_at,revision=revision+1,updated_at=v_deleted_at where id=p_entity_id and user_id=v_user returning revision into v_revision;
      update public.pregnancy_symptom_logs set date=null,symptoms=null,weight_kg=null,belly_measurement_cm=null,notes=null,deleted_at=v_deleted_at,revision=revision+1,updated_at=v_deleted_at where pregnancy_id=p_entity_id and user_id=v_user and deleted_at is null;
      update public.pregnancy_appointments set starts_at=null,time_zone=null,title=null,notes=null,completed=false,reminder_enabled=false,deleted_at=v_deleted_at,revision=revision+1,updated_at=v_deleted_at where pregnancy_id=p_entity_id and user_id=v_user and deleted_at is null;
      for v_child in select id,revision from public.pregnancy_symptom_logs where pregnancy_id=p_entity_id and user_id=v_user and deleted_at=v_deleted_at loop update public.pregnancy_sync_state set next_change_seq=next_change_seq+1 where user_id=v_user returning next_change_seq into v_seq; insert into public.pregnancy_changes(user_id,change_seq,entity_type,entity_id,revision,deleted) values(v_user,v_seq,'log',v_child.id,v_child.revision,true); end loop;
      for v_child in select id,revision from public.pregnancy_appointments where pregnancy_id=p_entity_id and user_id=v_user and deleted_at=v_deleted_at loop update public.pregnancy_sync_state set next_change_seq=next_change_seq+1 where user_id=v_user returning next_change_seq into v_seq; insert into public.pregnancy_changes(user_id,change_seq,entity_type,entity_id,revision,deleted) values(v_user,v_seq,'appointment',v_child.id,v_child.revision,true); end loop;
      v_deleted:=true;
    end if;
  elsif p_entity_type='settings' then
    if coalesce(jsonb_typeof(p_payload),'')<>'object' or (p_payload ? 'privacyMode' and jsonb_typeof(p_payload->'privacyMode')<>'boolean') then raise sqlstate 'PT400' using message='invalid_mutation'; end if;
    select revision into v_revision from public.pregnancy_settings where user_id=v_user for update;
    if found then
      if p_expected_revision is null or v_revision<>p_expected_revision then raise sqlstate 'PT409' using message='revision_conflict'; end if;
      update public.pregnancy_settings set recovery_display_days=coalesce((p_payload->>'recoveryDisplayDays')::integer,42),privacy_mode=coalesce((p_payload->>'privacyMode')::boolean,false),revision=revision+1,updated_at=now() where user_id=v_user returning revision into v_revision;
    elsif p_expected_revision is not null then raise sqlstate 'PT409' using message='revision_conflict';
    else insert into public.pregnancy_settings(user_id,recovery_display_days,privacy_mode) values(v_user,coalesce((p_payload->>'recoveryDisplayDays')::integer,42),coalesce((p_payload->>'privacyMode')::boolean,false)) returning revision into v_revision;
    end if;
  elsif p_entity_type='log' then
    select pregnancy_id,revision,deleted_at into v_parent,v_revision,v_deleted_at from public.pregnancy_symptom_logs where id=p_entity_id and user_id=v_user for update;
    if p_operation='delete' then
      if not found or v_deleted_at is not null or p_expected_revision is null or v_revision<>p_expected_revision then raise sqlstate 'PT409' using message='revision_conflict'; end if;
      update public.pregnancy_symptom_logs set date=null,symptoms=null,weight_kg=null,belly_measurement_cm=null,notes=null,deleted_at=now(),revision=revision+1,updated_at=now() where id=p_entity_id and user_id=v_user returning revision into v_revision; v_deleted:=true;
    else
      if coalesce(jsonb_typeof(p_payload),'')<>'object' or coalesce(jsonb_typeof(p_payload->'symptoms'),'')<>'array' or coalesce(jsonb_typeof(p_payload->'date'),'')<>'string' then raise sqlstate 'PT400' using message='invalid_mutation'; end if;
      v_parent := nullif(p_payload->>'pregnancyId','')::uuid;
      if v_parent is null or not exists(select 1 from public.pregnancies where id=v_parent and user_id=v_user and deleted_at is null) then raise sqlstate 'PT409' using message='parent_unavailable'; end if;
      if found then
        if v_deleted_at is not null or p_expected_revision is null or v_revision<>p_expected_revision then raise sqlstate 'PT409' using message='revision_conflict'; end if;
        update public.pregnancy_symptom_logs set pregnancy_id=v_parent,date=(p_payload->>'date')::date,symptoms=array(select jsonb_array_elements_text(p_payload->'symptoms')),weight_kg=nullif(p_payload->>'weightKg','')::numeric,belly_measurement_cm=nullif(p_payload->>'bellyMeasurementCm','')::numeric,notes=nullif(p_payload->>'notes',''),revision=revision+1,updated_at=now() where id=p_entity_id and user_id=v_user returning revision into v_revision;
      elsif p_expected_revision is not null then raise sqlstate 'PT409' using message='revision_conflict';
      else insert into public.pregnancy_symptom_logs(id,user_id,pregnancy_id,date,symptoms,weight_kg,belly_measurement_cm,notes) values(p_entity_id,v_user,v_parent,(p_payload->>'date')::date,array(select jsonb_array_elements_text(p_payload->'symptoms')),nullif(p_payload->>'weightKg','')::numeric,nullif(p_payload->>'bellyMeasurementCm','')::numeric,nullif(p_payload->>'notes','')) returning revision into v_revision;
      end if;
    end if;
  else
    select pregnancy_id,revision,deleted_at into v_parent,v_revision,v_deleted_at from public.pregnancy_appointments where id=p_entity_id and user_id=v_user for update;
    if p_operation='delete' then
      if not found or v_deleted_at is not null or p_expected_revision is null or v_revision<>p_expected_revision then raise sqlstate 'PT409' using message='revision_conflict'; end if;
      update public.pregnancy_appointments set starts_at=null,time_zone=null,title=null,notes=null,completed=false,reminder_enabled=false,deleted_at=now(),revision=revision+1,updated_at=now() where id=p_entity_id and user_id=v_user returning revision into v_revision; v_deleted:=true;
    else
      if coalesce(jsonb_typeof(p_payload),'')<>'object' or coalesce(jsonb_typeof(p_payload->'startsAt'),'')<>'string' or coalesce(jsonb_typeof(p_payload->'timeZone'),'')<>'string' or coalesce(jsonb_typeof(p_payload->'title'),'')<>'string' or (p_payload ? 'completed' and jsonb_typeof(p_payload->'completed')<>'boolean') or (p_payload ? 'reminderEnabled' and jsonb_typeof(p_payload->'reminderEnabled')<>'boolean') or not exists (select 1 from pg_catalog.pg_timezone_names where name=p_payload->>'timeZone' and name<>'Factory') then raise sqlstate 'PT400' using message='invalid_mutation'; end if;
      v_parent := nullif(p_payload->>'pregnancyId','')::uuid;
      if v_parent is null or not exists(select 1 from public.pregnancies where id=v_parent and user_id=v_user and deleted_at is null) then raise sqlstate 'PT409' using message='parent_unavailable'; end if;
      if found then
        if v_deleted_at is not null or p_expected_revision is null or v_revision<>p_expected_revision then raise sqlstate 'PT409' using message='revision_conflict'; end if;
        update public.pregnancy_appointments set pregnancy_id=v_parent,starts_at=(p_payload->>'startsAt')::timestamptz,time_zone=p_payload->>'timeZone',title=p_payload->>'title',notes=nullif(p_payload->>'notes',''),completed=coalesce((p_payload->>'completed')::boolean,false),reminder_enabled=coalesce((p_payload->>'reminderEnabled')::boolean,false),revision=revision+1,updated_at=now() where id=p_entity_id and user_id=v_user returning revision into v_revision;
      elsif p_expected_revision is not null then raise sqlstate 'PT409' using message='revision_conflict';
      else insert into public.pregnancy_appointments(id,user_id,pregnancy_id,starts_at,time_zone,title,notes,completed,reminder_enabled) values(p_entity_id,v_user,v_parent,(p_payload->>'startsAt')::timestamptz,p_payload->>'timeZone',p_payload->>'title',nullif(p_payload->>'notes',''),coalesce((p_payload->>'completed')::boolean,false),coalesce((p_payload->>'reminderEnabled')::boolean,false)) returning revision into v_revision;
      end if;
    end if;
  end if;
  update public.pregnancy_sync_state set next_change_seq=next_change_seq+1 where user_id=v_user returning next_change_seq into v_seq;
  insert into public.pregnancy_changes(user_id,change_seq,entity_type,entity_id,revision,deleted) values(v_user,v_seq,p_entity_type,p_entity_id,v_revision,v_deleted);
  insert into public.pregnancy_mutation_receipts(user_id,mutation_id,request_hash,entity_type,entity_id,resulting_revision,deleted) values(v_user,p_mutation_id,v_hash,p_entity_type,p_entity_id,v_revision,v_deleted);
  return pg_catalog.jsonb_build_object('status','applied','entityType',p_entity_type,'entityId',p_entity_id,'revision',v_revision,'deleted',v_deleted,'changeSeq',v_seq);
exception when sqlstate 'PT400' or sqlstate 'PT401' or sqlstate 'PT409' or sqlstate 'PT422' or sqlstate 'PT428' then raise; when integrity_constraint_violation or data_exception then raise sqlstate 'PT422' using message='mutation_rejected'; when others then raise sqlstate 'PT500' using message='mutation_failed'; end; $$;

create function public.pull_pregnancy_sync_state(p_after_change_seq bigint default 0, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_limit integer; v_changes jsonb; v_next bigint;
begin
  if v_user is null then raise sqlstate 'PT401' using message='not_authenticated'; end if;
  if p_after_change_seq is null or p_after_change_seq<0 then raise sqlstate 'PT400' using message='invalid_cursor'; end if;
  v_limit:=greatest(1,least(coalesce(p_limit,100),100));
  select coalesce(jsonb_agg(jsonb_build_object('changeSeq',change_seq,'entityType',entity_type,'entityId',entity_id,'revision',revision,'deleted',deleted) order by change_seq),'[]'::jsonb),coalesce(max(change_seq),p_after_change_seq) into v_changes,v_next from (select * from public.pregnancy_changes where user_id=v_user and change_seq>p_after_change_seq order by change_seq limit v_limit) q;
  return jsonb_build_object('changes',v_changes,'nextChangeSeq',v_next);
exception when sqlstate 'PT400' or sqlstate 'PT401' then raise; when others then raise sqlstate 'PT500' using message='pull_failed'; end; $$;

revoke all on function public.grant_health_consent(text,text), public.withdraw_health_consent(uuid), public.apply_pregnancy_sync_mutation(uuid,text,uuid,text,bigint,jsonb,uuid), public.pull_pregnancy_sync_state(bigint,integer) from public, anon, authenticated, service_role;
grant execute on function public.grant_health_consent(text,text), public.withdraw_health_consent(uuid), public.apply_pregnancy_sync_mutation(uuid,text,uuid,text,bigint,jsonb,uuid), public.pull_pregnancy_sync_state(bigint,integer) to authenticated;
