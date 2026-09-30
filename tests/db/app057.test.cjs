// APP-057: apply the documents history (APP-055, its hardening, APP-056), recreate
// public.warranties exactly as the remote schema declares it, seed legacy rows, and
// then apply the APP-057 migration to a disposable local Postgres cluster.
//
// The fixture for storage and auth is APP-056's: Supabase's `storage` and `auth`
// schemas are not version-controlled here, so the minimal parts the migrations
// depend on are recreated. The warranties table is NOT hand-copied: its statements
// are lifted verbatim out of 20260902112000_remote_schema.sql, so the table, its
// primary key, its auth.users cascade, its four RLS policies and its grants are the
// ones the migration history actually declares.
//
// Cross-account cases run as two authenticated users, each in their own session,
// and the races hold a transaction open in one psql session while another acts.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bin = path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app057-'));
const cluster = path.join(scratch, 'db');
const port = '55457';

/** The approved baseline APP-057 was built on. Every migration it contains is history. */
const BASELINE_COMMIT = '4b6e2843d31c522e41493b73c985eeff5870313e';
const APP057_MIGRATION = '20260930122303_app057_warranty_domain.sql';
const REMOTE_SCHEMA = '20260902112000_remote_schema.sql';

const ALICE = '10000000-0000-4000-8000-000000000001';
const BOB = '10000000-0000-4000-8000-000000000002';
/** Account deletion with a warranty that references a document. */
const CAROL = '10000000-0000-4000-8000-000000000003';

/** The documents history, in the order it reaches a real database. */
const DOCUMENT_MIGRATIONS = [
  '20260925090000_private_document_bucket.sql',
  '20260925225633_app055_harden_document_window_search_path.sql',
  '20260927204302_app056_document_delete_cascade.sql',
];

const doc = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const objectPath = (userId, documentId) => `${userId}/${documentId}`;

let started = false;
/** Captured before APP-057 is applied, compared after. */
let before057 = null;

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

function claims(userId) {
  return JSON.stringify({ sub: userId, role: 'authenticated', iat: Math.floor(Date.now() / 1000) }).replace(/'/g, "''");
}

const roleStatement = (userId, source) =>
  `set role authenticated; set request.jwt.claim.sub = '${userId}';
   set request.jwt.claims = '${claims(userId)}';
   ${source}`;

const asUser = (userId, source) => sql(roleStatement(userId, source));

/* ------------------------------------------------------------- fixtures */

/** The warranties statements exactly as the remote schema declares them. */
function remoteWarrantiesStatements() {
  const remote = fs.readFileSync(path.join(root, 'supabase/migrations', REMOTE_SCHEMA), 'utf8');
  return remote
    .split(/;\s*\n/)
    .filter((statement) => statement.includes('"public"."warranties"'))
    .map((statement) => `${statement.trim()};`);
}

/** A stored document: its object and its row, as a real upload leaves them. */
function seedDocument(userId, documentId, name = 'receipt.pdf') {
  const p = objectPath(userId, documentId);
  sql(`insert into storage.objects (bucket_id, name) values ('documents', '${p}');
       insert into public.documents (id, user_id, storage_path, original_name)
       values ('${documentId}', '${userId}', '${p}', '${name}');`);
}

const lit = (value) => (value === null || value === undefined ? 'null' : `'${value}'`);

/** An insert exactly as an authenticated client makes it. */
function insertWarranty(userId, id, { expiry = '2028-06-01', purchase = null, seller = null, receipt = null } = {}) {
  return asUser(userId, `insert into public.warranties
    (id, user_id, name, type, expiry_date, notes, purchase_date, seller, receipt_document_id)
    values ('${id}', '${userId}', 'Synthetic product', 'warranty', '${expiry}', null,
            ${lit(purchase)}, ${lit(seller)}, ${lit(receipt)})
    returning id`);
}

/** One warranty row as the database holds it, for exact comparisons. */
const warrantyRow = (userId, id) => sql(`select coalesce(row_to_json(w)::text, 'missing')
  from (select id, user_id, name, type, expiry_date, notes, created_at,
               purchase_date, seller, receipt_document_id
        from public.warranties where user_id='${userId}' and id='${id}') w`);

const receiptOf = (userId, id) => sql(`select coalesce(receipt_document_id::text, 'null')
  from public.warranties where user_id='${userId}' and id='${id}'`);

/* ------------------------------------------- the APP-056 client lifecycle */

const begin = (userId, documentId) => JSON.parse(asUser(userId,
  `select public.begin_my_document_deletion('${documentId}')::text`));

const finalize = (userId, documentId) => asUser(userId,
  `select public.finalize_my_document_deletion('${documentId}')`);

/** What the Storage API does for .remove([name]): a DELETE under the caller's RLS. */
const removeObject = (userId, name) => asUser(userId,
  `delete from storage.objects where bucket_id='documents' and name='${name}' returning name`);

/** Exactly the sequence the app runs: begin, remove the returned path, finalize. */
function deleteDocumentLikeTheClient(userId, documentId) {
  const started = begin(userId, documentId);
  if (started.status !== 'ready') return started.status;
  removeObject(userId, started.storage_path);
  return finalize(userId, documentId);
}

/* ------------------------------------------------ concurrent sessions */

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

/* ------------------------------------ what APP-057 must leave untouched */

/**
 * Policies, grants and function bodies that APP-055/APP-056 own, plus the
 * warranties policies. APP-057 changes none of them; this is compared before and
 * after the migration rather than asserted piecemeal.
 */
function untouchedSurface() {
  return {
    policies: sql(`select coalesce(string_agg(format('%s.%s|%s|%s|%s|%s|%s',
        schemaname, tablename, policyname, cmd, roles::text, coalesce(qual, ''), coalesce(with_check, '')),
        E'\\n' order by schemaname, tablename, policyname), '')
      from pg_policies
      where (schemaname, tablename) in (('public','documents'), ('public','document_deletion_tombstones'),
                                        ('public','warranties'), ('storage','objects'))`),
    tableGrants: sql(`select coalesce(string_agg(format('%s|%s|%s', table_name, grantee, privilege_type),
        E'\\n' order by table_name, grantee, privilege_type), '')
      from information_schema.role_table_grants
      where table_schema='public' and table_name in ('documents', 'document_deletion_tombstones', 'warranties')`),
    columnGrants: sql(`select coalesce(string_agg(format('%s|%s|%s|%s', table_name, column_name, grantee, privilege_type),
        E'\\n' order by table_name, column_name, grantee, privilege_type), '')
      from information_schema.column_privileges
      where table_schema='public' and table_name in ('documents', 'document_deletion_tombstones')
        and column_name not in ('purchase_date', 'seller', 'receipt_document_id')`),
    functions: sql(`select coalesce(string_agg(pg_get_functiondef(p.oid), E'\\n' order by p.proname), '')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`),
    functionGrants: sql(`select coalesce(string_agg(format('%s|%s', p.proname, coalesce(p.proacl::text, '')),
        E'\\n' order by p.proname), '')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`),
    buckets: sql(`select coalesce(string_agg(format('%s|%s|%s', id, public, coalesce(file_size_limit::text, '')),
        E'\\n' order by id), '') from storage.buckets`),
    rls: sql(`select string_agg(format('%s|%s|%s', relname, relrowsecurity, relforcerowsecurity), E'\\n' order by relname)
      from pg_class where oid in ('public.documents'::regclass, 'public.document_deletion_tombstones'::regclass,
                                  'public.warranties'::regclass, 'storage.objects'::regclass)`),
    documentColumns: sql(`select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name)
      from information_schema.columns where table_schema='public' and table_name='documents'`),
  };
}

/** Every legacy row, with only the pre-APP-057 columns. */
const legacyRows = () => sql(`select coalesce(string_agg(row_to_json(w)::text, E'\\n' order by user_id, id), '')
  from (select id, user_id, name, type, expiry_date, notes, created_at from public.warranties) w`);

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
      ('${CAROL}', 'carol@example.test');`);

  for (const migration of DOCUMENT_MIGRATIONS) {
    sql(fs.readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8'));
  }

  const statements = remoteWarrantiesStatements();
  // CREATE TABLE, ENABLE RLS, the auth.users FK, four policies and one GRANT. A
  // different count means the extraction no longer describes the real table.
  assert.equal(statements.length, 8, statements.join('\n\n'));
  for (const statement of statements) sql(statement);

  // Legacy rows, written the way pre-APP-057 clients wrote them: a text id of the
  // old timestamp shape, a crypto UUID, notes and none.
  sql(`insert into public.warranties (id, user_id, name, type, expiry_date, notes, created_at) values
    ('1693000000000-abc', '${ALICE}', 'Legacy laptop', 'warranty', '2027-01-31', 'kept in drawer', '2026-01-02T03:04:05Z'),
    ('30000000-0000-4000-8000-000000000001', '${ALICE}', 'Legacy insurance', 'insurance', '2026-12-24', null, '2026-02-03T04:05:06Z'),
    ('legacy-bob', '${BOB}', 'Legacy phone', 'receipt', '2028-02-29', null, '2026-03-04T05:06:07Z');`);

  before057 = { rows: legacyRows(), surface: untouchedSurface() };

  sql(fs.readFileSync(path.join(root, 'supabase/migrations', APP057_MIGRATION), 'utf8'));
});

after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});

/* ------------------------------------------------ migration and history */

test('MIGRATION: applies forward on the documents history and keeps every legacy value', () => {
  assert.notEqual(before057.rows, '');
  assert.equal(legacyRows(), before057.rows);

  // Nothing was invented for rows that never recorded these facts.
  assert.equal(sql(`select count(*) from public.warranties
    where purchase_date is not null or seller is not null or receipt_document_id is not null`), '0');
  assert.equal(sql('select count(*) from public.warranties'), '3');
});

test('MIGRATION: APP-055/APP-056 policies, grants, functions and the warranties policies are unchanged', () => {
  const after057 = untouchedSurface();
  for (const key of Object.keys(before057.surface)) {
    if (key === 'documentColumns') continue;
    assert.equal(after057[key], before057.surface[key], `${key} changed`);
  }
  // No column was added to or removed from public.documents.
  assert.equal(after057.documentColumns, before057.surface.documentColumns);
});

test('HISTORY: every migration in the approved baseline is byte-identical, and APP-057 is new', () => {
  const historical = execFileSync('git', ['ls-tree', '--name-only', `${BASELINE_COMMIT}:supabase/migrations`], {
    cwd: root, encoding: 'utf8',
  }).split('\n').filter(Boolean);
  assert.ok(historical.includes('20260927204302_app056_document_delete_cascade.sql'));
  assert.ok(!historical.includes(APP057_MIGRATION));

  for (const file of historical) {
    const atBaseline = execFileSync('git', ['show', `${BASELINE_COMMIT}:supabase/migrations/${file}`], {
      cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024,
    });
    const now = fs.readFileSync(path.join(root, 'supabase/migrations', file));
    assert.ok(atBaseline.equals(now), `${file} was edited`);
  }

  // Ordered after the whole history, so it runs after the documents it references.
  assert.ok(historical.every((file) => file < APP057_MIGRATION));
});

/* --------------------------------------------------------------- schema */

test('SCHEMA: three nullable columns; the product label and coverage end keep their names and types', () => {
  assert.equal(sql(`select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name)
    from information_schema.columns where table_schema='public' and table_name='warranties'`),
  [
    'created_at:timestamp with time zone:NO',
    'expiry_date:date:NO',
    'id:text:NO',
    'name:text:NO',
    'notes:text:YES',
    'purchase_date:date:YES',
    'receipt_document_id:uuid:YES',
    'seller:text:YES',
    'type:text:NO',
    'user_id:uuid:NO',
  ].join(','));
  assert.equal(sql(`select count(*) from information_schema.columns
    where table_schema='public' and table_name='warranties'
      and column_name in ('purchase_date', 'seller', 'receipt_document_id') and column_default is not null`), '0');
});

test('SCHEMA: the receipt reference is composite and owner-bound, and deletion can only clear the reference', () => {
  const fk = sql(`select
      (select string_agg(a.attname, ',' order by k.n) from unnest(c.conkey) with ordinality k(attnum, n)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) || '|' ||
      c.confrelid::regclass::text || '|' ||
      (select string_agg(a.attname, ',' order by k.n) from unnest(c.confkey) with ordinality k(attnum, n)
         join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) || '|' ||
      c.confdeltype::text || '|' || c.confupdtype::text || '|' || c.confmatchtype::text || '|' ||
      coalesce((select string_agg(a.attname, ',') from unnest(c.confdelsetcols) k(attnum)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum), 'ALL')
    from pg_constraint c
    where c.conrelid = 'public.warranties'::regclass and c.conname = 'warranties_receipt_document_fkey'`);
  // (user_id, receipt_document_id) -> documents(user_id, id); ON DELETE SET NULL of
  // receipt_document_id ONLY; ON UPDATE NO ACTION; MATCH SIMPLE.
  assert.equal(fk, 'user_id,receipt_document_id|documents|user_id,id|n|a|s|receipt_document_id');

  // The warranties primary key and auth.users cascade are what they were.
  assert.equal(sql(`select string_agg(conname || ':' || contype::text || ':' || confdeltype::text, ',' order by conname)
    from pg_constraint where conrelid = 'public.warranties'::regclass and contype in ('p', 'f')`),
  'warranties_pkey:p: ,warranties_receipt_document_fkey:f:n,warranties_user_id_fkey:f:c');

  // The FK target is new and changes nothing about which document rows may exist.
  assert.equal(sql(`select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.documents'::regclass and conname = 'documents_user_id_id_key'`), 'UNIQUE (user_id, id)');
  assert.equal(sql(`select pg_get_indexdef('public.warranties_receipt_document_idx'::regclass)`),
    'CREATE INDEX warranties_receipt_document_idx ON public.warranties USING btree (user_id, receipt_document_id) WHERE (receipt_document_id IS NOT NULL)');
});

/* ----------------------------------------------------- canonical dates */

test('CHECK: a purchase after coverage ends is refused; same day, earlier and absent are allowed', () => {
  assert.equal(insertWarranty(ALICE, 'check-equal', { purchase: '2028-06-01', expiry: '2028-06-01' }), 'check-equal');
  assert.equal(insertWarranty(ALICE, 'check-before', { purchase: '2026-06-01', expiry: '2028-06-01' }), 'check-before');
  assert.equal(insertWarranty(ALICE, 'check-absent', { expiry: '2028-06-01' }), 'check-absent');
  // A leap day is a real calendar day on both sides of the comparison.
  assert.equal(insertWarranty(ALICE, 'check-leap', { purchase: '2028-02-29', expiry: '2028-02-29' }), 'check-leap');

  assert.match(errorFor(roleStatement(ALICE, `insert into public.warranties (id, user_id, name, type, expiry_date, purchase_date)
    values ('check-after', '${ALICE}', 'X', 'warranty', '2028-06-01', '2028-06-02')`)),
  /violates check constraint "warranties_purchase_not_after_coverage_end"/);
  assert.equal(sql(`select count(*) from public.warranties where id='check-after'`), '0');

  // Moving either end so the order breaks is refused as well, and changes nothing.
  const beforeUpdate = warrantyRow(ALICE, 'check-before');
  assert.match(errorFor(roleStatement(ALICE, `update public.warranties set expiry_date = '2026-05-31'
    where id='check-before'`)), /warranties_purchase_not_after_coverage_end/);
  assert.match(errorFor(roleStatement(ALICE, `update public.warranties set purchase_date = '2028-06-02'
    where id='check-before'`)), /warranties_purchase_not_after_coverage_end/);
  assert.equal(warrantyRow(ALICE, 'check-before'), beforeUpdate);

  // An impossible calendar day never reaches the constraint: the date type refuses it.
  assert.match(errorFor(roleStatement(ALICE, `insert into public.warranties (id, user_id, name, type, expiry_date, purchase_date)
    values ('check-impossible', '${ALICE}', 'X', 'warranty', '2028-06-01', '2027-02-29')`)), /out of range/);
});

/* ------------------------------------------------------ owner reference */

test('REFERENCE: an owner can reference their own document on insert and on update', () => {
  const receipt = doc(1);
  const later = doc(2);
  seedDocument(ALICE, receipt);

  // A document uploaded the ordinary way (object first, row second, column grant)
  // is referenceable too — the new unique target does not get in the upload's way.
  sql(`insert into storage.objects (bucket_id, name) values ('documents', '${objectPath(ALICE, later)}')`);
  asUser(ALICE, `insert into public.documents (id, user_id, storage_path, original_name)
    values ('${later}', '${ALICE}', '${objectPath(ALICE, later)}', 'later.pdf')`);

  assert.equal(insertWarranty(ALICE, 'ref-own', { purchase: '2026-09-01', seller: 'Synthetic shop', receipt }), 'ref-own');
  assert.equal(receiptOf(ALICE, 'ref-own'), receipt);

  assert.equal(asUser(ALICE, `update public.warranties set receipt_document_id = '${later}'
    where id='ref-own' returning receipt_document_id`), later);
  assert.equal(asUser(ALICE, `update public.warranties set receipt_document_id = null
    where id='ref-own' returning coalesce(receipt_document_id::text, 'null')`), 'null');

  // Legacy rows can gain a receipt without anything else about them changing.
  const legacyBefore = JSON.parse(warrantyRow(ALICE, '1693000000000-abc'));
  asUser(ALICE, `update public.warranties set receipt_document_id = '${receipt}' where id='1693000000000-abc'`);
  const legacyAfter = JSON.parse(warrantyRow(ALICE, '1693000000000-abc'));
  assert.deepEqual({ ...legacyAfter, receipt_document_id: null }, legacyBefore);
  asUser(ALICE, `update public.warranties set receipt_document_id = null where id='1693000000000-abc'`);
});

test('REFERENCE: another account\'s document cannot be referenced, and the refusal is the one for a missing id', () => {
  const bobs = doc(10);
  const missing = doc(11);
  seedDocument(BOB, bobs, 'bob-private.pdf');
  insertWarranty(ALICE, 'ref-foreign');
  const untouched = warrantyRow(ALICE, 'ref-foreign');

  const foreignInsert = errorFor(roleStatement(ALICE, `insert into public.warranties
    (id, user_id, name, type, expiry_date, receipt_document_id)
    values ('ref-foreign-insert', '${ALICE}', 'X', 'warranty', '2028-06-01', '${bobs}')`));
  const missingInsert = errorFor(roleStatement(ALICE, `insert into public.warranties
    (id, user_id, name, type, expiry_date, receipt_document_id)
    values ('ref-foreign-insert', '${ALICE}', 'X', 'warranty', '2028-06-01', '${missing}')`));
  assert.match(foreignInsert, /violates foreign key constraint "warranties_receipt_document_fkey"/);
  // Same words either way: an existing document of someone else looks exactly like
  // no document at all, so the constraint is not an existence oracle.
  assert.equal(foreignInsert.replace(bobs, '<id>'), missingInsert.replace(missing, '<id>'));
  assert.doesNotMatch(foreignInsert, /bob-private|storage_path|10000000-0000-4000-8000-000000000002/);

  const foreignUpdate = errorFor(roleStatement(ALICE, `update public.warranties set receipt_document_id = '${bobs}'
    where id='ref-foreign'`));
  assert.match(foreignUpdate, /violates foreign key constraint "warranties_receipt_document_fkey"/);

  assert.equal(sql(`select count(*) from public.warranties where id='ref-foreign-insert'`), '0');
  assert.equal(warrantyRow(ALICE, 'ref-foreign'), untouched);
});

test('RLS: another account can neither read, change, claim nor re-home a warranty', () => {
  const alicesDoc = doc(20);
  const bobsDoc = doc(21);
  seedDocument(ALICE, alicesDoc);
  seedDocument(BOB, bobsDoc);
  insertWarranty(ALICE, 'rls-alice', { purchase: '2026-01-01', seller: 'Synthetic shop', receipt: alicesDoc });
  const untouched = warrantyRow(ALICE, 'rls-alice');

  // Bob sees neither her warranty nor the document it references.
  assert.equal(asUser(BOB, `select count(*) from public.warranties where id='rls-alice'`), '0');
  assert.equal(asUser(BOB, `select count(*) from public.warranties where receipt_document_id='${alicesDoc}'`), '0');
  assert.equal(asUser(BOB, `select count(*) from public.documents where id='${alicesDoc}'`), '0');

  // He cannot point her warranty at anything, nor clear its reference.
  assert.equal(asUser(BOB, `update public.warranties set receipt_document_id = '${bobsDoc}'
    where id='rls-alice' returning id`), '');
  assert.equal(asUser(BOB, `update public.warranties set receipt_document_id = null
    where id='rls-alice' returning id`), '');
  assert.equal(asUser(BOB, `delete from public.warranties where id='rls-alice' returning id`), '');

  // A client-supplied user_id is not an authority: Bob cannot write a row as Alice,
  // and Alice cannot move hers to Bob — which would also be the only way to make the
  // composite reference resolve against his documents.
  assert.match(errorFor(roleStatement(BOB, `insert into public.warranties
    (id, user_id, name, type, expiry_date, receipt_document_id)
    values ('rls-spoof', '${ALICE}', 'X', 'warranty', '2028-06-01', '${alicesDoc}')`)), /row-level security/);
  assert.match(errorFor(roleStatement(ALICE, `update public.warranties set user_id = '${BOB}', receipt_document_id = '${bobsDoc}'
    where id='rls-alice'`)), /row-level security/);

  // anon has nothing at all.
  assert.equal(sql(`set role anon; select count(*) from public.warranties;`), '0');

  assert.equal(warrantyRow(ALICE, 'rls-alice'), untouched);
});

test('CONTROL: a plain composite SET NULL would null the owner too, and so block document deletion', () => {
  // Proof of why the migration names its SET NULL column. Run in a transaction the
  // failure aborts, against a throwaway table, so nothing of it survives.
  const control = doc(90);
  seedDocument(ALICE, control);
  const refused = errorFor(`begin;
    create table public.app057_control_plain_set_null (
      user_id uuid not null, receipt uuid,
      foreign key (user_id, receipt) references public.documents (user_id, id) on delete set null);
    insert into public.app057_control_plain_set_null values ('${ALICE}', '${control}');
    delete from public.documents where id = '${control}';
    commit;`);
  assert.match(refused, /null value in column "user_id"/);
  assert.equal(sql(`select to_regclass('public.app057_control_plain_set_null') is null`), 't');
  assert.equal(sql(`select count(*) from public.documents where id='${control}'`), '1');
});

/* ------------------------------------------------------------- deletion */

test('DELETE: deleting a referenced document keeps every warranty and clears only the reference', () => {
  const receipt = doc(30);
  const other = doc(31);
  seedDocument(ALICE, receipt);
  seedDocument(ALICE, other);
  insertWarranty(ALICE, 'del-a', { purchase: '2026-02-01', expiry: '2028-02-01', seller: 'Shop A', receipt });
  insertWarranty(ALICE, 'del-b', { purchase: '2026-03-01', expiry: '2028-03-01', seller: 'Shop B', receipt });
  insertWarranty(ALICE, 'del-other', { receipt: other });
  const [a, b, otherRow] = ['del-a', 'del-b', 'del-other'].map((id) => JSON.parse(warrantyRow(ALICE, id)));

  // The real APP-056 lifecycle, as the owner, with finalize's pinned search_path.
  assert.equal(deleteDocumentLikeTheClient(ALICE, receipt), 'deleted');
  assert.equal(sql(`select count(*) from public.documents where id='${receipt}'`), '0');
  assert.equal(sql(`select count(*) from public.document_deletion_tombstones
    where user_id='${ALICE}' and document_id='${receipt}'`), '1');

  // Both warranties survive, byte for byte, except the reference — and user_id,
  // part of the key and of the reference, is exactly what it was.
  assert.deepEqual(JSON.parse(warrantyRow(ALICE, 'del-a')), { ...a, receipt_document_id: null });
  assert.deepEqual(JSON.parse(warrantyRow(ALICE, 'del-b')), { ...b, receipt_document_id: null });
  assert.equal(JSON.parse(warrantyRow(ALICE, 'del-a')).user_id, ALICE);
  // A warranty that referenced a different document is untouched.
  assert.deepEqual(JSON.parse(warrantyRow(ALICE, 'del-other')), otherRow);

  // No dangling reference anywhere, and the deleted id cannot be referenced again.
  assert.equal(sql(`select count(*) from public.warranties w
    where w.receipt_document_id is not null
      and not exists (select 1 from public.documents d where d.user_id = w.user_id and d.id = w.receipt_document_id)`), '0');
  assert.match(errorFor(roleStatement(ALICE, `update public.warranties set receipt_document_id = '${receipt}'
    where id='del-a'`)), /warranties_receipt_document_fkey/);
});

test('DELETE: account deletion cascades warranties and referenced documents without the reference blocking it', () => {
  const receipt = doc(40);
  seedDocument(CAROL, receipt);
  insertWarranty(CAROL, 'carol-1', { receipt });
  insertWarranty(CAROL, 'carol-2');

  sql(`delete from auth.users where id='${CAROL}'`);

  assert.equal(sql(`select count(*) from public.warranties where user_id='${CAROL}'`), '0');
  assert.equal(sql(`select count(*) from public.documents where user_id='${CAROL}'`), '0');
});

/* ------------------------------------------------------- stale clients */

test('LEGACY CLIENT: a pre-APP-057 upsert preserves the new columns, and a legacy insert leaves them empty', () => {
  const receipt = doc(50);
  seedDocument(ALICE, receipt);
  insertWarranty(ALICE, 'legacy-upsert', { purchase: '2026-04-01', seller: 'Synthetic shop', receipt });

  // PostgREST's merge-duplicates upsert updates exactly the columns in the payload,
  // and an old client's payload has none of the three.
  asUser(ALICE, `insert into public.warranties (id, user_id, name, type, expiry_date, notes, created_at)
    values ('legacy-upsert', '${ALICE}', 'Renamed on old phone', 'warranty', '2029-04-01', 'old note', '2026-04-01T00:00:00Z')
    on conflict (user_id, id) do update set
      name = excluded.name, type = excluded.type, expiry_date = excluded.expiry_date,
      notes = excluded.notes, created_at = excluded.created_at`);
  const row = JSON.parse(warrantyRow(ALICE, 'legacy-upsert'));
  assert.equal(row.name, 'Renamed on old phone');
  assert.equal(row.expiry_date, '2029-04-01');
  assert.equal(row.purchase_date, '2026-04-01');
  assert.equal(row.seller, 'Synthetic shop');
  assert.equal(row.receipt_document_id, receipt);

  asUser(ALICE, `insert into public.warranties (id, user_id, name, type, expiry_date, notes, created_at)
    values ('legacy-insert', '${ALICE}', 'From old phone', 'warranty', '2029-01-01', null, now())`);
  const inserted = JSON.parse(warrantyRow(ALICE, 'legacy-insert'));
  assert.deepEqual([inserted.purchase_date, inserted.seller, inserted.receipt_document_id], [null, null, null]);

  // The one thing an old client can no longer do is break the date order it cannot
  // see: moving coverage end before a recorded purchase is refused, not repaired.
  assert.match(errorFor(roleStatement(ALICE, `insert into public.warranties (id, user_id, name, type, expiry_date, notes, created_at)
    values ('legacy-upsert', '${ALICE}', 'X', 'warranty', '2026-03-01', null, now())
    on conflict (user_id, id) do update set expiry_date = excluded.expiry_date`)), /warranties_purchase_not_after_coverage_end/);
  assert.equal(JSON.parse(warrantyRow(ALICE, 'legacy-upsert')).expiry_date, '2029-04-01');
});

/* ---------------------------------------------------------------- races */

test('RACE: a warranty write holding a reference makes finalize wait, then the reference is cleared', async () => {
  const receipt = doc(60);
  const p = objectPath(ALICE, receipt);
  seedDocument(ALICE, receipt);
  assert.equal(begin(ALICE, receipt).status, 'ready');
  assert.equal(removeObject(ALICE, p), p);

  const writer = openSession();
  const finalizer = openSession();
  try {
    // Session 1: the warranty write that references the document, not yet committed.
    writer.send(`${roleStatement(ALICE, '')}
      begin;
      insert into public.warranties (id, user_id, name, type, expiry_date, receipt_document_id)
      values ('race-writer-first', '${ALICE}', 'Race', 'warranty', '2028-06-01', '${receipt}') returning id;`);
    await waitFor(() => sessionsLike('race-writer-first', "state = 'idle in transaction'") === 1,
      'the warranty insert to hold its reference');

    // Session 2: finalize must wait for it rather than delete under it.
    finalizer.send(`${roleStatement(ALICE, '')}
      select public.finalize_my_document_deletion('${receipt}') as warranty_race_finalize;`);
    await waitFor(() => sessionsLike('warranty_race_finalize', "wait_event_type = 'Lock'") === 1,
      'finalize to block on the referencing write');

    writer.send('commit;');
    const written = await writer.finish();
    const finalized = await finalizer.finish();

    assert.equal(written.code, 0, written.stderr);
    assert.equal(finalized.code, 0, finalized.stderr);
    assert.equal(finalized.stdout.trim(), 'deleted');
  } finally {
    writer.kill();
    finalizer.kill();
  }

  // The warranty exists, and its reference went with the document.
  assert.equal(receiptOf(ALICE, 'race-writer-first'), 'null');
  assert.equal(sql(`select count(*) from public.documents where id='${receipt}'`), '0');
});

test('RACE: a warranty write racing an open finalize is refused once finalize commits', async () => {
  const receipt = doc(61);
  const p = objectPath(ALICE, receipt);
  seedDocument(ALICE, receipt);
  insertWarranty(ALICE, 'race-finalize-first');
  assert.equal(begin(ALICE, receipt).status, 'ready');
  assert.equal(removeObject(ALICE, p), p);

  const finalizer = openSession();
  const writer = openSession();
  try {
    // Session 1: finalize inside an open transaction — row deleted, not committed.
    finalizer.send(`${roleStatement(ALICE, '')}
      begin;
      select public.finalize_my_document_deletion('${receipt}') as open_finalize_for_warranty;`);
    await waitFor(() => sessionsLike('open_finalize_for_warranty', "state = 'idle in transaction'") === 1,
      'finalize to run inside its open transaction');

    // Session 2: a warranty update that references it waits on the deleting transaction.
    writer.send(`${roleStatement(ALICE, '')}
      update public.warranties set receipt_document_id = '${receipt}'
      where id = 'race-finalize-first' returning 'race-late-reference';`);
    await waitFor(() => sessionsLike('race-late-reference', "wait_event_type = 'Lock'") === 1,
      'the referencing update to block on finalize');

    finalizer.send('commit;');
    const finalized = await finalizer.finish();
    const written = await writer.finish();

    assert.equal(finalized.code, 0, finalized.stderr);
    assert.equal(finalized.stdout.trim(), 'deleted');
    assert.notEqual(written.code, 0);
    assert.match(written.stderr, /warranties_receipt_document_fkey/);
  } finally {
    finalizer.kill();
    writer.kill();
  }

  assert.equal(receiptOf(ALICE, 'race-finalize-first'), 'null');
});

/* --------------------------------------------------------------- summary */

test('NO DANGLING: across everything this file did, every reference resolves to its owner\'s live document', () => {
  assert.equal(sql(`select count(*) from public.warranties w
    where w.receipt_document_id is not null
      and not exists (select 1 from public.documents d
                      where d.user_id = w.user_id and d.id = w.receipt_document_id)`), '0');
  assert.equal(sql(`select count(*) from public.warranties
    where purchase_date is not null and purchase_date > expiry_date`), '0');
});
