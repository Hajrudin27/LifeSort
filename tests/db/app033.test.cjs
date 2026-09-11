// APP-033 regressions after APP-034. Repeats docs/migration-verification.md's scratch-Postgres workflow.
// No .env, Supabase CLI, remote URL, existing database or migration reset is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const bin = process.env.APP033_PG_BIN || path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app033-'));
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
  (select enabled, revision::text, updated_at::text from public.user_modules where ${where(entity, user)}) t`) || 'null');
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
let oldPolicies, oldGrants, oldRpc, baseline;
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
  oldPolicies = sql("select row_to_json(p) from (select * from pg_policies where tablename='user_modules' and cmd <> 'DELETE' order by policyname) p");
  oldGrants = sql("select row_to_json(g) from (select grantee, privilege_type from information_schema.table_privileges where table_schema='public' and table_name='user_modules' and privilege_type not in ('DELETE', 'TRUNCATE') order by grantee, privilege_type) g");
  oldRpc = sql("select row_to_json(p) from (select prosecdef, proconfig, proacl from pg_proc where oid='public.apply_sync_mutation(text,text,text,text,text,jsonb)'::regprocedure) p");
  baseline = sql('select clock_timestamp()');
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260911075104_user_modules_revisions.sql'), 'utf8'));
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260911081953_user_modules_tombstones.sql'), 'utf8'));
});
after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
  console.log(`Scratch cluster ${started ? 'stopped' : 'not started'}; local test evidence retained at ${scratch}`);
});

test('existing rows receive revision 1 and a finite server baseline, replacing untrusted clocks', () => {
  assert.equal(snapshot('existing').revision, '1');
  assert.equal(snapshot('existing').enabled, false);
  assert.equal(snapshot('existing-infinity').updated_at, snapshot('existing').updated_at);
  assert.equal(sql(`select bool_and(revision=1 and isfinite(updated_at) and updated_at >= ${quote(baseline)}::timestamptz
    and updated_at <= clock_timestamp()) from public.user_modules`), 't');
});
test('ordinary insert receives initial metadata without any client values', () => {
  sql(auth() + `insert into public.user_modules(user_id,module_id,enabled) values(${quote(A)},'new',true)`);
  assert.equal(snapshot('new').revision, '1');
  assert.equal(sql(`select isfinite(updated_at) and updated_at <= clock_timestamp() from public.user_modules where ${where('new')}`), 't');
});
test('insert cannot forge revision or timestamp, including null and negative inputs', () => {
  for (const [i, revision] of ['999999999999', '-4', 'null'].entries()) {
    const entity = `forged-${i}`;
    sql(auth() + direct(entity, true, revision, "'infinity'"));
    assert.equal(snapshot(entity).revision, '1');
    assert.equal(sql(`select isfinite(updated_at) and updated_at <= clock_timestamp() from public.user_modules where ${where(entity)}`), 't');
  }
});
test('direct legacy upserts advance twice, overriding caller metadata each time', () => {
  let before = snapshot('new');
  sql(auth() + direct('new', false, '999999999', "'2099-01-01'"));
  before = advanced('new', before);
  assert.equal(before.enabled, false);
  sql(auth() + direct('new', true, '-99', "'1900-01-01'"));
  assert.equal(advanced('new', before).enabled, true);
});
test('plain UPDATE and same-value writes advance metadata even within one transaction', () => {
  const before = snapshot('new');
  const result = sql('begin;' + auth() + `update public.user_modules set enabled=enabled where ${where('new')} returning updated_at;
    update public.user_modules set revision=1, updated_at='1900-01-01' where ${where('new')} returning updated_at; commit;`).split('\n');
  assert.equal(snapshot('new').revision, String(BigInt(before.revision) + 2n));
  assert.equal(sql(`select ${quote(result[1])}::timestamptz > ${quote(result[0])}::timestamptz`), 't');
});
test('first APP-032 request inserts revision 1 and replay changes neither metadata nor value', () => {
  assert.equal(sql(auth() + rpc(101, 'rpc')), 'applied');
  const before = snapshot('rpc');
  assert.equal(before.revision, '1');
  for (let i = 0; i < 3; i++) assert.equal(sql(auth() + rpc(101, 'rpc')), 'replayed');
  assert.deepEqual(snapshot('rpc'), before);
  assert.equal(receipts(101), '1');
});
test('new mutation IDs advance existing entity; a same-value mutation is another write', () => {
  let before = snapshot('rpc');
  assert.equal(sql(auth() + rpc(102, 'rpc', false)), 'applied');
  before = advanced('rpc', before);
  assert.equal(sql(auth() + rpc(103, 'rpc', false)), 'applied');
  advanced('rpc', before);
});
test('replay of an older mutation cannot restore its version after another accepted write', () => {
  const before = snapshot('rpc');
  assert.equal(sql(auth() + rpc(101, 'rpc')), 'replayed');
  assert.deepEqual(snapshot('rpc'), before);
});
test('PT409 changed payload leaves entity value, revision and timestamp unchanged', () => {
  const before = snapshot('rpc');
  fails(auth() + rpc(101, 'rpc', false), 'PT409', 'mutation_id_conflict');
  assert.deepEqual(snapshot('rpc'), before);
  assert.equal(receipts(101), '1');
});
test('validation and constraint failures leave no row or receipt', () => {
  fails(auth() + rpc(104, 'invalid', true, { payload: '{"enabled":null}' }), 'PT400');
  fails(auth() + rpc(105, 'account'), 'PT422');
  assert.equal(snapshot('invalid'), null);
  assert.equal(snapshot('account'), null);
  assert.equal(receipts(104), '0');
  assert.equal(receipts(105), '0');
});
test('failure after an UPDATE rolls back the false revision increment and receipt', () => {
  const before = snapshot('rpc');
  sql(`create function public.app033_fail() returns trigger language plpgsql as $$ begin
    if new.module_id='rpc' then raise exception 'private detail'; end if; return new; end $$;
    create trigger app033_fail after update on public.user_modules for each row execute function public.app033_fail();`);
  try {
    fails(auth() + rpc(106, 'rpc', true), 'PT500', 'mutation_failed');
    assert.deepEqual(snapshot('rpc'), before);
    assert.equal(receipts(106), '0');
  } finally { sql('drop trigger app033_fail on public.user_modules; drop function public.app033_fail()'); }
  assert.equal(sql(auth() + rpc(106, 'rpc', true)), 'applied');
  advanced('rpc', before);
});
test('outer rollback restores an existing version and permits the same mutation ID later', () => {
  const before = snapshot('rpc');
  assert.equal(sql('begin;' + auth() + rpc(107, 'rpc', false) + 'rollback;'), 'applied');
  assert.deepEqual(snapshot('rpc'), before);
  assert.equal(receipts(107), '0');
  assert.equal(sql(auth() + rpc(107, 'rpc', false)), 'applied');
  advanced('rpc', before);
});
test('direct UPDATE rollback restores metadata too', () => {
  const before = snapshot('new');
  sql('begin;' + auth() + `update public.user_modules set enabled=false where ${where('new')}; rollback;`);
  assert.deepEqual(snapshot('new'), before);
});
test('two users have independent per-entity revisions and cannot alter each other through RLS', () => {
  const before = snapshot('rpc');
  assert.equal(sql(auth(B) + rpc(101, 'rpc', false)), 'applied');
  assert.equal(snapshot('rpc', B).revision, '1');
  assert.equal(sql(auth(B) + `update public.user_modules set revision=9999 where ${where('rpc')} returning module_id`), '');
  fails(auth(B) + direct('rpc', true, '1', 'now()', A), '42501');
  fails(auth() + `update public.user_modules set user_id=${quote(B)} where ${where('new')}`, '42501');
  assert.equal(sql(auth(B) + `select count(*) from public.user_modules where user_id=${quote(A)}`), '0');
  assert.deepEqual(snapshot('rpc'), before);
});
test('non-delete policies/grants, RLS and APP-032 RPC security remain unchanged after APP-034', () => {
  assert.equal(sql("select row_to_json(p) from (select * from pg_policies where tablename='user_modules' and cmd <> 'DELETE' order by policyname) p"), oldPolicies);
  assert.equal(sql("select row_to_json(g) from (select grantee, privilege_type from information_schema.table_privileges where table_schema='public' and table_name='user_modules' and privilege_type not in ('DELETE', 'TRUNCATE') order by grantee, privilege_type) g"), oldGrants);
  assert.equal(sql("select relrowsecurity from pg_class where oid='public.user_modules'::regclass"), 't');
  assert.equal(sql("select row_to_json(p) from (select prosecdef, proconfig, proacl from pg_proc where oid='public.apply_sync_mutation(text,text,text,text,text,jsonb)'::regprocedure) p"), oldRpc);
  fails(auth('', 'anon') + 'select * from public.user_modules', '42501');
  fails(auth('', 'anon') + direct('anonymous'), '42501');
});
test('trigger is invoker with empty search_path and no direct client execution privileges', () => {
  assert.equal(sql("select not prosecdef and proconfig=array['search_path=\"\"'] from pg_proc where oid='public.stamp_user_module_revision()'::regprocedure"), 't');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(sql(`select has_function_privilege('${role}', 'public.stamp_user_module_revision()', 'execute')`), 'f');
    fails(auth(A, role) + 'select public.stamp_user_module_revision()', '42501');
    fails(auth(A, role) + 'select * from public.mutation_receipts', '42501');
  }
});
test('concurrent new mutation IDs on one entity serialize increments without loss', async () => {
  sql(auth() + direct('concurrent'));
  const before = snapshot('concurrent');
  const first = run('begin;' + auth() + rpc(110, 'concurrent', false) + '\n\\echo write-held', 'app033-first');
  let second;
  try {
    await until(() => first.output().includes('write-held'));
    second = run(auth() + rpc(111, 'concurrent', true), 'app033-second');
    const done = second.done.then((value) => ({ value }), (error) => ({ error }));
    second.child.stdin.end();
    await until(() => sql("select count(*) from pg_stat_activity where application_name='app033-second' and wait_event_type='Lock'") === '1');
    first.child.stdin.end('commit;\n');
    await first.done;
    assert.deepEqual(await done, { value: 'applied' });
    assert.equal(snapshot('concurrent').revision, String(BigInt(before.revision) + 2n));
    assert.equal(snapshot('concurrent').enabled, true);
  } finally {
    if (!first.child.stdin.writableEnded) first.child.stdin.end('rollback;\n');
    if (second && !second.child.stdin.writableEnded) second.child.stdin.end();
  }
});
test('long-lived bigint revisions advance exactly and exhaustion aborts without wrapping', () => {
  sql(auth() + direct('long-lived'));
  // Privileged fixture only: simulate decades of accepted writes without a loop.
  sql(`begin; alter table public.user_modules disable trigger user_modules_revision;
    update public.user_modules set revision=9223372036854775806 where ${where('long-lived')};
    alter table public.user_modules enable trigger user_modules_revision; commit;`);
  const before = snapshot('long-lived');
  assert.equal(sql(auth() + rpc(112, 'long-lived')), 'applied');
  const last = advanced('long-lived', before);
  assert.equal(last.revision, '9223372036854775807');
  fails(auth() + rpc(113, 'long-lived'), 'PT500', 'mutation_failed');
  assert.deepEqual(snapshot('long-lived'), last);
  assert.equal(receipts(113), '0');
});
