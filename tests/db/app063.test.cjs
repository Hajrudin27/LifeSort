// APP-063 goal semantics against a disposable local PostgreSQL cluster.
// The pre-existing life_goals table, RLS policies, FK and grants are lifted verbatim from the
// remote schema migration, so the new columns are proven on the real baseline. No Supabase
// CLI, remote URL, .env or existing database is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bin = process.env.APP063_PG_BIN || path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app063-'));
const cluster = path.join(scratch, 'db');
const port = '55463';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MIGRATION = path.join(root, 'supabase/migrations/20261007180000_app063_life_goal_semantics.sql');
const MAX = 1000000000000;
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
const COLUMNS = 'id,title,description,deadline,sub_goals,goal_type,target_value,current_value,unit,completed';
const row = (user, id) => JSON.parse(sql(`select row_to_json(t) from (select ${COLUMNS}
  from public.life_goals where user_id='${user}' and id=${quote(id)}) t`));
const typed = (goal) => ({ goal_type: goal.goal_type, target_value: goal.target_value, current_value: goal.current_value, unit: goal.unit, completed: goal.completed });
const insert = (user, id, t = {}) => `insert into public.life_goals
  (id,user_id,title,sub_goals,goal_type,target_value,current_value,unit,completed)
  values (${quote(id)},${quote(user)},'T','[]'::jsonb,${quote(t.goal_type)},${t.target_value ?? 'null'},${t.current_value ?? 'null'},${quote(t.unit)},${t.completed ?? 'null'});`;
const snapshot = () => sql(`select
  (select string_agg(policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,''), '|' order by policyname)
     from pg_policies where tablename='life_goals'),
  (select string_agg(grantee||':'||privilege_type, '|' order by grantee, privilege_type)
     from information_schema.table_privileges where table_name='life_goals')`);

/** What an older client sends: only the historical columns, exactly as PostgREST builds the merge. */
const oldClientUpsert = (user, id, title, subGoals, extra = {}) => `${auth(user)}
  insert into public.life_goals (id,user_id,title,description,deadline,sub_goals,created_at)
  values (${quote(id)},${quote(user)},${quote(title)},${quote(extra.description)},${quote(extra.deadline)},${quote(JSON.stringify(subGoals))}::jsonb,'2026-09-01T10:00:00Z')
  on conflict (user_id,id) do update set id=excluded.id, user_id=excluded.user_id, title=excluded.title,
    description=excluded.description, deadline=excluded.deadline, sub_goals=excluded.sub_goals, created_at=excluded.created_at;`;

/** An independent statement of the approved rules, not derived from the SQL under test. */
function oracle(t, tv, cv, u, c) {
  const inRange = (v, min) => v !== null && v >= min && v <= MAX;
  const nothing = (...values) => values.every((v) => v === null);
  if (t === null) return nothing(tv, cv, u, c);
  if (t === 'binary') return c !== null && nothing(tv, cv, u);
  if (t === 'count' || t === 'duration') return inRange(tv, 1) && inRange(cv, 0) && nothing(u, c);
  if (t === 'amount') return inRange(tv, 1) && inRange(cv, 0) && u !== null && u.length >= 1 && u.length <= 24 && u === u.trim() && c === null;
  return false;
}

function baselineStatements() {
  const text = fs.readFileSync(path.join(root, 'supabase/migrations/20260902112000_remote_schema.sql'), 'utf8');
  return text.split(/;\s*\n/).filter((statement) => statement.includes('life_goals')).map((s) => `${s};`);
}

let beforeSnapshot;
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
  // Legacy rows written by every earlier client, before the migration exists.
  sql(`insert into public.life_goals (id,user_id,title,description,deadline,sub_goals,created_at) values
    ('old-partial','${A}','Old partial','Why','2026-12-31','[{"id":"1","title":"One","completed":true},{"id":"2","title":"Two","completed":false}]','2026-09-01T10:00:00Z'),
    ('old-empty','${A}','Old empty',null,null,'[]','2026-09-02T10:00:00Z'),
    ('old-b','${B}','Other user old',null,null,'[]','2026-09-03T10:00:00Z');`);
  beforeSnapshot = snapshot();
  sql(fs.readFileSync(MIGRATION, 'utf8'));
});

after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('ADDITIVE: five nullable columns, legacy rows untouched, policies and grants unchanged, sub_goals kept', () => {
  assert.equal(sql(`select string_agg(column_name||':'||data_type||':'||is_nullable, ',' order by column_name)
    from information_schema.columns where table_name='life_goals'
      and column_name in ('goal_type','target_value','current_value','unit','completed')`),
  'completed:boolean:YES,current_value:bigint:YES,goal_type:text:YES,target_value:bigint:YES,unit:text:YES');
  assert.equal(sql(`select data_type||':'||is_nullable from information_schema.columns where table_name='life_goals' and column_name='sub_goals'`), 'jsonb:NO');
  const legacy = row(A, 'old-partial');
  assert.deepEqual(typed(legacy), { goal_type: null, target_value: null, current_value: null, unit: null, completed: null });
  assert.equal(legacy.title, 'Old partial');
  assert.deepEqual(legacy.sub_goals, [{ id: '1', title: 'One', completed: true }, { id: '2', title: 'Two', completed: false }]);
  assert.equal(sql('select count(*) from public.life_goals'), '3');
  assert.equal(snapshot(), beforeSnapshot, 'the migration changed no RLS policy and no grant');
  assert.equal(sql(`select count(*) from information_schema.columns where table_name='life_goals' and data_type in ('real','double precision','numeric')`), '0', 'no float or numeric column');
});

test('IDEMPOTENT: the migration can be applied again without error or data change', () => {
  sql(fs.readFileSync(MIGRATION, 'utf8'));
  assert.equal(sql('select count(*) from public.life_goals'), '3');
  assert.equal(snapshot(), beforeSnapshot);
});

test('SHAPES: every approved typed shape, and the legacy all-NULL shape, is accepted', () => {
  sql(insert(A, 'legacy'));
  sql(insert(A, 'bin-open', { goal_type: 'binary', completed: false }));
  sql(insert(A, 'bin-done', { goal_type: 'binary', completed: true }));
  sql(insert(A, 'count', { goal_type: 'count', target_value: 12, current_value: 30 }));
  sql(insert(A, 'duration', { goal_type: 'duration', target_value: 6000, current_value: 0 }));
  sql(insert(A, 'amount', { goal_type: 'amount', target_value: 10050, current_value: 225, unit: 'km' }));
  assert.deepEqual(typed(row(A, 'count')), { goal_type: 'count', target_value: 12, current_value: 30, unit: null, completed: null });
  assert.deepEqual(typed(row(A, 'amount')), { goal_type: 'amount', target_value: 10050, current_value: 225, unit: 'km', completed: null });
  assert.deepEqual(typed(row(A, 'bin-done')), { goal_type: 'binary', target_value: null, current_value: null, unit: null, completed: true });
});

test('EXHAUSTIVE: every NULL / non-NULL / boundary combination matches an independent oracle', () => {
  const types = [null, 'binary', 'count', 'amount', 'duration', 'bogus'];
  const targets = [null, -1, 0, 1, MAX, MAX + 1];
  const currents = [null, -1, 0, MAX, MAX + 1];
  const units = [null, '', ' ', 'km', ' km', 'km ', 'x'.repeat(24), 'x'.repeat(25)];
  const completes = [null, true, false];
  const list = (values, cast) => `array[${values.map((v) => (v === null ? 'null' : typeof v === 'string' ? quote(v) : String(v))).join(',')}]${cast}`;
  const output = sql(`
    create temp table probe(accepted boolean, combo text);
    do $$
    declare t text; tv bigint; cv bigint; u text; c boolean; n int := 0; key text;
    begin
      foreach t in array ${list(types, '::text[]')} loop
      foreach tv in array ${list(targets, '::bigint[]')} loop
      foreach cv in array ${list(currents, '::bigint[]')} loop
      foreach u in array ${list(units, '::text[]')} loop
      foreach c in array ${list(completes, '::boolean[]')} loop
        n := n + 1;
        key := coalesce(t,'~')||'|'||coalesce(tv::text,'~')||'|'||coalesce(cv::text,'~')||'|'||coalesce(u,'~')||'|'||coalesce(c::text,'~');
        begin
          insert into public.life_goals (id,user_id,title,goal_type,target_value,current_value,unit,completed)
          values ('probe-'||n,'${A}','T',t,tv,cv,u,c);
          insert into probe values (true, key);
        exception when check_violation then
          insert into probe values (false, key);
        end;
      end loop; end loop; end loop; end loop; end loop;
    end $$;
    delete from public.life_goals where id like 'probe-%';
    select accepted::text||'#'||combo from probe order by combo;`);
  const actual = new Map(output.split('\n').map((line) => { const [accepted, combo] = line.split('#'); return [combo, accepted === 'true']; }));
  const total = types.length * targets.length * currents.length * units.length * completes.length;
  assert.equal(actual.size, total);
  let accepted = 0;
  for (const t of types) for (const tv of targets) for (const cv of currents) for (const u of units) for (const c of completes) {
    const key = `${t ?? '~'}|${tv ?? '~'}|${cv ?? '~'}|${u ?? '~'}|${c ?? '~'}`;
    const expected = oracle(t, tv, cv, u, c);
    assert.equal(actual.get(key), expected, `combination ${key} should be ${expected ? 'accepted' : 'refused'}`);
    if (expected) accepted += 1;
  }
  // The oracle must really exercise both outcomes for every type, or the comparison proves nothing.
  // Accepted by construction: 1 legacy + 2 binary (completed true/false) + 4 count (target 1|MAX x
  // current 0|MAX) + 4 duration + 8 amount (same four x two valid units: 'km' and 24 characters).
  assert.equal(accepted, 1 + 2 + 4 + 4 + 8, `accepted ${accepted} of ${total}`);
});

test('UPDATES: an UPDATE cannot create an illegal mixed state either', () => {
  assert.match(errorFor(`update public.life_goals set unit='km' where user_id='${A}' and id='count'`), /life_goals_semantics_check/);
  assert.match(errorFor(`update public.life_goals set completed=true where user_id='${A}' and id='count'`), /life_goals_semantics_check/);
  assert.match(errorFor(`update public.life_goals set goal_type=null where user_id='${A}' and id='count'`), /life_goals_semantics_check/);
  assert.match(errorFor(`update public.life_goals set target_value=0 where user_id='${A}' and id='count'`), /life_goals_semantics_check/);
  assert.match(errorFor(`update public.life_goals set target_value=5 where user_id='${A}' and id='bin-open'`), /life_goals_semantics_check/);
  assert.match(errorFor(`update public.life_goals set current_value=${MAX + 1} where user_id='${A}' and id='count'`), /life_goals_semantics_check/);
  assert.match(errorFor(`update public.life_goals set unit=' km' where user_id='${A}' and id='amount'`), /life_goals_semantics_check/);
  assert.deepEqual(typed(row(A, 'count')), { goal_type: 'count', target_value: 12, current_value: 30, unit: null, completed: null });
  // Legal edits still work: lowering the target below current is how a count goal becomes completed.
  sql(`update public.life_goals set target_value=5, current_value=4 where user_id='${A}' and id='count'`);
  assert.equal(row(A, 'count').target_value, 5);
});

test('OLD CLIENT: an upsert that lists only the historical columns never clears the typed columns', () => {
  for (const id of ['bin-done', 'count', 'amount', 'duration']) {
    const before = row(A, id);
    sql(oldClientUpsert(A, id, `Edited by an old client: ${id}`, [{ id: 'm', title: 'Step', completed: true }], { description: 'old note', deadline: '2026-11-30' }));
    const after = row(A, id);
    assert.deepEqual(typed(after), typed(before), `${id}: typed columns survive`);
    assert.equal(after.title, `Edited by an old client: ${id}`);
    assert.deepEqual(after.sub_goals, [{ id: 'm', title: 'Step', completed: true }]);
    assert.equal(after.description, 'old note');
    assert.equal(after.deadline, '2026-11-30');
  }
});

test('OLD CLIENT: a row it creates has every typed column NULL and is valid (a permanent legacy goal)', () => {
  sql(oldClientUpsert(A, 'created-by-old', 'Old client goal', [{ id: 'a', title: 'A', completed: true }]));
  assert.deepEqual(typed(row(A, 'created-by-old')), { goal_type: null, target_value: null, current_value: null, unit: null, completed: null });
  // A later old-client edit of that same row keeps it legacy.
  sql(oldClientUpsert(A, 'created-by-old', 'Old client goal, renamed', []));
  assert.deepEqual(typed(row(A, 'created-by-old')), { goal_type: null, target_value: null, current_value: null, unit: null, completed: null });
});

test('NEW CLIENT: a full upsert converts a legacy row to explicit typed state; a later old-client milestone toggle does not change it', () => {
  sql(`${auth(A)}
    insert into public.life_goals (id,user_id,title,description,deadline,sub_goals,created_at,goal_type,target_value,current_value,unit,completed)
    values ('old-partial','${A}','Old partial','Why','2026-12-31','[{"id":"1","title":"One","completed":true},{"id":"2","title":"Two","completed":false}]','2026-09-01T10:00:00Z','binary',null,null,null,false)
    on conflict (user_id,id) do update set title=excluded.title, description=excluded.description, deadline=excluded.deadline,
      sub_goals=excluded.sub_goals, goal_type=excluded.goal_type, target_value=excluded.target_value,
      current_value=excluded.current_value, unit=excluded.unit, completed=excluded.completed;`);
  assert.equal(row(A, 'old-partial').goal_type, 'binary');
  // An old client now completes every milestone. The explicit binary state does not move.
  sql(oldClientUpsert(A, 'old-partial', 'Old partial', [{ id: '1', title: 'One', completed: true }, { id: '2', title: 'Two', completed: true }], { description: 'Why', deadline: '2026-12-31' }));
  const after = row(A, 'old-partial');
  assert.deepEqual(typed(after), { goal_type: 'binary', target_value: null, current_value: null, unit: null, completed: false });
  assert.equal(after.sub_goals.every((m) => m.completed), true);
});

test('RLS: an owner reads and writes only their own rows', () => {
  assert.notEqual(sql(`${auth(A)} select count(*) from public.life_goals`), '0');
  assert.equal(sql(`${auth(A)} select count(*) from public.life_goals where user_id='${B}'`), '0');
  assert.equal(sql(`${auth(B)} select count(*) from public.life_goals where user_id='${A}'`), '0');
  assert.equal(sql(`${auth(B)} select count(*) from public.life_goals`), '1');
  sql(`${auth(A)} ${insert(A, 'owner-write', { goal_type: 'binary', completed: false })}`);
  assert.equal(row(A, 'owner-write').goal_type, 'binary');
});

test('RLS: another user cannot read, change, delete or insert into the owner\'s goals', () => {
  assert.equal(sql(`${auth(B)} update public.life_goals set title='hijacked', goal_type=null, completed=null where user_id='${A}' returning id`), '');
  assert.equal(sql(`${auth(B)} delete from public.life_goals where user_id='${A}' returning id`), '');
  assert.match(errorFor(`${auth(B)} ${insert(A, 'forged', { goal_type: 'binary', completed: true })}`), /row-level security/);
  assert.equal(row(A, 'count').goal_type, 'count');
  assert.equal(sql("select count(*) from public.life_goals where id='forged'"), '0');
});

test('RLS: anon sees nothing and cannot write', () => {
  assert.equal(sql(`${auth(null, 'anon')} select count(*) from public.life_goals`), '0');
  assert.match(errorFor(`${auth(null, 'anon')} ${insert(A, 'anon-write')}`), /row-level security/);
  assert.equal(sql(`${auth(null, 'anon')} update public.life_goals set title='x' returning id`), '');
  assert.equal(sql(`${auth(null, 'anon')} delete from public.life_goals returning id`), '');
});

test('RLS: an owner cannot move a goal to another user', () => {
  assert.match(errorFor(`${auth(A)} update public.life_goals set user_id='${B}' where id='owner-write'`), /row-level security/);
  assert.equal(row(A, 'owner-write').id, 'owner-write');
});

test('ACCOUNT DELETION: goals, with their typed state, cascade away', () => {
  assert.notEqual(sql(`select count(*) from public.life_goals where user_id='${A}'`), '0');
  sql(`delete from auth.users where id='${A}'`);
  assert.equal(sql(`select count(*) from public.life_goals where user_id='${A}'`), '0');
  assert.equal(sql(`select count(*) from public.life_goals where user_id='${B}'`), '1');
});
