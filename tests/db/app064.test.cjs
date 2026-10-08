// APP-064 habit semantics against a disposable local PostgreSQL cluster.
// The pre-existing habits table, RLS policies, FK and grants are lifted verbatim from the remote
// schema migration, so the new columns are proven on the real baseline, and an older client is
// emulated with the exact legacy column set. No Supabase CLI, remote URL, .env or existing
// database is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bin = process.env.APP064_PG_BIN || path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app064-'));
const cluster = path.join(scratch, 'db');
const port = '55464';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MIGRATION = path.join(root, 'supabase/migrations/20261008120000_app064_habit_semantics.sql');
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
const COLUMNS = 'id,title,direction,target_per_week,logs,start_date,schedule_history';
const row = (user, id) => JSON.parse(sql(`select row_to_json(t) from (select ${COLUMNS}
  from public.habits where user_id='${user}' and id=${quote(id)}) t`));
const canonical = (habit) => ({ start_date: habit.start_date, schedule_history: habit.schedule_history });
const HISTORY = [{ effectiveFrom: '2026-09-01', schedule: { kind: 'weekdays', days: [1, 3, 5] } }];
const insert = (user, id, c = {}) => `insert into public.habits
  (id,user_id,title,direction,target_per_week,logs,start_date,schedule_history)
  values (${quote(id)},${quote(user)},'T','build',${c.target_per_week ?? 'null'},${quote(JSON.stringify(c.logs ?? []))}::jsonb,
    ${quote(c.start_date)},${c.schedule_history === undefined ? 'null' : `${quote(JSON.stringify(c.schedule_history))}::jsonb`});`;
const snapshot = () => sql(`select
  (select string_agg(policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,''), '|' order by policyname)
     from pg_policies where tablename='habits'),
  (select string_agg(grantee||':'||privilege_type, '|' order by grantee, privilege_type)
     from information_schema.table_privileges where table_name='habits')`);

/** What an older client sends: only the historical columns, exactly as PostgREST builds the merge. */
const oldClientUpsert = (user, id, fields = {}) => `${auth(user)}
  insert into public.habits (id,user_id,title,direction,target_per_week,logs,created_at)
  values (${quote(id)},${quote(user)},${quote(fields.title ?? 'Old client habit')},${quote(fields.direction ?? 'build')},
    ${fields.target ?? 'null'},${quote(JSON.stringify(fields.logs ?? []))}::jsonb,${quote(fields.created_at ?? '2026-09-01T10:00:00Z')})
  on conflict (user_id,id) do update set id=excluded.id, user_id=excluded.user_id, title=excluded.title,
    direction=excluded.direction, target_per_week=excluded.target_per_week, logs=excluded.logs, created_at=excluded.created_at;`;

/**
 * An independent statement of the approved rule, not derived from the SQL under test.
 * `history === undefined` is an SQL NULL; a JSON `null` is a real value and is not a legacy row.
 */
function oracle(startDate, history) {
  const startNull = startDate === null;
  const historyNull = history === undefined;
  if (startNull && historyNull) return true; // legacy
  if (startNull || historyNull) return false; // exactly one of the two
  if (!Array.isArray(history) || history.length < 1) return false;
  const first = history[0];
  return typeof first === 'object' && first !== null && !Array.isArray(first) && first.effectiveFrom === startDate;
}

function baselineStatements() {
  const text = fs.readFileSync(path.join(root, 'supabase/migrations/20260902112000_remote_schema.sql'), 'utf8');
  return text.split(/;\s*\n/).filter((statement) => statement.includes('"public"."habits"')).map((s) => `${s};`);
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
  sql(`insert into public.habits (id,user_id,title,direction,target_per_week,logs,created_at) values
    ('old-weekly','${A}','Old weekly','build',3,'[{"id":"l1","date":"2026-09-02"}]','2026-09-01T10:00:00Z'),
    ('old-open','${A}','Old open','quit',null,'[]','2026-09-02T10:00:00Z'),
    ('old-b','${B}','Other user old','build',null,'[]','2026-09-03T10:00:00Z');`);
  beforeSnapshot = snapshot();
  sql(fs.readFileSync(MIGRATION, 'utf8'));
});

after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('ADDITIVE: two nullable columns, legacy rows untouched, policies and grants unchanged, logs and target_per_week kept', () => {
  assert.equal(sql(`select string_agg(column_name||':'||data_type||':'||is_nullable, ',' order by column_name)
    from information_schema.columns where table_name='habits' and column_name in ('start_date','schedule_history')`),
  'schedule_history:jsonb:YES,start_date:date:YES');
  assert.equal(sql(`select data_type||':'||is_nullable from information_schema.columns where table_name='habits' and column_name='logs'`), 'jsonb:NO');
  assert.equal(sql(`select data_type||':'||is_nullable from information_schema.columns where table_name='habits' and column_name='target_per_week'`), 'integer:YES');
  const legacy = row(A, 'old-weekly');
  assert.deepEqual(canonical(legacy), { start_date: null, schedule_history: null });
  assert.equal(legacy.title, 'Old weekly');
  assert.equal(legacy.target_per_week, 3);
  assert.deepEqual(legacy.logs, [{ id: 'l1', date: '2026-09-02' }]);
  assert.equal(sql('select count(*) from public.habits'), '3');
  assert.equal(snapshot(), beforeSnapshot, 'the migration changed no RLS policy and no grant');
  assert.equal(sql(`select count(*) from information_schema.columns where table_name='habits' and data_type in ('real','double precision','numeric')`), '0', 'no float or numeric column');
  assert.equal(sql(`select count(*) from information_schema.tables where table_schema='public'`), '1', 'no new table: habits is the only one');
});

test('IDEMPOTENT: the migration can be applied again without error or data change', () => {
  sql(fs.readFileSync(MIGRATION, 'utf8'));
  assert.equal(sql('select count(*) from public.habits'), '3');
  assert.equal(snapshot(), beforeSnapshot);
});

test('SHAPES: the legacy all-NULL shape and canonical shapes are accepted', () => {
  sql(insert(A, 'legacy'));
  sql(insert(A, 'one-period', { start_date: '2026-09-01', schedule_history: HISTORY }));
  sql(insert(A, 'weekly', { start_date: '2026-09-01', target_per_week: 3, schedule_history: [{ effectiveFrom: '2026-09-01', schedule: { kind: 'weekly', target: 3 } }] }));
  sql(insert(A, 'multi', { start_date: '2026-09-01', schedule_history: [
    { effectiveFrom: '2026-09-01', schedule: { kind: 'open' } }, { effectiveFrom: '2026-10-12', schedule: { kind: 'weekly', target: 2 } }] }));
  sql(insert(A, 'with-logs', { start_date: '2026-09-01', schedule_history: HISTORY, logs: [{ id: 'a', date: '2026-09-02' }, { id: 'f', date: '2099-01-01' }] }));
  assert.deepEqual(canonical(row(A, 'legacy')), { start_date: null, schedule_history: null });
  assert.deepEqual(canonical(row(A, 'one-period')), { start_date: '2026-09-01', schedule_history: HISTORY });
  assert.equal(row(A, 'multi').schedule_history.length, 2);
});

test('EXHAUSTIVE: every NULL / present combination of the two columns matches an independent oracle', () => {
  const startDates = [null, '2026-09-01', '2026-09-02'];
  const first = (effectiveFrom) => ({ effectiveFrom, schedule: { kind: 'open' } });
  const histories = [
    undefined, null, [], {}, 'x', 1, true, [1], ['x'], [null], [[]], [{}],
    [{ effectiveFrom: null }], [{ effectiveFrom: 5 }], [{ effectiveFrom: '2026-09-01T00:00:00Z' }], [{ effectiveFrom: '2026-9-1' }],
    [first('2026-09-01')], [first('2026-09-02')], [first('2026-08-31')],
    [first('2026-09-01'), first('2026-09-05')], [first('2026-09-02'), first('2026-09-01')], [first('2026-09-05'), first('2026-09-01')],
    [{ schedule: { kind: 'open' } }],
  ];
  const mirrors = [null, 0, 3, -1, 99];
  const list = (values, cast) => `array[${values.map((v) => (v === null || v === undefined ? 'null' : quote(v))).join(',')}]${cast}`;
  const jsonText = histories.map((h) => (h === undefined ? null : JSON.stringify(h)));
  const output = sql(`
    create temp table probe(accepted boolean, combo text);
    do $$
    declare sd date; h text; m integer; n int := 0; key text;
    begin
      foreach sd in array ${list(startDates, '::date[]')} loop
      foreach h in array ${list(jsonText, '::text[]')} loop
      foreach m in array array[null,0,3,-1,99]::integer[] loop
        n := n + 1;
        key := coalesce(sd::text,'~')||'#'||coalesce(h,'~')||'#'||coalesce(m::text,'~');
        begin
          insert into public.habits (id,user_id,title,direction,target_per_week,logs,start_date,schedule_history)
          values ('probe-'||n,'${A}','T','build',m,'[]'::jsonb,sd,h::jsonb);
          insert into probe values (true, key);
        exception when check_violation then
          insert into probe values (false, key);
        end;
      end loop; end loop; end loop;
    end $$;
    delete from public.habits where id like 'probe-%';
    select accepted::text||'|'||combo from probe order by combo;`);
  const actual = new Map(output.split('\n').map((line) => { const [accepted, combo] = line.split('|'); return [combo, accepted === 'true']; }));
  const total = startDates.length * histories.length * mirrors.length;
  assert.equal(actual.size, total);
  let accepted = 0;
  startDates.forEach((startDate) => histories.forEach((history, i) => mirrors.forEach((mirror) => {
    const key = `${startDate ?? '~'}#${jsonText[i] ?? '~'}#${mirror ?? '~'}`;
    const expected = oracle(startDate, history);
    assert.equal(actual.get(key), expected, `start_date=${startDate} history=${jsonText[i]} mirror=${mirror} should be ${expected ? 'accepted' : 'refused'}`);
    if (expected) accepted += 1;
  })));
  // Both outcomes must really occur, or the comparison proves nothing. Per mirror value: 1 legacy row,
  // 2 histories beginning on 2026-09-01 (with start 2026-09-01) and 2 beginning on 2026-09-02 (with start 2026-09-02).
  assert.equal(accepted, (1 + 2 + 2) * mirrors.length, `accepted ${accepted} of ${total}`);
});

test('UPDATES: an UPDATE cannot create an illegal mixed state either', () => {
  assert.match(errorFor(`update public.habits set start_date=null where user_id='${A}' and id='one-period'`), /habits_semantics_check/);
  assert.match(errorFor(`update public.habits set schedule_history=null where user_id='${A}' and id='one-period'`), /habits_semantics_check/);
  assert.match(errorFor(`update public.habits set schedule_history='[]'::jsonb where user_id='${A}' and id='one-period'`), /habits_semantics_check/);
  assert.match(errorFor(`update public.habits set start_date='2026-09-02' where user_id='${A}' and id='one-period'`), /habits_semantics_check/);
  assert.match(errorFor(`update public.habits set start_date='2026-09-01' where user_id='${A}' and id='legacy'`), /habits_semantics_check/);
  assert.match(errorFor(`update public.habits set schedule_history='{}'::jsonb where user_id='${A}' and id='one-period'`), /habits_semantics_check/);
  assert.deepEqual(canonical(row(A, 'one-period')), { start_date: '2026-09-01', schedule_history: HISTORY });
  // Legal edits still work: the title, the entries and the compatibility mirror are unconstrained.
  sql(`update public.habits set title='Renamed', target_per_week=5, logs='[{"id":"z","date":"2026-09-03"}]'::jsonb where user_id='${A}' and id='one-period'`);
  assert.equal(row(A, 'one-period').title, 'Renamed');
  assert.deepEqual(canonical(row(A, 'one-period')), { start_date: '2026-09-01', schedule_history: HISTORY });
});

test('OLD CLIENT: an upsert that lists only the historical columns never clears the canonical columns', () => {
  for (const id of ['one-period', 'weekly', 'multi', 'with-logs']) {
    const before = row(A, id);
    sql(oldClientUpsert(A, id, { title: `Edited by an old client: ${id}`, target: 4, logs: [{ id: 'old', date: '2026-09-04' }] }));
    const after = row(A, id);
    assert.deepEqual(canonical(after), canonical(before), `${id}: canonical columns survive`);
    assert.equal(after.title, `Edited by an old client: ${id}`);
    assert.deepEqual(after.logs, [{ id: 'old', date: '2026-09-04' }]);
  }
});

test('OLD CLIENT: a row it creates has both canonical columns NULL and is valid (a permanent legacy habit)', () => {
  sql(oldClientUpsert(A, 'created-by-old', { title: 'Old client habit', target: 2, logs: [{ id: 'a', date: '2026-09-02' }] }));
  assert.deepEqual(canonical(row(A, 'created-by-old')), { start_date: null, schedule_history: null });
  assert.equal(row(A, 'created-by-old').target_per_week, 2);
  // A later old-client edit of that same row keeps it legacy.
  sql(oldClientUpsert(A, 'created-by-old', { title: 'Renamed', target: 3 }));
  assert.deepEqual(canonical(row(A, 'created-by-old')), { start_date: null, schedule_history: null });
});

test('OLD CLIENT: its log toggle on a canonical row stays understandable, and the history is not touched', () => {
  sql(insert(A, 'toggle', { start_date: '2026-09-01', schedule_history: HISTORY, logs: [{ id: 'a', date: '2026-09-02' }] }));
  const before = row(A, 'toggle');
  // Marks a day: appends { id, date } to logs, exactly as the old client's toggle did.
  sql(oldClientUpsert(A, 'toggle', { title: 'T', logs: [...before.logs, { id: '1757000000000-123456', date: '2026-09-03' }] }));
  assert.deepEqual(row(A, 'toggle').logs, [{ id: 'a', date: '2026-09-02' }, { id: '1757000000000-123456', date: '2026-09-03' }]);
  // Clears a day: removes the entry for that date.
  sql(oldClientUpsert(A, 'toggle', { title: 'T', logs: [{ id: 'a', date: '2026-09-02' }] }));
  assert.deepEqual(row(A, 'toggle').logs, [{ id: 'a', date: '2026-09-02' }]);
  assert.deepEqual(canonical(row(A, 'toggle')), canonical(before));
});

test('OLD CLIENT PRE-START: an entry on the UTC creation date, one day before the local start_date, is accepted and leaves the canonical columns intact', () => {
  // The exact row a current client in Copenhagen leaves after an older client marks the day its UI enables.
  // Shared with the Jest tests (habitRow, habitStore), which prove the current client keeps this habit visible.
  const expected = JSON.parse(fs.readFileSync(path.join(root, '__tests__/fixtures/habits/old-client-pre-start-row.json'), 'utf8'));
  // Current client, 00:30 on 1 October in Copenhagen (UTC+2): created_at is still 30 September UTC, start_date is the local day.
  sql(`${auth(A)}
    insert into public.habits (id,user_id,title,direction,target_per_week,logs,created_at,start_date,schedule_history)
    values (${quote(expected.id)},'${A}',${quote(expected.title)},'build',null,'[]'::jsonb,'2026-09-30T22:30:00Z','2026-10-01',
      ${quote(JSON.stringify(expected.schedule_history))}::jsonb)
    on conflict (user_id,id) do nothing;`);
  const select = () => JSON.parse(sql(`set timezone='UTC'; select row_to_json(t) from (select id,title,direction,target_per_week,logs,created_at,start_date,schedule_history
    from public.habits where user_id='${A}' and id=${quote(expected.id)}) t`));
  const written = select();
  // What the older client computes as its earliest enabled day: createdAt.slice(0, 10) of the value it fetched.
  const olderClientFirstDay = written.created_at.slice(0, 10);
  assert.equal(olderClientFirstDay, '2026-09-30');
  assert.ok(olderClientFirstDay < written.start_date, 'the older client\'s legal range starts BEFORE the canonical start_date');
  // It marks that day; its upsert lists only the historical columns.
  sql(oldClientUpsert(A, expected.id, { title: expected.title, created_at: written.created_at, logs: [{ id: '1757000000000-123456', date: olderClientFirstDay }] }));
  // The database accepts it (logs is free-form) and the canonical columns survive, so the row is exactly the shared fixture.
  assert.deepEqual(select(), expected);
  // The same holds for every other day inside that range, up to a day after the start.
  for (const day of ['2026-09-30', '2026-10-01', '2026-10-02']) {
    sql(oldClientUpsert(A, expected.id, { title: expected.title, created_at: written.created_at, logs: [{ id: 'x', date: day }] }));
    assert.deepEqual(canonical(select()), { start_date: '2026-10-01', schedule_history: expected.schedule_history });
  }
});

test('OLD CLIENT: editing the target does not mutate schedule_history; a direction edit is allowed and documented', () => {
  sql(insert(A, 'target-edit', { start_date: '2026-09-01', schedule_history: HISTORY, logs: [{ id: 'a', date: '2026-09-02' }] }));
  const before = row(A, 'target-edit');
  sql(oldClientUpsert(A, 'target-edit', { title: 'T', target: 6, logs: before.logs }));
  assert.equal(row(A, 'target-edit').target_per_week, 6);
  assert.deepEqual(canonical(row(A, 'target-edit')), canonical(before), 'the mirror moved; the schedule did not');
  // Known limitation: nothing on the server stops an older client flipping direction on a habit that has entries.
  // Current clients refuse that (habit_direction_locked) and read entries as "kept" in both directions.
  sql(oldClientUpsert(A, 'target-edit', { title: 'T', direction: 'quit', target: 6, logs: before.logs }));
  assert.equal(row(A, 'target-edit').direction, 'quit');
  assert.deepEqual(canonical(row(A, 'target-edit')), canonical(before));
});

test('NEW CLIENT: a full upsert converts a legacy row to canonical state; a later old-client edit does not move it', () => {
  sql(`${auth(A)}
    insert into public.habits (id,user_id,title,direction,target_per_week,logs,created_at,start_date,schedule_history)
    values ('old-weekly','${A}','Old weekly','build',3,'[{"id":"l1","date":"2026-09-02"}]','2026-09-01T10:00:00Z','2026-09-01',
      '[{"effectiveFrom":"2026-09-01","schedule":{"kind":"weekly","target":3}}]'::jsonb)
    on conflict (user_id,id) do update set title=excluded.title, direction=excluded.direction, target_per_week=excluded.target_per_week,
      logs=excluded.logs, created_at=excluded.created_at, start_date=excluded.start_date, schedule_history=excluded.schedule_history;`);
  const converted = row(A, 'old-weekly');
  assert.equal(converted.start_date, '2026-09-01');
  sql(oldClientUpsert(A, 'old-weekly', { title: 'Old weekly', target: 5, logs: [] }));
  assert.deepEqual(canonical(row(A, 'old-weekly')), canonical(converted));
});

test('RLS: an owner reads and writes only their own rows', () => {
  assert.notEqual(sql(`${auth(A)} select count(*) from public.habits`), '0');
  assert.equal(sql(`${auth(A)} select count(*) from public.habits where user_id='${B}'`), '0');
  assert.equal(sql(`${auth(B)} select count(*) from public.habits where user_id='${A}'`), '0');
  assert.equal(sql(`${auth(B)} select count(*) from public.habits`), '1');
  sql(`${auth(A)} ${insert(A, 'owner-write', { start_date: '2026-09-01', schedule_history: HISTORY })}`);
  assert.deepEqual(canonical(row(A, 'owner-write')), { start_date: '2026-09-01', schedule_history: HISTORY });
});

test('RLS: another user cannot read, change, delete or insert into the owner\'s habits', () => {
  assert.equal(sql(`${auth(B)} update public.habits set title='hijacked', start_date=null, schedule_history=null where user_id='${A}' returning id`), '');
  assert.equal(sql(`${auth(B)} delete from public.habits where user_id='${A}' returning id`), '');
  assert.match(errorFor(`${auth(B)} ${insert(A, 'forged', { start_date: '2026-09-01', schedule_history: HISTORY })}`), /row-level security/);
  assert.deepEqual(canonical(row(A, 'one-period')), { start_date: '2026-09-01', schedule_history: HISTORY });
  assert.equal(sql("select count(*) from public.habits where id='forged'"), '0');
});

test('RLS: anon sees nothing and cannot write', () => {
  assert.equal(sql(`${auth(null, 'anon')} select count(*) from public.habits`), '0');
  assert.match(errorFor(`${auth(null, 'anon')} ${insert(A, 'anon-write')}`), /row-level security/);
  assert.equal(sql(`${auth(null, 'anon')} update public.habits set title='x' returning id`), '');
  assert.equal(sql(`${auth(null, 'anon')} delete from public.habits returning id`), '');
});

test('RLS: an owner cannot move a habit to another user, and no write path was revoked', () => {
  assert.match(errorFor(`${auth(A)} update public.habits set user_id='${B}' where id='owner-write'`), /row-level security/);
  assert.equal(row(A, 'owner-write').id, 'owner-write');
  assert.equal(snapshot(), beforeSnapshot, 'policies and grants are exactly as before the migration');
});

test('ACCOUNT DELETION: habits, with their schedule history, cascade away', () => {
  assert.notEqual(sql(`select count(*) from public.habits where user_id='${A}'`), '0');
  sql(`delete from auth.users where id='${A}'`);
  assert.equal(sql(`select count(*) from public.habits where user_id='${A}'`), '0');
  assert.equal(sql(`select count(*) from public.habits where user_id='${B}'`), '1');
});
