// APP-032 regressions after APP-034, using the established scratch-Postgres workflow.
// No .env, Supabase CLI, remote URL, existing database or migration reset is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const bin = process.env.APP032_PG_BIN || path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app032-'));
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
const receipts = (n, user = A) => sql(`select count(*) from public.mutation_receipts where user_id=${quote(user)} and mutation_id=${quote(id(n))}`);
const effects = (entity, user = A) => sql(`select count(*) from public.app032_effects where user_id=${quote(user)} and module_id=${quote(entity)}`);
let started = false;
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
    -- Simulate Supabase defaults so the new migration must revoke them.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260908233100_user_modules.sql'), 'utf8'));
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260911065428_idempotent_server_mutations.sql'), 'utf8'));
  // Run the original idempotency/security/concurrency regressions after APP-033 too.
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260911075104_user_modules_revisions.sql'), 'utf8'));
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260911081953_user_modules_tombstones.sql'), 'utf8'));
  // Test-only trigger counts actual writes, including no-op UPSERT updates. Merely
  // counting user_modules rows would not prove that duplicate writes were skipped.
  sql(`create table public.app032_effects(user_id uuid, module_id text);
    create function public.app032_observe() returns trigger language plpgsql as $$ begin
      insert into public.app032_effects values(new.user_id, new.module_id);
      if new.module_id = 'fail-after-write' then raise exception 'private domain detail'; end if;
      return new;
    end $$;
    create trigger app032_observe after insert or update on public.user_modules
      for each row execute function public.app032_observe();`);
});
after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
  console.log(`Scratch cluster ${started ? 'stopped' : 'not started'}; local test evidence retained at ${scratch}`);
});

test('first execution applies a real entity and persists one minimal receipt', () => {
  assert.equal(sql(auth() + rpc(1)), 'applied');
  assert.equal(sql(`select enabled from public.user_modules where user_id=${quote(A)} and module_id='habits'`), 't');
  assert.equal(receipts(1), '1');
  assert.equal(effects('habits'), '1');
  assert.equal(sql('select octet_length(fingerprint) from public.mutation_receipts'), '32');
  assert.equal(sql("select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name='mutation_receipts'"), 'user_id,mutation_id,fingerprint,processed_at');
});
test('duplicate and repeated replays never execute another domain write', () => {
  for (let i = 0; i < 3; i++) assert.equal(sql(auth() + rpc(1)), 'replayed');
  assert.equal(effects('habits'), '1');
  assert.equal(receipts(1), '1');
});
test('normalized JSON and UUID spelling are equivalent replay identity', () => {
  assert.equal(sql(auth() + rpc(1, 'habits', true, { payload: ' { "enabled" : true } ' })), 'replayed');
  const upper = 'ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF';
  assert.equal(sql(auth() + rpc(0, 'case', true, { id: upper })), 'applied');
  assert.equal(sql(auth() + rpc(0, 'case', true, { id: upper.toLowerCase() })), 'replayed');
  assert.equal(effects('case'), '1');
});
test('changed content, entity, kind, domain and operation all fail closed', () => {
  for (const override of [{ payload: '{"enabled":false}' }, { entity: 'food' }, { type: 'other' }, { domain: 'other' }, { operation: 'delete' }]) {
    fails(auth() + rpc(1, 'habits', true, override), 'PT409', 'mutation_id_conflict');
  }
  assert.equal(effects('habits'), '1');
  assert.equal(effects('food'), '0');
});
test('different IDs apply independently; replay does not restore stale state', () => {
  assert.equal(sql(auth() + rpc(2, 'habits', false)), 'applied');
  assert.equal(sql(auth() + rpc(1)), 'replayed');
  assert.equal(effects('habits'), '2');
  assert.equal(sql(`select enabled from public.user_modules where user_id=${quote(A)} and module_id='habits'`), 'f');
});
test('two users can use the same ID independently without reading/replaying each other', () => {
  assert.equal(sql(auth(B) + rpc(1, 'habits', false)), 'applied');
  assert.equal(sql(auth(B) + rpc(1, 'habits', false)), 'replayed');
  assert.equal(receipts(1, B), '1');
  assert.equal(effects('habits', B), '1');
  assert.equal(effects('habits', A), '2');
  assert.equal(sql(auth(B) + `select count(*) from public.user_modules where user_id=${quote(A)}`), '0');
  assert.equal(sql(auth(B) + `update public.user_modules set enabled=true where user_id=${quote(A)} returning module_id`), '');
  fails(auth(B) + `insert into public.user_modules values (${quote(A)}, 'foreign', true, now())`, '42501');
});
test('receipt table denies direct reads, forgery, changes and deletes to client roles', () => {
  for (const role of ['authenticated', 'anon', 'service_role']) {
    for (const query of ['select * from public.mutation_receipts',
      `insert into public.mutation_receipts values (${quote(A)}, ${quote(id(3))}, decode(repeat('00',32),'hex'), now())`,
      "update public.mutation_receipts set processed_at=now()", 'delete from public.mutation_receipts']) {
      fails(auth(A, role) + query, '42501');
    }
  }
  assert.equal(sql("select relrowsecurity from pg_class where oid='public.mutation_receipts'::regclass"), 't');
  assert.equal(sql("select count(*) from pg_policies where tablename='mutation_receipts'"), '0');
});
test('anonymous, missing context, and deleted/nonexistent accounts are rejected', () => {
  fails(auth('', 'anon') + rpc(3), '42501');
  fails(auth('') + rpc(3), 'PT401', 'not_authenticated');
  fails(auth('cccccccc-cccc-4ccc-8ccc-cccccccccccc') + rpc(3), 'PT401');
  fails(auth(A, 'service_role') + rpc(3), '42501');
  assert.equal(receipts(3), '0');
});
test('malformed or non-v4 mutation IDs produce safe validation errors', () => {
  for (const invalid of [null, '', 'private invalid input', '00000000-0000-0000-0000-000000000000']) {
    fails(auth() + rpc(4, 'invalid', true, { id: invalid }), 'PT400', 'invalid_mutation');
  }
  assert.equal(effects('invalid'), '0');
});
test('unsupported or malformed envelopes leave no successful receipt', () => {
  for (const override of [{ payload: '{}' }, { payload: 'null' }, { payload: '[]' }, { payload: '{"enabled":"true"}' },
    { payload: '{"enabled":true,"user_id":"someone"}' }, { domain: null }, { operation: 'delete' }, { entity: '' }]) {
    fails(auth() + rpc(5, 'invalid', true, override), 'PT400');
    assert.equal(receipts(5), '0');
  }
});
test('existing domain constraint failure rolls back the claimed receipt', () => {
  fails(auth() + rpc(6, 'core-shell'), 'PT422', 'mutation_rejected');
  assert.equal(receipts(6), '0');
  assert.equal(effects('core-shell'), '0');
  assert.equal(sql(auth() + rpc(6, 'valid-after-failure')), 'applied');
});
test('failure after domain write rolls back entity, trigger effect and receipt', () => {
  fails(auth() + rpc(7, 'fail-after-write'), 'PT500', 'mutation_failed');
  assert.equal(receipts(7), '0');
  assert.equal(effects('fail-after-write'), '0');
  assert.equal(sql("select count(*) from public.user_modules where module_id='fail-after-write'"), '0');
});
test('failed receipt persistence prevents the domain effect', () => {
  sql(`create function public.app032_fail_receipt() returns trigger language plpgsql as $$ begin
      if new.mutation_id = '${id(9)}'::uuid then raise exception 'private receipt detail'; end if;
      return new;
    end $$;
    create trigger app032_fail_receipt after insert on public.mutation_receipts
      for each row execute function public.app032_fail_receipt();`);
  fails(auth() + rpc(9, 'receipt-failure'), 'PT500', 'mutation_failed');
  assert.equal(receipts(9), '0');
  assert.equal(effects('receipt-failure'), '0');
});
test('outer transaction rollback removes successful domain write and receipt together', () => {
  assert.equal(sql('begin;' + auth() + rpc(8, 'rolled-back') + 'rollback;'), 'applied');
  assert.equal(receipts(8), '0');
  assert.equal(effects('rolled-back'), '0');
  assert.equal(sql(auth() + rpc(8, 'rolled-back')), 'applied');
});
for (const scenario of ['commit', 'rollback', 'changed']) {
  test(`true concurrent duplicate: first transaction ${scenario}`, async () => {
    const n = { commit: 10, rollback: 11, changed: 12 }[scenario];
    const entity = `concurrent-${scenario}`;
    const first = run('begin;' + auth() + rpc(n, entity) + '\n\\echo claim-held', `app032-first-${n}`);
    let second;
    try {
      await until(() => first.output().includes('claim-held'));
      second = run(auth() + rpc(n, entity, scenario !== 'changed'), `app032-second-${n}`);
      // Attach rejection handler immediately; checked below after release.
      const secondResult = second.done.then((value) => ({ value }), (error) => ({ error }));
      second.child.stdin.end();
      await until(() => sql(`select count(*) from pg_stat_activity where application_name='app032-second-${n}' and wait_event_type='Lock'`) === '1');
      first.child.stdin.end(scenario === 'rollback' ? 'rollback;\n' : 'commit;\n');
      await first.done;
      const result = await secondResult;
      if (scenario === 'changed') assert.match(result.error?.message || '', /mutation_id_conflict/);
      else assert.equal(result.value, scenario === 'rollback' ? 'applied' : 'replayed');
      assert.equal(effects(entity), '1');
      assert.equal(receipts(n), '1');
    } finally {
      if (!first.child.stdin.writableEnded) first.child.stdin.end('rollback;\n');
      if (second && !second.child.stdin.writableEnded) second.child.stdin.end();
    }
  });
}
test('account deletion cascades replay evidence and domain data', () => {
  const user = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  sql(`insert into auth.users values(${quote(user)})`);
  assert.equal(sql(auth(user) + rpc(20, 'cascade')), 'applied');
  sql(`delete from auth.users where id=${quote(user)}`);
  assert.equal(receipts(20, user), '0');
  assert.equal(sql(`select count(*) from public.user_modules where user_id=${quote(user)}`), '0');
});
