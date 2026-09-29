// APP-056: apply both APP-055 migrations and then the APP-056 migration to a
// disposable local Postgres cluster, and exercise the per-document delete
// lifecycle as the database actually enforces it.
//
// The fixture is APP-055's: Supabase's `storage` schema is not version-controlled
// in this repo, so the minimal parts the migrations depend on — storage.buckets,
// storage.objects, storage.foldername and the auth helpers — are recreated here.
// Everything under test comes from the migration files themselves.
//
// A Storage API removal is simulated the way the Storage API performs it: a DELETE
// on storage.objects as the caller's own role, filtered by the RLS policies.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bin = path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app056-'));
const cluster = path.join(scratch, 'db');
const port = '55456';

const ALICE = '10000000-0000-4000-8000-000000000001';
const BOB = '10000000-0000-4000-8000-000000000002';
/** Account deletion around a half-finished APP-056 deletion. */
const CAROL = '10000000-0000-4000-8000-000000000003';
/** The storage-visibility guard, with the functions owned by an RLS-bound role. */
const DAVE = '10000000-0000-4000-8000-000000000004';
/** Account deletion retried after a failed Storage removal. */
const ERIN = '10000000-0000-4000-8000-000000000005';
/** Account deletion with anomalous bytes under a deleted document's path. */
const FRANK = '10000000-0000-4000-8000-000000000006';
/** The foreign owner in the upload tests, so no other scenario inherits its state. */
const GRACE = '10000000-0000-4000-8000-000000000007';

/** Applied in the order they reach a real database: APP-055, its hardening, APP-056. */
const MIGRATIONS = [
  '20260925090000_private_document_bucket.sql',
  '20260925225633_app055_harden_document_window_search_path.sql',
  '20260927204302_app056_document_delete_cascade.sql',
];

/** A document id per scenario, so no test depends on another's leftovers. */
const doc = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const objectPath = (userId, documentId) => `${userId}/${documentId}`;

let started = false;

function psqlArgs() {
  return ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', port, '-U', 'postgres', '-d', 'postgres'];
}

function sql(source) {
  return execFileSync(path.join(bin, 'psql'), psqlArgs(), {
    input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function errorFor(source) {
  try { sql(source); } catch (error) { return String(error.stderr); }
  assert.fail('SQL unexpectedly succeeded');
}

/** A session's claims; `amr` is only needed where recent password authentication matters. */
function claims(userId, { amr } = {}) {
  const payload = { sub: userId, role: 'authenticated', iat: Math.floor(Date.now() / 1000) };
  if (amr !== undefined) payload.amr = amr;
  return JSON.stringify(payload).replace(/'/g, "''");
}

/** A session that signed in with a password `secondsAgo` seconds ago. */
const passwordAmr = (secondsAgo) =>
  [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - secondsAgo }];

const roleStatement = (role, userId, source, sessionClaims) =>
  `set role ${role}; set request.jwt.claim.sub = '${userId}';
   set request.jwt.claims = '${sessionClaims ?? claims(userId, { amr: passwordAmr(5) })}';
   ${source}`;

function asRole(role, userId, source, sessionClaims) {
  return sql(roleStatement(role, userId, source, sessionClaims));
}

/* ------------------------------------------------------ lifecycle helpers */

/** begin_my_document_deletion() as the given user, parsed. */
const begin = (userId, documentId) => JSON.parse(asRole('authenticated', userId,
  `select public.begin_my_document_deletion('${documentId}')::text`));

const finalize = (userId, documentId) => asRole('authenticated', userId,
  `select public.finalize_my_document_deletion('${documentId}')`);

/** What the Storage API does for .remove([name]): a DELETE under the caller's RLS. */
const removeObject = (userId, name) => asRole('authenticated', userId,
  `delete from storage.objects where bucket_id='documents' and name='${name}' returning name`);

const deletable = (userId, name) => asRole('authenticated', userId,
  `select public.document_object_is_deletable('${name}')::text`);

const release = (userId, amr = passwordAmr(5)) => asRole('authenticated', userId,
  `select coalesce(string_agg(p, ',' order by p), '')
   from public.release_my_documents_for_account_deletion() as p`, claims(userId, { amr }));

/** A stored document: its object (unless told otherwise) and its row, as a real upload leaves them. */
function seed(userId, documentId, { object = true, name = 'seeded.pdf' } = {}) {
  const p = objectPath(userId, documentId);
  sql(`${object ? `insert into storage.objects (bucket_id, name) values ('documents', '${p}');` : ''}
       insert into public.documents (id, user_id, storage_path, original_name)
       values ('${documentId}', '${userId}', '${p}', '${name}');`);
}

/** The three facts the acceptance criterion is about, for one document. */
function stateOf(userId, documentId) {
  return {
    rows: Number(sql(`select count(*) from public.documents where id='${documentId}' and user_id='${userId}'`)),
    objects: Number(sql(`select count(*) from storage.objects
      where bucket_id='documents' and name='${objectPath(userId, documentId)}'`)),
    tombstones: Number(sql(`select count(*) from public.document_deletion_tombstones
      where user_id='${userId}' and document_id='${documentId}'`)),
  };
}

const DELETED = { rows: 0, objects: 0, tombstones: 1 };
const INTACT = { rows: 1, objects: 1, tombstones: 0 };

/** Exactly the sequence the app runs: begin, remove the returned path, finalize. */
function deleteLikeTheClient(userId, documentId) {
  const started = begin(userId, documentId);
  if (started.status !== 'ready') return started.status;
  removeObject(userId, started.storage_path);
  return finalize(userId, documentId);
}

const requestedAt = (documentId) => sql(`select coalesce(deletion_requested_at::text, 'null')
  from public.documents where id='${documentId}'`);

/** Move the request to `offset` relative to the window's edge, on the DATABASE clock. */
const ageRequest = (documentId, offset) => sql(`update public.documents
  set deletion_requested_at = now() - public.document_delete_window() + interval '${offset}'
  where id='${documentId}'`);

/* ------------------------------------------------ concurrent sessions */

/**
 * A long-lived psql session, for the two races that need a transaction held open
 * while another session acts. Progress is observed in pg_stat_activity rather than
 * in this process's pipes, whose buffering is not something to depend on.
 */
function openSession() {
  const child = spawn(path.join(bin, 'psql'), psqlArgs(), { stdio: ['pipe', 'pipe', 'pipe'] });
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

/* -------------------------------------------------------------- fixture */

before(() => {
  execFileSync(path.join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-l', path.join(scratch, 'postgres.log'), '-o', `-k ${scratch} -p ${port} -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  started = true;

  sql(`create role authenticated; create role anon; create role service_role;
    create schema auth; create schema storage;

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
    grant usage on schema auth, storage to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    grant execute on function auth.jwt() to authenticated, anon, service_role;

    create table auth.users (id uuid primary key, email text);

    create function storage.foldername(name text) returns text[]
    language plpgsql immutable as $$
    declare parts text[];
    begin
      parts := string_to_array(name, '/');
      return parts[1:array_length(parts, 1) - 1];
    end $$;
    grant execute on function storage.foldername(text) to authenticated, anon, service_role;

    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[],
      created_at timestamptz not null default now()
    );

    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets (id),
      name text not null,
      owner uuid,
      created_at timestamptz not null default now(),
      unique (bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to authenticated;
    grant select on storage.objects to anon;
    grant select, insert, update, delete on storage.objects to service_role;
    grant select on storage.buckets to authenticated, anon, service_role;

    insert into storage.buckets (id, name, public, file_size_limit)
      values ('attachments', 'attachments', false, 25 * 1024 * 1024);

    insert into auth.users (id, email) values
      ('${ALICE}', 'alice@example.test'),
      ('${BOB}', 'bob@example.test'),
      ('${CAROL}', 'carol@example.test'),
      ('${DAVE}', 'dave@example.test'),
      ('${ERIN}', 'erin@example.test'),
      ('${FRANK}', 'frank@example.test'),
      ('${GRACE}', 'grace@example.test');`);

  for (const migration of MIGRATIONS) {
    sql(fs.readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8'));
  }
});

after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});

/* ------------------------------------------------------ schema and grants */

test('SCHEMA: deletion_requested_at exists, is nullable, and no client grant names it', () => {
  assert.equal(sql(`select data_type || '|' || is_nullable from information_schema.columns
    where table_schema='public' and table_name='documents' and column_name='deletion_requested_at'`),
  'timestamp with time zone|YES');

  // The APP-055 grant shape survives exactly: SELECT at table level, and INSERT on
  // the four client-owned columns only. The new column is in neither INSERT list.
  assert.equal(sql(`select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
    from information_schema.role_table_grants
    where table_schema='public' and table_name='documents' and grantee='authenticated'`), 'SELECT');
  assert.equal(sql(`select coalesce(string_agg(column_name, ',' order by column_name), '')
    from information_schema.column_privileges
    where table_schema='public' and table_name='documents' and grantee='authenticated' and privilege_type='INSERT'`),
  'id,original_name,storage_path,user_id');
  assert.equal(sql(`select count(*) from information_schema.column_privileges
    where table_schema='public' and table_name='documents'
      and grantee in ('authenticated', 'anon') and privilege_type in ('UPDATE', 'DELETE')`), '0');
});

test('SCHEMA: a client can neither set nor change deletion_requested_at', () => {
  const id = doc(1);
  seed(ALICE, id);

  assert.match(errorFor(roleStatement('authenticated', ALICE,
    `insert into public.documents (id, user_id, storage_path, original_name, deletion_requested_at)
     values ('${doc(2)}', '${ALICE}', '${objectPath(ALICE, doc(2))}', 'x.pdf', now())`)), /permission denied/);
  assert.match(errorFor(roleStatement('authenticated', ALICE,
    `update public.documents set deletion_requested_at = now() where id='${id}'`)), /permission denied/);

  assert.equal(requestedAt(id), 'null');
  assert.equal(sql(`select count(*) from public.documents where id='${doc(2)}'`), '0');
  // And a client that could set it still could not make the object go away: the
  // object stays protected because nothing authorized its removal.
  assert.equal(removeObject(ALICE, objectPath(ALICE, id)), '');
});

test('SCHEMA: there is still no ordinary DELETE or UPDATE path on public.documents', () => {
  const id = doc(3);
  seed(ALICE, id);

  assert.match(errorFor(roleStatement('authenticated', ALICE,
    `delete from public.documents where id='${id}'`)), /permission denied for table documents/);
  assert.match(errorFor(roleStatement('authenticated', ALICE,
    `update public.documents set original_name = 'renamed.pdf' where id='${id}'`)), /permission denied for table documents/);
  assert.deepEqual(stateOf(ALICE, id), INTACT);

  // Deletion is a function, never a policy: no statement-level route exists.
  assert.equal(sql(`select count(*) from pg_policies
    where schemaname='public' and tablename='documents' and cmd in ('UPDATE','DELETE','ALL')`), '0');
  assert.equal(sql(`select relrowsecurity::text from pg_class where oid='public.documents'::regclass`), 'true');
});

test('SCHEMA: the tombstone table is minimal, account-bound, RLS-protected and closed to clients', () => {
  assert.equal(sql(`select string_agg(column_name, ',' order by column_name) from information_schema.columns
    where table_schema='public' and table_name='document_deletion_tombstones'`), 'deleted_at,document_id,user_id');

  // Keyed per account, cascading with the account, and deliberately NOT tied to
  // public.documents: it has to outlive the row it records.
  assert.equal(sql(`select string_agg(a.attname, ',' order by k.ordinality)
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ordinality)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid='public.document_deletion_tombstones'::regclass and c.contype='p'`), 'user_id,document_id');
  assert.equal(sql(`select confrelid::regclass::text || ':' || confdeltype::text from pg_constraint
    where conrelid='public.document_deletion_tombstones'::regclass and contype='f'`), 'auth.users:c');

  // deleted_at is the server's: a NOT NULL column with a now() default nobody
  // but the definer function can write.
  assert.equal(sql(`select is_nullable || '|' || column_default from information_schema.columns
    where table_schema='public' and table_name='document_deletion_tombstones' and column_name='deleted_at'`),
  'NO|now()');

  assert.equal(sql(`select relrowsecurity::text from pg_class where oid='public.document_deletion_tombstones'::regclass`), 'true');
  assert.equal(sql(`select count(*) from pg_policies where schemaname='public' and tablename='document_deletion_tombstones'`), '0');
  assert.equal(sql(`select count(*) from information_schema.role_table_grants
    where table_schema='public' and table_name='document_deletion_tombstones'
      and grantee in ('anon', 'authenticated', 'PUBLIC')`), '0');

  for (const role of ['anon', 'authenticated']) {
    for (const statement of [
      'select count(*) from public.document_deletion_tombstones',
      `insert into public.document_deletion_tombstones (user_id, document_id) values ('${ALICE}', '${doc(4)}')`,
      `update public.document_deletion_tombstones set deleted_at = now()`,
      'delete from public.document_deletion_tombstones',
    ]) {
      assert.match(errorFor(roleStatement(role, ALICE, statement)),
        /permission denied for table document_deletion_tombstones/, `${role}: ${statement}`);
    }
  }
});

test('SCHEMA: every APP-056 function pins its search_path and carries only the grants it needs', () => {
  const functions = {
    'begin_my_document_deletion(uuid)': { config: 'search_path=pg_catalog, pg_temp', definer: true, authenticated: true },
    'finalize_my_document_deletion(uuid)': { config: 'search_path=pg_catalog, pg_temp', definer: true, authenticated: true },
    'refuse_deleted_document_id()': { config: 'search_path=pg_catalog, pg_temp', definer: true, authenticated: false },
    'document_delete_window()': { config: 'search_path=pg_catalog', definer: false, authenticated: false },
    // The Storage INSERT policy evaluates it as `authenticated`, so that role needs EXECUTE.
    'document_object_is_insertable(text)': { config: 'search_path=pg_catalog, pg_temp', definer: true, authenticated: true },
    // The two APP-055 functions APP-056 replaces keep their reviewed shape.
    'document_object_is_deletable(text)': { config: 'search_path=public, storage, pg_temp', definer: true, authenticated: true },
    'release_my_documents_for_account_deletion()': { config: 'search_path=public, auth, pg_temp', definer: true, authenticated: true },
  };

  for (const [signature, expected] of Object.entries(functions)) {
    const oid = `'public.${signature}'::regprocedure`;
    assert.equal(sql(`select coalesce(array_to_string(proconfig, ','), '') from pg_proc where oid=${oid}`),
      expected.config, `${signature} search_path`);
    assert.equal(sql(`select prosecdef::text from pg_proc where oid=${oid}`), String(expected.definer), `${signature} definer`);
    // Owned by the migration role — for a definer, that is whose rights it runs with.
    assert.equal(sql(`select proowner::regrole::text from pg_proc where oid=${oid}`), 'postgres', `${signature} owner`);
    assert.equal(sql(`select has_function_privilege('authenticated', ${oid}, 'EXECUTE')::text`),
      String(expected.authenticated), `${signature} authenticated EXECUTE`);
    // anon holds no function here, directly or through PUBLIC.
    assert.equal(sql(`select has_function_privilege('anon', ${oid}, 'EXECUTE')::text`), 'false', `${signature} anon EXECUTE`);
  }

  // The window is its own immutable constant, not a reuse of the account one.
  assert.equal(sql(`select public.document_delete_window()::text`), '00:15:00');
  assert.equal(sql(`select provolatile::text from pg_proc where oid='public.document_delete_window()'::regprocedure`), 'i');
  assert.equal(sql(`select public.document_release_window()::text`), '00:15:00');

  // The resurrection guard fires AFTER the insert (see the race test below).
  assert.equal(sql(`select tgtype::int & 2 from pg_trigger
    where tgrelid='public.documents'::regclass and tgname='documents_refuse_deleted_id'`), '0');
});

/* ------------------------------------------------------ two users + anon */

test('BEGIN: Alice can prepare her own document and is handed its canonical path', () => {
  const id = doc(10);
  seed(ALICE, id);

  const started = begin(ALICE, id);
  assert.deepEqual(started, { status: 'ready', storage_path: objectPath(ALICE, id) });
  assert.equal(sql(`select (deletion_requested_at > now() - interval '1 minute')::text
    from public.documents where id='${id}'`), 'true');

  // Nothing is destroyed by preparing: the row, its path and the bytes are all here.
  assert.deepEqual(stateOf(ALICE, id), INTACT);
  assert.equal(sql(`select account_deletion_released_at is null from public.documents where id='${id}'`), 't');
});

test('BEGIN: neither user can prepare the other one\'s document, and nothing changes', () => {
  const aliceDoc = doc(11);
  const bobDoc = doc(12);
  seed(ALICE, aliceDoc);
  seed(BOB, bobDoc);

  assert.deepEqual(begin(BOB, aliceDoc), { status: 'not-found' });
  assert.deepEqual(begin(ALICE, bobDoc), { status: 'not-found' });
  assert.equal(requestedAt(aliceDoc), 'null');
  assert.equal(requestedAt(bobDoc), 'null');

  // And so neither object became removable by anyone.
  assert.equal(removeObject(BOB, objectPath(ALICE, aliceDoc)), '');
  assert.equal(removeObject(ALICE, objectPath(ALICE, aliceDoc)), '');
  assert.equal(removeObject(ALICE, objectPath(BOB, bobDoc)), '');
  assert.deepEqual(stateOf(ALICE, aliceDoc), INTACT);
  assert.deepEqual(stateOf(BOB, bobDoc), INTACT);
});

test('BEGIN/FINALIZE: a foreign id is answered exactly like a missing one — no ownership oracle', () => {
  const active = doc(13);
  const deleted = doc(14);
  seed(ALICE, active);
  seed(ALICE, deleted);
  assert.equal(deleteLikeTheClient(ALICE, deleted), 'deleted');

  // Bob cannot tell apart Alice's live document, Alice's deleted document and an
  // id nobody ever used.
  const missing = '20000000-0000-4000-8000-00000000dead';
  const beginAnswers = [active, deleted, missing].map((id) => JSON.stringify(begin(BOB, id)));
  const finalizeAnswers = [active, deleted, missing].map((id) => finalize(BOB, id));
  assert.deepEqual(new Set(beginAnswers), new Set([JSON.stringify({ status: 'not-found' })]));
  assert.deepEqual(new Set(finalizeAnswers), new Set(['not-found']));

  // A tombstone speaks only to the account that owns it.
  assert.deepEqual(begin(ALICE, deleted), { status: 'already-deleted' });
  assert.equal(requestedAt(active), 'null');
  assert.deepEqual(stateOf(ALICE, active), INTACT);
});

test('anon can call neither function, and a session without a user is refused', () => {
  const id = doc(15);
  seed(ALICE, id);

  for (const fn of ['begin_my_document_deletion', 'finalize_my_document_deletion']) {
    assert.match(errorFor(roleStatement('anon', ALICE, `select public.${fn}('${id}')`)),
      /permission denied for function/);
    // Signed-in role, no user in the token: refused before anything is read.
    assert.match(errorFor(`set role authenticated; select public.${fn}('${id}')`), /not_authenticated/);
  }
  assert.equal(requestedAt(id), 'null');
  assert.deepEqual(stateOf(ALICE, id), INTACT);
});

/* --------------------------------------------------------- storage policy */

test('STORAGE: a stored, unrequested document cannot be removed — not even by its owner', () => {
  const id = doc(20);
  seed(ALICE, id);
  assert.equal(deletable(ALICE, objectPath(ALICE, id)), 'false');
  assert.equal(removeObject(ALICE, objectPath(ALICE, id)), '');
  assert.deepEqual(stateOf(ALICE, id), INTACT);
});

test('STORAGE: a fresh request permits removing exactly that object, and only by its owner', () => {
  const requested = doc(21);
  const untouched = doc(22);
  seed(ALICE, requested);
  seed(ALICE, untouched);
  assert.equal(begin(ALICE, requested).status, 'ready');

  // Another account cannot ride on Alice's request, and learns nothing from asking.
  assert.equal(deletable(BOB, objectPath(ALICE, requested)), 'false');
  assert.equal(removeObject(BOB, objectPath(ALICE, requested)), '');

  // The request covers one document, not Alice's prefix.
  assert.equal(deletable(ALICE, objectPath(ALICE, untouched)), 'false');
  assert.equal(removeObject(ALICE, objectPath(ALICE, untouched)), '');

  assert.equal(removeObject(ALICE, objectPath(ALICE, requested)), objectPath(ALICE, requested));
  // The bytes went; the row did not. Only finalize retires it.
  assert.deepEqual(stateOf(ALICE, requested), { rows: 1, objects: 0, tombstones: 0 });
  assert.deepEqual(stateOf(ALICE, untouched), INTACT);

  assert.equal(finalize(ALICE, requested), 'deleted');
});

test('STORAGE: NULL never authorizes — only a fresh window does', () => {
  const id = doc(23);
  const p = objectPath(ALICE, id);
  seed(ALICE, id);

  const cases = [
    // account release,                 per-document request,               deletable?
    ['null',                             'null',                             'false'],
    ["now() - interval '1 hour'",        'null',                             'false'],
    ['null',                             "now() - interval '1 hour'",        'false'],
    ["now() - interval '1 hour'",        "now() - interval '1 hour'",        'false'],
    ['now()',                            'null',                             'true'],
    ['null',                             'now()',                            'true'],
    ["now() - interval '1 hour'",        'now()',                            'true'],
    ['now()',                            "now() - interval '1 hour'",        'true'],
  ];
  for (const [released, requested, expected] of cases) {
    sql(`update public.documents set account_deletion_released_at = ${released},
      deletion_requested_at = ${requested} where id='${id}'`);
    assert.equal(deletable(ALICE, p), expected, `release=${released} request=${requested}`);
    // For a foreign prefix the answer is the constant false in every state.
    assert.equal(deletable(BOB, p), 'false');
  }
  sql(`update public.documents set account_deletion_released_at = null, deletion_requested_at = null where id='${id}'`);
});

test('STORAGE: an expired request protects the document again, and begin opens a new window', () => {
  const id = doc(24);
  const p = objectPath(ALICE, id);
  seed(ALICE, id);
  assert.equal(begin(ALICE, id).status, 'ready');
  assert.equal(deletable(ALICE, p), 'true');

  // Just past the window, on the database clock: protected again, with nothing run.
  ageRequest(id, '-1 second');
  assert.equal(deletable(ALICE, p), 'false');
  assert.equal(removeObject(ALICE, p), '');

  // Just inside it: the boundary is the window, not something incidental.
  ageRequest(id, '5 seconds');
  assert.equal(deletable(ALICE, p), 'true');

  // An abandoned request, long expired, then a retry: begin refreshes rather than
  // preserving the old timestamp, so the user is never locked out of deleting.
  sql(`update public.documents set deletion_requested_at = now() - interval '3 days' where id='${id}'`);
  assert.equal(deletable(ALICE, p), 'false');
  assert.deepEqual(begin(ALICE, id), { status: 'ready', storage_path: p });
  assert.equal(sql(`select (deletion_requested_at > now() - interval '1 minute')::text
    from public.documents where id='${id}'`), 'true');
  assert.equal(deletable(ALICE, p), 'true');
  assert.deepEqual(stateOf(ALICE, id), INTACT);
});

test('STORAGE: failed-upload compensation still works — an object with no row is its owner\'s', () => {
  const orphan = doc(25);
  sql(`insert into storage.objects (bucket_id, name) values ('documents', '${objectPath(ALICE, orphan)}')`);
  assert.equal(removeObject(BOB, objectPath(ALICE, orphan)), '');
  assert.equal(removeObject(ALICE, objectPath(ALICE, orphan)), objectPath(ALICE, orphan));
});

test('STORAGE: the APP-055 account-deletion release still authorizes removal on its own', () => {
  const id = doc(26);
  seed(ERIN, id);
  assert.equal(removeObject(ERIN, objectPath(ERIN, id)), '');

  assert.equal(release(ERIN), objectPath(ERIN, id));
  assert.equal(requestedAt(id), 'null');
  assert.equal(removeObject(ERIN, objectPath(ERIN, id)), objectPath(ERIN, id));

  // Put Erin back the way the account-retry test below expects to find her.
  sql(`insert into storage.objects (bucket_id, name) values ('documents', '${objectPath(ERIN, id)}');
       update public.documents set account_deletion_released_at = null where id='${id}';`);
});

/* ------------------------------------------------------- storage upload */

const upload = (userId, name) => asRole('authenticated', userId,
  `insert into storage.objects (bucket_id, name) values ('documents', '${name}') returning name`);
const uploadError = (userId, name) => errorFor(roleStatement('authenticated', userId,
  `insert into storage.objects (bucket_id, name) values ('documents', '${name}')`));
const insertable = (userId, name) => asRole('authenticated', userId,
  `select public.document_object_is_insertable('${name}')::text`);

test('UPLOAD A: a fresh path is uploadable — object first, metadata second — exactly as APP-055 uploads', () => {
  const id = doc(90);
  const p = objectPath(ALICE, id);

  // Fresh crypto id: no row, no tombstone. The object goes up first...
  assert.equal(insertable(ALICE, p), 'true');
  assert.equal(upload(ALICE, p), p);

  // ...then the metadata row, and the document is whole.
  assert.equal(asRole('authenticated', ALICE,
    `insert into public.documents (id, user_id, storage_path, original_name)
     values ('${id}', '${ALICE}', '${p}', 'fresh-upload.pdf') returning id`), id);
  assert.deepEqual(stateOf(ALICE, id), INTACT);

  // From here the row claims the path, and the ordinary lifecycle deletes it.
  assert.equal(insertable(ALICE, p), 'false');
  assert.equal(deleteLikeTheClient(ALICE, id), 'deleted');
  assert.deepEqual(stateOf(ALICE, id), DELETED);
});

test('UPLOAD B: a path claimed by an active row cannot be uploaded to, even while its object is absent', () => {
  const id = doc(91);
  const p = objectPath(ALICE, id);
  seed(ALICE, id, { object: false });

  assert.equal(insertable(ALICE, p), 'false');
  assert.match(uploadError(ALICE, p), /row-level security/);
  assert.deepEqual(stateOf(ALICE, id), { rows: 1, objects: 0, tombstones: 0 });

  // Nor while a deletion window is open on it.
  assert.equal(begin(ALICE, id).status, 'ready');
  assert.match(uploadError(ALICE, p), /row-level security/);
  assert.equal(finalize(ALICE, id), 'deleted');
});

test('UPLOAD C: a tombstoned path cannot be uploaded to', () => {
  const id = doc(92);
  const p = objectPath(ALICE, id);
  seed(ALICE, id);
  assert.equal(deleteLikeTheClient(ALICE, id), 'deleted');

  assert.equal(insertable(ALICE, p), 'false');
  assert.match(uploadError(ALICE, p), /row-level security/);
  assert.deepEqual(stateOf(ALICE, id), DELETED);
});

test('UPLOAD D: a foreign prefix is refused in every state, and the helper answers it with the constant false', () => {
  const fresh = doc(93);
  const active = doc(94);
  const deleted = doc(95);
  seed(GRACE, active);
  seed(GRACE, deleted);
  assert.equal(deleteLikeTheClient(GRACE, deleted), 'deleted');

  // Grace's fresh path, her live document's path, her deleted document's path, and
  // a nested name: Alice gets "false" for all of them, so she learns nothing.
  const foreign = [objectPath(GRACE, fresh), objectPath(GRACE, active), objectPath(GRACE, deleted), `${GRACE}/nested/${fresh}`];
  for (const name of foreign) {
    assert.equal(insertable(ALICE, name), 'false', name);
    assert.match(uploadError(ALICE, name), /row-level security/, name);
  }
  // The same fresh path is Grace's to use, which is what makes Alice's "false" constant.
  assert.equal(insertable(GRACE, objectPath(GRACE, fresh)), 'true');

  // anon has neither the upload nor the helper; a session without a user gets false.
  assert.match(errorFor(roleStatement('anon', ALICE,
    `insert into storage.objects (bucket_id, name) values ('documents', '${objectPath(ALICE, fresh)}')`)),
  /permission denied|row-level security/);
  assert.match(errorFor(roleStatement('anon', ALICE,
    `select public.document_object_is_insertable('${objectPath(ALICE, fresh)}')`)), /permission denied for function/);
  assert.equal(sql(`set role authenticated;
    select public.document_object_is_insertable('${objectPath(ALICE, fresh)}')::text`), 'false');

  assert.equal(sql(`select count(*) from storage.objects where name like '%${fresh}%'`), '0');
  assert.deepEqual(stateOf(GRACE, active), INTACT);
});

test('POLICIES: the documents bucket keeps exactly INSERT, SELECT and the three-reason DELETE — no UPDATE', () => {
  const policies = sql(`select policyname || '|' || cmd || '|' || array_to_string(roles, ',')
    from pg_policies
    where schemaname='storage' and tablename='objects'
      and (coalesce(qual, '') like '%documents%' or coalesce(with_check, '') like '%documents%')
    order by cmd`).split('\n');
  assert.deepEqual(policies, [
    'Users can delete own unreferenced or released documents|DELETE|authenticated',
    'Users can upload own documents|INSERT|authenticated',
    'Users can view own documents|SELECT|authenticated',
  ]);

  const insert = sql(`select with_check from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='Users can upload own documents'`);
  assert.match(insert, /bucket_id = 'documents'::text/);
  assert.match(insert, /\(storage\.foldername\(name\)\)\[1\] = \(auth\.uid\(\)\)::text/);
  assert.match(insert, /document_object_is_insertable\(name\)/);

  // DELETE is APP-055's policy over APP-056's three-reason helper, unchanged by V3.
  const remove = sql(`select qual from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='Users can delete own unreferenced or released documents'`);
  assert.match(remove, /bucket_id = 'documents'::text/);
  assert.match(remove, /\(storage\.foldername\(name\)\)\[1\] = \(auth\.uid\(\)\)::text/);
  assert.match(remove, /document_object_is_deletable\(name\)/);
  assert.doesNotMatch(remove, /insertable/);

  // SELECT is exactly APP-055's.
  const view = sql(`select qual from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='Users can view own documents'`);
  assert.match(view, /bucket_id = 'documents'::text/);
  assert.doesNotMatch(view, /insertable|deletable/);

  assert.equal(sql(`select count(*) from pg_policies
    where schemaname='storage' and tablename='objects' and cmd in ('UPDATE', 'ALL')`), '0');
});

/* --------------------------------------------------------------- finalize */

test('FINALIZE: refuses while the object still exists — the row stays and no tombstone is written', () => {
  const id = doc(30);
  seed(ALICE, id);
  assert.equal(begin(ALICE, id).status, 'ready');

  // The Storage call "failed": the object is still there.
  assert.equal(finalize(ALICE, id), 'object-present');
  assert.deepEqual(stateOf(ALICE, id), INTACT);

  // And it stays retryable: remove, finalize, done.
  assert.equal(removeObject(ALICE, objectPath(ALICE, id)), objectPath(ALICE, id));
  assert.equal(finalize(ALICE, id), 'deleted');
  assert.deepEqual(stateOf(ALICE, id), DELETED);
});

test('FINALIZE: refuses without a fresh request, even when the object is already gone', () => {
  const never = doc(31);
  seed(ALICE, never, { object: false });
  assert.equal(finalize(ALICE, never), 'not-requested');
  assert.deepEqual(stateOf(ALICE, never), { rows: 1, objects: 0, tombstones: 0 });

  const expired = doc(32);
  seed(ALICE, expired);
  assert.equal(begin(ALICE, expired).status, 'ready');
  assert.equal(removeObject(ALICE, objectPath(ALICE, expired)), objectPath(ALICE, expired));
  ageRequest(expired, '-1 second');
  assert.equal(finalize(ALICE, expired), 'not-requested');
  assert.deepEqual(stateOf(ALICE, expired), { rows: 1, objects: 0, tombstones: 0 });
});

test('FINALIZE: with the object gone, the tombstone and the row removal land together', () => {
  const id = doc(33);
  seed(ALICE, id, { name: 'biopsy-result.pdf' });
  assert.equal(begin(ALICE, id).status, 'ready');
  assert.equal(removeObject(ALICE, objectPath(ALICE, id)), objectPath(ALICE, id));

  assert.equal(finalize(ALICE, id), 'deleted');
  assert.deepEqual(stateOf(ALICE, id), DELETED);

  // Evidence, not a copy: the tombstone holds the two ids and a server time, and
  // nothing that says what the document was.
  const tombstone = JSON.parse(sql(`select row_to_json(t) from public.document_deletion_tombstones t
    where user_id='${ALICE}' and document_id='${id}'`));
  assert.deepEqual(Object.keys(tombstone).sort(), ['deleted_at', 'document_id', 'user_id']);
  assert.ok(!JSON.stringify(tombstone).includes('biopsy'));
  assert.equal(sql(`select (deleted_at > now() - interval '1 minute')::text
    from public.document_deletion_tombstones where user_id='${ALICE}' and document_id='${id}'`), 'true');
});

test('FINALIZE: repeating it is safe and says already-deleted, as does a fresh begin', () => {
  const id = doc(34);
  seed(ALICE, id);
  assert.equal(deleteLikeTheClient(ALICE, id), 'deleted');

  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal(finalize(ALICE, id), 'already-deleted');
    assert.deepEqual(begin(ALICE, id), { status: 'already-deleted' });
  }
  // Repetition writes nothing: still one tombstone, no row, no object.
  assert.deepEqual(stateOf(ALICE, id), DELETED);
});

test('FINALIZE: another account can neither finalize nor disturb a requested document', () => {
  const id = doc(35);
  seed(ALICE, id);
  assert.equal(begin(ALICE, id).status, 'ready');
  assert.equal(removeObject(ALICE, objectPath(ALICE, id)), objectPath(ALICE, id));

  assert.equal(finalize(BOB, id), 'not-found');
  assert.deepEqual(stateOf(ALICE, id), { rows: 1, objects: 0, tombstones: 0 });
  assert.equal(sql(`select count(*) from public.document_deletion_tombstones where user_id='${BOB}'`), '0');

  assert.equal(finalize(ALICE, id), 'deleted');
});

test('RESURRECTION: a deleted id cannot be written back for that account, by anyone', () => {
  const id = doc(36);
  const p = objectPath(ALICE, id);
  seed(ALICE, id);
  assert.equal(deleteLikeTheClient(ALICE, id), 'deleted');

  // A stale or modified client replaying the original insert.
  assert.match(errorFor(roleStatement('authenticated', ALICE,
    `insert into public.documents (id, user_id, storage_path, original_name)
     values ('${id}', '${ALICE}', '${p}', 'resurrected.pdf')`)), /document_already_deleted/);
  // Nor the table owner: the rule is the database's, not a policy on one role.
  assert.match(errorFor(`insert into public.documents (id, user_id, storage_path, original_name)
     values ('${id}', '${ALICE}', '${p}', 'resurrected.pdf')`), /document_already_deleted/);
  assert.deepEqual(stateOf(ALICE, id), DELETED);

  // A fresh id — what every real upload uses — still inserts as an ordinary user,
  // which also proves the definer trigger needs no EXECUTE grant to fire.
  const fresh = doc(37);
  assert.equal(asRole('authenticated', ALICE,
    `insert into public.documents (id, user_id, storage_path, original_name)
     values ('${fresh}', '${ALICE}', '${objectPath(ALICE, fresh)}', 'new.pdf') returning id`), fresh);

  // Tombstones are per account: Alice's neither blocks Bob nor tells him anything.
  assert.equal(asRole('authenticated', BOB,
    `insert into public.documents (id, user_id, storage_path, original_name)
     values ('${id}', '${BOB}', '${objectPath(BOB, id)}', 'coincidence.pdf') returning id`), id);
  assert.deepEqual(begin(ALICE, id), { status: 'already-deleted' });
  sql(`delete from public.documents where id in ('${fresh}', '${id}')`);
});

test('TOMBSTONED OBJECT: anomalous bytes at a deleted path are removed before success is reported', () => {
  const id = doc(38);
  const p = objectPath(ALICE, id);
  seed(ALICE, id);

  // 1. An ordinary, completed deletion.
  assert.equal(deleteLikeTheClient(ALICE, id), 'deleted');
  assert.deepEqual(stateOf(ALICE, id), DELETED);

  // 2. An ordinary client can no longer put bytes back: the tombstone claims the path.
  assert.match(errorFor(roleStatement('authenticated', ALICE,
    `insert into storage.objects (bucket_id, name) values ('documents', '${p}')`)), /row-level security/);
  assert.deepEqual(stateOf(ALICE, id), DELETED);

  //    Bytes can still arrive by another route — history, an operator, a bypass —
  //    so they are seeded here with privileged setup, and the lifecycle must cope.
  sql(`insert into storage.objects (bucket_id, name) values ('documents', '${p}')`);
  assert.deepEqual(stateOf(ALICE, id), { rows: 0, objects: 1, tombstones: 1 });

  // 3. Finalize is still the authority on absence: the tombstone is not an answer
  //    while the object exists.
  assert.equal(finalize(ALICE, id), 'object-present');
  assert.deepEqual(stateOf(ALICE, id), { rows: 0, objects: 1, tombstones: 1 });

  // 4. Begin hands the owner the exact canonical path again, NOT already-deleted,
  //    and creates no row doing so.
  assert.deepEqual(begin(ALICE, id), { status: 'ready', storage_path: p });
  assert.equal(sql(`select count(*) from public.documents where id='${id}'`), '0');

  // Another account still learns nothing, and can neither finish nor remove it.
  assert.deepEqual(begin(BOB, id), { status: 'not-found' });
  assert.equal(finalize(BOB, id), 'not-found');
  assert.equal(deletable(BOB, p), 'false');
  assert.equal(removeObject(BOB, p), '');

  // 5. The owner removes it under the existing no-row reason — nothing new was
  //    authorized for this — and finalize now reports the deletion as complete.
  assert.equal(deletable(ALICE, p), 'true');
  assert.equal(removeObject(ALICE, p), p);
  assert.equal(finalize(ALICE, id), 'already-deleted');
  assert.deepEqual(stateOf(ALICE, id), DELETED);
  assert.deepEqual(begin(ALICE, id), { status: 'already-deleted' });
});

test('TOMBSTONED OBJECT: the client\'s full lifecycle settles it in one ordinary attempt', () => {
  const id = doc(39);
  const p = objectPath(ALICE, id);
  seed(ALICE, id);
  assert.equal(deleteLikeTheClient(ALICE, id), 'deleted');

  // Privileged setup: an ordinary client cannot create this state any more.
  sql(`insert into storage.objects (bucket_id, name) values ('documents', '${p}')`);

  // begin → remove → finalize, unchanged: success only once the bytes are gone.
  assert.equal(deleteLikeTheClient(ALICE, id), 'already-deleted');
  assert.deepEqual(stateOf(ALICE, id), DELETED);
});

/* ------------------------------------------------------ ambiguity / retry */

test('AMBIGUITY: finalize committed but its answer was lost — the retry settles to already-deleted', () => {
  const id = doc(40);
  seed(ALICE, id);

  // Attempt 1 completes on the server; the client never hears the answer.
  assert.equal(begin(ALICE, id).status, 'ready');
  assert.equal(removeObject(ALICE, objectPath(ALICE, id)), objectPath(ALICE, id));
  void finalize(ALICE, id);

  // Attempt 2: the client runs the lifecycle again from the top. It is told the
  // truth — already deleted — without a Storage call or a new error.
  assert.deepEqual(begin(ALICE, id), { status: 'already-deleted' });
  assert.equal(finalize(ALICE, id), 'already-deleted');
  assert.deepEqual(stateOf(ALICE, id), DELETED);
});

test('AMBIGUITY: the object went but the row stayed and the request expired — begin again and finish', () => {
  const id = doc(41);
  const p = objectPath(ALICE, id);
  seed(ALICE, id);

  // The removal worked (even if it looked like it failed), then the app died.
  assert.equal(begin(ALICE, id).status, 'ready');
  assert.equal(removeObject(ALICE, p), p);
  ageRequest(id, '-1 minute');
  assert.deepEqual(stateOf(ALICE, id), { rows: 1, objects: 0, tombstones: 0 });

  // Removing an object that is already gone is a no-op, not an error.
  assert.equal(removeObject(ALICE, p), '');

  // The ordinary retry finishes it; nothing about the half-state blocks it.
  assert.equal(deleteLikeTheClient(ALICE, id), 'deleted');
  assert.deepEqual(stateOf(ALICE, id), DELETED);
});

test('INVARIANT: an active row that also has a tombstone fails closed in both functions', () => {
  const id = doc(42);
  seed(ALICE, id);
  // A state no code path creates — written here directly, as only an operator could.
  sql(`insert into public.document_deletion_tombstones (user_id, document_id) values ('${ALICE}', '${id}')`);

  assert.match(errorFor(roleStatement('authenticated', ALICE,
    `select public.begin_my_document_deletion('${id}')`)), /document_deletion_invariant_violated/);
  assert.match(errorFor(roleStatement('authenticated', ALICE,
    `select public.finalize_my_document_deletion('${id}')`)), /document_deletion_invariant_violated/);

  // Nothing moved: the begin's timestamp rolled back with its error.
  assert.equal(requestedAt(id), 'null');
  assert.deepEqual(stateOf(ALICE, id), { rows: 1, objects: 1, tombstones: 1 });
  sql(`delete from public.document_deletion_tombstones where user_id='${ALICE}' and document_id='${id}'`);
});

test('RACE: an insert of the same id racing finalize is refused once finalize commits', async () => {
  const id = doc(43);
  const p = objectPath(ALICE, id);
  seed(ALICE, id);
  assert.equal(begin(ALICE, id).status, 'ready');
  assert.equal(removeObject(ALICE, p), p);

  const alice = claims(ALICE);
  const finalizer = openSession();
  const replayer = openSession();
  try {
    // Session 1: finalize inside an open transaction — tombstone written, row
    // deleted, nothing committed yet.
    finalizer.send(`set role authenticated; set request.jwt.claim.sub = '${ALICE}';
      set request.jwt.claims = '${alice}';
      begin;
      select public.finalize_my_document_deletion('${id}');`);
    await waitFor(() => sessionsLike('finalize_my_document_deletion', "state = 'idle in transaction'") === 1,
      'finalize to run inside its open transaction');

    // Session 2: a stale client replays the insert. The primary key makes it wait
    // for session 1; a BEFORE-insert check would already have looked and passed.
    replayer.send(`set role authenticated; set request.jwt.claim.sub = '${ALICE}';
      set request.jwt.claims = '${alice}';
      insert into public.documents (id, user_id, storage_path, original_name)
      values ('${id}', '${ALICE}', '${p}', 'race-resurrected.pdf');`);
    await waitFor(() => sessionsLike('race-resurrected.pdf', "wait_event_type = 'Lock'") === 1,
      'the replayed insert to block on the finalizing transaction');

    finalizer.send('commit;');
    const finalized = await finalizer.finish();
    const replayed = await replayer.finish();

    assert.equal(finalized.code, 0, finalized.stderr);
    assert.equal(finalized.stdout.trim(), 'deleted');
    assert.notEqual(replayed.code, 0);
    assert.match(replayed.stderr, /document_already_deleted/);
  } finally {
    finalizer.kill();
    replayer.kill();
  }

  assert.deepEqual(stateOf(ALICE, id), DELETED);
});

test('RACE: two finalizes at once — exactly one deletes, the other is told it is done', async () => {
  const id = doc(44);
  const p = objectPath(ALICE, id);
  seed(ALICE, id);
  assert.equal(begin(ALICE, id).status, 'ready');
  assert.equal(removeObject(ALICE, p), p);

  const alice = claims(ALICE);
  const first = openSession();
  const second = openSession();
  try {
    first.send(`set role authenticated; set request.jwt.claim.sub = '${ALICE}';
      set request.jwt.claims = '${alice}';
      begin;
      select public.finalize_my_document_deletion('${id}') as first_finalize;`);
    await waitFor(() => sessionsLike('first_finalize', "state = 'idle in transaction'") === 1,
      'the first finalize to hold its row lock');

    second.send(`set role authenticated; set request.jwt.claim.sub = '${ALICE}';
      set request.jwt.claims = '${alice}';
      select public.finalize_my_document_deletion('${id}') as second_finalize;`);
    await waitFor(() => sessionsLike('second_finalize', "wait_event_type = 'Lock'") === 1,
      'the second finalize to wait on the row lock');

    first.send('commit;');
    const one = await first.finish();
    const two = await second.finish();

    assert.equal(one.code, 0, one.stderr);
    assert.equal(two.code, 0, two.stderr);
    assert.equal(one.stdout.trim(), 'deleted');
    assert.equal(two.stdout.trim(), 'already-deleted');
  } finally {
    first.kill();
    second.kill();
  }

  // One tombstone, not two; no row; no object.
  assert.deepEqual(stateOf(ALICE, id), DELETED);
});

test('RACE: an upload to the canonical path while finalize is open is refused — before and after it commits', async () => {
  const id = doc(46);
  const p = objectPath(ALICE, id);
  seed(ALICE, id);
  assert.equal(begin(ALICE, id).status, 'ready');
  assert.equal(removeObject(ALICE, p), p);

  const alice = claims(ALICE);
  const finalizer = openSession();
  const uploader = openSession();
  try {
    // Session A: finalize has checked storage.objects (absent), written the
    // tombstone and deleted the row — and has not committed.
    finalizer.send(`set role authenticated; set request.jwt.claim.sub = '${ALICE}';
      set request.jwt.claims = '${alice}';
      begin;
      select public.finalize_my_document_deletion('${id}') as upload_race_finalize;`);
    await waitFor(() => sessionsLike('upload_race_finalize', "state = 'idle in transaction'") === 1,
      'finalize to hold its uncommitted deletion open');

    // Session B: Alice uploads to the same canonical path in that gap. It still
    // sees the committed active row, so the path is claimed and the upload fails.
    uploader.send(`set role authenticated; set request.jwt.claim.sub = '${ALICE}';
      set request.jwt.claims = '${alice}';
      insert into storage.objects (bucket_id, name) values ('documents', '${p}');`);
    const uploaded = await uploader.finish();
    assert.notEqual(uploaded.code, 0, 'the upload landed while finalize was in flight');
    assert.match(uploaded.stderr, /row-level security/);
    assert.equal(sql(`select count(*) from storage.objects where bucket_id='documents' and name='${p}'`), '0');

    finalizer.send('commit;');
    const finalized = await finalizer.finish();
    assert.equal(finalized.code, 0, finalized.stderr);
    assert.equal(finalized.stdout.trim(), 'deleted');
  } finally {
    finalizer.kill();
    uploader.kill();
  }

  // After the commit the tombstone holds the path: the retry is refused too.
  assert.match(errorFor(roleStatement('authenticated', ALICE,
    `insert into storage.objects (bucket_id, name) values ('documents', '${p}')`)), /row-level security/);

  // So the "deleted" that finalize returned is still true.
  assert.deepEqual(stateOf(ALICE, id), DELETED);
});

/* ---------------------------------------- account deletion compatibility */

test('ACCOUNT: a half-finished APP-056 deletion does not poison the account release', () => {
  const kept = doc(50);
  const halfDeleted = doc(51);
  const finished = doc(52);
  seed(CAROL, kept);
  seed(CAROL, halfDeleted);
  seed(CAROL, finished);

  // One completed deletion, and one interrupted after its bytes were removed.
  assert.equal(deleteLikeTheClient(CAROL, finished), 'deleted');
  assert.equal(begin(CAROL, halfDeleted).status, 'ready');
  assert.equal(removeObject(CAROL, objectPath(CAROL, halfDeleted)), objectPath(CAROL, halfDeleted));
  assert.deepEqual(stateOf(CAROL, halfDeleted), { rows: 1, objects: 0, tombstones: 0 });

  // The manifest names only what still needs removing — the half-deleted row's
  // bytes are already gone, so the client is not sent after them...
  assert.equal(release(CAROL), objectPath(CAROL, kept));

  // ...while EVERY owned row, the half-deleted one included, is freshly released
  // and still carries its canonical path. No metadata was removed.
  assert.equal(sql(`select count(*) from public.documents
    where user_id='${CAROL}' and account_deletion_released_at > now() - interval '1 minute'`), '2');

  // The account-deletion flow now removes what it was given and deletes the account.
  assert.equal(removeObject(CAROL, objectPath(CAROL, kept)), objectPath(CAROL, kept));
  assert.equal(release(CAROL), '');
  sql(`delete from auth.users where id='${CAROL}'`);

  // Rows and tombstones cascade with the account; no object is left for the sweep.
  assert.equal(sql(`select count(*) from public.documents where user_id='${CAROL}'`), '0');
  assert.equal(sql(`select count(*) from public.document_deletion_tombstones where user_id='${CAROL}'`), '0');
  assert.equal(sql(`select count(*) from storage.objects where name like '${CAROL}/%'`), '0');
  assert.equal(sql(`select count(*) from public.orphaned_document_paths(1000) where path like '${CAROL}/%'`), '0');
});

test('ACCOUNT: the release still requires recent password authentication, and refuses before writing', () => {
  const id = doc(53);
  seed(ERIN, id);
  const before = sql(`select coalesce(account_deletion_released_at::text, 'null') from public.documents where id='${id}'`);

  for (const amr of [undefined, [], passwordAmr(6 * 60), [{ method: 'oauth', timestamp: Math.floor(Date.now() / 1000) }]]) {
    assert.match(errorFor(roleStatement('authenticated', ERIN,
      'select * from public.release_my_documents_for_account_deletion()', claims(ERIN, { amr }))),
    /reauthentication_required/);
  }
  assert.equal(sql(`select coalesce(account_deletion_released_at::text, 'null') from public.documents where id='${id}'`), before);
  assert.match(errorFor(roleStatement('anon', ERIN, 'select * from public.release_my_documents_for_account_deletion()')),
    /permission denied/);
  // And a per-document request is not a way around it: it opens one document, not the account.
  assert.equal(sql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='release_my_documents_for_account_deletion' and p.pronargs=0`), '1');
});

test('ACCOUNT: still retry-safe — a failed removal is found again, then the account cascades', () => {
  const first = doc(26);
  const second = doc(53);

  // Attempt 1: released, but the Storage removal fails. Nothing is destroyed.
  const manifest = release(ERIN);
  assert.equal(manifest, [objectPath(ERIN, first), objectPath(ERIN, second)].sort().join(','));
  assert.equal(sql(`select count(*) from public.documents where user_id='${ERIN}'`), '2');

  // Attempt 2: the same paths again, because the same objects still exist.
  assert.equal(release(ERIN), manifest);
  for (const id of [first, second]) {
    assert.equal(removeObject(ERIN, objectPath(ERIN, id)), objectPath(ERIN, id));
  }
  assert.equal(release(ERIN), '');

  sql(`delete from auth.users where id='${ERIN}'`);
  assert.equal(sql(`select count(*) from public.documents where user_id='${ERIN}'`), '0');
  assert.equal(sql(`select count(*) from storage.objects where name like '${ERIN}/%'`), '0');
});

test('ACCOUNT: the release also names anomalous bytes under an owned tombstone (defense in depth)', () => {
  const active = doc(54);
  const deleted = doc(55);
  const deletedPath = objectPath(FRANK, deleted);
  seed(FRANK, active);
  seed(FRANK, deleted);
  assert.equal(deleteLikeTheClient(FRANK, deleted), 'deleted');

  // Frank himself cannot put bytes back under the deleted path, nor re-upload over
  // the active document's path while account cleanup runs.
  for (const claimed of [deletedPath, objectPath(FRANK, active)]) {
    assert.match(errorFor(roleStatement('authenticated', FRANK,
      `insert into storage.objects (bucket_id, name) values ('documents', '${claimed}')`)), /row-level security/);
  }

  // Bytes under the deleted path by another route (privileged setup). No row exists for them.
  sql(`insert into storage.objects (bucket_id, name) values ('documents', '${deletedPath}')`);
  assert.deepEqual(stateOf(FRANK, deleted), { rows: 0, objects: 1, tombstones: 1 });

  // A manifest built from rows alone would miss them; this one does not.
  assert.equal(release(FRANK), [objectPath(FRANK, active), deletedPath].sort().join(','));

  // Release still only marks ACTIVE rows, and destroys no metadata.
  assert.equal(sql(`select count(*) from public.documents
    where user_id='${FRANK}' and account_deletion_released_at > now() - interval '1 minute'`), '1');
  assert.equal(sql(`select count(*) from public.document_deletion_tombstones where user_id='${FRANK}'`), '1');

  // One path, once: an active row and a tombstone for the same id — a state only an
  // operator could create — still yields a single manifest entry, because both
  // clients reject a manifest with a duplicate outright.
  sql(`insert into public.document_deletion_tombstones (user_id, document_id) values ('${FRANK}', '${active}')`);
  assert.equal(release(FRANK), [objectPath(FRANK, active), deletedPath].sort().join(','));
  sql(`delete from public.document_deletion_tombstones where user_id='${FRANK}' and document_id='${active}'`);

  // The account-deletion flow removes both: the active one under the fresh release,
  // the anomalous one under the existing no-row reason.
  assert.equal(removeObject(FRANK, objectPath(FRANK, active)), objectPath(FRANK, active));
  assert.equal(removeObject(FRANK, deletedPath), deletedPath);
  assert.equal(release(FRANK), '');

  sql(`delete from auth.users where id='${FRANK}'`);
  assert.equal(sql(`select count(*) from public.documents where user_id='${FRANK}'`), '0');
  assert.equal(sql(`select count(*) from public.document_deletion_tombstones where user_id='${FRANK}'`), '0');
  assert.equal(sql(`select count(*) from storage.objects where name like '${FRANK}/%'`), '0');
  assert.equal(sql(`select count(*) from public.orphaned_document_paths(1000) where path like '${FRANK}/%'`), '0');
});

test('VISIBILITY: an owner that cannot see all of storage.objects makes begin and finalize refuse, and the release over-report', () => {
  const present = doc(60);
  const bytesGone = doc(61);
  const deleted = doc(62);
  seed(DAVE, present);
  seed(DAVE, bytesGone, { object: false });
  seed(DAVE, deleted);
  assert.equal(deleteLikeTheClient(DAVE, deleted), 'deleted');

  // Normal ownership first, for contrast: the release names only the object that
  // exists — not the row whose bytes are gone, not the tombstone with no bytes.
  assert.equal(release(DAVE), objectPath(DAVE, present));
  sql(`update public.documents set account_deletion_released_at = null where user_id='${DAVE}'`);

  const functions = [
    'public.begin_my_document_deletion(uuid)',
    'public.finalize_my_document_deletion(uuid)',
    'public.release_my_documents_for_account_deletion()',
  ];
  // A role subject to RLS on storage.objects, with just enough privilege for the
  // release to read and mark Dave's rows and read his tombstones.
  sql(`create role lifesort_rls_bound_owner nologin nosuperuser nobypassrls;
    grant usage on schema public, storage, auth to lifesort_rls_bound_owner;
    grant select, update on public.documents to lifesort_rls_bound_owner;
    create policy lifesort_rls_bound_owner_documents on public.documents
      for all to lifesort_rls_bound_owner using (true) with check (true);
    grant select on public.document_deletion_tombstones to lifesort_rls_bound_owner;
    create policy lifesort_rls_bound_owner_tombstones on public.document_deletion_tombstones
      for select to lifesort_rls_bound_owner using (true);
    grant execute on function auth.uid(), auth.jwt(), public.has_recent_password_authentication(),
      public.document_release_reauth_window() to lifesort_rls_bound_owner;
    ${functions.map((fn) => `alter function ${fn} owner to lifesort_rls_bound_owner;`).join('\n')}`);
  try {
    // What the guard reads, from each owner's side: the real owner sees every row,
    // the RLS-bound one would not.
    assert.equal(sql(`select row_security_active('storage.objects')::text`), 'false');
    assert.equal(sql(`set role lifesort_rls_bound_owner; select row_security_active('storage.objects')::text`), 'true');

    // begin refuses to open a window that nothing could later close...
    assert.match(errorFor(roleStatement('authenticated', DAVE,
      `select public.begin_my_document_deletion('${present}')`)), /document_storage_state_unverifiable/);
    assert.equal(requestedAt(present), 'null');

    // ...and finalize refuses to read a blind "absent" as proof, even for a row
    // whose bytes really are gone and whose request is fresh.
    sql(`update public.documents set deletion_requested_at = now() where id='${bytesGone}'`);
    assert.match(errorFor(roleStatement('authenticated', DAVE,
      `select public.finalize_my_document_deletion('${bytesGone}')`)), /document_storage_state_unverifiable/);
    assert.deepEqual(stateOf(DAVE, bytesGone), { rows: 1, objects: 0, tombstones: 0 });

    // The release cannot tell which objects exist, so it over-reports: every
    // active row's path AND every tombstone-derived path. Over-reporting costs a
    // no-op removal; under-reporting would strand bytes.
    assert.equal(release(DAVE),
      [objectPath(DAVE, present), objectPath(DAVE, bytesGone), objectPath(DAVE, deleted)].sort().join(','));
  } finally {
    sql(`${functions.map((fn) => `alter function ${fn} owner to postgres;`).join('\n')}
      drop policy lifesort_rls_bound_owner_documents on public.documents;
      drop policy lifesort_rls_bound_owner_tombstones on public.document_deletion_tombstones;
      drop owned by lifesort_rls_bound_owner;
      drop role lifesort_rls_bound_owner;`);
  }

  // Ownership restored: the lifecycle works again for the same rows.
  assert.equal(finalize(DAVE, bytesGone), 'deleted');
  assert.deepEqual(stateOf(DAVE, bytesGone), DELETED);
});

/* --------------------------------------------------------------- no orphan */

test('NO ORPHAN: a completed deletion leaves no row, no object and exactly one tombstone', () => {
  const id = doc(70);
  seed(BOB, id, { name: 'final-check.pdf' });
  assert.deepEqual(stateOf(BOB, id), INTACT);

  assert.equal(deleteLikeTheClient(BOB, id), 'deleted');

  assert.equal(sql(`select count(*) from public.documents where id='${id}'`), '0');
  assert.equal(sql(`select count(*) from storage.objects where bucket_id='documents' and name='${objectPath(BOB, id)}'`), '0');
  assert.equal(sql(`select count(*) from public.document_deletion_tombstones where user_id='${BOB}' and document_id='${id}'`), '1');

  // And across everything this file deleted: no tombstone has a surviving row or object.
  assert.equal(sql(`select count(*) from public.document_deletion_tombstones t
    where exists (select 1 from public.documents d where d.id = t.document_id and d.user_id = t.user_id)
       or exists (select 1 from storage.objects o
                  where o.bucket_id = 'documents' and o.name = t.user_id::text || '/' || t.document_id::text)`), '0');
});
