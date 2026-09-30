// APP-058: build the pre-APP-058 schema in a disposable local Postgres cluster —
// the documents history (APP-055/056), then the trip tables exactly as the remote
// schema declares them (statements lifted from the migration file), then the
// sharing-security migration — seed legacy data, and apply the APP-058 migration
// itself. Nothing here is a hand-written approximation of a migration under test.
//
// Every access check runs as a real `authenticated` session with JWT claims, never
// as the superuser. Fail-closed cases run the migration against copies of the
// pre-migration database that have been given data which breaks one invariant.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bin = path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app058-'));
const cluster = path.join(scratch, 'db');
const port = '55458';

/** The approved baseline APP-058 was built on. Every migration it contains is history. */
const BASELINE_COMMIT = '21e417c7d60703e1b08fe0beb2b22fe7f557aafe';
const APP058 = '20260930141858_app058_trip_canonical_entity.sql';
const REMOTE_SCHEMA = '20260902112000_remote_schema.sql';
const SHARING_FIX = '20260906090000_fix_trip_sharing_rls.sql';
const WARRANTY_DOMAIN = '20260930122303_app057_warranty_domain.sql'; // supplies documents(user_id, id), the FK target
const DOCUMENT_MIGRATIONS = [
  '20260925090000_private_document_bucket.sql',
  '20260925225633_app055_harden_document_window_search_path.sql',
  '20260927204302_app056_document_delete_cascade.sql',
];

const OWNER = '10000000-0000-4000-8000-000000000001';
const BOB = '10000000-0000-4000-8000-000000000002'; // accepted participant
const CAROL = '10000000-0000-4000-8000-000000000003'; // pending participant
const DAVE = '10000000-0000-4000-8000-000000000004'; // unrelated attacker
const ERIN = '10000000-0000-4000-8000-000000000005'; // owner of a second trip
const FRAN = '10000000-0000-4000-8000-000000000006'; // fills the compatibility buffer, then is deleted
const GRACE = '10000000-0000-4000-8000-000000000007'; // the concurrent-cap test
const USERS = { OWNER, BOB, CAROL, DAVE, ERIN };

const doc = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const objectPath = (userId, documentId) => `${userId}/${documentId}`;
const TRIP = 'trip-owner-1'; // the shared trip (Bob accepted, Carol pending)
const LEGACY_TRIP = '1693000000000-abc'; // a legacy timestamp-shaped id
const OTHER_TRIP = 'trip-erin-1';

let started = false;
let migrationSql;

function psqlArgs(db) {
  return ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', port, '-U', 'postgres', '-d', db];
}
function sqlIn(db, source) {
  return execFileSync(path.join(bin, 'psql'), psqlArgs(db), {
    input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
const sql = (source) => sqlIn('main', source);
function errorFor(source, db = 'main') {
  try { sqlIn(db, source); } catch (error) { return String(error.stderr); }
  assert.fail('SQL unexpectedly succeeded');
}
const claims = (userId) => JSON.stringify({ sub: userId, role: 'authenticated', iat: Math.floor(Date.now() / 1000) }).replace(/'/g, "''");
const asRole = (role, userId, source) =>
  `set role ${role}; set request.jwt.claim.sub = '${userId}'; set request.jwt.claims = '${claims(userId)}'; ${source}`;
const as = (userId, source, db = 'main') => sqlIn(db, asRole('authenticated', userId, source));

function remoteStatements() {
  const remote = fs.readFileSync(path.join(root, 'supabase/migrations', REMOTE_SCHEMA), 'utf8');
  return remote.split(/;\s*\n/)
    .filter((s) => /"public"\."(trips|trip_expenses|trip_packing_items|trip_participants|warranties)"/.test(s))
    .map((s) => `${s.trim()};`);
}

/* ------------------------------------------------ concurrent sessions */

function openSession() {
  const child = spawn(path.join(bin, 'psql'), psqlArgs('main'), { stdio: ['pipe', 'pipe', 'pipe'] });
  const out = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => { out.stdout += chunk; });
  child.stderr.on('data', (chunk) => { out.stderr += chunk; });
  const closed = new Promise((resolve) => child.on('close', (code) => resolve({ code, ...out })));
  return {
    send: (source) => child.stdin.write(`${source}\n`),
    finish: () => { child.stdin.end(); return closed; },
    kill: () => child.kill('SIGKILL'),
  };
}
async function waitFor(check, label, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const sessionsLike = (fragment, condition) => Number(sql(`select count(*) from pg_stat_activity
  where pid <> pg_backend_pid() and query like '%${fragment}%' and ${condition}`));

const insertTrip = (userId, id, { start = '2027-05-01', end = '2027-05-08', destination } = {}, db = 'main') =>
  as(userId, `insert into public.trips (id, user_id, name, start_date, end_date${destination === undefined ? '' : ', destination'})
    values ('${id}', '${userId}', 'Synthetic trip', '${start}', '${end}'${destination === undefined ? '' : `, '${destination}'`}) returning id`, db);
const insertExpense = (author, id, tripId, db = 'main') =>
  as(author, `insert into public.trip_expenses (id, user_id, trip_id, name, amount, category)
    values ('${id}', '${author}', '${tripId}', 'Synthetic', 10, 'food') returning id`, db);
const insertPacking = (author, id, tripId, db = 'main') =>
  as(author, `insert into public.trip_packing_items (id, user_id, trip_id, label)
    values ('${id}', '${author}', '${tripId}', 'Synthetic') returning id`, db);
function seedDocument(userId, documentId) {
  const p = objectPath(userId, documentId);
  sql(`insert into storage.objects (bucket_id, name) values ('documents', '${p}');
       insert into public.documents (id, user_id, storage_path, original_name)
       values ('${documentId}', '${userId}', '${p}', 'private-name.pdf');`);
}
const link = (userId, tripId, documentId) => as(userId, `insert into public.trip_document_references (user_id, trip_id, document_id)
  values ('${userId}', '${tripId}', '${documentId}') returning document_id`);
const objects = (documentId) => Number(sql(`select count(*) from storage.objects where bucket_id='documents' and name like '%/${documentId}'`));
const count = (table, where) => Number(sql(`select count(*) from public.${table} where ${where}`));
const begin = (userId, documentId) => JSON.parse(as(userId, `select public.begin_my_document_deletion('${documentId}')::text`));
const finalize = (userId, documentId) => as(userId, `select public.finalize_my_document_deletion('${documentId}')`);
function deleteDocumentLikeTheClient(userId, documentId) {
  const started = begin(userId, documentId);
  if (started.status !== 'ready') return started.status;
  as(userId, `delete from storage.objects where bucket_id='documents' and name='${started.storage_path}'`);
  return finalize(userId, documentId);
}

before(() => {
  execFileSync(path.join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-l', path.join(scratch, 'postgres.log'), '-o', `-k ${scratch} -p ${port} -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  migrationSql = fs.readFileSync(path.join(root, 'supabase/migrations', APP058), 'utf8');

  sqlIn('postgres', 'create database base');
  sqlIn('base', `create role authenticated; create role anon; create role service_role;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth, storage to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    grant execute on function auth.jwt() to authenticated, anon, service_role;
    create table auth.users (id uuid primary key, email text);
    create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
    declare parts text[]; begin parts := string_to_array(name, '/'); return parts[1:array_length(parts, 1) - 1]; end $$;
    grant execute on function storage.foldername(text) to authenticated, anon, service_role;
    create table storage.buckets (id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[], created_at timestamptz not null default now());
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null references storage.buckets (id),
      name text not null, owner uuid, created_at timestamptz not null default now(), unique (bucket_id, name));
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to authenticated;
    grant select on storage.objects to anon;
    grant select, insert, update, delete on storage.objects to service_role;
    grant select on storage.buckets to authenticated, anon, service_role;
    insert into storage.buckets (id, name, public, file_size_limit) values ('attachments', 'attachments', false, 25 * 1024 * 1024);
    insert into auth.users (id, email) values
      ('${OWNER}', 'owner@example.test'), ('${BOB}', 'bob@example.test'), ('${CAROL}', 'carol@example.test'),
      ('${DAVE}', 'dave@example.test'), ('${ERIN}', 'erin@example.test'), ('${FRAN}', 'fran@example.test'), ('${GRACE}', 'grace@example.test');`);
  for (const migration of DOCUMENT_MIGRATIONS) {
    sqlIn('base', fs.readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8'));
  }
  const statements = remoteStatements();
  // 5 tables + 5 RLS enables + 4 user FKs + 4 grants + every policy on them.
  assert.ok(statements.length >= 40, `extracted only ${statements.length} statements`);
  for (const statement of statements) sqlIn('base', statement);
  sqlIn('base', fs.readFileSync(path.join(root, 'supabase/migrations', SHARING_FIX), 'utf8'));
  sqlIn('base', fs.readFileSync(path.join(root, 'supabase/migrations', WARRANTY_DOMAIN), 'utf8'));

  // Legacy data as pre-APP-058 clients left it: valid trips, a shared trip with an
  // accepted and a pending invitee, and children written by owner AND participant.
  sqlIn('base', `insert into public.trips (id, user_id, name, start_date, end_date, budget) values
      ('${TRIP}', '${OWNER}', 'Shared trip', '2027-05-01', '2027-05-08', 5000),
      ('${LEGACY_TRIP}', '${OWNER}', 'Legacy trip', '2026-07-01', '2026-07-01', null),
      ('${OTHER_TRIP}', '${ERIN}', 'Erin trip', '2027-06-01', '2027-06-05', null);
    insert into public.trip_participants (trip_id, owner_id, user_id, invited_email, status) values
      ('${TRIP}', '${OWNER}', '${BOB}', 'bob@example.test', 'accepted'),
      ('${TRIP}', '${OWNER}', '${CAROL}', 'carol@example.test', 'pending');
    insert into public.trip_expenses (id, user_id, trip_id, name, amount, category) values
      ('legacy-exp-owner', '${OWNER}', '${TRIP}', 'Owner expense', 100, 'food'),
      ('legacy-exp-bob', '${BOB}', '${TRIP}', 'Bob expense', 50, 'food'),
      ('legacy-exp-erin', '${ERIN}', '${OTHER_TRIP}', 'Erin expense', 70, 'food');
    insert into public.trip_packing_items (id, user_id, trip_id, label) values
      ('legacy-pack-owner', '${OWNER}', '${TRIP}', 'Passport'),
      ('legacy-pack-bob', '${BOB}', '${TRIP}', 'Charger');`);

  // Fail-closed copies, each broken in exactly one way, before the migration exists.
  const broken = {
    dirty_dates: `insert into public.trips (id, user_id, name, start_date, end_date) values ('bad-dates', '${OWNER}', 'x', '2027-02-02', '2027-02-01')`,
    dirty_expense: `insert into public.trip_expenses (id, user_id, trip_id, name, amount, category) values ('orphan-e', '${OWNER}', 'no-such-trip', 'x', 1, 'food')`,
    dirty_packing: `insert into public.trip_packing_items (id, user_id, trip_id, label) values ('orphan-p', '${OWNER}', 'no-such-trip', 'x')`,
    // Authors nobody can vouch for: a stranger, and a participant who never accepted.
    // The same shape is what a removed participant's legitimate rows look like, which is
    // why the migration will not decide and stops for a person to resolve them.
    dirty_author_expense: `insert into public.trip_expenses (id, user_id, trip_id, name, amount, category) values ('who-e', '${DAVE}', '${TRIP}', 'x', 1, 'food')`,
    dirty_author_packing: `insert into public.trip_packing_items (id, user_id, trip_id, label) values ('who-p', '${CAROL}', '${TRIP}', 'x')`,
    dirty_participant: `alter table public.trip_participants disable trigger all;
      insert into public.trip_participants (trip_id, owner_id, user_id, invited_email, status) values ('${TRIP}', '${ERIN}', '${DAVE}', 'dave@example.test', 'pending')`,
  };
  sqlIn('postgres', 'create database main template base');
  for (const [name, breakage] of Object.entries(broken)) {
    sqlIn('postgres', `create database ${name} template base`);
    sqlIn(name, breakage);
  }
  sqlIn('main', migrationSql);
});

after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});

/* ------------------------------------------------------ migration hygiene */

test('HISTORY: every migration in the approved baseline is byte-identical, and APP-058 is new and last', () => {
  const historical = execFileSync('git', ['ls-tree', '--name-only', `${BASELINE_COMMIT}:supabase/migrations`], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.ok(historical.includes('20260930122303_app057_warranty_domain.sql'));
  assert.ok(!historical.includes(APP058));
  for (const file of historical) {
    const atBaseline = execFileSync('git', ['show', `${BASELINE_COMMIT}:supabase/migrations/${file}`], { cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    assert.ok(atBaseline.equals(fs.readFileSync(path.join(root, 'supabase/migrations', file))), `${file} was edited`);
  }
  assert.ok(historical.every((file) => file < APP058));
});

test('MIGRATION: applies forward and keeps every legacy row exactly as it was', () => {
  assert.equal(count('trips', 'true'), 3);
  assert.equal(count('trip_expenses', 'true'), 3);
  assert.equal(count('trip_packing_items', 'true'), 2);
  assert.equal(count('trip_participants', 'true'), 2);
  assert.equal(sql(`select name || '|' || start_date || '|' || end_date || '|' || coalesce(budget::text,'') from public.trips where id='${TRIP}'`),
    'Shared trip|2027-05-01|2027-05-08|5000');
  // Nothing was invented for rows that never recorded a destination.
  assert.equal(count('trips', 'destination is not null'), 0);
  assert.equal(sql(`select is_nullable from information_schema.columns where table_schema='public' and table_name='trips' and column_name='destination'`), 'YES');
  assert.equal(sql(`select column_default is null from information_schema.columns where table_schema='public' and table_name='trips' and column_name='destination'`), 't');
});

test('FAIL CLOSED: data that breaks an invariant stops the migration, names a count and changes nothing', () => {
  const expectations = {
    dirty_dates: [/1 trip\(s\) end before they start/, 'trips'],
    dirty_expense: [/1 trip expense row\(s\) name a trip that does not exist/, 'trip_expenses'],
    dirty_packing: [/1 packing item row\(s\) name a trip that does not exist/, 'trip_packing_items'],
    dirty_author_expense: [/1 trip expense row\(s\) were written by someone who is neither the trip's owner nor an accepted participant/, 'trip_expenses'],
    dirty_author_packing: [/1 packing item row\(s\) were written by someone who is neither the trip's owner nor an accepted participant/, 'trip_packing_items'],
    dirty_participant: [/1 participant row\(s\) do not match their trip's owner/, 'trip_participants'],
  };
  for (const [db, [message, table]] of Object.entries(expectations)) {
    const before = sqlIn(db, `select count(*) from public.${table}`);
    const error = errorFor(migrationSql, db);
    assert.match(error, message);
    // No row, id or name is echoed, and no data was deleted to make room.
    assert.doesNotMatch(error, /bad-dates|orphan-|no-such-trip|who-e|who-p|Synthetic|dave@/);
    assert.equal(sqlIn(db, `select count(*) from public.${table}`), before);
    assert.equal(sqlIn(db, `select count(*) from information_schema.columns where table_schema='public' and table_name='trips' and column_name='destination'`), '0');
    assert.equal(sqlIn(db, `select to_regclass('public.trip_document_references') is null`), 't');
  }
});

/* ---------------------------------------------------------- canonical trip */

test('TRIP: destination is optional for legacy inserts, dates are ordered, same day is fine', () => {
  // A pre-APP-058 client insert omits destination and stays valid.
  assert.equal(insertTrip(OWNER, 'legacy-style-insert'), 'legacy-style-insert');
  assert.equal(count('trips', `id='legacy-style-insert' and destination is null`), 1);
  assert.equal(insertTrip(OWNER, 'with-destination', { destination: 'Rome' }), 'with-destination');
  assert.equal(insertTrip(OWNER, 'same-day', { start: '2027-08-08', end: '2027-08-08' }), 'same-day');
  assert.equal(insertTrip(OWNER, 'leap-day', { start: '2028-02-29', end: '2028-02-29' }), 'leap-day');

  assert.match(errorFor(asRole('authenticated', OWNER, `insert into public.trips (id, user_id, name, start_date, end_date)
    values ('backwards', '${OWNER}', 'x', '2027-08-09', '2027-08-08')`)), /violates check constraint "trips_start_not_after_end"/);
  assert.equal(count('trips', `id='backwards'`), 0);
  // An impossible day never reaches the constraint; the date type refuses it.
  assert.match(errorFor(asRole('authenticated', OWNER, `insert into public.trips (id, user_id, name, start_date, end_date)
    values ('impossible', '${OWNER}', 'x', '2027-02-29', '2027-03-01')`)), /out of range/);
});

test('TRIP: a blank or oversized destination is refused, and the check is on the column only', () => {
  for (const bad of ["''", "'   '", `'${'x'.repeat(201)}'`]) {
    assert.match(errorFor(asRole('authenticated', OWNER, `insert into public.trips (id, user_id, name, start_date, end_date, destination)
      values ('bad-dest', '${OWNER}', 'x', '2027-01-01', '2027-01-02', ${bad})`)), /trips_destination_not_blank/);
  }
  assert.equal(count('trips', `id='bad-dest'`), 0);
});

test('STALE CLIENT: a pre-APP-058 upsert keeps its destination, and an invalid legacy-style date order is now refused', () => {
  insertTrip(OWNER, 'stale-upsert', { destination: 'Lisbon', start: '2027-09-01', end: '2027-09-05' });
  // PostgREST merge upsert of an old client: it names no destination column.
  as(OWNER, `insert into public.trips (id, user_id, name, start_date, end_date, budget)
    values ('stale-upsert', '${OWNER}', 'Renamed on old phone', '2027-09-01', '2027-09-06', 900)
    on conflict (user_id, id) do update set name = excluded.name, start_date = excluded.start_date,
      end_date = excluded.end_date, budget = excluded.budget`);
  assert.equal(sql(`select name || '|' || destination || '|' || end_date from public.trips where id='stale-upsert'`), 'Renamed on old phone|Lisbon|2027-09-06');
  // The compatibility consequence: an old client that moves the end before the start
  // used to succeed. It is now refused, and that client ignores the error.
  assert.match(errorFor(asRole('authenticated', OWNER, `update public.trips set end_date = '2027-08-31' where id='stale-upsert'`)),
    /trips_start_not_after_end/);
  assert.equal(sql(`select end_date from public.trips where id='stale-upsert'`), '2027-09-06');
});

/* ----------------------------------------------------------- parent relations */

test('PARENT: a child must name a real trip; author may be a participant; a foreign trip is refused', () => {
  assert.equal(insertExpense(OWNER, 'p-owner-exp', TRIP), 'p-owner-exp');
  assert.equal(insertExpense(BOB, 'p-bob-exp', TRIP), 'p-bob-exp');
  assert.equal(insertPacking(OWNER, 'p-owner-pack', TRIP), 'p-owner-pack');
  assert.equal(insertPacking(BOB, 'p-bob-pack', TRIP), 'p-bob-pack');

  // A trip that does not exist: refused by the foreign key, superuser or not.
  assert.match(errorFor(`insert into public.trip_expenses (id, user_id, trip_id, name, amount, category)
    values ('bogus', '${OWNER}', 'no-such-trip', 'x', 1, 'food')`), /trip_expenses_trip_id_fkey/);
  assert.match(errorFor(`insert into public.trip_packing_items (id, user_id, trip_id, label)
    values ('bogus', '${OWNER}', 'no-such-trip', 'x')`), /trip_packing_items_trip_id_fkey/);

  // A trip that exists but is not theirs: refused by the tightened write policy.
  for (const [who, table, cols, vals] of [
    [DAVE, 'trip_expenses', 'id, user_id, trip_id, name, amount, category', `'x-d', '${DAVE}', '${TRIP}', 'x', 1, 'food'`],
    [CAROL, 'trip_expenses', 'id, user_id, trip_id, name, amount, category', `'x-c', '${CAROL}', '${TRIP}', 'x', 1, 'food'`],
    [DAVE, 'trip_packing_items', 'id, user_id, trip_id, label', `'x-d', '${DAVE}', '${TRIP}', 'x'`],
    [CAROL, 'trip_packing_items', 'id, user_id, trip_id, label', `'x-c', '${CAROL}', '${TRIP}', 'x'`],
  ]) {
    assert.match(errorFor(asRole('authenticated', who, `insert into public.${table} (${cols}) values (${vals})`)), /row-level security/);
  }
  assert.equal(count('trip_expenses', `id in ('x-d','x-c')`) + count('trip_packing_items', `id in ('x-d','x-c')`), 0);
});

test('PARENT: moving your own row onto a trip you may not write to is refused', () => {
  insertExpense(BOB, 'move-exp', TRIP); insertPacking(BOB, 'move-pack', TRIP);
  assert.match(errorFor(asRole('authenticated', BOB, `update public.trip_expenses set trip_id='${OTHER_TRIP}' where id='move-exp'`)), /trip_identity_immutable|row-level security/);
  assert.match(errorFor(asRole('authenticated', BOB, `update public.trip_packing_items set trip_id='${OTHER_TRIP}' where id='move-pack'`)), /trip_identity_immutable|row-level security/);
  assert.equal(count('trip_expenses', `id='move-exp' and trip_id='${TRIP}'`), 1);
});
test('PARENT: participant rows are owner-bound', () => {
  // Owner and trip must match: this pair is what the trip's primary key expresses.
  assert.match(errorFor(`insert into public.trip_participants (trip_id, owner_id, user_id, invited_email, status)
    values ('${TRIP}', '${ERIN}', '${DAVE}', 'dave@example.test', 'pending')`), /trip_participants_trip_owner_fkey/);
  assert.match(errorFor(`insert into public.trip_participants (trip_id, owner_id, user_id, invited_email, status)
    values ('no-such-trip', '${OWNER}', '${DAVE}', 'dave@example.test', 'pending')`), /trip_participants_trip_owner_fkey/);
  // Through the real invite function, as the owner, for their own trip.
  as(OWNER, `select public.invite_trip_participant('${LEGACY_TRIP}', 'dave@example.test')`);
  assert.equal(count('trip_participants', `trip_id='${LEGACY_TRIP}' and user_id='${DAVE}' and status='pending'`), 1);
  // And still refused for someone else's trip.
  assert.match(errorFor(asRole('authenticated', DAVE, `select public.invite_trip_participant('${TRIP}', 'dave@example.test')`)), /trip_not_found/);
});

test('AUTHOR: user_id is the author — a participant cannot write a row in anyone else\'s name', () => {
  // A trip with two accepted participants, so "another accepted participant" exists.
  insertTrip(OWNER, 'multi-trip');
  as(OWNER, `insert into public.trip_participants (trip_id, owner_id, user_id, invited_email, status)
    values ('multi-trip', '${OWNER}', '${BOB}', 'bob@example.test', 'pending'), ('multi-trip', '${OWNER}', '${CAROL}', 'carol@example.test', 'pending')`);
  as(BOB, `update public.trip_participants set status='accepted' where trip_id='multi-trip'`);
  as(CAROL, `update public.trip_participants set status='accepted' where trip_id='multi-trip'`);

  const expense = (actor, author, id) => asRole('authenticated', actor, `insert into public.trip_expenses (id, user_id, trip_id, name, amount, category)
    values ('${id}', '${author}', 'multi-trip', 'x', 1, 'food')`);
  const packing = (actor, author, id) => asRole('authenticated', actor, `insert into public.trip_packing_items (id, user_id, trip_id, label)
    values ('${id}', '${author}', 'multi-trip', 'x')`);

  // Bob is an accepted participant. He cannot sign as the owner or as Carol.
  for (const [author, label] of [[OWNER, 'owner'], [CAROL, 'carol']]) {
    assert.match(errorFor(expense(BOB, author, `sp-e-${label}`)), /row-level security/);
    assert.match(errorFor(packing(BOB, author, `sp-p-${label}`)), /row-level security/);
  }
  // Pending and unrelated accounts still fail, as anyone.
  for (const actor of [DAVE]) {
    for (const author of [actor, OWNER, BOB]) {
      assert.match(errorFor(expense(actor, author, 'sp-x')), /row-level security/);
      assert.match(errorFor(packing(actor, author, 'sp-y')), /row-level security/);
    }
  }
  assert.equal(count('trip_expenses', `id like 'sp-%'`) + count('trip_packing_items', `id like 'sp-%'`), 0);

  // The legitimate cases are untouched: Bob writes his own, the owner writes theirs.
  assert.equal(sql(asRole('authenticated', BOB, `insert into public.trip_expenses (id, user_id, trip_id, name, amount, category)
    values ('ok-bob', '${BOB}', 'multi-trip', 'x', 1, 'food') returning user_id`)), BOB);
  assert.equal(sql(asRole('authenticated', BOB, `insert into public.trip_packing_items (id, user_id, trip_id, label)
    values ('ok-bob-p', '${BOB}', 'multi-trip', 'x') returning user_id`)), BOB);
  assert.equal(insertExpense(OWNER, 'ok-owner', 'multi-trip'), 'ok-owner');
  assert.equal(insertPacking(OWNER, 'ok-owner-p', 'multi-trip'), 'ok-owner-p');
  assert.equal(count('trip_expenses', `id='ok-bob' and user_id='${BOB}'`), 1);
});

test('AUTHOR: the old participant INSERT policies are gone, and content editing by participants is kept', () => {
  assert.equal(sql(`select count(*) from pg_policies where schemaname='public' and cmd='INSERT'
    and tablename in ('trip_expenses','trip_packing_items') and policyname like 'Participants can insert%'`), '0');
  assert.equal(sql(`select count(*) from pg_policies where schemaname='public' and tablename in ('trip_expenses','trip_packing_items')
    and policyname like 'Participants can %' and cmd in ('SELECT','UPDATE','DELETE')`), '6');
  // Bob can still edit the CONTENT of a row the owner wrote on a trip he belongs to.
  assert.equal(as(BOB, `update public.trip_expenses set name='Edited by Bob' where id='ok-owner' returning name`), 'Edited by Bob');
  assert.equal(as(BOB, `update public.trip_packing_items set checked=true where id='ok-owner-p' returning checked`), 't');
  assert.equal(count('trip_expenses', `id='ok-owner' and user_id='${OWNER}'`), 1);
});

test('IDENTITY: id, user_id and trip_id cannot be changed by anyone, on any of the three tables', () => {
  const attempts = [
    // [who, sql, table]
    [BOB, `update public.trip_expenses set user_id='${BOB}' where id='ok-owner'`],       // take authorship
    [BOB, `update public.trip_expenses set user_id='${OWNER}' where id='ok-bob'`],       // sign as owner
    [BOB, `update public.trip_expenses set user_id='${CAROL}' where id='ok-bob'`],       // sign as Carol
    [OWNER, `update public.trip_expenses set user_id='${BOB}' where id='ok-owner'`],     // owner re-attributes
    [OWNER, `update public.trip_expenses set trip_id='${TRIP}' where id='ok-owner'`],    // move within owned trips
    [OWNER, `update public.trip_expenses set id='renamed' where id='ok-owner'`],
    [BOB, `update public.trip_packing_items set user_id='${OWNER}' where id='ok-bob-p'`],
    [OWNER, `update public.trip_packing_items set trip_id='${TRIP}' where id='ok-owner-p'`],
    [OWNER, `update public.trip_packing_items set id='renamed' where id='ok-owner-p'`],
    [BOB, `update public.trips set user_id='${BOB}' where id='multi-trip'`],             // take a trip over
    [OWNER, `update public.trips set user_id='${BOB}' where id='multi-trip'`],
    [OWNER, `update public.trips set id='renamed-trip' where id='multi-trip'`],
  ];
  const before = sql(`select md5(string_agg(t::text, '|' order by t::text)) from (
    select id, user_id, trip_id from public.trip_expenses union all select id, user_id, trip_id from public.trip_packing_items
    union all select id, user_id, id from public.trips) t`);
  for (const [who, statement] of attempts) {
    assert.match(errorFor(asRole('authenticated', who, statement)), /trip_identity_immutable|row-level security|violates foreign key/, statement);
  }
  assert.equal(sql(`select md5(string_agg(t::text, '|' order by t::text)) from (
    select id, user_id, trip_id from public.trip_expenses union all select id, user_id, trip_id from public.trip_packing_items
    union all select id, user_id, id from public.trips) t`), before);
  // Ordinary updates that leave identity alone still work — including the client's own upsert shape.
  as(OWNER, `insert into public.trip_expenses (id, user_id, trip_id, name, amount, category)
    values ('ok-owner', '${OWNER}', 'multi-trip', 'Owner again', 2, 'food')
    on conflict (user_id, id) do update set name = excluded.name, user_id = excluded.user_id, trip_id = excluded.trip_id`);
  assert.equal(count('trip_expenses', `id='ok-owner' and user_id='${OWNER}' and name='Owner again'`), 1);
});

test('IDENTITY: the trigger function is not callable by clients and pins its search_path', () => {
  assert.equal(sql(`select p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='trip_identity_is_immutable'`), 'false:search_path=pg_catalog, pg_temp');
  assert.equal(sql(`select count(*) from information_schema.routine_privileges where routine_schema='public'
    and routine_name='trip_identity_is_immutable' and grantee in ('anon','PUBLIC','authenticated')`), '0');
});

/* ------------------------------ old-client compatibility buffer (finding 5) */

const WINDOW_MINUTES = 15;
const queued = (where = 'true') => Number(sql(`select count(*) from public.trip_packing_compat_queue where ${where}`));
const packingRow = (actor, id, tripId, label = 'Passport', category = 'essentials', db = 'main') =>
  as(actor, `insert into public.trip_packing_items (id, user_id, trip_id, label, category)
    values ('${id}', '${actor}', '${tripId}', '${label}', '${category}')`, db);
/** Exactly the request an old client sends for its new trip. */
const oldClientTrip = (actor, id) => as(actor, `insert into public.trips (id, user_id, name, start_date, end_date)
  values ('${id}', '${actor}', 'Old client trip', '2027-07-01', '2027-07-05')`);

test('COMPAT A: packing commits before its trip → after the trip it appears once, canonically', () => {
  packingRow(OWNER, 'ca-1', 'compat-a');
  // Set aside, not canonical, and the request itself succeeded.
  assert.equal(count('trip_packing_items', `id='ca-1'`), 0);
  assert.equal(queued(`trip_id='compat-a'`), 1);

  oldClientTrip(OWNER, 'compat-a');
  assert.equal(count('trip_packing_items', `id='ca-1' and trip_id='compat-a' and user_id='${OWNER}' and label='Passport' and category='essentials'`), 1);
  assert.equal(queued(`trip_id='compat-a'`), 0);
});

test('COMPAT B: a whole default list before the trip is adopted exactly once, field for field', () => {
  // One statement with several rows, as a batch upsert sends them.
  as(OWNER, `insert into public.trip_packing_items (id, user_id, trip_id, label, checked, category) values
    ('cb-1', '${OWNER}', 'compat-b', 'Passport', false, 'essentials'),
    ('cb-2', '${OWNER}', 'compat-b', 'Wallet', true, 'essentials'),
    ('cb-3', '${OWNER}', 'compat-b', 'Charger', false, 'electronics'),
    ('cb-4', '${OWNER}', 'compat-b', 'Toothbrush', false, 'toiletries'),
    ('cb-5', '${OWNER}', 'compat-b', 'Medication', false, 'toiletries')`);
  assert.equal(count('trip_packing_items', `trip_id='compat-b'`), 0);
  assert.equal(queued(`trip_id='compat-b'`), 5);

  oldClientTrip(OWNER, 'compat-b');
  assert.equal(sql(`select string_agg(id || ':' || label || ':' || checked || ':' || category, ',' order by id)
    from public.trip_packing_items where trip_id='compat-b'`),
  'cb-1:Passport:false:essentials,cb-2:Wallet:true:essentials,cb-3:Charger:false:electronics,cb-4:Toothbrush:false:toiletries,cb-5:Medication:false:toiletries');
  assert.equal(queued(`trip_id='compat-b'`), 0);
});

test('COMPAT B2: the same list sent as separate requests, some before and some after the trip', () => {
  packingRow(OWNER, 'cb2-1', 'compat-b2'); packingRow(OWNER, 'cb2-2', 'compat-b2');
  oldClientTrip(OWNER, 'compat-b2');
  packingRow(OWNER, 'cb2-3', 'compat-b2'); // the trip exists now: straight into the canonical table
  assert.equal(count('trip_packing_items', `trip_id='compat-b2'`), 3);
  assert.equal(queued(`trip_id='compat-b2'`), 0);
});

test('COMPAT C: trip first → direct canonical insert, and the buffer is never touched', () => {
  insertTrip(OWNER, 'compat-c');
  const before = queued();
  assert.equal(packingRow(OWNER, 'cc-1', 'compat-c').length >= 0, true);
  assert.equal(count('trip_packing_items', `id='cc-1' and trip_id='compat-c'`), 1);
  assert.equal(queued(), before);
  assert.equal(queued(`trip_id='compat-c'`), 0);
  // A participant\'s own row on a shared trip goes the same direct way.
  packingRow(BOB, 'cc-bob', TRIP);
  assert.equal(count('trip_packing_items', `id='cc-bob'`), 1);
  assert.equal(queued(`id='cc-bob'`), 0);
});

test('COMPAT D: another account\'s queued rows for a trip id are never adopted into the owner\'s trip', () => {
  packingRow(DAVE, 'cd-dave', 'compat-d');
  assert.equal(queued(`id='cd-dave' and user_id='${DAVE}'`), 1);

  oldClientTrip(OWNER, 'compat-d');
  assert.equal(count('trip_packing_items', `trip_id='compat-d'`), 0);
  assert.equal(count('trip_packing_items', `id='cd-dave'`), 0);
  // It can never be valid now, so it is gone rather than left to rot.
  assert.equal(queued(`trip_id='compat-d'`), 0);

  // And an attacker cannot queue a row in another account's name.
  assert.match(errorFor(asRole('authenticated', DAVE, `insert into public.trip_packing_items (id, user_id, trip_id, label)
    values ('cd-forged', '${OWNER}', 'compat-d2', 'x')`)), /row-level security|trip_packing_items_trip_id_fkey/);
  assert.equal(queued(`id='cd-forged'`), 0);
});

test('COMPAT E: an expired set-aside row is never adopted, and is removed', () => {
  packingRow(OWNER, 'ce-old', 'compat-e');
  packingRow(OWNER, 'ce-fresh', 'compat-e');
  sql(`update public.trip_packing_compat_queue set queued_at = now() - interval '${WINDOW_MINUTES} minutes' - interval '1 second' where id = 'ce-old'`);

  oldClientTrip(OWNER, 'compat-e');
  assert.equal(count('trip_packing_items', `id='ce-old'`), 0);
  assert.equal(count('trip_packing_items', `id='ce-fresh'`), 1);
  assert.equal(queued(`trip_id='compat-e'`), 0);
  // Just inside the window is still adopted.
  packingRow(OWNER, 'ce-edge', 'compat-e2');
  sql(`update public.trip_packing_compat_queue set queued_at = now() - interval '${WINDOW_MINUTES} minutes' + interval '30 seconds' where id = 'ce-edge'`);
  oldClientTrip(OWNER, 'compat-e2');
  assert.equal(count('trip_packing_items', `id='ce-edge'`), 1);
});

test('COMPAT E2: cleanup is opportunistic, per account, and honest about its reach', () => {
  packingRow(OWNER, 'ce2-stale', 'compat-never-created');
  packingRow(BOB, 'ce2-bob-stale', 'compat-never-created-bob');
  sql(`update public.trip_packing_compat_queue set queued_at = now() - interval '2 hours' where id in ('ce2-stale', 'ce2-bob-stale')`);
  // The owner\'s next compatible activity removes the owner\'s expired rows...
  packingRow(OWNER, 'ce2-next', 'compat-never-created-2');
  assert.equal(queued(`id='ce2-stale'`), 0);
  // ...and nothing removes another account\'s: there is no scheduler.
  assert.equal(queued(`id='ce2-bob-stale'`), 1);
  // Expired or not, no client can read it.
  assert.match(errorFor(asRole('authenticated', BOB, `select * from public.trip_packing_compat_queue`)), /permission denied/);
});

test('COMPAT F: an old client\'s retry never duplicates a canonical row', () => {
  packingRow(OWNER, 'cf-1', 'compat-f'); packingRow(OWNER, 'cf-1', 'compat-f'); // retried before the trip
  assert.equal(queued(`id='cf-1'`), 1);
  oldClientTrip(OWNER, 'compat-f');
  assert.equal(count('trip_packing_items', `id='cf-1'`), 1);

  // Retried after adoption, as a PostgREST upsert: it updates the one row, never adds one.
  as(OWNER, `insert into public.trip_packing_items (id, user_id, trip_id, label, category)
    values ('cf-1', '${OWNER}', 'compat-f', 'Passport (retry)', 'essentials')
    on conflict (user_id, id) do update set label = excluded.label, trip_id = excluded.trip_id, user_id = excluded.user_id`);
  assert.equal(count('trip_packing_items', `id='cf-1'`), 1);
  assert.equal(count('trip_packing_items', `id='cf-1' and label='Passport (retry)'`), 1);
  assert.equal(queued(`id='cf-1'`), 0);

  // Upserting an early row that was already set aside is also a no-op, not a second row.
  const upsertEarly = `insert into public.trip_packing_items (id, user_id, trip_id, label)
    values ('cf-2', '${OWNER}', 'compat-f2', 'x') on conflict (user_id, id) do update set label = excluded.label`;
  as(OWNER, upsertEarly); as(OWNER, upsertEarly);
  assert.equal(queued(`id='cf-2'`), 1);
});

test('COMPAT G: a trip that fails to be created adopts nothing and leaves no canonical packing row', () => {
  packingRow(OWNER, 'cg-1', 'compat-g');
  assert.match(errorFor(asRole('authenticated', OWNER, `insert into public.trips (id, user_id, name, start_date, end_date)
    values ('compat-g', '${OWNER}', 'x', '2027-07-09', '2027-07-01')`)), /trips_start_not_after_end/);
  assert.equal(count('trips', `id='compat-g'`), 0);
  assert.equal(count('trip_packing_items', `trip_id='compat-g'`), 0);
  assert.equal(queued(`id='cg-1'`), 1); // still set aside, still bounded by its window
  // The failed attempt rolled back entirely. A valid trip with the SAME id, by the same
  // account, inside the window is exactly what the set-aside row was waiting for.
  oldClientTrip(OWNER, 'compat-g');
  assert.equal(count('trip_packing_items', `id='cg-1' and trip_id='compat-g'`), 1);
  assert.equal(queued(`id='cg-1'`), 0);
});

test('COMPAT H: an adopted row is an ordinary child — it cascades when the trip is deleted', () => {
  packingRow(OWNER, 'ch-1', 'compat-h'); packingRow(OWNER, 'ch-2', 'compat-h');
  oldClientTrip(OWNER, 'compat-h');
  assert.equal(count('trip_packing_items', `trip_id='compat-h'`), 2);
  as(OWNER, `delete from public.trips where id='compat-h'`);
  assert.equal(count('trip_packing_items', `trip_id='compat-h'`), 0);
  assert.equal(queued(`trip_id='compat-h'`), 0);
});

test('COMPAT I: no client can read or write the buffer, and nothing in it is executable by one', () => {
  for (const role of ['authenticated', 'anon']) {
    for (const statement of [
      'select count(*) from public.trip_packing_compat_queue',
      `insert into public.trip_packing_compat_queue (user_id, id, trip_id, label) values ('${OWNER}', 'x', 'y', 'z')`,
      `update public.trip_packing_compat_queue set label = 'x'`,
      'delete from public.trip_packing_compat_queue',
    ]) {
      assert.match(errorFor(`set role ${role}; set request.jwt.claim.sub = '${OWNER}'; ${statement}`), /permission denied/, `${role}: ${statement}`);
    }
  }
  assert.equal(sql(`select count(*) from information_schema.role_table_grants where table_schema='public'
    and table_name='trip_packing_compat_queue' and grantee in ('anon', 'authenticated', 'PUBLIC')`), '0');
  assert.equal(sql(`select relrowsecurity::text from pg_class where oid='public.trip_packing_compat_queue'::regclass`), 'true');
  assert.equal(sql(`select count(*) from pg_policies where tablename='trip_packing_compat_queue'`), '0');
  assert.equal(sql(`select count(*) from information_schema.routine_privileges where routine_schema='public'
    and routine_name in ('trip_packing_route_early_row', 'trip_packing_adopt_early_rows', 'trip_packing_compat_window')
    and grantee in ('anon', 'authenticated', 'PUBLIC')`), '0');
  assert.equal(sql(`select string_agg(p.proname || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), ''), ' | ' order by p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('trip_packing_route_early_row', 'trip_packing_adopt_early_rows')`),
  'trip_packing_adopt_early_rows:true:search_path=pg_catalog, public, pg_temp | trip_packing_route_early_row:true:search_path=pg_catalog, public, pg_temp');
  // It holds only what a replay needs.
  assert.equal(sql(`select string_agg(column_name, ',' order by column_name) from information_schema.columns
    where table_schema='public' and table_name='trip_packing_compat_queue'`), 'category,checked,id,label,queued_at,trip_id,user_id');
});

test('COMPAT J: what the buffer must NOT do — expenses, other accounts, sessions and sizes', () => {
  // Expenses are not buffered: still refused, for a missing trip.
  assert.match(errorFor(asRole('authenticated', OWNER, `insert into public.trip_expenses (id, user_id, trip_id, name, amount, category)
    values ('cj-e', '${OWNER}', 'compat-none', 'x', 1, 'food')`)), /row-level security|trip_expenses_trip_id_fkey/);
  assert.equal(queued(`id='cj-e'`), 0);
  // No session: nothing is buffered, and the foreign key still speaks.
  assert.match(errorFor(`insert into public.trip_packing_items (id, user_id, trip_id, label) values ('cj-s', '${OWNER}', 'compat-none', 'x')`), /trip_packing_items_trip_id_fkey/);
  // A trip that exists but is not yours is still refused by the policy, not buffered.
  assert.match(errorFor(asRole('authenticated', DAVE, `insert into public.trip_packing_items (id, user_id, trip_id, label)
    values ('cj-d', '${DAVE}', '${TRIP}', 'x')`)), /row-level security/);
  assert.equal(queued(`id in ('cj-s', 'cj-d')`), 0);
  // No placeholder trip is ever created.
  assert.equal(count('trips', `id in ('compat-none', 'compat-cap', 'compat-never-created', 'compat-never-created-2', 'compat-f2', 'compat-d2')`), 0);
  // The buffer is bounded per account.
  as(FRAN, `insert into public.trip_packing_items (id, user_id, trip_id, label)
    select 'cap-' || g, '${FRAN}', 'compat-cap', 'x' from generate_series(1, 500) g`);
  assert.equal(queued(`user_id='${FRAN}'`), 500);
  assert.match(errorFor(asRole('authenticated', FRAN, `insert into public.trip_packing_items (id, user_id, trip_id, label)
    values ('cap-501', '${FRAN}', 'compat-cap', 'x')`)), /row-level security|trip_packing_items_trip_id_fkey/);
  assert.equal(queued(`user_id='${FRAN}'`), 500);
});

test('COMPAT K: account deletion removes whatever is still set aside', () => {
  // FRAN\'s 500 rows above are still queued; deleting the account must take them.
  assert.ok(queued(`user_id='${FRAN}'`) > 0);
  sql(`delete from auth.users where id='${FRAN}'`);
  assert.equal(queued(`user_id='${FRAN}'`), 0);
});

test('COMPAT L: the race is real and overlapping — trip transaction open while the packing request arrives', async () => {
  const tripSession = openSession();
  const packSession = openSession();
  try {
    tripSession.send(`${asRole('authenticated', OWNER, '')} begin;
      insert into public.trips (id, user_id, name, start_date, end_date)
      values ('compat-l', '${OWNER}', 'x', '2027-01-01', '2027-01-02');
      select 'trip_row_written_l';`);
    await waitFor(() => sessionsLike('trip_row_written_l', "state = 'idle in transaction'") === 1, 'trip transaction to hold its row');

    // The packing request finds no (committed) trip, and must WAIT for the trip\'s
    // transaction instead of deciding on a stale view of it.
    packSession.send(`${asRole('authenticated', OWNER, '')}
      insert into public.trip_packing_items (id, user_id, trip_id, label) values ('cl-1', '${OWNER}', 'compat-l', 'Passport') /* pack_l */;`);
    await waitFor(() => sessionsLike('pack_l', "wait_event_type = 'Lock'") === 1, 'the packing request to wait for the trip');

    tripSession.send('commit;');
    const committed = await tripSession.finish();
    const packed = await packSession.finish();
    assert.equal(committed.code, 0, committed.stderr);
    assert.equal(packed.code, 0, packed.stderr);
  } finally {
    tripSession.kill(); packSession.kill();
  }
  // Seen the committed trip, so it went straight in: once, canonical, nothing buffered.
  assert.equal(count('trip_packing_items', `id='cl-1' and trip_id='compat-l'`), 1);
  assert.equal(queued(`trip_id='compat-l'`), 0);
});

test('COMPAT M: the other overlap — packing set aside in an open transaction while the trip arrives', async () => {
  const packSession = openSession();
  const tripSession = openSession();
  try {
    packSession.send(`${asRole('authenticated', OWNER, '')} begin;
      insert into public.trip_packing_items (id, user_id, trip_id, label) values ('cm-1', '${OWNER}', 'compat-m', 'Passport');
      select 'packing_set_aside_m';`);
    await waitFor(() => sessionsLike('packing_set_aside_m', "state = 'idle in transaction'") === 1, 'the packing transaction');

    tripSession.send(`${asRole('authenticated', OWNER, '')}
      insert into public.trips (id, user_id, name, start_date, end_date) values ('compat-m', '${OWNER}', 'x', '2027-01-01', '2027-01-02') /* trip_m */;`);
    await waitFor(() => sessionsLike('trip_m', "wait_event_type = 'Lock'") === 1, 'the trip to wait for the set-aside row');

    packSession.send('commit;');
    const packed = await packSession.finish();
    const created = await tripSession.finish();
    assert.equal(packed.code, 0, packed.stderr);
    assert.equal(created.code, 0, created.stderr);
  } finally {
    packSession.kill(); tripSession.kill();
  }
  // The adopter saw the committed row: adopted once, nothing orphaned.
  assert.equal(count('trip_packing_items', `id='cm-1' and trip_id='compat-m'`), 1);
  assert.equal(queued(`trip_id='compat-m'`), 0);
});

test('COMPAT N: the per-account cap holds when two requests for DIFFERENT missing trips arrive together', async () => {
  // GRACE has 499 of her 500 rows queued. Two concurrent requests then each want the last slot.
  as(GRACE, `insert into public.trip_packing_items (id, user_id, trip_id, label)
    select 'g-' || g, '${GRACE}', 'cap2-seed', 'x' from generate_series(1, 499) g`);
  assert.equal(queued(`user_id='${GRACE}'`), 499);

  const first = openSession();
  const second = openSession();
  try {
    // The first takes the slot inside an open transaction...
    first.send(`${asRole('authenticated', GRACE, '')} begin;
      insert into public.trip_packing_items (id, user_id, trip_id, label) values ('g-first', '${GRACE}', 'cap2-trip-a', 'x');
      select 'first_holds_the_slot';`);
    await waitFor(() => sessionsLike('first_holds_the_slot', "state = 'idle in transaction'") === 1, 'the first request');
    // ...and the second, for a DIFFERENT trip id (so a different trip lock), must wait for it
    // rather than counting 499 beside it.
    second.send(`${asRole('authenticated', GRACE, '')}
      insert into public.trip_packing_items (id, user_id, trip_id, label) values ('g-second', '${GRACE}', 'cap2-trip-b', 'x') /* second_wants_it */;`);
    await waitFor(() => sessionsLike('second_wants_it', "wait_event_type = 'Lock'") === 1, 'the second request to wait on the account');

    // A different account is not held up by GRACE\'s lock.
    assert.equal(as(DAVE, `insert into public.trip_packing_items (id, user_id, trip_id, label)
      values ('d-indep', '${DAVE}', 'cap2-dave', 'x') returning id`), '');
    assert.equal(queued(`id='d-indep'`), 1);

    first.send('commit;');
    const a = await first.finish();
    const b = await second.finish();
    assert.equal(a.code, 0, a.stderr);
    assert.notEqual(b.code, 0, 'the excess request must be refused');
    assert.match(b.stderr, /row-level security|trip_packing_items_trip_id_fkey/);
  } finally {
    first.kill(); second.kill();
  }
  assert.equal(queued(`user_id='${GRACE}'`), 500);
  assert.equal(queued(`id='g-first'`), 1);
  assert.equal(queued(`id='g-second'`), 0);
});

test('COMPAT O: two accounts filling the buffer at once do not block or deadlock each other', async () => {
  const one = openSession();
  const two = openSession();
  try {
    one.send(`${asRole('authenticated', DAVE, '')} begin;
      insert into public.trip_packing_items (id, user_id, trip_id, label) values ('o-1', '${DAVE}', 'cap2-o1', 'x');
      select 'dave_open';`);
    await waitFor(() => sessionsLike('dave_open', "state = 'idle in transaction'") === 1, 'the first account');
    two.send(`${asRole('authenticated', BOB, '')}
      insert into public.trip_packing_items (id, user_id, trip_id, label) values ('o-2', '${BOB}', 'cap2-o2', 'x');`);
    const done = await two.finish(); // completes while the first is still open
    assert.equal(done.code, 0, done.stderr);
    one.send('commit;');
    assert.equal((await one.finish()).code, 0);
  } finally { one.kill(); two.kill(); }
  assert.equal(queued(`id in ('o-1', 'o-2')`), 2);
});

test('COMPAT P: expiry is decided on the wall clock, not at transaction start', () => {
  // One long transaction: the set-aside row is aged (by an operator) to expire 0.6 s after the
  // update, and the trip arrives 1.2 s after that. By wall-clock time the row has expired.
  // With transaction-start time — the transaction began ~2.4 s earlier — it would still look
  // fresh and be adopted.
  sql(`begin;
    set local role authenticated; set local request.jwt.claim.sub = '${OWNER}'; set local request.jwt.claims = '${claims(OWNER)}';
    insert into public.trip_packing_items (id, user_id, trip_id, label) values ('wc-1', '${OWNER}', 'wall-clock-trip', 'x');
    reset role;
    select pg_sleep(1.2);
    update public.trip_packing_compat_queue set queued_at = clock_timestamp() - public.trip_packing_compat_window() + interval '0.6 seconds' where id = 'wc-1';
    select pg_sleep(1.2);
    set local role authenticated;
    insert into public.trips (id, user_id, name, start_date, end_date) values ('wall-clock-trip', '${OWNER}', 'x', '2027-01-01', '2027-01-02');
    commit;`);
  assert.equal(count('trips', `id='wall-clock-trip'`), 1);
  assert.equal(count('trip_packing_items', `id='wc-1'`), 0, 'an expired row was adopted');
  assert.equal(queued(`id='wc-1'`), 0);
});

test('COMPAT Q: queued_at is the real time of queuing, not the transaction start', () => {
  sql(`begin;
    set local role authenticated; set local request.jwt.claim.sub = '${OWNER}'; set local request.jwt.claims = '${claims(OWNER)}';
    insert into public.trip_packing_items (id, user_id, trip_id, label) values ('wq-1', '${OWNER}', 'wq-trip-a', 'x');
    select pg_sleep(0.3);
    insert into public.trip_packing_items (id, user_id, trip_id, label) values ('wq-2', '${OWNER}', 'wq-trip-b', 'x');
    commit;`);
  assert.equal(sql(`select (max(queued_at) - min(queued_at) >= interval '0.25 seconds')::text
    from public.trip_packing_compat_queue where id in ('wq-1', 'wq-2')`), 'true');
});

/* ------------------------ deletion that matches what the user was shown (review #2) */

const dependencies = (userId, tripId) => JSON.parse(as(userId, `select public.trip_deletion_preview('${tripId}')::text`));
const deleteIfMatching = (userId, tripId, c) => JSON.parse(as(userId,
  `select public.delete_trip_if_dependencies_match('${tripId}', ${c.expenses}, ${c.packing_items}, ${c.participants}, ${c.documents})::text`));
/** A shared trip with Bob accepted, one expense, one packing item and one linked document. */
function sharedTrip(id, documentNumber) {
  insertTrip(OWNER, id);
  as(OWNER, `insert into public.trip_participants (trip_id, owner_id, user_id, invited_email, status) values ('${id}', '${OWNER}', '${BOB}', 'bob@example.test', 'pending'), ('${id}', '${OWNER}', '${CAROL}', 'carol@example.test', 'pending')`);
  as(BOB, `update public.trip_participants set status='accepted' where trip_id='${id}'`);
  insertExpense(OWNER, `${id}-e1`, id); insertPacking(OWNER, `${id}-p1`, id);
  const d = doc(documentNumber); seedDocument(OWNER, d); link(OWNER, id, d);
  return d;
}
const stripStatus = ({ status, ...counts }) => counts;

test('DELETE RPC: matching counts delete the trip and cascade; the linked Document survives', () => {
  const d = sharedTrip('rpc-match', 60);
  const shown = dependencies(OWNER, 'rpc-match');
  assert.deepEqual(stripStatus(shown), { expenses: 1, packing_items: 1, participants: 2, documents: 1 });

  assert.deepEqual(deleteIfMatching(OWNER, 'rpc-match', shown), { status: 'deleted' });
  assert.equal(count('trips', `id='rpc-match'`), 0);
  for (const table of ['trip_expenses', 'trip_packing_items', 'trip_participants', 'trip_document_references']) {
    assert.equal(count(table, `trip_id='rpc-match'`), 0, table);
  }
  assert.equal(count('documents', `id='${d}'`), 1);
  // Repeating it answers "no such trip" rather than pretending, which is what lets a client converge.
  assert.deepEqual(deleteIfMatching(OWNER, 'rpc-match', shown), { status: 'not-found' });
});

test('DELETE RPC: a participant adds an expense after the preview → changed, nothing deleted, fresh counts, then a second confirmation deletes', () => {
  sharedTrip('rpc-changed-e', 61);
  const shown = dependencies(OWNER, 'rpc-changed-e');
  insertExpense(BOB, 'rpc-changed-e-bob', 'rpc-changed-e'); // between preview and confirmation

  const answer = deleteIfMatching(OWNER, 'rpc-changed-e', shown);
  assert.deepEqual(answer, { status: 'changed', expenses: 2, packing_items: 1, participants: 2, documents: 1 });
  assert.equal(count('trips', `id='rpc-changed-e'`), 1);
  assert.equal(count('trip_expenses', `trip_id='rpc-changed-e'`), 2);
  assert.deepEqual(stripStatus(dependencies(OWNER, 'rpc-changed-e')), stripStatus(answer)); // the fresh preview is the same

  assert.deepEqual(deleteIfMatching(OWNER, 'rpc-changed-e', stripStatus(answer)), { status: 'deleted' });
  assert.equal(count('trip_expenses', `trip_id='rpc-changed-e'`), 0);
});

test('DELETE RPC: the same for a packing item, a document link and an invitation', () => {
  sharedTrip('rpc-changed-p', 62);
  let shown = dependencies(OWNER, 'rpc-changed-p');
  insertPacking(BOB, 'rpc-changed-p-bob', 'rpc-changed-p');
  let answer = deleteIfMatching(OWNER, 'rpc-changed-p', shown);
  assert.equal(answer.status, 'changed'); assert.equal(answer.packing_items, 2);

  shown = stripStatus(answer);
  const d2 = doc(63); seedDocument(OWNER, d2); link(OWNER, 'rpc-changed-p', d2); // another device of the owner
  answer = deleteIfMatching(OWNER, 'rpc-changed-p', shown);
  assert.equal(answer.status, 'changed'); assert.equal(answer.documents, 2);

  shown = stripStatus(answer);
  as(OWNER, `insert into public.trip_participants (trip_id, owner_id, user_id, invited_email, status) values ('rpc-changed-p', '${OWNER}', '${DAVE}', 'dave@example.test', 'pending')`);
  answer = deleteIfMatching(OWNER, 'rpc-changed-p', shown);
  assert.equal(answer.status, 'changed'); assert.equal(answer.participants, 3);

  assert.equal(count('trips', `id='rpc-changed-p'`), 1);
  assert.equal(deleteIfMatching(OWNER, 'rpc-changed-p', stripStatus(answer)).status, 'deleted');
});

test('DELETE RPC: a missing, null or partial expectation never deletes', () => {
  sharedTrip('rpc-null', 64);
  assert.equal(JSON.parse(as(OWNER, `select public.delete_trip_if_dependencies_match('rpc-null', null, null, null, null)::text`)).status, 'changed');
  assert.equal(deleteIfMatching(OWNER, 'rpc-null', { expenses: 1, packing_items: 1, participants: 2, documents: 0 }).status, 'changed');
  assert.equal(deleteIfMatching(OWNER, 'rpc-null', { expenses: 0, packing_items: 0, participants: 0, documents: 0 }).status, 'changed');
  assert.equal(count('trips', `id='rpc-null'`), 1);
});

test('DELETE RPC: a participant, a pending invitee and a stranger can never delete, and get the preview\'s answers', () => {
  sharedTrip('rpc-authz', 65);
  const right = { expenses: 1, packing_items: 1, participants: 2, documents: 1 };
  assert.deepEqual(deleteIfMatching(BOB, 'rpc-authz', right), { status: 'not-owner' });
  for (const who of [CAROL, DAVE]) {
    assert.deepEqual(deleteIfMatching(who, 'rpc-authz', right), { status: 'not-found' });
  }
  // A stranger cannot tell a trip that exists from one that does not.
  assert.deepEqual(deleteIfMatching(DAVE, 'no-such-trip-at-all', right), { status: 'not-found' });
  assert.deepEqual(deleteIfMatching(DAVE, 'rpc-authz', right), deleteIfMatching(DAVE, 'no-such-trip-at-all', right));
  assert.equal(count('trips', `id='rpc-authz'`), 1);
  // No session, and anon.
  assert.match(errorFor(`select public.delete_trip_if_dependencies_match('rpc-authz', 1, 1, 2, 1)`), /not_authenticated/);
  assert.match(errorFor(`set role anon; select public.delete_trip_if_dependencies_match('rpc-authz', 1, 1, 2, 1)`), /permission denied/);
  assert.equal(count('trips', `id='rpc-authz'`), 1);
  // Pinned, definer, authenticated only.
  assert.equal(sql(`select p.prosecdef::text || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p
    where p.proname='delete_trip_if_dependencies_match'`), 'true:v:search_path=public, pg_temp');
  assert.equal(sql(`select string_agg(grantee, ',' order by grantee) from information_schema.routine_privileges
    where routine_name='delete_trip_if_dependencies_match' and grantee not in ('postgres')`), 'authenticated');
});

test('DELETE RPC: a child insert already in flight is counted, not lost', async () => {
  sharedTrip('rpc-inflight', 66);
  const shown = dependencies(OWNER, 'rpc-inflight');
  const writer = openSession();
  const deleter = openSession();
  try {
    writer.send(`${asRole('authenticated', BOB, '')} begin;
      insert into public.trip_expenses (id, user_id, trip_id, name, amount, category) values ('rpc-inflight-x', '${BOB}', 'rpc-inflight', 'x', 1, 'food');
      select 'child_insert_open';`);
    await waitFor(() => sessionsLike('child_insert_open', "state = 'idle in transaction'") === 1, 'the open child insert');
    deleter.send(`${asRole('authenticated', OWNER, '')}
      select public.delete_trip_if_dependencies_match('rpc-inflight', ${shown.expenses}, ${shown.packing_items}, ${shown.participants}, ${shown.documents})::text /* inflight_delete */;`);
    await waitFor(() => sessionsLike('inflight_delete', "wait_event_type = 'Lock'") === 1, 'the delete to wait for the child');
    writer.send('commit;');
    await writer.finish();
    const result = await deleter.finish();
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout.trim().split('\n').pop()).status, 'changed'); // it saw the new child
  } finally { writer.kill(); deleter.kill(); }
  assert.equal(count('trips', `id='rpc-inflight'`), 1);
  assert.equal(count('trip_expenses', `id='rpc-inflight-x'`), 1);
});

test('DELETE RPC: no child can commit between the locked recount and the delete', async () => {
  sharedTrip('rpc-lock', 67);
  const shown = dependencies(OWNER, 'rpc-lock');
  const deleter = openSession();
  const writer = openSession();
  try {
    // The delete runs in an open transaction: recount done, row deleted, not yet committed.
    deleter.send(`${asRole('authenticated', OWNER, '')} begin;
      select public.delete_trip_if_dependencies_match('rpc-lock', ${shown.expenses}, ${shown.packing_items}, ${shown.participants}, ${shown.documents})::text;
      select 'delete_holds_the_row';`);
    await waitFor(() => sessionsLike('delete_holds_the_row', "state = 'idle in transaction'") === 1, 'the open delete');
    writer.send(`${asRole('authenticated', BOB, '')}
      insert into public.trip_expenses (id, user_id, trip_id, name, amount, category) values ('rpc-lock-late', '${BOB}', 'rpc-lock', 'x', 1, 'food') /* late_child */;`);
    await waitFor(() => sessionsLike('late_child', "wait_event_type = 'Lock'") === 1, 'the late child insert to wait');
    deleter.send('commit;');
    const deleted = await deleter.finish();
    const late = await writer.finish();
    assert.equal(deleted.code, 0, deleted.stderr);
    assert.match(deleted.stdout, /"status": "deleted"/);
    assert.notEqual(late.code, 0, 'the late child must be refused');
    assert.match(late.stderr, /trip_expenses_trip_id_fkey|row-level security/);
  } finally { deleter.kill(); writer.kill(); }
  assert.equal(count('trips', `id='rpc-lock'`), 0);
  assert.equal(count('trip_expenses', `trip_id='rpc-lock'`), 0); // nothing survived to be orphaned
});

test('DELETE RPC: the initial read, trip_deletion_preview, is still there and unchanged in kind', () => {
  assert.equal(sql(`select count(*) from pg_proc where proname='trip_deletion_preview'`), '1');
});

/* -------------------------------------------------------- document references */

test('DOCUMENTS: the schema stores ids only', () => {
  assert.equal(sql(`select string_agg(column_name || ':' || data_type, ',' order by column_name) from information_schema.columns
    where table_schema='public' and table_name='trip_document_references'`),
  'created_at:timestamp with time zone,document_id:uuid,trip_id:text,user_id:uuid');
  assert.equal(sql(`select string_agg(a.attname, ',' order by k.n) from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality k(attnum, n)
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
    where c.conrelid='public.trip_document_references'::regclass and c.contype='p'`), 'user_id,trip_id,document_id');
  assert.equal(sql(`select string_agg(pg_get_constraintdef(oid), ' ; ' order by conname) from pg_constraint
    where conrelid='public.trip_document_references'::regclass and contype='f'`),
  'FOREIGN KEY (user_id, document_id) REFERENCES documents(user_id, id) ON DELETE CASCADE ; FOREIGN KEY (user_id, trip_id) REFERENCES trips(user_id, id) ON DELETE CASCADE');
});

test('DOCUMENTS: own trip and own document link; duplicates, foreign documents and foreign trips are refused', () => {
  const mine = doc(1); const erins = doc(2);
  seedDocument(OWNER, mine); seedDocument(ERIN, erins);

  assert.equal(link(OWNER, TRIP, mine), mine);
  assert.match(errorFor(asRole('authenticated', OWNER, `insert into public.trip_document_references (user_id, trip_id, document_id)
    values ('${OWNER}', '${TRIP}', '${mine}')`)), /trip_document_references_pkey|duplicate key/);
  // Another account's document, and another account's trip: each refused, and refused
  // exactly like an id that does not exist, so neither is an existence oracle.
  const foreignDoc = errorFor(asRole('authenticated', OWNER, `insert into public.trip_document_references (user_id, trip_id, document_id)
    values ('${OWNER}', '${TRIP}', '${erins}')`));
  const missingDoc = errorFor(asRole('authenticated', OWNER, `insert into public.trip_document_references (user_id, trip_id, document_id)
    values ('${OWNER}', '${TRIP}', '${doc(99)}')`));
  assert.match(foreignDoc, /trip_document_references_document_fkey/);
  assert.equal(foreignDoc.replace(erins, '<id>'), missingDoc.replace(doc(99), '<id>'));
  assert.match(errorFor(asRole('authenticated', OWNER, `insert into public.trip_document_references (user_id, trip_id, document_id)
    values ('${OWNER}', '${OTHER_TRIP}', '${mine}')`)), /trip_document_references_trip_fkey/);
  // Writing the row in someone else's name is not possible either.
  assert.match(errorFor(asRole('authenticated', DAVE, `insert into public.trip_document_references (user_id, trip_id, document_id)
    values ('${OWNER}', '${TRIP}', '${mine}')`)), /row-level security/);
  assert.match(errorFor(asRole('authenticated', BOB, `insert into public.trip_document_references (user_id, trip_id, document_id)
    values ('${BOB}', '${TRIP}', '${mine}')`)), /violates foreign key|row-level security/);
  assert.equal(count('trip_document_references', 'true') >= 1, true);
});

test('DOCUMENTS: deleting a document removes only the link; deleting a trip removes only the link', () => {
  const d1 = doc(10); const d2 = doc(11);
  seedDocument(OWNER, d1); seedDocument(OWNER, d2);
  insertTrip(OWNER, 'doc-trip-a'); insertTrip(OWNER, 'doc-trip-b');
  link(OWNER, 'doc-trip-a', d1); link(OWNER, 'doc-trip-a', d2); link(OWNER, 'doc-trip-b', d1);

  // The real APP-056 lifecycle: begin, remove the object, finalize.
  assert.equal(deleteDocumentLikeTheClient(OWNER, d1), 'deleted');
  assert.equal(count('documents', `id='${d1}'`), 0);
  assert.equal(count('trip_document_references', `document_id='${d1}'`), 0);
  assert.equal(count('trips', `id in ('doc-trip-a','doc-trip-b')`), 2);
  assert.equal(count('trip_document_references', `trip_id='doc-trip-a' and document_id='${d2}'`), 1);

  // Deleting the trip removes its link and keeps the standalone document, bytes and row.
  as(OWNER, `delete from public.trips where id='doc-trip-a'`);
  assert.equal(count('trip_document_references', `trip_id='doc-trip-a'`), 0);
  assert.equal(count('documents', `id='${d2}'`), 1);
  assert.equal(objects(d2), 1);
});

test('DOCUMENTS: links are owner-only — participants and outsiders cannot read, infer or change them', () => {
  const d = doc(20);
  seedDocument(OWNER, d);
  insertTrip(OWNER, 'doc-private-trip');
  as(OWNER, `insert into public.trip_participants (trip_id, owner_id, user_id, invited_email, status)
    values ('doc-private-trip', '${OWNER}', '${BOB}', 'bob@example.test', 'pending')`);
  as(BOB, `update public.trip_participants set status='accepted' where trip_id='doc-private-trip'`);
  link(OWNER, 'doc-private-trip', d);

  assert.equal(as(OWNER, `select count(*) from public.trip_document_references where trip_id='doc-private-trip'`), '1');
  // The accepted participant sees the trip, and none of what it links to.
  assert.equal(as(BOB, `select count(*) from public.trips where id='doc-private-trip'`), '1');
  for (const who of [BOB, CAROL, DAVE]) {
    assert.equal(as(who, `select count(*) from public.trip_document_references`), '0');
    assert.equal(as(who, `select count(*) from public.documents where id='${d}'`), '0');
    assert.equal(as(who, `delete from public.trip_document_references where document_id='${d}' returning 1`), '');
  }
  assert.match(errorFor(asRole('authenticated', OWNER, `update public.trip_document_references set trip_id='x' where document_id='${d}'`)), /permission denied/);
});

test('DOCUMENTS: anon has no access to the relation', () => {
  assert.match(errorFor(`set role anon; select count(*) from public.trip_document_references`), /permission denied/);
  assert.equal(sql(`select count(*) from information_schema.role_table_grants
    where table_schema='public' and table_name='trip_document_references' and grantee in ('anon', 'PUBLIC')`), '0');
  assert.equal(sql(`select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') from information_schema.role_table_grants
    where table_schema='public' and table_name='trip_document_references' and grantee='authenticated'`), 'DELETE,SELECT');
  assert.equal(sql(`select coalesce(string_agg(column_name, ',' order by column_name), '') from information_schema.column_privileges
    where table_schema='public' and table_name='trip_document_references' and grantee='authenticated' and privilege_type='INSERT'`),
  'document_id,trip_id,user_id');
});

/* --------------------------------------------------------------- sharing / RLS */

test('RLS: owner CRUD on their own trip; an unrelated account can neither read nor write it', () => {
  insertTrip(OWNER, 'rls-own');
  assert.equal(as(OWNER, `update public.trips set name='Renamed' where id='rls-own' returning name`), 'Renamed');
  assert.equal(as(DAVE, `select count(*) from public.trips where id in ('rls-own', '${TRIP}')`), '0');
  assert.equal(as(DAVE, `update public.trips set name='x' where id='rls-own' returning id`), '');
  assert.equal(as(DAVE, `delete from public.trips where id='rls-own' returning id`), '');
  assert.match(errorFor(asRole('authenticated', DAVE, `insert into public.trips (id, user_id, name, start_date, end_date)
    values ('spoof', '${OWNER}', 'x', '2027-01-01', '2027-01-02')`)), /row-level security/);
  assert.equal(as(DAVE, `select count(*) from public.trip_expenses where trip_id='${TRIP}'`), '0');
  assert.equal(as(DAVE, `select count(*) from public.trip_packing_items where trip_id='${TRIP}'`), '0');
  assert.equal(as(DAVE, `select count(*) from public.trip_participants where trip_id='${TRIP}'`), '0');
});

test('RLS: the owner reads participant-authored rows; participants keep to their trip; pending sees nothing', () => {
  // Bob wrote rows on the shared trip (legacy data above). The owner must see them.
  assert.equal(as(OWNER, `select string_agg(id, ',' order by id) from public.trip_expenses where trip_id='${TRIP}' and user_id='${BOB}' and id in ('legacy-exp-bob', 'p-bob-exp')`), 'legacy-exp-bob,p-bob-exp');
  assert.equal(as(OWNER, `select string_agg(id, ',' order by id) from public.trip_packing_items where trip_id='${TRIP}' and user_id='${BOB}' and id in ('legacy-pack-bob', 'p-bob-pack')`), 'legacy-pack-bob,p-bob-pack');
  // Owner visibility is read-only: the owner cannot rewrite a participant's row.
  assert.equal(as(OWNER, `update public.trip_expenses set name='forged' where id='legacy-exp-bob' returning id`), '');
  assert.equal(count('trip_expenses', `id='legacy-exp-bob' and name='Bob expense'`), 1);

  // The accepted participant reads the shared trip's rows (owner-authored and theirs)...
  assert.equal(as(BOB, `select count(*) from public.trip_expenses where trip_id='${TRIP}'`), String(count('trip_expenses', `trip_id='${TRIP}'`)));
  assert.ok(count('trip_expenses', `trip_id='${TRIP}' and user_id='${OWNER}'`) >= 2);
  assert.equal(as(BOB, `select count(*) from public.trips where id='${TRIP}'`), '1');
  // ...but nothing of another trip.
  assert.equal(as(BOB, `select count(*) from public.trip_expenses where trip_id='${OTHER_TRIP}'`), '0');
  assert.equal(as(BOB, `select count(*) from public.trips where id='${OTHER_TRIP}'`), '0');

  // The pending invitee sees the trip's data not at all, only their own invitation.
  assert.equal(as(CAROL, `select count(*) from public.trip_expenses where trip_id='${TRIP}'`), '0');
  assert.equal(as(CAROL, `select count(*) from public.trip_packing_items where trip_id='${TRIP}'`), '0');
  assert.equal(as(CAROL, `select count(*) from public.trips where id='${TRIP}'`), '0');
  assert.equal(as(CAROL, `select count(*) from public.trip_participants where trip_id='${TRIP}'`), '1');
});

test('RLS: an attacker cannot use a colliding trip id or a borrowed author id', () => {
  // The global unique index still refuses a second trip with the victim's id.
  assert.match(errorFor(asRole('authenticated', DAVE, `insert into public.trips (id, user_id, name, start_date, end_date)
    values ('${TRIP}', '${DAVE}', 'collision', '2027-01-01', '2027-01-02')`)), /trips_id_globally_unique|duplicate key/);
  // Forged acceptance is still impossible: nobody can accept for someone else.
  assert.match(errorFor(asRole('authenticated', DAVE, `insert into public.trip_participants (trip_id, owner_id, user_id, invited_email, status)
    values ('${TRIP}', '${DAVE}', '${OWNER}', 'x@example.test', 'accepted')`)), /row-level security|trip_participants_trip_owner_fkey/);
  // Nor can the pending invitee accept and then write; a pending row confers nothing.
  assert.match(errorFor(asRole('authenticated', CAROL, `insert into public.trip_expenses (id, user_id, trip_id, name, amount, category)
    values ('c-forge', '${OWNER}', '${TRIP}', 'x', 1, 'food')`)), /row-level security/);
  // The helper is not callable by anon.
  assert.match(errorFor(`set role anon; select public.can_access_trip_row('${TRIP}', '${OWNER}')`), /permission denied/);
  assert.match(errorFor(`set role anon; select public.trip_deletion_preview('${TRIP}')`), /permission denied/);
});

test('RLS: the helper and the preview are SECURITY DEFINER with a pinned search_path and no anon/PUBLIC execute', () => {
  assert.equal(sql(`select string_agg(p.proname || ':' || p.prosecdef || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ','), ''), ' | ' order by p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('can_access_trip_row', 'trip_deletion_preview', 'trip_is_owned_by_caller')`),
  'can_access_trip_row:true:s:search_path=public, pg_temp | trip_deletion_preview:true:s:search_path=public, pg_temp | trip_is_owned_by_caller:true:v:search_path=public, pg_temp');
  assert.equal(sql(`select count(*) from information_schema.routine_privileges
    where routine_schema='public' and routine_name in ('can_access_trip_row', 'trip_deletion_preview', 'trip_is_owned_by_caller')
      and grantee in ('anon', 'PUBLIC')`), '0');
  // can_access_trip_row itself was not modified by APP-058.
  assert.equal(sql(`select md5(pg_get_functiondef('public.can_access_trip_row(text, uuid)'::regprocedure))`),
    sqlIn('base', `select md5(pg_get_functiondef('public.can_access_trip_row(text, uuid)'::regprocedure))`));
});

/* ------------------------------------------------------------ deletion preview */

test('PREVIEW: counts every author, shows linked documents, and answers non-owners without revealing more', () => {
  const d = doc(30);
  seedDocument(OWNER, d);
  insertTrip(OWNER, 'preview-trip');
  as(OWNER, `insert into public.trip_participants (trip_id, owner_id, user_id, invited_email, status)
    values ('preview-trip', '${OWNER}', '${BOB}', 'bob@example.test', 'pending'), ('preview-trip', '${OWNER}', '${CAROL}', 'carol@example.test', 'pending')`);
  as(BOB, `update public.trip_participants set status='accepted' where trip_id='preview-trip'`);
  insertExpense(OWNER, 'pv-e1', 'preview-trip'); insertExpense(BOB, 'pv-e2', 'preview-trip');
  insertPacking(OWNER, 'pv-p1', 'preview-trip'); insertPacking(BOB, 'pv-p2', 'preview-trip'); insertPacking(BOB, 'pv-p3', 'preview-trip');
  link(OWNER, 'preview-trip', d);

  assert.deepEqual(JSON.parse(as(OWNER, `select public.trip_deletion_preview('preview-trip')::text`)),
    { status: 'ok', expenses: 2, packing_items: 3, participants: 2, documents: 1 });
  assert.deepEqual(JSON.parse(as(BOB, `select public.trip_deletion_preview('preview-trip')::text`)), { status: 'not-owner' });
  // Pending, unrelated and missing are one answer.
  for (const who of [CAROL, DAVE]) {
    assert.deepEqual(JSON.parse(as(who, `select public.trip_deletion_preview('preview-trip')::text`)), { status: 'not-found' });
  }
  assert.deepEqual(JSON.parse(as(OWNER, `select public.trip_deletion_preview('no-such-trip')::text`)), { status: 'not-found' });
  assert.deepEqual(JSON.parse(as(OWNER, `select public.trip_deletion_preview('${OTHER_TRIP}')::text`)), { status: 'not-found' });
  assert.match(errorFor(`select public.trip_deletion_preview('preview-trip')`), /not_authenticated/);
});

/* ---------------------------------------------------------------- deletion */

test('DELETE: a participant and an outsider cannot delete the trip; the owner\'s delete leaves no child of any author', () => {
  const d = doc(40);
  seedDocument(OWNER, d);
  insertTrip(OWNER, 'del-trip', { destination: 'Oslo' });
  as(OWNER, `insert into public.trip_participants (trip_id, owner_id, user_id, invited_email, status) values ('del-trip', '${OWNER}', '${BOB}', 'bob@example.test', 'pending')`);
  as(BOB, `update public.trip_participants set status='accepted' where trip_id='del-trip'`);
  insertExpense(OWNER, 'dl-e1', 'del-trip'); insertExpense(BOB, 'dl-e2', 'del-trip');
  insertPacking(OWNER, 'dl-p1', 'del-trip'); insertPacking(BOB, 'dl-p2', 'del-trip');
  link(OWNER, 'del-trip', d);

  assert.equal(as(BOB, `delete from public.trips where id='del-trip' returning id`), '');
  assert.equal(as(DAVE, `delete from public.trips where id='del-trip' returning id`), '');
  assert.equal(count('trips', `id='del-trip'`), 1);

  assert.equal(as(OWNER, `delete from public.trips where id='del-trip' returning id`), 'del-trip');
  for (const table of ['trip_expenses', 'trip_packing_items', 'trip_participants', 'trip_document_references']) {
    assert.equal(count(table, `trip_id='del-trip'`), 0, `${table} survived`);
  }
  // The participant's OWN rows went with the trip, whoever wrote them.
  assert.equal(count('trip_expenses', `user_id='${BOB}' and trip_id='del-trip'`), 0);
  // The linked standalone document is untouched.
  assert.equal(count('documents', `id='${d}'`), 1);
  assert.equal(objects(d), 1);
  // Other trips' children survive.
  assert.equal(count('trip_expenses', `trip_id='${OTHER_TRIP}'`), 1);
});

test('DELETE: account deletion cascades a whole shared trip without any reference blocking it', () => {
  insertTrip(ERIN, 'erin-shared');
  const d = doc(50); seedDocument(ERIN, d);
  as(ERIN, `insert into public.trip_participants (trip_id, owner_id, user_id, invited_email, status) values ('erin-shared', '${ERIN}', '${BOB}', 'bob@example.test', 'pending')`);
  as(BOB, `update public.trip_participants set status='accepted' where trip_id='erin-shared'`);
  insertExpense(BOB, 'er-e1', 'erin-shared'); link(ERIN, 'erin-shared', d);

  sql(`delete from auth.users where id='${ERIN}'`);
  for (const table of ['trips', 'trip_document_references', 'documents']) assert.equal(count(table, `user_id='${ERIN}'`), 0);
  assert.equal(count('trip_expenses', `trip_id in ('erin-shared', '${OTHER_TRIP}')`), 0);
  assert.equal(count('trip_participants', `trip_id='erin-shared'`), 0);
});

/* ------------------------------------------------------------------ summary */

test('NO DANGLING: every child names a real trip, every link resolves to its owner\'s trip and document', () => {
  assert.equal(count('trip_expenses', `not exists (select 1 from public.trips t where t.id = trip_expenses.trip_id)`), 0);
  assert.equal(count('trip_packing_items', `not exists (select 1 from public.trips t where t.id = trip_packing_items.trip_id)`), 0);
  assert.equal(count('trip_participants', `not exists (select 1 from public.trips t where t.id = trip_participants.trip_id and t.user_id = trip_participants.owner_id)`), 0);
  assert.equal(count('trip_document_references', `not exists (select 1 from public.trips t where t.id = trip_id and t.user_id = trip_document_references.user_id)
    or not exists (select 1 from public.documents d where d.id = document_id and d.user_id = trip_document_references.user_id)`), 0);
  assert.equal(count('trips', 'start_date > end_date'), 0);
});
