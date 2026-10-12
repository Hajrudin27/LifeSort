-- APP-067 / ADR-0055. Security hardening of the LEGACY public.job_applications table.
-- Local file only: remote deployment requires a separate reviewed operation.
--
-- The app no longer reads or writes this table: Career applications are local-only and encrypted
-- on the device (Profile B), and cloud sync returns only once a Profile-B-capable durable sync
-- path exists. Rows written by earlier releases may remain, so the table is hardened rather than
-- dropped. No column is added, renamed or dropped; the composite primary key (user_id, id), the
-- legacy column names and the user_id -> auth.users ON DELETE CASCADE foreign key are unchanged.
--
-- Every CHECK is NOT VALID, like 20260906170000_constrain_public_input: rows that already exist
-- are left untouched and are never rewritten (they cannot be changed retroactively), while every
-- new or updated row must comply. A legacy row that violates one is still readable and deletable
-- by its owner; an UPDATE of it must bring the whole row into range.
begin;

alter table public.job_applications
  drop constraint if exists job_applications_status_check,
  drop constraint if exists job_applications_company_check,
  drop constraint if exists job_applications_position_check,
  drop constraint if exists job_applications_link_check,
  drop constraint if exists job_applications_notes_check;

alter table public.job_applications
  add constraint job_applications_status_check
    check (status in ('applied', 'interview', 'offer', 'rejected')) not valid,
  add constraint job_applications_company_check
    check (char_length(company) between 1 and 200 and company !~ '^\s*$') not valid,
  add constraint job_applications_position_check
    check (char_length("position") between 1 and 200 and "position" !~ '^\s*$') not valid,
  -- NULL and '' both mean "no link" (the client has only ever written NULL). A present link is
  -- http(s) with a host and no whitespace; javascript:, file:, data: and custom schemes fail.
  add constraint job_applications_link_check
    check (
      link is null
      or link = ''
      or (char_length(link) <= 2048 and link ~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$')
    ) not valid,
  add constraint job_applications_notes_check
    check (notes is null or char_length(notes) <= 10000) not valid;

-- Privileges. The table exposed every privilege, TRUNCATE and TRIGGER included, to anon and
-- authenticated. Only an authenticated owner may now touch rows, and only row CRUD. postgres and
-- service_role are deliberately left as they were.
revoke all on table public.job_applications from public, anon, authenticated;
grant select, insert, update, delete on table public.job_applications to authenticated;

-- Row-level security: owner only, authenticated role only, stated per operation. UPDATE carries an
-- explicit WITH CHECK so a row can never be reassigned to another user.
alter table public.job_applications enable row level security;

drop policy if exists "Users can delete their own applications" on public.job_applications;
drop policy if exists "Users can insert their own applications" on public.job_applications;
drop policy if exists "Users can update their own applications" on public.job_applications;
drop policy if exists "Users can view their own applications" on public.job_applications;
drop policy if exists job_applications_owner_select on public.job_applications;
drop policy if exists job_applications_owner_insert on public.job_applications;
drop policy if exists job_applications_owner_update on public.job_applications;
drop policy if exists job_applications_owner_delete on public.job_applications;

create policy job_applications_owner_select on public.job_applications
  for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy job_applications_owner_insert on public.job_applications
  for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy job_applications_owner_update on public.job_applications
  for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy job_applications_owner_delete on public.job_applications
  for delete to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

comment on table public.job_applications is
  'LEGACY (APP-067). Not read or written by the app: Career applications are local-only and encrypted on the device. Retained and hardened because rows from earlier releases may exist. Cloud sync returns only with a Profile-B-capable durable sync path.';

commit;
