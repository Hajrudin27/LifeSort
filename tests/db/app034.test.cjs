// APP-034 only. Repeats docs/migration-verification.md's scratch-Postgres workflow.
// No .env, Supabase CLI, remote URL, existing database or migration reset is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const bin = process.env.APP034_PG_BIN || path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app034-'));
const cluster = path.join(scratch, 'db');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const quote = (value) => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const rpc = (n, entity = 'habits', enabled = true, overrides = {}) => {
  const args = { id: id(n), domain: 'core.module-choice', type: 'module-choice', entity,
    operation: 'upsert', payload: JSON.stringify({ enabled }), ...overrides };
  return `select public.apply_sync_mutation(${Object.values(args).map(quote).join(',')});`;
};
const auth = (user = A, role = 'authenticated') =>
  `set role ${role}; set request.jwt.claim.sub = ${quote(user)};`;
const psqlArgs = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', '55432', '-U', 'postgres', '-d', 'postgres'];
function sql(source) {
  return execFileSync(path.join(bin, 'psql'), psqlArgs, { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function run(source, name) {
  const child = spawn(path.join(bin, 'psql'), psqlArgs, { env: { ...process.env, PGAPPNAME: name } });
  let output = '', errors = '';
  child.stdout.on('data', (value) => { output += value; });
  child.stderr.on('data', (value) => { errors += value; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(errors)));
  });
  child.stdin.write(source + '\n');
  return { child, done, output: () => output };
}
async function until(check) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'concurrent request reached expected database barrier');
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}
function fails(source, code, message) {
  try { sql('\\set VERBOSITY sqlstate\n' + source); assert.fail('expected SQL rejection'); }
  catch (error) { assert.match(String(error.stderr), new RegExp(code)); }
  if (message) {
    try { sql(source); assert.fail('expected SQL rejection'); }
    catch (error) { assert.match(String(error.stderr), new RegExp(message)); }
  }
}
const receipts = (n) => sql(`select count(*) from public.mutation_receipts where user_id=${quote(A)} and mutation_id=${quote(id(n))}`);
const where = (entity, user = A) => `user_id=${quote(user)} and module_id=${quote(entity)}`;
const snapshot = (entity, user = A) => JSON.parse(sql(`select row_to_json(t) from
  (select enabled, revision::text, updated_at::text, deleted_at::text from public.user_modules where ${where(entity, user)}) t`) || 'null');
const direct = (entity, enabled = true, revision = '123', time = "'2099-01-01'", user = A) =>
  `insert into public.user_modules(user_id,module_id,enabled,revision,updated_at)
   values(${quote(user)},${quote(entity)},${enabled},${revision},${time})
   on conflict(user_id,module_id) do update set enabled=excluded.enabled,
     revision=excluded.revision,updated_at=excluded.updated_at;`;
function advanced(entity, before) {
  const next = snapshot(entity);
  assert.equal(BigInt(next.revision), BigInt(before.revision) + 1n);
  assert.equal(sql(`select updated_at > ${quote(before.updated_at)}::timestamptz from public.user_modules where ${where(entity)}`), 't');
  return next;
}
let started = false;
let baseline, preUpgrade;
before(() => {
  execFileSync(path.join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-l', path.join(scratch, 'postgres.log'), '-o', `-k ${scratch} -p 55432 -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    insert into auth.users values (${quote(A)}), (${quote(B)});
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260908233100_user_modules.sql'), 'utf8'));
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260911065428_idempotent_server_mutations.sql'), 'utf8'));
  sql(`insert into public.user_modules values
    (${quote(A)},'existing',false,'2099-01-01'), (${quote(A)},'existing-infinity',true,'infinity');`);
  baseline = sql('select clock_timestamp()');
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260911075104_user_modules_revisions.sql'), 'utf8'));
  sql(auth() + rpc(900, 'pre-upgrade'));
  preUpgrade = sql(`select revision::text || '|' || updated_at::text from public.user_modules where ${where('pre-upgrade')}`);
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260911081953_user_modules_tombstones.sql'), 'utf8'));
  sql(`create table public.admin_users(id uuid primary key);
    create table public.trip_participants(owner_id uuid);`);
  const deletion = fs.readFileSync(path.join(root, 'supabase/migrations/20260907090000_delete_my_account.sql'), 'utf8');
  sql(deletion.slice(0, deletion.indexOf('-- Cascaden fjerner')));
});
after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
  console.log(`Scratch cluster ${started ? 'stopped' : 'not started'}; local test evidence retained at ${scratch}`);
});


const remove = (n, entity = 'habits', overrides = {}) => rpc(n, entity, true, { operation: 'delete', payload: null, ...overrides });

test('existing active rows gain explicit NULL without changing APP-033 metadata or old receipts', () => {
  assert.equal(snapshot('existing').deleted_at, null);
  const before = snapshot('pre-upgrade');
  assert.equal(before.deleted_at, null);
  assert.equal(before.revision, '1');
  assert.equal(`${before.revision}|${before.updated_at}`, preUpgrade);
  assert.equal(sql(auth() + rpc(900, 'pre-upgrade')), 'replayed');
  assert.deepEqual(snapshot('pre-upgrade'), before);
});
test('first delete retains the entity and advances exactly once with server-owned deletion time', () => {
  sql(auth() + rpc(1));
  const before = snapshot('habits');
  const lower = sql('select clock_timestamp()');
  assert.equal(sql(auth() + remove(2)), 'applied');
  const deleted = advanced('habits', before);
  assert.equal(deleted.enabled, before.enabled);
  assert.equal(deleted.deleted_at, deleted.updated_at);
  assert.equal(sql(`select deleted_at >= ${quote(lower)}::timestamptz and deleted_at <= clock_timestamp()
    from public.user_modules where ${where('habits')}`), 't');
  assert.equal(receipts(2), '1');
});
test('same delete replay (SQL NULL or JSON null) leaves revision and both timestamps untouched', () => {
  const before = snapshot('habits');
  for (const payload of [null, 'null', null]) {
    assert.equal(sql(auth() + remove(2, 'habits', { payload })), 'replayed');
    assert.deepEqual(snapshot('habits'), before);
  }
});
test('a second new delete intent records a receipt but no fake deletion version', () => {
  const before = snapshot('habits');
  assert.equal(sql(auth() + remove(3)), 'applied');
  assert.equal(receipts(3), '1');
  assert.deepEqual(snapshot('habits'), before);
  assert.equal(sql(auth() + remove(3)), 'replayed');
  assert.deepEqual(snapshot('habits'), before);
});
test('upsert-to-delete and delete-to-changed-entity reuse fail PT409 before dispatch', () => {
  const before = snapshot('habits');
  fails(auth() + remove(1), 'PT409', 'mutation_id_conflict');
  fails(auth() + remove(2, 'different'), 'PT409', 'mutation_id_conflict');
  fails(auth() + rpc(2), 'PT409', 'mutation_id_conflict');
  assert.deepEqual(snapshot('habits'), before);
  assert.equal(snapshot('different'), null);
});
test('a pre-delete upsert replay cannot resurrect or alter the tombstone', () => {
  const before = snapshot('habits');
  assert.equal(sql(auth() + rpc(1)), 'replayed');
  assert.deepEqual(snapshot('habits'), before);
});
test('stale pre-delete upsert and later normal upsert both fail without a receipt', () => {
  const before = snapshot('habits');
  // baseRevision is intentionally absent from the RPC; every normal upsert is
  // refused regardless of whether the client saw an older or the current revision.
  for (const [n, enabled] of [[4, true], [5, false]]) {
    fails(auth() + rpc(n, 'habits', enabled), 'PT409', 'entity_deleted');
    assert.equal(receipts(n), '0');
    assert.deepEqual(snapshot('habits'), before);
  }
});
test('delete payload cannot forge deleted_at or enabled; invalid/missing entities leave no receipt', () => {
  for (const overrides of [{ payload: '{"deleted_at":"1900-01-01"}' }, { payload: '{}' },
    { payload: '{"enabled":false}' }, { payload: 'false' }, { domain: 'other' },
    { type: 'other' }, { operation: 'restore' }, { operation: null }, { entity: '' }, { entity: null },
    { entity: 'x'.repeat(101) }]) {
    fails(auth() + remove(6, 'habits', overrides), 'PT400');
    assert.equal(receipts(6), '0');
  }
  for (const entity of ['absent', 'core-shell', 'account']) {
    fails(auth() + remove(7, entity), 'PT422', 'mutation_rejected');
    assert.equal(snapshot(entity), null);
    assert.equal(receipts(7), '0');
  }
});
test('direct INSERT ignores supplied deletion history; active UPDATE stamps its own deletion time', () => {
  sql(auth() + `insert into public.user_modules(user_id,module_id,enabled,deleted_at)
    values(${quote(A)},'forged',true,'infinity')`);
  assert.equal(snapshot('forged').deleted_at, null);
  const before = snapshot('forged');
  sql(auth() + `update public.user_modules set deleted_at='1900-01-01',revision=900,updated_at='infinity'
    where ${where('forged')}`);
  const deleted = advanced('forged', before);
  assert.equal(deleted.deleted_at, deleted.updated_at);
  assert.equal(sql(`select isfinite(deleted_at) and deleted_at >= ${quote(baseline)}::timestamptz
    and deleted_at <= clock_timestamp() from public.user_modules where ${where('forged')}`), 't');
});
test('direct legacy writes cannot clear, modify, rename or resurrect a tombstone', () => {
  const before = snapshot('habits');
  for (const change of ['deleted_at=null', "deleted_at='infinity'", 'enabled=false',
    'enabled=true', 'revision=9999', "updated_at='2099-01-01'", "module_id='new-identity'"]) {
    fails(auth() + `update public.user_modules set ${change} where ${where('habits')}`, 'PT409', 'entity_deleted');
  }
  fails(auth() + direct('habits'), 'PT409', 'entity_deleted');
  assert.deepEqual(snapshot('habits'), before);
  assert.equal(snapshot('new-identity'), null);
});
test('failed delete after domain write rolls back tombstone, metadata and receipt', () => {
  sql(auth() + direct('fail-delete'));
  const before = snapshot('fail-delete');
  sql(`create function public.app034_fail() returns trigger language plpgsql as $$ begin
    if new.module_id='fail-delete' then raise exception 'private detail'; end if; return new; end $$;
    create trigger app034_fail after update on public.user_modules for each row execute function public.app034_fail();`);
  try {
    fails(auth() + remove(8, 'fail-delete'), 'PT500', 'mutation_failed');
    assert.deepEqual(snapshot('fail-delete'), before);
    assert.equal(receipts(8), '0');
  } finally { sql('drop trigger app034_fail on public.user_modules; drop function public.app034_fail()'); }
  assert.equal(sql(auth() + remove(8, 'fail-delete')), 'applied');
  advanced('fail-delete', before);
});
test('outer rollback restores active entity and receipt consistency; the ID can be reused', () => {
  sql(auth() + direct('rollback-delete'));
  const before = snapshot('rollback-delete');
  assert.equal(sql('begin;' + auth() + remove(9, 'rollback-delete') + 'rollback;'), 'applied');
  assert.deepEqual(snapshot('rollback-delete'), before);
  assert.equal(receipts(9), '0');
  assert.equal(sql(auth() + remove(9, 'rollback-delete')), 'applied');
  advanced('rollback-delete', before);
});
test('receipt failure prevents deletion and all metadata changes', () => {
  sql(auth() + direct('receipt-failure'));
  const before = snapshot('receipt-failure');
  sql(`create function public.app034_fail_receipt() returns trigger language plpgsql as $$ begin
    raise exception 'private receipt detail'; end $$;
    create trigger app034_fail_receipt after insert on public.mutation_receipts
    for each row execute function public.app034_fail_receipt();`);
  try {
    fails(auth() + remove(10, 'receipt-failure'), 'PT500', 'mutation_failed');
    assert.deepEqual(snapshot('receipt-failure'), before);
    assert.equal(receipts(10), '0');
  } finally { sql('drop trigger app034_fail_receipt on public.mutation_receipts; drop function public.app034_fail_receipt()'); }
});
test('two accounts cannot read, modify or delete each other’s tombstones through RLS or the RPC', () => {
  const before = snapshot('habits');
  assert.equal(sql(auth(B) + `select count(*) from public.user_modules where ${where('habits')}`), '0');
  assert.equal(sql(auth(B) + `update public.user_modules set deleted_at=null where ${where('habits')} returning module_id`), '');
  fails(auth(B) + direct('habits', true, '1', 'now()', A), '42501');
  fails(auth(B) + remove(2), 'PT422');
  assert.equal(sql(auth(B) + rpc(1)), 'applied');
  assert.equal(snapshot('habits', B).deleted_at, null);
  assert.equal(sql(auth(B) + remove(2)), 'applied');
  assert.equal(snapshot('habits', B).revision, '2');
  assert.deepEqual(snapshot('habits'), before);
});
test('ordinary physical DELETE/TRUNCATE are denied while SELECT/INSERT/UPDATE retain owner access', () => {
  for (const role of ['anon', 'authenticated']) {
    for (const privilege of ['delete', 'truncate']) {
      assert.equal(sql(`select has_table_privilege('${role}','public.user_modules','${privilege}')`), 'f');
    }
    fails(auth(A, role) + `delete from public.user_modules where ${where('habits')}`, '42501');
    fails(auth(A, role) + 'truncate public.user_modules', '42501');
  }
  assert.equal(sql("select count(*) from pg_policies where tablename='user_modules' and cmd='DELETE'"), '0');
  assert.equal(sql("select relrowsecurity from pg_class where oid='public.user_modules'::regclass"), 't');
  for (const privilege of ['select', 'insert', 'update']) {
    assert.equal(sql(`select has_table_privilege('authenticated','public.user_modules','${privilege}')`), 't');
  }
});
test('RPC and trigger preserve least privilege, empty search_path and receipt isolation', () => {
  assert.equal(sql("select not prosecdef and proconfig=array['search_path=\"\"'] from pg_proc where oid='public.stamp_user_module_revision()'::regprocedure"), 't');
  assert.equal(sql("select prosecdef and proconfig=array['search_path=\"\"'] from pg_proc where oid='public.apply_sync_mutation(text,text,text,text,text,jsonb)'::regprocedure"), 't');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    fails(auth(A, role) + 'select public.stamp_user_module_revision()', '42501');
    fails(auth(A, role) + 'select * from public.mutation_receipts', '42501');
    if (role !== 'authenticated') fails(auth(A, role) + remove(11), '42501');
  }
  fails(auth('') + remove(11), 'PT401');
  assert.equal(receipts(11), '0');
});
test('unchanged APP-022 account RPC physically cascades active rows, tombstones and receipts', () => {
  const user = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  sql(`insert into auth.users values(${quote(user)})`);
  sql(auth(user) + rpc(20, 'active') + rpc(21, 'deleted') + remove(22, 'deleted'));
  sql(auth(user) + 'select public.delete_my_account()');
  assert.equal(snapshot('active', user), null);
  assert.equal(snapshot('deleted', user), null);
  assert.equal(sql(`select count(*) from public.mutation_receipts where user_id=${quote(user)}`), '0');
  fails(auth(user) + rpc(23, 'active'), 'PT401');
});
for (const scenario of ['delete-first', 'upsert-first', 'direct-upsert', 'two-deletes', 'same-delete', 'delete-rollback']) {
  test(`concurrency: ${scenario} serializes at a real row/receipt lock without resurrection`, async () => {
    const n = 100 + ['delete-first', 'upsert-first', 'direct-upsert', 'two-deletes', 'same-delete', 'delete-rollback'].indexOf(scenario) * 2;
    const entity = `race-${scenario}`;
    sql(auth() + direct(entity));
    const before = snapshot(entity);
    const firstSql = scenario === 'upsert-first' ? rpc(n, entity, false) : remove(n, entity);
    const secondSql = scenario === 'direct-upsert' ? direct(entity)
      : scenario === 'same-delete' ? remove(n, entity)
      : ['two-deletes', 'upsert-first'].includes(scenario) ? remove(n + 1, entity) : rpc(n + 1, entity);
    const first = run('begin;' + auth() + firstSql + '\n\\echo write-held', `app034-first-${n}`);
    let second;
    try {
      await until(() => first.output().includes('write-held'));
      second = run(auth() + secondSql, `app034-second-${n}`);
      const done = second.done.then((value) => ({ value }), (error) => ({ error }));
      second.child.stdin.end();
      await until(() => sql(`select count(*) from pg_stat_activity where application_name='app034-second-${n}' and wait_event_type='Lock'`) === '1');
      first.child.stdin.end(scenario === 'delete-rollback' ? 'rollback;\n' : 'commit;\n');
      await first.done;
      const result = await done;
      if (['delete-first', 'direct-upsert'].includes(scenario)) {
        assert.match(result.error?.message || '', /entity_deleted/);
        assert.equal(receipts(n + 1), '0');
      } else {
        assert.equal(result.value, scenario === 'same-delete' ? 'replayed' : 'applied');
      }
      const next = snapshot(entity);
      assert.equal(next.revision, String(BigInt(before.revision) + (scenario === 'upsert-first' ? 2n : 1n)));
      if (scenario === 'delete-rollback') {
        assert.equal(next.deleted_at, null);
        assert.equal(receipts(n), '0');
      } else {
        assert.equal(next.deleted_at, next.updated_at);
        assert.equal(receipts(n), '1');
        fails(auth() + rpc(n + 1000, entity), 'PT409', 'entity_deleted');
        assert.deepEqual(snapshot(entity), next);
      }
    } finally {
      if (!first.child.stdin.writableEnded) first.child.stdin.end('rollback;\n');
      if (second && !second.child.stdin.writableEnded) second.child.stdin.end();
    }
  });
}

test('disabling a module remains an active choice; subsequent delete is a separate version', () => {
  sql(auth() + rpc(300, 'disabled', false));
  const before = snapshot('disabled');
  assert.equal(before.enabled, false);
  assert.equal(before.deleted_at, null);
  sql(auth() + remove(301, 'disabled'));
  const deleted = advanced('disabled', before);
  assert.equal(deleted.enabled, false);
  assert.equal(deleted.deleted_at, deleted.updated_at);
});
test('revision exhaustion rolls back delete and receipt instead of creating unversioned history', () => {
  sql(auth() + direct('exhausted'));
  sql(`begin; alter table public.user_modules disable trigger user_modules_revision;
    update public.user_modules set revision=9223372036854775807 where ${where('exhausted')};
    alter table public.user_modules enable trigger user_modules_revision; commit;`);
  const before = snapshot('exhausted');
  fails(auth() + remove(302, 'exhausted'), 'PT500', 'mutation_failed');
  assert.equal(receipts(302), '0');
  assert.deepEqual(snapshot('exhausted'), before);
});
