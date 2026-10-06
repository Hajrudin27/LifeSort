// APP-060 applied-template boundary against a disposable local Postgres cluster.
// The production migration is applied verbatim; no remote Supabase is touched.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bin = path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app060-'));
const cluster = path.join(scratch, 'db');
const port = '55460';
const OWNER = '10000000-0000-4000-8000-000000000001';
const BOB = '10000000-0000-4000-8000-000000000002';
const CAROL = '10000000-0000-4000-8000-000000000003';
const DAVE = '10000000-0000-4000-8000-000000000004';
const TRIP = 'trip-shared';
let started = false;

const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', port, '-U', 'postgres', '-d', 'postgres'];
const sql = (source) => execFileSync(path.join(bin, 'psql'), args, {
  input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
}).trim();
function errorFor(source) {
  try { sql(source); } catch (error) { return String(error.stderr); }
  assert.fail('SQL unexpectedly succeeded');
}
const claims = (userId, role = 'authenticated') => JSON.stringify({ sub: userId, role }).replace(/'/g, "''");
const as = (userId, source) => sql(`set role authenticated; set request.jwt.claim.sub='${userId}';
  set request.jwt.claims='${claims(userId)}'; ${source}`);
const apply = (userId, { trip = TRIP, id = 'travel-essentials', version = 1, itemId = 'copy-1', label = 'Passport' } = {}) =>
  as(userId, `select public.apply_trip_packing_template(
    '${trip}', '${userId}'::uuid, '${id}', ${version},
    '[{"id":"${itemId}","label":"${label}","category":"essentials"}]'::jsonb)`);
const applications = (userId, trip = TRIP) => JSON.parse(as(userId,
  `select coalesce(json_agg(a order by a.template_id, a.template_version), '[]')
   from public.list_trip_packing_template_applications('${trip}') a`));

before(() => {
  execFileSync(path.join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-l', path.join(scratch, 'postgres.log'), '-o', `-k ${scratch} -p ${port} -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  sql(`create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${OWNER}'),('${BOB}'),('${CAROL}'),('${DAVE}');

    create table public.trips(
      id text not null unique, user_id uuid not null references auth.users(id) on delete cascade,
      name text not null, primary key(user_id,id));
    create table public.trip_participants(
      trip_id text not null, owner_id uuid not null, user_id uuid not null,
      invited_email text not null, status text not null, primary key(trip_id,user_id));
    create table public.trip_packing_items(
      id text not null unique, user_id uuid not null references auth.users(id),
      trip_id text not null references public.trips(id) on delete cascade,
      label text not null, checked boolean not null default false,
      category text not null check(category in ('essentials','clothing','electronics','toiletries','other')),
      primary key(user_id,id));
    grant usage on schema public to authenticated, anon;
    grant select on public.trips, public.trip_participants, public.trip_packing_items to authenticated;

    insert into public.trips values
      ('${TRIP}','${OWNER}','Shared'),
      ('trip-second','${OWNER}','Second'),
      ('trip-other','${DAVE}','Other'),
      ('trip-delete','${OWNER}','Delete');
    insert into public.trip_participants values
      ('${TRIP}','${OWNER}','${BOB}','bob@example.test','accepted'),
      ('${TRIP}','${OWNER}','${CAROL}','carol@example.test','pending');
    insert into public.trip_packing_items values
      ('manual-passport','${OWNER}','${TRIP}','Passport',false,'essentials');`);

  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20261006120000_app060_packing_template_applications.sql'), 'utf8'));
});

after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('IDENTITY: a manually identical item is not an application marker', () => {
  assert.deepEqual(applications(OWNER), []);
  assert.equal(sql(`select count(*) from public.trip_packing_items where trip_id='${TRIP}' and label='Passport'`), '1');
});

test('ATOMIC APPLY: exact id/version is claimed once while other templates and versions remain distinct', () => {
  assert.equal(apply(OWNER), 'applied');
  assert.equal(apply(OWNER, { itemId: 'repeat-would-insert' }), 'already-applied');
  assert.equal(apply(OWNER, { version: 2, itemId: 'v2-copy' }), 'applied');
  assert.equal(apply(OWNER, { id: 'weekend-basics', version: 1, itemId: 'weekend-copy' }), 'applied');
  assert.deepEqual(applications(OWNER).map(({ template_id, template_version }) =>
    `${template_id}@${template_version}`), [
    'travel-essentials@1', 'travel-essentials@2', 'weekend-basics@1',
  ]);
  assert.equal(sql("select count(*) from public.trip_packing_items where id='repeat-would-insert'"), '0');
  assert.equal(sql(`select count(*) from public.trip_packing_items where trip_id='${TRIP}'`), '4');
  assert.equal(apply(OWNER, { trip: 'trip-second', itemId: 'second-trip-copy' }), 'applied');
  assert.equal(applications(OWNER, 'trip-second').length, 1);
});

test('AUTHORIZATION: accepted participants share Trip state; pending and unrelated accounts cannot read or apply', () => {
  assert.equal(apply(BOB, { id: 'participant-kit', itemId: 'bob-copy' }), 'applied');
  assert.equal(applications(BOB).some((row) => row.template_id === 'participant-kit'), true);
  assert.deepEqual(applications(CAROL), []);
  assert.deepEqual(applications(DAVE), []);
  assert.match(errorFor(`set role authenticated; set request.jwt.claim.sub='${CAROL}';
    select public.apply_trip_packing_template('${TRIP}','${CAROL}'::uuid,'denied',1,'[]'::jsonb)`), /trip_access_denied/);
  assert.match(errorFor(`set role authenticated; set request.jwt.claim.sub='${DAVE}';
    select public.apply_trip_packing_template('${TRIP}','${DAVE}'::uuid,'denied',1,'[]'::jsonb)`), /trip_access_denied/);
  assert.match(errorFor(`set role authenticated; set request.jwt.claim.sub='${OWNER}';
    select public.apply_trip_packing_template('${TRIP}','${BOB}'::uuid,'wrong-account',1,'[]'::jsonb)`), /account_mismatch/);
  assert.match(errorFor(`set role authenticated; select * from public.trip_packing_template_applications`), /permission denied/);
  assert.match(errorFor(`set role anon; select public.list_trip_packing_template_applications('${TRIP}')`), /permission denied/);
});

test('HARDENING AND LIFECYCLE: functions pin search_path and Trip deletion cascades markers and rows', () => {
  assert.equal(sql(`select count(*) from pg_proc where proname in
    ('apply_trip_packing_template','list_trip_packing_template_applications')
    and proconfig @> array['search_path=public, pg_temp']`), '2');
  assert.equal(apply(OWNER, { trip: 'trip-delete', id: 'delete-kit', itemId: 'delete-copy' }), 'applied');
  sql("delete from public.trips where id='trip-delete'");
  assert.equal(sql("select count(*) from public.trip_packing_template_applications where trip_id='trip-delete'"), '0');
  assert.equal(sql("select count(*) from public.trip_packing_items where trip_id='trip-delete'"), '0');
});
