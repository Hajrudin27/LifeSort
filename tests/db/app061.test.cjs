// APP-061 Home-task boundary against a disposable local PostgreSQL cluster.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bin = path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app061-'));
const cluster = path.join(scratch, 'db');
const port = '55461';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TASK = '11111111-1111-4111-8111-111111111111';
let started = false;
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', port, '-U', 'postgres', '-d', 'postgres'];
const sql = (source) => execFileSync(path.join(bin, 'psql'), args, {
  input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
}).trim();
function run(source, name) {
  const child = spawn(path.join(bin, 'psql'), args, { env: { ...process.env, PGAPPNAME: name } });
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
const quote = (value) => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const claims = (userId, role = 'authenticated') => JSON.stringify({ sub: userId, role }).replaceAll("'", "''");
const auth = (userId, role = 'authenticated') =>
  `set role ${role}; set request.jwt.claim.sub='${userId}'; set request.jwt.claims='${claims(userId, role)}'; `;
const mutationId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const taskPayload = (overrides = {}) => JSON.stringify({
  action: 'create',
  task: {
    id: TASK, kind: 'cleaning', title: 'Kitchen', frequency: 'weekly',
    assignedTo: 'me', rotates: true, createdAt: '2026-01-01T00:00:00.000Z',
    timeZone: 'Europe/Copenhagen',
  },
  ...overrides,
});
const apply = (user, n, {
  entity = TASK, operation = 'upsert', payload = taskPayload(), base = null,
} = {}) => sql(auth(user) + `select public.apply_sync_mutation(
  ${quote(mutationId(n))}, 'home.household', 'home-task', ${quote(entity)},
  ${quote(operation)}, ${payload === null ? 'null' : quote(payload) + '::jsonb'}, ${base ?? 'null'});`);
function errorFor(source) {
  try { sql(source); } catch (error) { return String(error.stderr); }
  assert.fail('SQL unexpectedly succeeded');
}
const row = (user = A, id = TASK) => JSON.parse(sql(`select row_to_json(t) from (
  select id,user_id,kind,title,frequency,last_done,assigned_to,rotates,
         created_at,time_zone,revision::text,updated_at,deleted_at
  from public.household_tasks where user_id='${user}' and id='${id}') t`));

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
    insert into auth.users values ('${A}'),('${B}');
    create table public.mutation_receipts(
      user_id uuid not null references auth.users(id) on delete cascade,
      mutation_id uuid not null, fingerprint bytea not null, processed_at timestamptz not null default now(),
      primary key(user_id,mutation_id));
    alter table public.mutation_receipts enable row level security;
    create table public.household_tasks(
      id text not null, user_id uuid not null references auth.users(id) on delete cascade,
      kind text not null, title text not null, frequency text not null, last_done date,
      created_at timestamptz not null default now(), assigned_to text not null default 'me',
      rotates boolean not null default false, primary key(user_id,id));
    alter table public.household_tasks enable row level security;
    create policy "Users can delete their own household tasks" on public.household_tasks
      for delete to public using (auth.uid()=user_id);
    create policy "Users can insert their own household tasks" on public.household_tasks
      for insert to public with check (auth.uid()=user_id);
    create policy "Users can update their own household tasks" on public.household_tasks
      for update to public using (auth.uid()=user_id);
    create policy "Users can view their own household tasks" on public.household_tasks
      for select to public using (auth.uid()=user_id);
    grant all on public.household_tasks to anon, authenticated, service_role;
    grant all on public.mutation_receipts to service_role;`);
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20261007104454_app061_home_task_sync.sql'), 'utf8'));
});

after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('SCHEMA/RLS: owner reads only own rows; anon and authenticated direct CRUD are closed', () => {
  assert.equal(apply(A, 1), 'applied');
  assert.equal(asCount(A), '1');
  assert.equal(asCount(B), '0');
  assert.match(errorFor(auth(A) + `insert into public.household_tasks(id,user_id,kind,title,frequency)
    values('x','${B}','cleaning','Spoof','weekly')`), /permission denied/);
  assert.match(errorFor(auth(A, 'anon') + 'select * from public.household_tasks'), /permission denied/);
  assert.equal(sql(`select relrowsecurity from pg_class where oid='public.household_tasks'::regclass`), 't');
  assert.equal(sql(`select prosecdef and proconfig=array['search_path=""']
    from pg_proc where oid='public.apply_sync_mutation(text,text,text,text,text,jsonb,bigint)'::regprocedure`), 't');
});
function asCount(user) {
  return sql(auth(user) + 'select count(*) from public.household_tasks');
}

test('REVISION: accepted edit advances once; replay does not; stale edit is rejected', () => {
  const edited = taskPayload({ action: 'edit', task: {
    ...JSON.parse(taskPayload()).task, title: 'Kitchen floor',
  } });
  assert.equal(apply(A, 2, { payload: edited, base: 1 }), 'applied');
  assert.equal(row().revision, '2');
  assert.equal(apply(A, 2, { payload: edited, base: 1 }), 'replayed');
  assert.equal(row().revision, '2');
  const stale = errorFor(auth(A) + `select public.apply_sync_mutation(
    '${mutationId(3)}','home.household','home-task','${TASK}','upsert',
    ${quote(edited)}::jsonb,1)`);
  assert.match(stale, /stale_revision/);
  assert.equal(sql(`select count(*) from public.mutation_receipts where user_id='${A}' and mutation_id='${mutationId(3)}'`), '0');
});

test('SERVER METADATA: trigger owns revision/timestamps and makes tombstones immutable', () => {
  const entity = '33333333-3333-4333-8333-333333333333';
  sql(`set role service_role;
    insert into public.household_tasks
      (id,user_id,kind,title,frequency,assigned_to,rotates,created_at,time_zone,revision,updated_at,deleted_at)
    values
      ('${entity}','${A}','maintenance','Boiler','yearly','me',false,
       '2026-01-01T00:00:00Z','Europe/Copenhagen',99,'2000-01-01T00:00:00Z','2000-01-01T00:00:00Z')`);
  const inserted = row(A, entity);
  assert.equal(inserted.revision, '1');
  assert.equal(inserted.deleted_at, null);
  assert.notEqual(inserted.updated_at, '2000-01-01T00:00:00+00:00');
  sql(`set role service_role;
    update public.household_tasks
       set title='Boiler service',revision=99,updated_at='2000-01-01T00:00:00Z'
     where user_id='${A}' and id='${entity}'`);
  assert.equal(row(A, entity).revision, '2');
  sql(`set role service_role;
    update public.household_tasks set deleted_at=now()
     where user_id='${A}' and id='${entity}'`);
  const tombstone = row(A, entity);
  assert.equal(tombstone.revision, '3');
  assert.ok(tombstone.deleted_at);
  assert.match(errorFor(`set role service_role;
    update public.household_tasks set title='Resurrected'
     where user_id='${A}' and id='${entity}'`), /entity_deleted/);
  assert.deepEqual(row(A, entity), tombstone);
});

test('COMPLETION: retry and same-day duplicate rotate once and keep one logical date', () => {
  const payload = JSON.stringify({ action: 'complete', completedOn: '2026-10-07' });
  assert.equal(apply(A, 4, { payload, base: 2 }), 'applied');
  const completed = row();
  assert.equal(completed.last_done, '2026-10-07');
  assert.equal(completed.assigned_to, 'partner');
  assert.equal(completed.revision, '3');
  assert.equal(apply(A, 4, { payload, base: 2 }), 'replayed');
  assert.equal(apply(A, 5, { payload, base: 3 }), 'applied');
  assert.deepEqual(row(), completed);
});

test('TOMBSTONE: delete is retained/replay-safe and stale updates cannot resurrect it', () => {
  assert.equal(apply(A, 6, { operation: 'delete', payload: null, base: 3 }), 'applied');
  const deleted = row();
  assert.equal(deleted.revision, '4');
  assert.ok(deleted.deleted_at);
  assert.equal(apply(A, 6, { operation: 'delete', payload: null, base: 3 }), 'replayed');
  assert.deepEqual(row(), deleted);
  const edit = taskPayload({ action: 'edit', task: JSON.parse(taskPayload()).task });
  assert.match(errorFor(auth(A) + `select public.apply_sync_mutation(
    '${mutationId(7)}','home.household','home-task','${TASK}','upsert',
    ${quote(edit)}::jsonb,3)`), /entity_deleted/);
  assert.deepEqual(row(), deleted);
});

test('CONCURRENCY: two devices on one base serialize and exactly one edit advances', async () => {
  const entity = '22222222-2222-4222-8222-222222222222';
  const baseTask = { ...JSON.parse(taskPayload()).task, id: entity, title: 'Base' };
  assert.equal(apply(A, 20, { entity, payload: JSON.stringify({ action: 'create', task: baseTask }) }), 'applied');
  const firstPayload = JSON.stringify({ action: 'edit', task: { ...baseTask, title: 'First' } });
  const secondPayload = JSON.stringify({ action: 'edit', task: { ...baseTask, title: 'Second' } });
  const statement = (n, payload) => auth(A) + `select public.apply_sync_mutation(
    '${mutationId(n)}','home.household','home-task','${entity}','upsert',
    ${quote(payload)}::jsonb,1);`;
  const first = run('begin;' + statement(21, firstPayload) + '\n\\echo write-held', 'app061-first');
  let second;
  try {
    await until(() => first.output().includes('write-held'));
    second = run(statement(22, secondPayload), 'app061-second');
    const secondDone = second.done.then((value) => ({ value }), (error) => ({ error }));
    second.child.stdin.end();
    await until(() => sql("select count(*) from pg_stat_activity where application_name='app061-second' and wait_event_type='Lock'") === '1');
    first.child.stdin.end('commit;\n');
    await first.done;
    const result = await secondDone;
    assert.match(result.error?.message || '', /stale_revision/);
    assert.equal(row(A, entity).title, 'First');
    assert.equal(row(A, entity).revision, '2');
    assert.equal(sql(`select count(*) from public.mutation_receipts where mutation_id='${mutationId(22)}'`), '0');
  } finally {
    if (!first.child.stdin.writableEnded) first.child.stdin.end('rollback;\n');
    if (second && !second.child.stdin.writableEnded) second.child.stdin.end();
  }
});

test('LEGACY ID: pre-APP-030 timestamp task IDs use the durable path; other shapes are rejected', () => {
  const legacy = '1757000000000-123456';
  const legacyTask = { ...JSON.parse(taskPayload()).task, id: legacy };
  assert.equal(apply(A, 30, { entity: legacy, payload: JSON.stringify({ action: 'create', task: legacyTask }) }), 'applied');
  assert.equal(apply(A, 31, { entity: legacy, base: 1,
    payload: JSON.stringify({ action: 'complete', completedOn: '2026-10-07' }) }), 'applied');
  assert.equal(row(A, legacy).revision, '2');
  const bad = 'not-a-task-id';
  assert.match(errorFor(auth(A) + `select public.apply_sync_mutation(
    '${mutationId(32)}','home.household','home-task','${bad}','upsert',
    ${quote(JSON.stringify({ action: 'create', task: { ...legacyTask, id: bad } }))}::jsonb,null)`), /invalid_mutation/);
});

test('ACCOUNT: owner is auth.uid(), same IDs stay isolated, and account deletion cascades rows and receipts', () => {
  assert.equal(apply(B, 8), 'applied');
  assert.equal(row(B).user_id, B);
  assert.equal(row(A).user_id, A);
  sql(`delete from auth.users where id='${B}'`);
  assert.equal(sql(`select count(*) from public.household_tasks where user_id='${B}'`), '0');
  assert.equal(sql(`select count(*) from public.mutation_receipts where user_id='${B}'`), '0');
});
