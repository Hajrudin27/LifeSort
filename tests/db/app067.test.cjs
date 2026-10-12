// APP-067 hardening of the legacy job_applications table against a disposable local PostgreSQL cluster.
// The pre-existing table, RLS policies, FK and grants are lifted verbatim from the remote schema
// migration, so the hardening is proven on the real baseline. No Supabase CLI, remote URL, .env or
// existing database is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bin = process.env.APP067_PG_BIN || path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app067-'));
const cluster = path.join(scratch, 'db');
const port = '55467';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MIGRATION = path.join(root, 'supabase/migrations/20261009120000_app067_job_applications_hardening.sql');
let started = false;
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', port, '-U', 'postgres', '-d', 'postgres'];
const sql = (source) => execFileSync(path.join(bin, 'psql'), args, {
  input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
}).trim();
function errorFor(source) {
  try { sql(source); } catch (error) { return String(error.stderr); }
  assert.fail('SQL unexpectedly succeeded');
}
const quote = (value) => value === null || value === undefined ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const auth = (userId, role = 'authenticated') =>
  `set role ${role}; ${userId ? `set request.jwt.claim.sub='${userId}'; ` : ''}`;
const row = (overrides = {}) => ({
  id: 'x', company: 'Acme', position: 'Engineer', status: 'applied', applied_date: '2026-09-01', link: null, notes: null, ...overrides,
});
const insert = (user, overrides = {}) => {
  const r = row(overrides);
  return `insert into public.job_applications (id,user_id,company,position,status,applied_date,link,notes)
    values (${quote(r.id)},${quote(user)},${quote(r.company)},${quote(r.position)},${quote(r.status)},${quote(r.applied_date)},${quote(r.link)},${quote(r.notes)});`;
};
const count = (where = 'true') => Number(sql(`select count(*) from public.job_applications where ${where}`));
const privileges = (role) => sql(`select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') from (
  select (aclexplode(relacl)).* from pg_class where oid = 'public.job_applications'::regclass) acl
  where grantee = (select oid from pg_roles where rolname = '${role}')`);
const publicPrivileges = () => sql(`select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') from (
  select (aclexplode(relacl)).* from pg_class where oid = 'public.job_applications'::regclass) acl where grantee = 0`);
const columns = () => sql(`select string_agg(column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), '|' order by ordinal_position)
  from information_schema.columns where table_schema='public' and table_name='job_applications'`);
const keys = () => sql(`select string_agg(conname||':'||contype::text||':'||pg_get_constraintdef(oid), '|' order by conname)
  from pg_constraint where conrelid='public.job_applications'::regclass and contype in ('p','f')`);
const policies = () => sql(`select coalesce(string_agg(policyname||':'||cmd||':'||roles::text, '|' order by policyname), '')
  from pg_policies where schemaname='public' and tablename='job_applications'`);

function baselineStatements() {
  const text = fs.readFileSync(path.join(root, 'supabase/migrations/20260902112000_remote_schema.sql'), 'utf8');
  return text.split(/;\s*\n/).filter((statement) => statement.includes('job_applications')).map((s) => `${s};`);
}

let baseline;
before(() => {
  execFileSync(path.join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-l', path.join(scratch, 'postgres.log'),
    '-o', `-k ${scratch} -p ${port} -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  sql(`create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${A}'),('${B}');`);
  const statements = baselineStatements();
  assert.ok(statements.some((s) => /CREATE TABLE/i.test(s)), 'baseline table statement found');
  assert.equal(statements.filter((s) => /CREATE POLICY/i.test(s)).length, 4);
  sql(statements.join('\n'));
  // Legacy rows written by earlier clients, before any constraint exists. The first two violate the
  // new rules (an unvalidated status written by the old remote fetch cast, and an over-long note).
  sql(`insert into public.job_applications (id,user_id,company,position,status,applied_date,link,notes) values
    ('legacy-bad-status','${A}','Old Co','Old Role','ghosted','2026-01-01',null,null),
    ('legacy-bad-link','${A}','Old Co','Old Role','applied','2026-01-02','javascript:alert(1)',null),
    ('legacy-long-note','${A}','Old Co','Old Role','offer','2026-01-03',null,'${'n'.repeat(10001)}'),
    ('legacy-good','${A}','Old Co','Old Role','interview','2026-01-04','https://example.com/job','note'),
    ('b-legacy','${B}','Other Co','Other Role','applied','2026-01-05',null,null);`);
  baseline = { columns: columns(), keys: keys(), service: privileges('service_role'), postgres: privileges('postgres') };
  sql(fs.readFileSync(MIGRATION, 'utf8'));
});

after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('BASELINE: the original grants really were broad (so the revoke below is not vacuous)', () => {
  assert.match(baseline.service, /TRUNCATE/);
  assert.ok(baseline.columns.includes('position:text:NO'));
});

test('NO SCHEMA CHANGE: columns, composite primary key and the cascading user foreign key are unchanged', () => {
  assert.equal(columns(), baseline.columns);
  assert.equal(keys(), baseline.keys);
  assert.match(baseline.keys, /PRIMARY KEY \(user_id, id\)/);
  assert.match(baseline.keys, /ON DELETE CASCADE/);
  assert.equal(count(), 5, 'no legacy row was rewritten or removed');
});

test('IDEMPOTENT: the migration can be applied again without error or change', () => {
  const before = { policies: policies(), columns: columns(), authenticated: privileges('authenticated') };
  sql(fs.readFileSync(MIGRATION, 'utf8'));
  assert.deepEqual({ policies: policies(), columns: columns(), authenticated: privileges('authenticated') }, before);
  assert.equal(count(), 5);
});

test('NOT VALID: the five constraints exist, are unvalidated, and leave legacy rows untouched', () => {
  assert.equal(sql(`select string_agg(conname||':'||convalidated, ',' order by conname) from pg_constraint
    where conrelid='public.job_applications'::regclass and contype='c'`),
  'job_applications_company_check:false,job_applications_link_check:false,job_applications_notes_check:false,job_applications_position_check:false,job_applications_status_check:false');
  assert.equal(sql(`select status from public.job_applications where id='legacy-bad-status'`), 'ghosted');
  assert.equal(sql(`select link from public.job_applications where id='legacy-bad-link'`), 'javascript:alert(1)');
  assert.equal(sql(`select char_length(notes) from public.job_applications where id='legacy-long-note'`), '10001');
});

test('NOT VALID: a legacy violating row stays readable and deletable by its owner, but cannot be updated while it violates', () => {
  assert.equal(sql(`${auth(A)} select count(*) from public.job_applications where id in ('legacy-bad-status','legacy-bad-link','legacy-long-note')`), '3');
  assert.match(errorFor(`${auth(A)} update public.job_applications set notes='fine' where id='legacy-bad-status'`), /job_applications_status_check/);
  assert.match(errorFor(`${auth(A)} update public.job_applications set position='Role' where id='legacy-bad-link'`), /job_applications_link_check/);
  // The owner can bring the row into range in one update, or delete it.
  sql(`${auth(A)} update public.job_applications set status='rejected' where id='legacy-bad-status'`);
  assert.equal(sql(`select status from public.job_applications where id='legacy-bad-status'`), 'rejected');
  sql(`${auth(A)} delete from public.job_applications where id='legacy-long-note'`);
  assert.equal(count(`id='legacy-long-note'`), 0);
});

test('STATUS: exactly the four existing values are accepted; anything else is refused', () => {
  for (const status of ['applied', 'interview', 'offer', 'rejected']) {
    sql(insert(A, { id: `s-${status}`, status }));
  }
  for (const status of ['withdrawn', 'accepted', 'Applied', '', 'ghosted', 'applied ']) {
    assert.match(errorFor(insert(A, { id: `bad-${status}`, status })), /job_applications_status_check/, `status ${JSON.stringify(status)}`);
  }
  assert.match(errorFor(`insert into public.job_applications (id,user_id,company,position,status,applied_date) values ('n','${A}','C','P',null,'2026-09-01')`), /null value|status/);
});

test('COMPANY: 1-200 characters, not blank', () => {
  sql(insert(A, { id: 'c1', company: 'C' }));
  sql(insert(A, { id: 'c200', company: 'c'.repeat(200) }));
  for (const [label, company] of [['empty', ''], ['spaces', '   '], ['tabs and newlines', '\t\n '], ['201 characters', 'c'.repeat(201)]]) {
    assert.match(errorFor(insert(A, { id: `bad-c-${label}`, company })), /job_applications_company_check/, label);
  }
});

test('POSITION: 1-200 characters, not blank', () => {
  sql(insert(A, { id: 'p1', position: 'P' }));
  sql(insert(A, { id: 'p200', position: 'p'.repeat(200) }));
  for (const [label, position] of [['empty', ''], ['spaces', '   '], ['201 characters', 'p'.repeat(201)]]) {
    assert.match(errorFor(insert(A, { id: `bad-p-${label}`, position })), /job_applications_position_check/, label);
  }
});

test('NOTES: NULL, empty and up to 10,000 characters; 10,001 refused', () => {
  sql(insert(A, { id: 'n-null', notes: null }));
  sql(insert(A, { id: 'n-empty', notes: '' }));
  sql(insert(A, { id: 'n-max', notes: 'n'.repeat(10000) }));
  sql(insert(A, { id: 'n-multiline', notes: 'line one\nline two\n\tindented' }));
  assert.match(errorFor(insert(A, { id: 'n-over', notes: 'n'.repeat(10001) })), /job_applications_notes_check/);
});

test('LINK: NULL, empty and http(s) with a host are accepted; every other scheme and shape is refused', () => {
  for (const [id, link] of [['l-null', null], ['l-empty', ''], ['l-http', 'http://example.com'], ['l-https', 'https://example.com/jobs/1?x=1#top'],
    ['l-upper', 'HTTPS://EXAMPLE.COM/Path'], ['l-port', 'https://example.com:8443/a'], ['l-max', `https://example.com/${'a'.repeat(2048 - 'https://example.com/'.length)}`]]) {
    sql(insert(A, { id, link }));
  }
  for (const link of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'ftp://example.com', 'intent://x#Intent;end',
    'mailto:a@b.c', 'example.com', '//example.com', 'https://', 'https:///path', 'https://exa mple.com', ' https://example.com', 'https://example.com ',
    'https://example.com/\nx', `https://example.com/${'a'.repeat(2049 - 'https://example.com/'.length)}`]) {
    assert.match(errorFor(insert(A, { id: 'bad-link', link })), /job_applications_link_check/, JSON.stringify(link.slice(0, 40)));
  }
});

test('OWNER: an authenticated owner can select, insert, update and delete their own rows', () => {
  sql(`${auth(A)} ${insert(A, { id: 'own' })}`);
  assert.equal(sql(`${auth(A)} select company from public.job_applications where id='own'`), 'Acme');
  sql(`${auth(A)} update public.job_applications set status='offer', notes='n' where id='own'`);
  assert.equal(sql(`select status||':'||notes from public.job_applications where id='own'`), 'offer:n');
  sql(`${auth(A)} delete from public.job_applications where id='own'`);
  assert.equal(count(`id='own' and user_id='${A}'`), 0);
});

test('OTHER USER: B cannot select, update or delete A\'s rows, and cannot insert one for A', () => {
  sql(insert(A, { id: 'a-private', notes: 'private note' }));
  assert.equal(sql(`${auth(B)} select count(*) from public.job_applications where user_id='${A}'`), '0');
  assert.equal(sql(`${auth(B)} select count(*) from public.job_applications`), '1', 'B sees only their own legacy row');
  assert.equal(sql(`${auth(B)} update public.job_applications set notes='hijacked' where user_id='${A}' returning id`), '');
  assert.equal(sql(`${auth(B)} delete from public.job_applications where user_id='${A}' returning id`), '');
  assert.match(errorFor(`${auth(B)} ${insert(A, { id: 'forged' })}`), /row-level security/);
  assert.equal(sql(`select notes from public.job_applications where id='a-private'`), 'private note');
  assert.equal(count(`id='forged'`), 0);
});

test('OWNERSHIP: a row can never be reassigned to another user, in either direction', () => {
  assert.match(errorFor(`${auth(A)} update public.job_applications set user_id='${B}' where id='a-private'`), /row-level security/);
  assert.match(errorFor(`${auth(B)} update public.job_applications set user_id='${A}' where id='b-legacy'`), /row-level security/);
  assert.equal(sql(`select user_id from public.job_applications where id='a-private'`), A);
  assert.equal(sql(`select user_id from public.job_applications where id='b-legacy'`), B);
});

test('ANON: no privilege at all, so every operation is denied', () => {
  assert.equal(privileges('anon'), '');
  for (const statement of ['select count(*) from public.job_applications', insert(A, { id: 'anon-write' }),
    `update public.job_applications set notes='x'`, 'delete from public.job_applications', 'truncate public.job_applications']) {
    assert.match(errorFor(`${auth(null, 'anon')} ${statement}`), /permission denied for table job_applications/, statement.slice(0, 40));
  }
});

test('PUBLIC and authenticated: row CRUD only - no TRUNCATE, TRIGGER, REFERENCES or MAINTAIN', () => {
  assert.equal(publicPrivileges(), '');
  assert.equal(privileges('authenticated'), 'DELETE,INSERT,SELECT,UPDATE');
  assert.match(errorFor(`${auth(A)} truncate public.job_applications`), /permission denied for table job_applications/);
  assert.match(errorFor(`${auth(A)} create trigger t before insert on public.job_applications for each row execute function pg_catalog.suppress_redundant_updates_trigger()`), /permission denied|must be owner/);
  assert.equal(count() > 0, true, 'the failed TRUNCATE removed nothing');
});

test('AUTH REQUIRED: an authenticated role without a user id sees and writes nothing', () => {
  assert.equal(sql(`${auth(null)} select count(*) from public.job_applications`), '0');
  assert.match(errorFor(`${auth(null)} ${insert(A, { id: 'no-sub' })}`), /row-level security/);
});

test('POLICIES: exactly four owner policies, each TO authenticated, none TO public', () => {
  assert.equal(policies(), [
    'job_applications_owner_delete:DELETE:{authenticated}',
    'job_applications_owner_insert:INSERT:{authenticated}',
    'job_applications_owner_select:SELECT:{authenticated}',
    'job_applications_owner_update:UPDATE:{authenticated}',
  ].join('|'));
  assert.equal(sql(`select relrowsecurity::text from pg_class where oid='public.job_applications'::regclass`), 'true');
});

test('SERVICE ROLE and postgres: privileges are exactly what they were before the migration', () => {
  assert.equal(privileges('service_role'), baseline.service);
  assert.equal(privileges('postgres'), baseline.postgres);
});

test('ACCOUNT DELETION: the user\'s applications cascade away and nobody else\'s do', () => {
  assert.notEqual(count(`user_id='${A}'`), 0);
  sql(`delete from auth.users where id='${A}'`);
  assert.equal(count(`user_id='${A}'`), 0);
  assert.equal(count(`user_id='${B}'`), 1);
});

test('SCOPE: the migration names no relation but public.job_applications and creates no other object', () => {
  const code = fs.readFileSync(MIGRATION, 'utf8').split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.deepEqual([...new Set(code.match(/public\.[a-z_]+/g))], ['public.job_applications']);
  assert.doesNotMatch(code, /\b(?:create|drop)\s+(?:function|schema|role|extension|index|trigger|view|table)\b/i);
});
