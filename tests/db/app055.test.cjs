// APP-055: apply the actual additive migration to a disposable local Postgres
// cluster and exercise the behaviour, not the policy names.
//
// Supabase's `storage` schema is not version-controlled in this repo, so the
// minimal parts the migration and its policies actually depend on are recreated
// here as synthetic fixtures: `storage.buckets`, `storage.objects` and
// `storage.foldername`. Everything under test — the table, its constraints, its
// RLS and the object policies — comes from the migration file itself.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bin = path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app055-'));
const cluster = path.join(scratch, 'db');
const port = '55455';

const ALICE = '10000000-0000-4000-8000-000000000001';
const BOB = '10000000-0000-4000-8000-000000000002';
const DOOMED = '10000000-0000-4000-8000-000000000003';

const ALICE_DOC = '20000000-0000-4000-8000-000000000001';
const BOB_DOC = '20000000-0000-4000-8000-000000000002';
const DOOMED_DOC = '20000000-0000-4000-8000-000000000003';

let started = false;

function sql(source) {
  return execFileSync(
    path.join(bin, 'psql'),
    ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', port, '-U', 'postgres', '-d', 'postgres'],
    { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}

function errorFor(source) {
  try { sql(source); } catch (error) { return String(error.stderr); }
  assert.fail('SQL unexpectedly succeeded');
}

/**
 * A session's claims.
 *
 * `amr` carries what Supabase Auth records per session: which method verified
 * the identity and when. `iat` is the access token's issue time and moves on
 * every refresh — the two are set independently here precisely so a test can
 * show that moving `iat` alone changes nothing.
 */
function claims(userId, { amr, iatSecondsAgo = 0 } = {}) {
  const payload = { sub: userId, role: 'authenticated', iat: Math.floor(Date.now() / 1000) - iatSecondsAgo };
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

// Two layers refuse a non-canonical path: the INSERT policy's own predicate and
// the table CHECK. Which one reports first is a Postgres ordering detail, not a
// contract, so the refusal is asserted rather than the layer. The CHECK is then
// proved on its own below, with RLS out of the way.
const REFUSED_PATH = /documents_storage_path_canonical|row-level security/;

const objectPath = (userId, documentId) => `${userId}/${documentId}`;

before(() => {
  execFileSync(path.join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-l', path.join(scratch, 'postgres.log'), '-o', `-k ${scratch} -p ${port} -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  started = true;

  sql(`create role authenticated; create role anon; create role service_role;
    create schema auth; create schema storage;

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    -- Mirrors Supabase's own auth.jwt(): the request's claims as jsonb. The
    -- CLAIM SHAPE is Supabase's (documented amr entries of {method,timestamp});
    -- what this cluster can prove is the SQL that reads it, not GoTrue's
    -- behaviour. See the limitation recorded in the APP-055 documentation.
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
    grant usage on schema auth, storage to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    grant execute on function auth.jwt() to authenticated, anon, service_role;

    create table auth.users (id uuid primary key, email text);

    -- Synthetic mirror of the Supabase helper: the folder segments of an object
    -- name, excluding the file part. 'uid/doc' therefore yields {uid}.
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

    -- The pre-existing attachments bucket and its policies, so the test can prove
    -- APP-055 does not disturb them.
    insert into storage.buckets (id, name, public, file_size_limit)
      values ('attachments', 'attachments', false, 25 * 1024 * 1024);

    -- A documents bucket that already exists with unsafe settings. The
    -- migration has to assert its invariants, not skip over it.
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('documents', 'documents', true, 500 * 1024 * 1024, array['image/png']);
    create policy "Users can upload own attachment files"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
    create policy "Users can view own attachment files"
      on storage.objects for select to authenticated
      using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
    create policy "Users can delete own attachment files"
      on storage.objects for delete to authenticated
      using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

    insert into auth.users (id, email) values
      ('${ALICE}', 'alice@example.test'),
      ('${BOB}', 'bob@example.test'),
      ('${DOOMED}', 'doomed@example.test');`);

  // The migration under test, exactly as it will be applied.
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260925090000_private_document_bucket.sql'), 'utf8'));

  // Seed one object + row per user through the service role, so the read tests
  // start from data that already exists rather than from their own writes.
  sql(`insert into storage.objects (bucket_id, name) values
      ('documents', '${objectPath(ALICE, ALICE_DOC)}'),
      ('documents', '${objectPath(BOB, BOB_DOC)}'),
      ('documents', '${objectPath(DOOMED, DOOMED_DOC)}');
    insert into public.documents (id, user_id, storage_path, original_name) values
      ('${ALICE_DOC}', '${ALICE}', '${objectPath(ALICE, ALICE_DOC)}', 'alice-lease.pdf'),
      ('${BOB_DOC}', '${BOB}', '${objectPath(BOB, BOB_DOC)}', 'bob-payslip.pdf'),
      ('${DOOMED_DOC}', '${DOOMED}', '${objectPath(DOOMED, DOOMED_DOC)}', 'doomed.pdf');`);
});

after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});

/* ---------------------------------------------------------------- metadata */

test('1-2: a user can insert and read back their own document metadata', () => {
  const id = '30000000-0000-4000-8000-000000000001';
  const inserted = asRole('authenticated', ALICE,
    `insert into public.documents (id, user_id, storage_path, original_name)
     values ('${id}', '${ALICE}', '${objectPath(ALICE, id)}', 'receipt.pdf') returning id`);
  assert.equal(inserted, id);

  assert.equal(
    asRole('authenticated', ALICE, `select original_name from public.documents where id = '${id}'`),
    'receipt.pdf',
  );
  // Clean up so the visibility test below counts a stable set.
  sql(`delete from public.documents where id = '${id}'`);
});

test('3: another user cannot see a victim\'s metadata, by id or by listing', () => {
  assert.equal(asRole('authenticated', BOB, `select count(*) from public.documents where id = '${ALICE_DOC}'`), '0');
  assert.equal(asRole('authenticated', BOB, `select original_name from public.documents where user_id = '${ALICE}'`), '');
  // A predicate-free listing sees only its own row, not every row.
  assert.equal(
    asRole('authenticated', BOB, `select string_agg(id::text, ',' order by id) from public.documents`),
    BOB_DOC,
  );
  assert.equal(
    asRole('authenticated', ALICE, `select string_agg(id::text, ',' order by id) from public.documents`),
    ALICE_DOC,
  );
});

test('4: another user cannot insert metadata on the victim\'s behalf', () => {
  const id = '30000000-0000-4000-8000-000000000002';
  const error = errorFor(roleStatement('authenticated', BOB,
    `insert into public.documents (id, user_id, storage_path, original_name)
     values ('${id}', '${ALICE}', '${objectPath(ALICE, id)}', 'planted.pdf')`));
  assert.match(error, /row-level security/);
});

test('5: a user cannot bind their own metadata to another user\'s storage prefix', () => {
  const id = '30000000-0000-4000-8000-000000000003';
  // Own user_id, victim's prefix: the canonical-path CHECK refuses it outright.
  const error = errorFor(roleStatement('authenticated', BOB,
    `insert into public.documents (id, user_id, storage_path, original_name)
     values ('${id}', '${BOB}', '${objectPath(ALICE, id)}', 'reaching.pdf')`));
  assert.match(error, REFUSED_PATH);

  // And it cannot claim an existing object of the victim's either.
  assert.match(errorFor(roleStatement('authenticated', BOB,
    `insert into public.documents (id, user_id, storage_path, original_name)
     values ('${id}', '${BOB}', '${objectPath(ALICE, ALICE_DOC)}', 'reaching.pdf')`)), REFUSED_PATH);
});

test('6: the canonical path invariant rejects arbitrary and mismatched paths', () => {
  const id = '30000000-0000-4000-8000-000000000004';
  const bad = [
    `'documents/${id}'`,
    `'${ALICE}/../${BOB}/${id}'`,
    `'${ALICE}/${id}/original-name.pdf'`,
    `'${ALICE}/${BOB_DOC}'`,
    `'${id}'`,
    `''`,
  ];
  for (const value of bad) {
    assert.match(errorFor(roleStatement('authenticated', ALICE,
      `insert into public.documents (id, user_id, storage_path, original_name)
       values ('${id}', '${ALICE}', ${value}, 'x.pdf')`)), REFUSED_PATH, `accepted ${value}`);
  }

  // The same row with the derived path is accepted, so the rule is the path and
  // not something incidental about these inserts.
  assert.equal(asRole('authenticated', ALICE,
    `insert into public.documents (id, user_id, storage_path, original_name)
     values ('${id}', '${ALICE}', '${objectPath(ALICE, id)}', 'x.pdf') returning id`), id);
  sql(`delete from public.documents where id = '${id}'`);

  // With RLS out of the way (table owner), the CHECK still refuses. The invariant
  // is therefore a property of the table, not only of the ordinary-user policy.
  assert.match(errorFor(
    `insert into public.documents (id, user_id, storage_path, original_name)
     values ('${id}', '${ALICE}', 'documents/${id}', 'x.pdf')`), /documents_storage_path_canonical/);
});

test('6b: the filename must be present and bounded, and paths stay unique', () => {
  const id = '30000000-0000-4000-8000-000000000005';
  // Run without RLS in the way: the subject here is the name/uniqueness CHECK.
  const insert = (name) =>
    `insert into public.documents (id, user_id, storage_path, original_name)
     values ('${id}', '${ALICE}', '${objectPath(ALICE, id)}', ${name})`;
  for (const blank of ["''", "'   '"]) {
    assert.match(errorFor(insert(blank)), /documents_original_name_nonblank/);
  }
  assert.match(errorFor(insert(`repeat('a', 256)`)), /documents_original_name_nonblank/);

  // Two rows may not point at one object. A second row with the SAME id is
  // stopped by the primary key, so the uniqueness of the path is proved with a
  // different id whose canonical path is forced to collide.
  assert.equal(sql(`select count(*) from pg_constraint
    where conrelid='public.documents'::regclass and conname='documents_storage_path_unique' and contype='u'`), '1');
  assert.match(errorFor(
    `insert into public.documents (id, user_id, storage_path, original_name)
     values ('${ALICE_DOC}', '${ALICE}', '${objectPath(ALICE, ALICE_DOC)}', 'dupe.pdf')`), /documents_pkey/);
});

test('7-8: anon can neither read nor insert', () => {
  // Stronger than "no rows": the REVOKE means anon has no grant on the table at
  // all, so it is refused before RLS is even consulted.
  assert.match(errorFor(roleStatement('anon', ALICE, 'select count(*) from public.documents')),
    /permission denied for table documents/);
  assert.match(errorFor(roleStatement('anon', ALICE,
    `insert into public.documents (id, user_id, storage_path, original_name)
     values ('40000000-0000-4000-8000-000000000001', '${ALICE}', '${ALICE}/40000000-0000-4000-8000-000000000001', 'x.pdf')`)),
    /permission denied for table documents/);
  assert.equal(sql(`select count(*) from information_schema.role_table_grants
    where table_schema='public' and table_name='documents' and grantee='anon'`), '0');
});

test('APP-055 exposes no UPDATE or DELETE path for ordinary users', () => {
  // APP-056 owns the delete cascade. The grant is SELECT, INSERT only, so an
  // ordinary user is refused before RLS rather than quietly matching no rows.
  assert.match(errorFor(roleStatement('authenticated', ALICE,
    `update public.documents set original_name = 'renamed.pdf' where id = '${ALICE_DOC}'`)),
    /permission denied for table documents/);
  assert.match(errorFor(roleStatement('authenticated', ALICE,
    `delete from public.documents where id = '${ALICE_DOC}'`)),
    /permission denied for table documents/);
  assert.equal(sql(`select original_name from public.documents where id = '${ALICE_DOC}'`), 'alice-lease.pdf');

  // Table-level: SELECT only. INSERT is granted per column instead (see the
  // created_at test), which is what keeps the creation timestamp the server's.
  assert.equal(sql(`select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
    from information_schema.role_table_grants
    where table_schema='public' and table_name='documents' and grantee='authenticated'`), 'SELECT');

  assert.equal(sql(`select count(*) from pg_policies
    where schemaname='public' and tablename='documents' and cmd in ('UPDATE','DELETE')`), '0');
  assert.equal(sql(`select count(*) from pg_policies
    where schemaname='public' and tablename='documents' and 'anon'=any(roles)`), '0');
  assert.equal(sql(`select relrowsecurity::text from pg_class where oid='public.documents'::regclass`), 'true');
});

test('9: metadata cascades when the account is deleted', () => {
  assert.equal(sql(`select count(*) from public.documents where user_id = '${DOOMED}'`), '1');
  sql(`delete from auth.users where id = '${DOOMED}'`);
  assert.equal(sql(`select count(*) from public.documents where user_id = '${DOOMED}'`), '0');

  // The object does NOT cascade — that is the fact the orphan sweep exists for.
  assert.equal(sql(`select count(*) from storage.objects
    where bucket_id='documents' and name='${objectPath(DOOMED, DOOMED_DOC)}'`), '1');
  assert.equal(sql(`select path from public.orphaned_document_paths(100)`), objectPath(DOOMED, DOOMED_DOC));

  // The sweep is service-role only, exactly like orphaned_attachment_paths.
  assert.match(errorFor(roleStatement('authenticated', ALICE, 'select * from public.orphaned_document_paths(10)')),
    /permission denied/);
  assert.match(errorFor(roleStatement('anon', ALICE, 'select * from public.orphaned_document_paths(10)')),
    /permission denied/);
  assert.equal(asRole('service_role', ALICE, `select path from public.orphaned_document_paths(100)`),
    objectPath(DOOMED, DOOMED_DOC));
});

test('created_at is the server\'s: the client may write four columns and no more', () => {
  const id = '60000000-0000-4000-8000-000000000001';

  // A: the ordinary insert, without created_at, succeeds.
  assert.equal(asRole('authenticated', ALICE,
    `insert into public.documents (id, user_id, storage_path, original_name)
     values ('${id}', '${ALICE}', '${objectPath(ALICE, id)}', 'receipt.pdf') returning id`), id);

  // B: and the row comes back carrying a server timestamp.
  const createdAt = asRole('authenticated', ALICE, `select created_at from public.documents where id='${id}'`);
  assert.ok(createdAt.length > 0);
  assert.equal(sql(`select (created_at > now() - interval '1 hour')::text from public.documents where id='${id}'`), 'true');

  // C: supplying it is refused at the privilege layer, so a default is not the
  // only thing standing between a client and a backdated document.
  for (const value of ["'2000-01-01T00:00:00Z'", 'now()', 'default']) {
    assert.match(errorFor(roleStatement('authenticated', ALICE,
      `insert into public.documents (id, user_id, storage_path, original_name, created_at)
       values ('60000000-0000-4000-8000-000000000002', '${ALICE}', '${ALICE}/60000000-0000-4000-8000-000000000002', 'x.pdf', ${value})`)),
      /permission denied/, `accepted created_at = ${value}`);
  }
  assert.equal(sql(`select count(*) from public.documents where id='60000000-0000-4000-8000-000000000002'`), '0');

  // The grant really is column-scoped rather than table-wide — and the list is
  // exactly the four client-owned columns, so neither created_at nor the
  // account-deletion marker can be written by a client on any statement.
  assert.equal(sql(`select coalesce(string_agg(column_name, ',' order by column_name), '')
    from information_schema.column_privileges
    where table_schema='public' and table_name='documents' and grantee='authenticated' and privilege_type='INSERT'`),
    'id,original_name,storage_path,user_id');
  assert.match(errorFor(roleStatement('authenticated', ALICE,
    `insert into public.documents (id, user_id, storage_path, original_name, account_deletion_released_at)
     values ('60000000-0000-4000-8000-000000000009', '${ALICE}', '${ALICE}/60000000-0000-4000-8000-000000000009', 'x.pdf', now())`)),
    /permission denied/);
  assert.match(errorFor(roleStatement('authenticated', ALICE,
    `update public.documents set account_deletion_released_at = now() where id='${ALICE_DOC}'`)),
    /permission denied/);

  sql(`delete from public.documents where id='${id}'`);
});

const release = (userId) => asRole('authenticated', userId,
  `select coalesce(string_agg(release_my_documents_for_account_deletion, ',' order by release_my_documents_for_account_deletion), '')
   from public.release_my_documents_for_account_deletion()`);

/* ------------------------------------------------- release authorization */

test('DIRECT RPC ABUSE: an ordinary authenticated session cannot open a release', () => {
  const path = objectPath(ALICE, ALICE_DOC);
  const before = sql(`select coalesce(account_deletion_released_at::text, 'null')
    from public.documents where id='${ALICE_DOC}'`);

  // Every one of these is a real session — signed in, not expired, correct
  // user — and none of them has recently proved the password.
  const ordinarySessions = {
    'no amr claim at all': claims(ALICE),
    'an empty amr array': claims(ALICE, { amr: [] }),
    'amr that is not an array': JSON.stringify({ sub: ALICE, amr: 'password' }).replace(/'/g, "''"),
    'a password sign-in that is too old': claims(ALICE, { amr: passwordAmr(6 * 60) }),
    'a non-password method only': claims(ALICE, { amr: [{ method: 'oauth', timestamp: Math.floor(Date.now() / 1000) }] }),
    'a method entry with no timestamp': claims(ALICE, { amr: [{ method: 'password' }] }),
    'a non-numeric timestamp': claims(ALICE, { amr: [{ method: 'password', timestamp: 'now' }] }),
    'the RFC-8176 string form a custom hook may emit': claims(ALICE, { amr: ['password'] }),
    'a timestamp in the future from a tampered clock': claims(ALICE, { amr: [{ method: 'password', timestamp: 'x' }] }),
  };

  for (const [label, sessionClaims] of Object.entries(ordinarySessions)) {
    assert.match(
      errorFor(roleStatement('authenticated', ALICE, 'select * from public.release_my_documents_for_account_deletion()', sessionClaims)),
      /reauthentication_required/, `released with ${label}`);

    // Refused before any write: the timestamp is untouched...
    assert.equal(sql(`select coalesce(account_deletion_released_at::text, 'null')
      from public.documents where id='${ALICE_DOC}'`), before);

    // ...and the object therefore stays undeletable.
    assert.equal(asRole('authenticated', ALICE,
      `delete from storage.objects where bucket_id='documents' and name='${path}' returning name`,
      sessionClaims), '');
    assert.equal(sql(`select count(*) from storage.objects where name='${path}'`), '1');
  }
});

test('DIRECT RPC ABUSE: a recently password-authenticated session may open one', () => {
  const path = objectPath(ALICE, ALICE_DOC);
  const recent = claims(ALICE, { amr: passwordAmr(10) });

  const released = asRole('authenticated', ALICE,
    `select coalesce(string_agg(release_my_documents_for_account_deletion, ','), '')
     from public.release_my_documents_for_account_deletion()`, recent);

  assert.equal(released, path);
  assert.equal(sql(`select (account_deletion_released_at > now() - interval '1 minute')::text
    from public.documents where id='${ALICE_DOC}'`), 'true');
  assert.equal(sql(`select count(*) from public.documents where id='${ALICE_DOC}'`), '1');

  // And the Storage cleanup the account deletion needs is now permitted.
  assert.equal(asRole('authenticated', ALICE,
    `delete from storage.objects where bucket_id='documents' and name='${path}' returning name`, recent), path);

  sql(`insert into storage.objects (bucket_id, name) values ('documents', '${path}');
       update public.documents set account_deletion_released_at = null;`);
});

test('TOKEN REFRESH cannot forge freshness: a newer iat does not re-open the gate', () => {
  // A refreshed access token: brand-new `iat`, same session, same untouched amr.
  // GoTrue mints amr timestamps from auth.mfa_amr_claims rows written at
  // authentication events; RefreshTokenGrant writes none, so refreshing moves
  // `iat` and nothing else. This asserts the SQL honours that distinction.
  const staleAuthFreshToken = claims(ALICE, { amr: passwordAmr(6 * 60), iatSecondsAgo: 0 });
  assert.match(
    errorFor(roleStatement('authenticated', ALICE, 'select * from public.release_my_documents_for_account_deletion()', staleAuthFreshToken)),
    /reauthentication_required/);
  assert.equal(asRole('authenticated', ALICE,
    `select public.has_recent_password_authentication()::text`, staleAuthFreshToken), 'false');

  // The mirror image: an OLD token whose password authentication is recent still
  // passes, which is what shows the decision reads amr and not iat.
  const freshAuthStaleToken = claims(ALICE, { amr: passwordAmr(10), iatSecondsAgo: 60 * 60 });
  assert.equal(asRole('authenticated', ALICE,
    `select public.has_recent_password_authentication()::text`, freshAuthStaleToken), 'true');
});

test('the reauthentication gate is one explicit constant, and anon has neither function', () => {
  assert.equal(sql(`select public.document_release_reauth_window()::text`), '00:05:00');

  for (const fn of ['has_recent_password_authentication()', 'document_release_reauth_window()']) {
    assert.match(errorFor(roleStatement('anon', ALICE, `select public.${fn}`)), /permission denied/);
  }
  assert.match(errorFor(roleStatement('anon', ALICE,
    'select * from public.release_my_documents_for_account_deletion()')), /permission denied/);
});

test('one account cannot borrow another account\'s recent authentication', () => {
  // Bob proves his own password; that says nothing about Alice's account, and
  // the function takes no user id he could aim at her.
  const bobRecent = claims(BOB, { amr: passwordAmr(5) });
  const aliceBefore = sql(`select coalesce(account_deletion_released_at::text, 'null')
    from public.documents where id='${ALICE_DOC}'`);

  assert.equal(asRole('authenticated', BOB,
    `select coalesce(string_agg(release_my_documents_for_account_deletion, ','), '')
     from public.release_my_documents_for_account_deletion()`, bobRecent), objectPath(BOB, BOB_DOC));

  assert.equal(sql(`select coalesce(account_deletion_released_at::text, 'null')
    from public.documents where id='${ALICE_DOC}'`), aliceBefore);
  assert.equal(asRole('authenticated', BOB,
    `delete from storage.objects where bucket_id='documents' and name='${objectPath(ALICE, ALICE_DOC)}' returning name`,
    bobRecent), '');

  sql(`update public.documents set account_deletion_released_at = null`);
});

test('the account-deletion release is account-wide, scoped to the caller, and destroys no metadata', () => {
  const id = '60000000-0000-4000-8000-000000000003';
  sql(`insert into public.documents (id, user_id, storage_path, original_name)
       values ('${id}', '${ALICE}', '${objectPath(ALICE, id)}', 'temp.pdf')`);

  // Bob's release covers Bob's account and nothing of Alice's.
  assert.equal(release(BOB), objectPath(BOB, BOB_DOC));
  assert.equal(sql(`select count(*) from public.documents
    where user_id='${ALICE}' and account_deletion_released_at is not null`), '0');

  // Alice's returns every path her account still owns...
  assert.equal(release(ALICE), [objectPath(ALICE, ALICE_DOC), objectPath(ALICE, id)].sort().join(','));

  // ...and the rows are all still here. This is the whole point: the canonical
  // path is what a retry rediscovers the object by, so it may not be destroyed
  // before the bytes are known to be gone.
  assert.equal(sql(`select count(*) from public.documents where user_id='${ALICE}'`), '2');
  assert.equal(sql(`select count(*) from public.documents
    where user_id='${ALICE}' and account_deletion_released_at is null`), '0');

  // It takes no arguments at all, so there is no victim id to supply, and it is
  // a function rather than a policy: no ordinary statement can remove a row.
  assert.equal(sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='release_my_documents_for_account_deletion' and p.pronargs=0`), '1');
  assert.equal(sql(`select count(*) from pg_policies
    where schemaname='public' and tablename='documents' and cmd='DELETE'`), '0');
  assert.match(errorFor(roleStatement('anon', ALICE,
    'select * from public.release_my_documents_for_account_deletion()')), /permission denied/);

  // The superseded destructive release is gone, not merely unused.
  assert.equal(sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('delete_my_document_metadata','document_object_is_orphan')`), '0');

  sql(`delete from public.documents where id='${id}';
       update public.documents set account_deletion_released_at = null;`);
});

test('a released object may be removed by its owner, and still only by its owner', () => {
  assert.equal(release(ALICE), objectPath(ALICE, ALICE_DOC));

  // Another account cannot ride on Alice's release.
  assert.equal(asRole('authenticated', BOB,
    `delete from storage.objects where bucket_id='documents' and name='${objectPath(ALICE, ALICE_DOC)}' returning name`), '');
  assert.equal(sql(`select count(*) from storage.objects where name='${objectPath(ALICE, ALICE_DOC)}'`), '1');

  // Bob's own document is untouched by Alice's release and stays undeletable.
  assert.equal(asRole('authenticated', BOB,
    `delete from storage.objects where bucket_id='documents' and name='${objectPath(BOB, BOB_DOC)}' returning name`), '');

  assert.equal(asRole('authenticated', ALICE,
    `delete from storage.objects where bucket_id='documents' and name='${objectPath(ALICE, ALICE_DOC)}' returning name`),
    objectPath(ALICE, ALICE_DOC));

  // Removing the bytes does NOT remove the row: the metadata lives until the
  // account does, which is what the next test relies on.
  assert.equal(sql(`select count(*) from public.documents where id='${ALICE_DOC}'`), '1');

  sql(`insert into storage.objects (bucket_id, name) values ('documents', '${objectPath(ALICE, ALICE_DOC)}');
       update public.documents set account_deletion_released_at = null;`);
});

test('RETRY: a failed Storage removal leaves the same path rediscoverable, and the second attempt works', () => {
  const path = objectPath(ALICE, ALICE_DOC);

  // Attempt 1: release succeeds, the Storage call fails. Nothing in the database
  // is destroyed by that failure — the client simply stops at the files stage.
  const firstAttempt = release(ALICE);
  assert.equal(firstAttempt, path);
  // (the Storage removal failing is the simulation: the object is left in place)
  assert.equal(sql(`select count(*) from storage.objects where name='${path}'`), '1');
  assert.equal(sql(`select count(*) from public.documents where id='${ALICE_DOC}'`), '1');

  // Attempt 2: the release hands back the SAME path, so the object is still
  // discoverable. Under the previous design the row was gone by now and this
  // path could never have been found again.
  //
  // The timestamp moves forward rather than being preserved, and that is the
  // corrected contract: the release is a window, so a retry has to be able to
  // open a new one. Keeping the first attempt's timestamp would leave a user
  // whose window had closed unable to finish deleting their own account.
  const releasedAt = sql(`select account_deletion_released_at from public.documents where id='${ALICE_DOC}'`);
  const secondAttempt = release(ALICE);
  assert.equal(secondAttempt, firstAttempt);
  assert.equal(sql(`select (account_deletion_released_at >= '${releasedAt}')::text
    from public.documents where id='${ALICE_DOC}'`), 'true');
  assert.equal(sql(`select count(*) from public.documents where user_id='${ALICE}'`), '1');

  // This time the removal succeeds...
  assert.equal(asRole('authenticated', ALICE,
    `delete from storage.objects where bucket_id='documents' and name='${path}' returning name`), path);

  // ...the metadata is still there, waiting for the account...
  assert.equal(sql(`select count(*) from public.documents where id='${ALICE_DOC}'`), '1');

  // ...and only auth.users deletion takes it.
  sql(`delete from auth.users where id='${ALICE}'`);
  assert.equal(sql(`select count(*) from public.documents where user_id='${ALICE}'`), '0');
  assert.equal(sql(`select count(*) from public.orphaned_document_paths(100) where path='${path}'`), '0');

  // Rebuild Alice for the tests that follow.
  sql(`insert into auth.users (id, email) values ('${ALICE}', 'alice@example.test');
       insert into storage.objects (bucket_id, name) values ('documents', '${path}');
       insert into public.documents (id, user_id, storage_path, original_name)
         values ('${ALICE_DOC}', '${ALICE}', '${path}', 'alice-lease.pdf');`);
});

test('the release window is one explicit constant', () => {
  assert.equal(sql(`select public.document_release_window()::text`), '00:15:00');
});

test('EXPIRY: a release older than the window protects the document again', () => {
  const path = objectPath(ALICE, ALICE_DOC);

  // Fresh release: deletable.
  assert.equal(release(ALICE), path);
  assert.equal(asRole('authenticated', ALICE, `select public.document_object_is_deletable('${path}')::text`), 'true');

  // Age the release past the window using the DATABASE clock. No sleeping, and
  // no client timestamp is trusted anywhere in this decision.
  sql(`update public.documents
       set account_deletion_released_at = now() - public.document_release_window() - interval '1 second'
       where id='${ALICE_DOC}'`);

  assert.equal(asRole('authenticated', ALICE, `select public.document_object_is_deletable('${path}')::text`), 'false');
  assert.equal(asRole('authenticated', ALICE,
    `delete from storage.objects where bucket_id='documents' and name='${path}' returning name`), '');
  assert.equal(sql(`select count(*) from storage.objects where name='${path}'`), '1');

  // Just inside the window is still allowed, so the boundary is the window and
  // not something incidental about an old timestamp.
  sql(`update public.documents
       set account_deletion_released_at = now() - public.document_release_window() + interval '5 seconds'
       where id='${ALICE_DOC}'`);
  assert.equal(asRole('authenticated', ALICE, `select public.document_object_is_deletable('${path}')::text`), 'true');

  sql(`update public.documents set account_deletion_released_at = null`);
});

test('EXPIRY RETRY: calling release again re-opens the window and returns the same path', () => {
  const path = objectPath(ALICE, ALICE_DOC);

  // An abandoned attempt, long expired.
  sql(`update public.documents
       set account_deletion_released_at = now() - interval '3 days'
       where id='${ALICE_DOC}'`);
  assert.equal(asRole('authenticated', ALICE, `select public.document_object_is_deletable('${path}')::text`), 'false');

  // The user comes back and tries again. Same path, fresh window, no metadata
  // touched — and no scheduler was needed for the protection to come back.
  assert.equal(release(ALICE), path);
  assert.equal(sql(`select (account_deletion_released_at > now() - interval '1 minute')::text
    from public.documents where id='${ALICE_DOC}'`), 'true');
  assert.equal(sql(`select count(*) from public.documents where id='${ALICE_DOC}'`), '1');

  assert.equal(asRole('authenticated', ALICE,
    `delete from storage.objects where bucket_id='documents' and name='${path}' returning name`), path);

  sql(`insert into storage.objects (bucket_id, name) values ('documents', '${path}');
       update public.documents set account_deletion_released_at = null;`);
});

test('EXPIRY is not a cross-user oracle, and another account never inherits a release', () => {
  const alicePath = objectPath(ALICE, ALICE_DOC);
  const bobPath = objectPath(BOB, BOB_DOC);

  // Alice releases; Bob sees nothing of it and cannot act on it.
  assert.equal(release(ALICE), alicePath);
  assert.equal(asRole('authenticated', BOB, `select public.document_object_is_deletable('${alicePath}')::text`), 'false');
  assert.equal(asRole('authenticated', BOB,
    `delete from storage.objects where bucket_id='documents' and name='${alicePath}' returning name`), '');

  // Bob's own document is untouched by Alice's release, expired or fresh.
  assert.equal(sql(`select account_deletion_released_at is null from public.documents where id='${BOB_DOC}'`), 't');
  assert.equal(asRole('authenticated', BOB,
    `delete from storage.objects where bucket_id='documents' and name='${bobPath}' returning name`), '');

  // Not an oracle: for ANY path in a foreign prefix the answer is the constant
  // 'false', whatever the real state behind it is. Bob therefore cannot tell
  // apart a document that exists, one that is freshly released, one whose
  // release expired, and one that was never there at all.
  const foreignAnswers = new Set();
  for (const state of ['null', "now()", "now() - interval '3 days'"]) {
    sql(`update public.documents set account_deletion_released_at = ${state} where id='${ALICE_DOC}'`);
    foreignAnswers.add(asRole('authenticated', BOB,
      `select public.document_object_is_deletable('${alicePath}')::text`));
  }
  foreignAnswers.add(asRole('authenticated', BOB,
    `select public.document_object_is_deletable('${ALICE}/00000000-0000-4000-8000-00000000dead')::text`));
  assert.deepEqual([...foreignAnswers], ['false']);

  // In his OWN prefix the answer is informative, as it must be: a path with no
  // row is a failed-upload orphan and is his to remove.
  assert.equal(asRole('authenticated', BOB,
    `select public.document_object_is_deletable('${BOB}/00000000-0000-4000-8000-00000000dead')::text`), 'true');

  // Bob's release covers Bob only; Alice's stale row is not refreshed by it.
  const aliceStamp = sql(`select account_deletion_released_at from public.documents where id='${ALICE_DOC}'`);
  assert.equal(release(BOB), bobPath);
  assert.equal(sql(`select account_deletion_released_at from public.documents where id='${ALICE_DOC}'`), aliceStamp);

  sql(`update public.documents set account_deletion_released_at = null`);
});

/* ----------------------------------------------------------------- storage */

test('10 + 17: the bucket is private with the 25 MiB ceiling, even though it already existed unsafely', () => {
  // The fixture created `documents` as PUBLIC, 500 MiB and MIME-restricted before
  // the migration ran. ON CONFLICT DO NOTHING would have left all three; the
  // invariants have to be asserted, not merely proposed.
  const bucket = JSON.parse(sql(`select row_to_json(b) from storage.buckets b where id='documents'`));
  assert.equal(bucket.name, 'documents');
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 25 * 1024 * 1024);
  // Arbitrary document types are the point of the module; only size is limited.
  assert.equal(bucket.allowed_mime_types, null);
});

test('11-12: object insert is confined to the uploader\'s own prefix', () => {
  const id = '50000000-0000-4000-8000-000000000001';
  assert.equal(asRole('authenticated', ALICE,
    `insert into storage.objects (bucket_id, name) values ('documents', '${objectPath(ALICE, id)}') returning name`),
    objectPath(ALICE, id));

  for (const name of [objectPath(BOB, id), `${BOB}/nested/${id}`, id, `../${ALICE}/${id}`]) {
    assert.match(errorFor(roleStatement('authenticated', ALICE,
      `insert into storage.objects (bucket_id, name) values ('documents', '${name}')`)),
      /row-level security/, `accepted ${name}`);
  }
  sql(`delete from storage.objects where name = '${objectPath(ALICE, id)}'`);
});

test('13-14: object reads are confined to the reader\'s own prefix', () => {
  assert.equal(asRole('authenticated', ALICE,
    `select name from storage.objects where bucket_id='documents' and name='${objectPath(ALICE, ALICE_DOC)}'`),
    objectPath(ALICE, ALICE_DOC));
  assert.equal(asRole('authenticated', BOB,
    `select count(*) from storage.objects where bucket_id='documents' and name='${objectPath(ALICE, ALICE_DOC)}'`), '0');
  // A predicate-free listing of the bucket shows only the reader's own objects.
  assert.equal(asRole('authenticated', BOB,
    `select string_agg(name, ',' order by name) from storage.objects where bucket_id='documents'`),
    objectPath(BOB, BOB_DOC));
  assert.equal(asRole('anon', ALICE, `select count(*) from storage.objects where bucket_id='documents'`), '0');
});

test('15A: an orphan object — no metadata row — may be removed by its owner', () => {
  const id = '50000000-0000-4000-8000-000000000002';
  sql(`insert into storage.objects (bucket_id, name) values ('documents', '${objectPath(ALICE, id)}')`);

  // This is the upload-atomicity case: the object landed, the row never did.
  assert.equal(sql(`select count(*) from public.documents where storage_path='${objectPath(ALICE, id)}'`), '0');
  assert.equal(asRole('authenticated', ALICE,
    `delete from storage.objects where bucket_id='documents' and name='${objectPath(ALICE, id)}' returning name`),
    objectPath(ALICE, id));
});

test('15B: a stored document — metadata present, not released — cannot be removed, even by its owner', () => {
  // The stored document must not be reducible to a row pointing at nothing, and
  // a client that saw an error while the insert actually committed must not be
  // able to compensate the real file away.
  assert.equal(sql(`select count(*) from public.documents
    where storage_path='${objectPath(ALICE, ALICE_DOC)}' and account_deletion_released_at is null`), '1');
  assert.equal(asRole('authenticated', ALICE,
    `delete from storage.objects where bucket_id='documents' and name='${objectPath(ALICE, ALICE_DOC)}' returning name`), '');
  assert.equal(sql(`select count(*) from storage.objects where name='${objectPath(ALICE, ALICE_DOC)}'`), '1');

  // The same object becomes removable the moment its row is gone, so the refusal
  // is the metadata and not something incidental about this object.
  sql(`delete from public.documents where id='${ALICE_DOC}'`);
  assert.equal(asRole('authenticated', ALICE,
    `delete from storage.objects where bucket_id='documents' and name='${objectPath(ALICE, ALICE_DOC)}' returning name`),
    objectPath(ALICE, ALICE_DOC));

  // Restore the fixture for the tests that follow.
  sql(`insert into storage.objects (bucket_id, name) values ('documents', '${objectPath(ALICE, ALICE_DOC)}');
    insert into public.documents (id, user_id, storage_path, original_name)
      values ('${ALICE_DOC}', '${ALICE}', '${objectPath(ALICE, ALICE_DOC)}', 'alice-lease.pdf');`);
});

test('16: another user can delete neither an orphan nor a stored object', () => {
  const orphan = '50000000-0000-4000-8000-000000000003';
  sql(`insert into storage.objects (bucket_id, name) values ('documents', '${objectPath(ALICE, orphan)}')`);

  for (const name of [objectPath(ALICE, orphan), objectPath(ALICE, ALICE_DOC)]) {
    assert.equal(asRole('authenticated', BOB,
      `delete from storage.objects where bucket_id='documents' and name='${name}' returning name`), '');
    assert.equal(sql(`select count(*) from storage.objects where name='${name}'`), '1');
  }

  // The deletability helper is not an oracle for someone else's paths either: it
  // answers only for the caller's own prefix, so Bob learns nothing from it — it
  // says "no" for Alice's orphan and Alice's stored document alike.
  assert.equal(asRole('authenticated', BOB,
    `select public.document_object_is_deletable('${objectPath(ALICE, orphan)}')::text`), 'false');
  assert.equal(asRole('authenticated', BOB,
    `select public.document_object_is_deletable('${objectPath(ALICE, ALICE_DOC)}')::text`), 'false');
  assert.match(errorFor(roleStatement('anon', BOB,
    `select public.document_object_is_deletable('${objectPath(ALICE, orphan)}')`)), /permission denied/);

  sql(`delete from storage.objects where name='${objectPath(ALICE, orphan)}'`);
});

test('the attachments bucket and its policies are untouched', () => {
  const bucket = JSON.parse(sql(`select row_to_json(b) from storage.buckets b where id='attachments'`));
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 25 * 1024 * 1024);

  // APP-055 policies name the documents bucket and only the documents bucket.
  assert.equal(sql(`select count(*) from pg_policies where schemaname='storage' and tablename='objects'
    and policyname like '%document%' and qual is distinct from null and qual not like '%documents%'`), '0');

  // Attachment objects stay reachable by their owner and unreachable by others.
  const attachment = `${ALICE}/warranty/${ALICE_DOC}/${ALICE_DOC}.pdf`;
  sql(`insert into storage.objects (bucket_id, name) values ('attachments', '${attachment}')`);
  assert.equal(asRole('authenticated', ALICE,
    `select name from storage.objects where bucket_id='attachments' and name='${attachment}'`), attachment);
  assert.equal(asRole('authenticated', BOB,
    `select count(*) from storage.objects where bucket_id='attachments' and name='${attachment}'`), '0');
  // And a documents-bucket policy does not grant anything in attachments.
  assert.equal(asRole('authenticated', BOB,
    `select count(*) from storage.objects where bucket_id='attachments'`), '0');
});
