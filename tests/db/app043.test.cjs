// APP-043 migration check: savings goal integrity (positive target, non-negative
// balance, history → same-account goal) added NOT VALID over the historical schema.
// Uses the established scratch-Postgres workflow (docs/migration-verification.md).
// No .env, Supabase CLI, remote URL, project link, existing database or reset is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const bin = process.env.APP043_PG_BIN || path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app043-'));
const cluster = path.join(scratch, 'db');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MIGRATION = 'supabase/migrations/20260918120000_savings_goal_integrity.sql';
const CONSTRAINTS = ['savings_goals_target_amount_positive', 'savings_goals_saved_amount_non_negative', 'savings_history_goal_fkey'];
const psqlArgs = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', '55432', '-U', 'postgres', '-d', 'postgres'];
function sql(source) {
  return execFileSync(path.join(bin, 'psql'), psqlArgs, { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
/** Asserts the statement is rejected with this SQLSTATE; returns nothing else about it. */
function fails(source, sqlstate) {
  try { sql('\\set VERBOSITY sqlstate\n' + source); } catch (error) {
    assert.match(String(error.stderr), new RegExp(sqlstate));
    return;
  }
  assert.fail('statement unexpectedly succeeded');
}
const quote = (value) => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
/**
 * A statement run as an account, the way PostgREST runs it. An anonymous request
 * carries no subject: an empty claim, which auth.uid() reads as NULL.
 */
const as =(user, source, role = 'authenticated') => `set role ${role}; set request.jwt.claim.sub = ${quote(user ?? '')};\n${source}`;
const migrate = () => sql(fs.readFileSync(path.join(root, MIGRATION), 'utf8'));

/** What the app sends for a goal: an upsert of decimal text built with json_populate_recordset. */
function upsertGoal(user, id, { target = '1000.00', saved = '0.00', name = 'Synthetic', deadline = null } = {}) {
  const row = { id, user_id: user, name, icon: 'other', target_amount: target, saved_amount: saved, deadline, archived: false, created_at: '2026-09-18T10:00:00Z' };
  const columns = Object.keys(row).map((column) => `"${column}"`).join(',');
  return `insert into public.savings_goals (${columns})
    select ${columns} from json_populate_recordset(null::public.savings_goals, $json$${JSON.stringify([row])}$json$)
    on conflict (user_id, id) do update set name = excluded.name, icon = excluded.icon,
      target_amount = excluded.target_amount, saved_amount = excluded.saved_amount,
      deadline = excluded.deadline, archived = excluded.archived;`;
}
function insertHistory(user, id, goalId, amount = '10.00') {
  const row = { id, user_id: user, goal_id: goalId, amount, date: '2026-09-18T10:00:00Z' };
  const columns = Object.keys(row).map((column) => `"${column}"`).join(',');
  return `insert into public.savings_history (${columns})
    select ${columns} from json_populate_recordset(null::public.savings_history, $json$${JSON.stringify([row])}$json$);`;
}
/** Every row of both tables, as one comparable text. */
const contents = () => sql(`select
  (select coalesce(string_agg(t::text, '|' order by t.user_id, t.id), '') from public.savings_goals t) || ' || ' ||
  (select coalesce(string_agg(t::text, '|' order by t.user_id, t.id), '') from public.savings_history t)`);
const ids = (table, user) => sql(`select coalesce(string_agg(id, ',' order by id), '') from public.${table} where user_id = ${quote(user)}`);
const constraintState = () => sql(`select string_agg(conname || ':' || convalidated, ',' order by conname)
  from pg_constraint where conname = any (array[${CONSTRAINTS.map(quote).join(',')}])`);
const policies = () => sql(`select string_agg(tablename || ':' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), E'\\n' order by tablename, policyname)
  from pg_policies where schemaname = 'public' and tablename in ('savings_goals', 'savings_history')`);

/** The read-only production audit documented in docs/app-043-savings-goals.md. */
const AUDIT = {
  target: `select count(*) from public.savings_goals where not (target_amount > 0 and target_amount < 'Infinity'::numeric)`,
  saved: `select count(*) from public.savings_goals where not (saved_amount >= 0 and saved_amount < 'Infinity'::numeric)`,
  orphans: `select count(*) from public.savings_history h where not exists
    (select 1 from public.savings_goals g where g.user_id = h.user_id and g.id = h.goal_id)`,
};

let started = false;
let historical;
let historicalPolicies;
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
    insert into auth.users values (${quote(A)}), (${quote(B)});`);

  // The historical definitions, unmodified: tables, user foreign keys, RLS and policies.
  const schema = fs.readFileSync(path.join(root, 'supabase/migrations/20260902112000_remote_schema.sql'), 'utf8');
  for (const table of ['savings_goals', 'savings_history']) {
    const pieces = [
      schema.match(new RegExp(`CREATE TABLE "public"\\."${table}" \\([\\s\\S]*?\\n\\);`)),
      schema.match(new RegExp(`ALTER TABLE "public"\\."${table}"\\n  ENABLE ROW LEVEL SECURITY;`)),
      schema.match(new RegExp(`ALTER TABLE "public"\\."${table}"\\n  ADD CONSTRAINT "${table}_user_id_fkey"[^;]*;`)),
    ];
    for (const piece of pieces) assert.ok(piece, `remote schema defines ${table}`);
    sql(pieces.map((piece) => piece[0]).join('\n'));
    const tablePolicies = [...schema.matchAll(new RegExp(`CREATE POLICY "[^"]+" ON "public"\\."${table}"[^;]*;`, 'g'))];
    assert.ok(tablePolicies.length >= 3, `remote schema defines policies for ${table}`);
    sql(tablePolicies.map((match) => match[0]).join('\n'));
  }
  // The snapshot's legacy table grants are broader still (including PG17's MAINTAIN,
  // which the CI's PostgreSQL 16 lacks); the DML subset is what these checks exercise.
  sql(`grant select, insert, update, delete on public.savings_goals, public.savings_history to anon, authenticated;`);

  // Rows written before APP-043.
  sql([
    // Legitimate data: a goal with a deadline, an overfunded goal, signed history.
    upsertGoal(A, 'trip', { target: '1000.00', saved: '250.50', deadline: '2027-06-01' }),
    upsertGoal(A, 'reached', { target: '100.00', saved: '150.00' }),
    insertHistory(A, 'a-h1', 'trip', '300.00'),
    insertHistory(A, 'a-h2', 'trip', '-49.50'),
    insertHistory(A, 'a-h3', 'reached', '150.00'),
    // A legitimate orphan: the goal was deleted, the second (history) delete failed.
    insertHistory(A, 'a-orphan', 'deleted-goal', '20.00'),
    // Account B reuses the text ID 'trip' for its own goal.
    upsertGoal(B, 'trip', { target: '10.00', saved: '10.00' }),
    upsertGoal(B, 'b-only', { target: '10.00', saved: '0.00' }),
    insertHistory(B, 'b-h1', 'trip', '10.00'),
    // Rows no shipped client could write, but that the repository cannot rule out.
    upsertGoal(B, 'legacy-zero-target', { target: '0.00', saved: '0.00' }),
    upsertGoal(B, 'legacy-negative', { target: '50.00', saved: '-1.00' }),
  ].join('\n'));
  historical = contents();
  historicalPolicies = policies();
});
after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
  console.log(`Scratch cluster ${started ? 'stopped' : 'not started'}; local test evidence retained at ${scratch}`);
});

test('the historical schema has none of the APP-043 constraints, so the migration is required', () => {
  assert.equal(constraintState(), '');
  assert.equal(sql(AUDIT.orphans), '1');
});

test('the migration applies over existing data without rewriting, repairing or rejecting any row', () => {
  migrate();
  assert.equal(contents(), historical);
  // Enforced for new writes, not yet validated against history.
  assert.equal(constraintState(), CONSTRAINTS.slice().sort().map((name) => `${name}:false`).join(','));
  assert.equal(sql(`select count(*) from pg_indexes where schemaname = 'public'
    and tablename = 'savings_history' and indexname = 'savings_history_user_id_goal_id_idx'`), '1');
});

test('RLS and policies are unchanged by the migration', () => {
  assert.equal(policies(), historicalPolicies);
  assert.equal(sql(`select string_agg(relname || ':' || relrowsecurity, ',' order by relname) from pg_class
    where relname in ('savings_goals', 'savings_history')`), 'savings_goals:true,savings_history:true');
  // Each account still sees only its own rows; anon sees nothing and writes nothing.
  assert.equal(sql(as(A, `select count(*) from public.savings_goals;`)), '2');
  assert.equal(sql(as(B, `select count(*) from public.savings_history;`)), '1');
  assert.equal(sql(as(null, `select count(*) from public.savings_goals;`, 'anon')), '0');
  fails(as(null, upsertGoal(A, 'anon-goal'), 'anon'), '42501');
  fails(as(A, upsertGoal(B, 'foreign-goal')), '42501');
});

test('targets: positive amounts are accepted; zero, negative, NaN and Infinity are refused on insert and update', () => {
  sql(as(A, upsertGoal(A, 'new-goal', { target: '1500.00' })));
  sql(as(A, upsertGoal(A, 'tiny-goal', { target: '0.01' })));
  for (const target of ['0.00', '-0.01', '-100.00', 'NaN', 'Infinity']) {
    fails(as(A, upsertGoal(A, `bad-target-${target}`, { target })), '23514');
    fails(as(A, upsertGoal(A, 'new-goal', { target })), '23514');
  }
  fails(as(A, `update public.savings_goals set target_amount = 0 where id = 'new-goal';`), '23514');
  assert.equal(sql(`select target_amount from public.savings_goals where user_id = ${quote(A)} and id = 'new-goal'`), '1500.00');
  assert.equal(sql(`select count(*) from public.savings_goals where id like 'bad-target-%'`), '0');
});

test('balances: zero and overfunded are accepted; negative, NaN and Infinity are refused', () => {
  sql(as(A, upsertGoal(A, 'new-goal', { target: '1500.00', saved: '0.00' })));
  sql(as(A, upsertGoal(A, 'new-goal', { target: '1500.00', saved: '2000.00' })));
  for (const saved of ['-0.01', '-50.00', 'NaN', 'Infinity']) {
    fails(as(A, upsertGoal(A, 'new-goal', { target: '1500.00', saved })), '23514');
  }
  fails(as(A, `update public.savings_goals set saved_amount = saved_amount - 2000.01 where id = 'new-goal';`), '23514');
  assert.equal(sql(`select saved_amount from public.savings_goals where user_id = ${quote(A)} and id = 'new-goal'`), '2000.00');
});

test('history: a row for an own existing goal is accepted; an orphan is refused', () => {
  sql(as(A, insertHistory(A, 'a-h4', 'new-goal', '25.00')));
  fails(as(A, insertHistory(A, 'a-orphan-2', 'never-existed', '25.00')), '23503');
  assert.equal(sql(`select count(*) from public.savings_history where id = 'a-orphan-2'`), '0');
});

test('history cannot link across accounts, and the error is the same as for a goal that does not exist', () => {
  // B owns 'b-only'. For A it is exactly as absent as an ID nobody has.
  fails(as(A, insertHistory(A, 'cross-1', 'b-only')), '23503');
  fails(as(A, insertHistory(A, 'cross-2', 'nobody-has-this')), '23503');
  // Writing under B's user_id is still stopped by RLS, before the key is considered.
  fails(as(A, insertHistory(B, 'cross-3', 'b-only')), '42501');
  // A's 'trip' history links to A's 'trip' only, never to B's goal with the same text ID.
  assert.equal(sql(`select string_agg(g.user_id::text || '/' || h.id, ',' order by h.id) from public.savings_history h
    join public.savings_goals g on g.user_id = h.user_id and g.id = h.goal_id where h.goal_id = 'trip'`),
    `${A}/a-h1,${A}/a-h2,${B}/b-h1`);
});

test('deleting a goal deletes its own history in the same statement, and nothing of another account', () => {
  const bBefore = ids('savings_history', B);
  sql(as(A, `delete from public.savings_goals where id = 'trip';`));
  assert.equal(ids('savings_history', A), 'a-h3,a-h4,a-orphan');
  assert.equal(ids('savings_history', B), bBefore);
  assert.equal(ids('savings_goals', B), 'b-only,legacy-negative,legacy-zero-target,trip');
  // The app's own second request (history by goal_id) is now a harmless no-op.
  assert.equal(sql(as(A, `with gone as (delete from public.savings_history where user_id = ${quote(A)} and goal_id = 'trip' returning 1) select count(*) from gone;`)), '0');
  // Deleting another account's goal affects nothing.
  assert.equal(sql(as(A, `with gone as (delete from public.savings_goals where user_id = ${quote(B)} returning 1) select count(*) from gone;`)), '0');
  assert.equal(ids('savings_history', B), bBefore);
});

test('existing orphans are preserved, and the app can still delete them by goal_id', () => {
  assert.equal(sql(`select amount from public.savings_history where id = 'a-orphan'`), '20.00');
  sql(as(A, `delete from public.savings_history where user_id = ${quote(A)} and goal_id = 'deleted-goal';`));
  assert.equal(sql(`select count(*) from public.savings_history where id = 'a-orphan'`), '0');
});

test('documented NOT VALID behaviour: a pre-existing violating row keeps its value but must be corrected before it can change', () => {
  assert.equal(sql(`select saved_amount from public.savings_goals where id = 'legacy-negative'`), '-1.00');
  fails(`update public.savings_goals set name = 'Renamed' where id = 'legacy-negative';`, '23514');
  sql(`update public.savings_goals set saved_amount = 0.00 where id = 'legacy-negative';`);
  assert.equal(sql(`select saved_amount from public.savings_goals where id = 'legacy-negative'`), '0.00');
});

test('account deletion still cascades through both the goal key and the account key', () => {
  sql(`insert into auth.users values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');`);
  const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  sql(as(C, upsertGoal(C, 'c-goal') + insertHistory(C, 'c-h1', 'c-goal')));
  sql(`delete from auth.users where id = ${quote(C)};`);
  assert.equal(sql(`select count(*) from public.savings_goals where user_id = ${quote(C)}`), '0');
  assert.equal(sql(`select count(*) from public.savings_history where user_id = ${quote(C)}`), '0');
});

test('re-running the migration is idempotent: same rows, one of each constraint and index, still NOT VALID', () => {
  const before = contents();
  migrate();
  assert.equal(contents(), before);
  assert.equal(constraintState(), CONSTRAINTS.slice().sort().map((name) => `${name}:false`).join(','));
  assert.equal(sql(`select count(*) from pg_constraint where conname = any (array[${CONSTRAINTS.map(quote).join(',')}])`), '3');
  assert.equal(sql(`select count(*) from pg_indexes where indexname = 'savings_history_user_id_goal_id_idx'`), '1');
  assert.equal(policies(), historicalPolicies);
});

// Last: this changes constraint state in the scratch cluster.
test('the documented audit finds the violating rows, and VALIDATE succeeds only once none remain', () => {
  // A pre-existing orphan like a-orphan (removed above): replica mode skips the
  // referential triggers for this one session, as if the row predated the key.
  sql(`set session_replication_role = replica;
    insert into public.savings_history (id, user_id, goal_id, amount, date)
    values ('late-orphan', ${quote(A)}, 'gone', 1.00, now());`);
  assert.equal(sql(AUDIT.target), '1'); // legacy-zero-target
  assert.equal(sql(AUDIT.saved), '0'); // legacy-negative was corrected above
  assert.equal(sql(AUDIT.orphans), '1'); // late-orphan
  fails(`alter table public.savings_goals validate constraint savings_goals_target_amount_positive;`, '23514');
  fails(`alter table public.savings_history validate constraint savings_history_goal_fkey;`, '23503');

  // Only in this scratch cluster: remove the synthetic violations, then validate.
  sql(`delete from public.savings_goals where id = 'legacy-zero-target';
    delete from public.savings_history where id = 'late-orphan';`);
  for (const query of Object.values(AUDIT)) assert.equal(sql(query), '0');
  sql(`alter table public.savings_goals validate constraint savings_goals_target_amount_positive;
    alter table public.savings_goals validate constraint savings_goals_saved_amount_non_negative;
    alter table public.savings_history validate constraint savings_history_goal_fkey;`);
  assert.equal(constraintState(), CONSTRAINTS.slice().sort().map((name) => `${name}:true`).join(','));
});
