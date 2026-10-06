// APP-059 server boundary against a disposable local Postgres cluster. The
// migration under test is applied verbatim; no remote Supabase environment is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bin = path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app059-'));
const cluster = path.join(scratch, 'db');
const port = '55459';
const OWNER = '10000000-0000-4000-8000-000000000001';
const BOB = '10000000-0000-4000-8000-000000000002';
const CAROL = '10000000-0000-4000-8000-000000000003';
const DAVE = '10000000-0000-4000-8000-000000000004';
const TRIP = 'trip-shared';
let started = false;

const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', port, '-U', 'postgres', '-d', 'postgres'];
function sql(source) {
  return execFileSync(path.join(bin, 'psql'), args, { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function errorFor(source) {
  try { sql(source); } catch (error) { return String(error.stderr); }
  assert.fail('SQL unexpectedly succeeded');
}
const claims = (userId) => JSON.stringify({ sub: userId, role: 'authenticated' }).replace(/'/g, "''");
const as = (userId, source) => sql(`set role authenticated; set request.jwt.claim.sub='${userId}';
  set request.jwt.claims='${claims(userId)}'; ${source}`);
const projection = (userId, tripId = TRIP) => JSON.parse(as(userId,
  `select coalesce(json_agg(p order by p.expense_id), '[]') from public.trip_financial_projection('${tripId}') p`));
const linkCall = ({ trip = TRIP, expected = OWNER, id, amount = '10.00', date = '2026-07-03', legacy = null, category = 'food' }) =>
  `select public.link_trip_economy_expense(
    '${trip}', '${expected}'::uuid, '${id}', 'Synthetic', ${amount}, '${category}', ${date === null ? 'null' : `'${date}'::date`},
    ${legacy === null ? 'null' : `'${legacy}'`}, null, null, null)`;
const link = (userId, options) => as(userId, linkCall({ ...options, expected: userId }));
const economyCount = (userId, id) => Number(sql(`select count(*) from public.expenses where user_id='${userId}' and id='${id}'`));
const linkCount = (userId, id) => Number(sql(`select count(*) from public.trip_expense_links where expense_owner_id='${userId}' and expense_id='${id}'`));

/* ------------------------------------------------ concurrent sessions */

function openSession() {
  const child = spawn(path.join(bin, 'psql'), args, { stdio: ['pipe', 'pipe', 'pipe'] });
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

before(() => {
  execFileSync(path.join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-l', path.join(scratch, 'postgres.log'), '-o', `-k ${scratch} -p ${port} -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  sql(`create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${OWNER}'),('${BOB}'),('${CAROL}'),('${DAVE}');

    create table public.trips(
      id text not null unique, user_id uuid not null references auth.users(id) on delete cascade,
      name text not null, start_date date not null, end_date date not null, budget numeric,
      primary key(user_id,id));
    create table public.expenses(
      id text not null, user_id uuid not null references auth.users(id) on delete cascade,
      series_id text, is_recurring boolean not null default false,
      recurrence_frequency text, recurrence_anchor_day smallint,
      name text not null, amount numeric not null, category text not null,
      next_payment_date date not null, created_at timestamptz not null default now(),
      primary key(user_id,id));
    create table public.trip_expenses(
      id text not null, user_id uuid not null references auth.users(id) on delete cascade,
      trip_id text not null references public.trips(id) on delete cascade,
      name text not null, amount numeric not null, category text not null,
      currency text, original_amount numeric, exchange_rate numeric,
      primary key(user_id,id));
    create table public.trip_packing_items(
      id text not null, user_id uuid not null, trip_id text not null references public.trips(id) on delete cascade,
      label text not null, primary key(user_id,id));
    create table public.trip_participants(
      trip_id text not null, owner_id uuid not null, user_id uuid not null,
      invited_email text not null, status text not null, primary key(trip_id,user_id));
    create table public.trip_document_references(
      user_id uuid not null, trip_id text not null references public.trips(id) on delete cascade,
      document_id uuid not null, primary key(user_id,trip_id,document_id));

    alter table public.expenses enable row level security;
    create policy expenses_owner_select on public.expenses for select to authenticated using(auth.uid()=user_id);
    create policy expenses_owner_delete on public.expenses for delete to authenticated using(auth.uid()=user_id);
    grant usage on schema public to authenticated, anon;
    grant select, delete on public.expenses to authenticated;
    grant select on public.trips, public.trip_participants to authenticated;

    insert into public.trips(id,user_id,name,start_date,end_date,budget) values
      ('${TRIP}','${OWNER}','Shared','2026-07-01','2026-07-08',5000),
      ('trip-other','${DAVE}','Other','2026-08-01','2026-08-02',null),
      ('trip-delete','${OWNER}','Delete','2026-09-01','2026-09-02',null),
      ('trip-expense-delete','${OWNER}','Expense delete','2026-10-01','2026-10-02',null),
      ('trip-invalid-budget','${OWNER}','Legacy budget','2026-11-01','2026-11-02',12.345);
    insert into public.trip_participants values
      ('${TRIP}','${OWNER}','${BOB}','bob@example.test','accepted'),
      ('${TRIP}','${OWNER}','${CAROL}','carol@example.test','pending');
    insert into public.trip_expenses(id,user_id,trip_id,name,amount,category)
      values ('legacy-exp','${OWNER}','${TRIP}','Legacy',12.34,'transport'),
             ('legacy-bob','${BOB}','${TRIP}','Bob legacy',8.00,'food');
    insert into public.expenses(id,user_id,series_id,name,amount,category,next_payment_date)
      values ('private-unlinked','${OWNER}','private-unlinked','Private',99,'other','2026-01-01');`);

  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20261005120000_app059_travel_budget_bridge.sql'), 'utf8'));
});

after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('MONEY/DATE: new writes require an exact supported amount and an explicit date; legacy budget remains', () => {
  assert.equal(sql(`select budget::text from public.trips where id='trip-invalid-budget'`), '12.345');
  assert.match(errorFor(`insert into public.trips values ('bad-budget','${OWNER}','x','2026-01-01','2026-01-02',12.345)`), /trips_budget_supported_money/);
  assert.match(errorFor(asRole(OWNER, `select public.link_trip_economy_expense('${TRIP}','${OWNER}'::uuid,'bad-money','x',12.345,'food','2026-01-01',null,null,null,null)`)), /money_unsupported_amount/);
  assert.match(errorFor(asRole(OWNER, `select public.link_trip_economy_expense('${TRIP}','${OWNER}'::uuid,'no-date','x',10,'food',null,null,null,null,null)`)), /transaction_date_required/);
  assert.equal(link(OWNER, { id: 'dated', date: '2026-07-04' }), 'linked');
  assert.equal(sql(`select next_payment_date::text from public.expenses where user_id='${OWNER}' and id='dated'`), '2026-07-04');
});

test('LEGACY: resolution is atomic, traceable, and removes only the resolved legacy row', () => {
  assert.equal(link(OWNER, { id: 'legacy-exp', legacy: 'legacy-exp', amount: '12.34', date: '2026-07-02', category: 'transport' }), 'linked');
  assert.equal(sql(`select count(*) from public.trip_expenses where id='legacy-exp'`), '0');
  assert.equal(sql(`select legacy_trip_expense_id from public.trip_expense_links where expense_id='legacy-exp'`), 'legacy-exp');
  assert.equal(sql(`select amount::text || '|' || next_payment_date::text from public.expenses where id='legacy-exp' and user_id='${OWNER}'`), '12.34|2026-07-02');
  assert.match(errorFor(asRole(OWNER, `select public.link_trip_economy_expense(
    '${TRIP}','${OWNER}'::uuid,'legacy-bob','Wrong author',8,'food','2026-07-02','legacy-bob',null,null,null)`)), /legacy_author_mismatch/);
  assert.equal(sql(`select count(*) from public.trip_expenses where id='legacy-bob' and user_id='${BOB}'`), '1');
});

test('SECURITY: an expected-account mismatch is rejected before any Economy row or link is written', () => {
  assert.match(errorFor(asRole(OWNER, linkCall({ expected: BOB, id: 'wrong-account' }))), /account_mismatch/);
  assert.equal(sql(`select count(*) from public.expenses where id='wrong-account'`), '0');
  assert.equal(sql(`select count(*) from public.trip_expense_links where expense_id='wrong-account'`), '0');
});

test('SECURITY: owner and accepted participant see only linked projection; pending/unrelated are denied', () => {
  link(BOB, { id: 'bob-expense', amount: '4.00' });
  assert.deepEqual(projection(OWNER).map((row) => row.expense_id), ['bob-expense', 'dated', 'legacy-exp']);
  assert.deepEqual(projection(BOB).map((row) => row.expense_id), ['bob-expense', 'dated', 'legacy-exp']);
  assert.deepEqual(projection(CAROL), []);
  assert.deepEqual(projection(DAVE), []);
  assert.equal(as(BOB, `select count(*) from public.expenses where id='private-unlinked'`), '0');
  assert.match(errorFor(asRole(DAVE, `select * from public.trip_expense_links`)), /permission denied/);
});

function asRole(userId, source) {
  return `set role authenticated; set request.jwt.claim.sub='${userId}'; set request.jwt.claims='${claims(userId)}'; ${source}`;
}

test('SECURITY: removing a participant immediately removes server projection access', () => {
  sql(`delete from public.trip_participants where trip_id='${TRIP}' and user_id='${BOB}'`);
  assert.deepEqual(projection(BOB), []);
});

test('DELETION: deleting a trip removes only links; deleting Economy removes its link', () => {
  link(OWNER, { trip: 'trip-delete', id: 'kept-economy' });
  const deleted = JSON.parse(as(OWNER, `select public.delete_trip_if_dependencies_match('trip-delete',1,0,0,0)::text`));
  assert.equal(deleted.status, 'deleted');
  assert.equal(sql(`select count(*) from public.trip_expense_links where expense_id='kept-economy'`), '0');
  assert.equal(sql(`select count(*) from public.expenses where id='kept-economy' and user_id='${OWNER}'`), '1');

  link(OWNER, { trip: 'trip-expense-delete', id: 'delete-economy' });
  as(OWNER, `delete from public.expenses where id='delete-economy' and user_id='${OWNER}'`);
  assert.equal(sql(`select count(*) from public.trip_expense_links where expense_id='delete-economy'`), '0');
  assert.deepEqual(projection(OWNER, 'trip-expense-delete'), []);
});

/* ---------------------------------------- APP-059 review #1: one logical expense */

test('IDEMPOTENCY: a committed write whose answer was lost, replayed again and again, is one expense and one link', () => {
  // The first call commits; the client never sees its answer, so it sends the same
  // logical id again — several times. Every replay is recognised as that expense.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal(link(OWNER, { id: 'retry-draft', amount: '25.50', date: '2026-07-05', category: 'transport' }), 'linked');
  }
  assert.equal(economyCount(OWNER, 'retry-draft'), 1);
  assert.equal(linkCount(OWNER, 'retry-draft'), 1);
  assert.equal(sql(`select amount::text || '|' || next_payment_date::text from public.expenses
    where user_id='${OWNER}' and id='retry-draft'`), '25.50|2026-07-05');
});

test('IDEMPOTENCY: a replay of the same id with different details is refused and adds nothing', () => {
  assert.match(errorFor(asRole(OWNER, linkCall({ id: 'retry-draft', amount: '99.00', date: '2026-07-05', category: 'transport' }))),
    /expense_identity_conflict/);
  assert.equal(economyCount(OWNER, 'retry-draft'), 1);
  assert.equal(linkCount(OWNER, 'retry-draft'), 1);
});

test('IDEMPOTENCY: two different drafts with identical details are two expenses and two links', () => {
  assert.equal(link(OWNER, { id: 'draft-one', amount: '7.50' }), 'linked');
  assert.equal(link(OWNER, { id: 'draft-two', amount: '7.50' }), 'linked');
  assert.equal(economyCount(OWNER, 'draft-one') + economyCount(OWNER, 'draft-two'), 2);
  assert.equal(linkCount(OWNER, 'draft-one') + linkCount(OWNER, 'draft-two'), 2);
});

test('CONCURRENCY: the same logical id sent while the first request is still open converges on one row each', async () => {
  const first = openSession();
  const second = openSession();
  try {
    // The first request has created Economy + link inside an open transaction...
    first.send(`${asRole(OWNER, '')} begin; ${linkCall({ id: 'concurrent-draft', amount: '42.00' })}; select 'first_holds_concurrent_draft';`);
    await waitFor(() => sessionsLike('first_holds_concurrent_draft', "state = 'idle in transaction'") === 1, 'the first request to hold its rows');
    // ...and the retry of the SAME logical expense arrives. It must wait, not decide on a stale view.
    second.send(`${asRole(OWNER, '')} ${linkCall({ id: 'concurrent-draft', amount: '42.00' })} /* second_same_draft */;`);
    await waitFor(() => sessionsLike('second_same_draft', "wait_event_type = 'Lock'") === 1, 'the retry to wait for the first');
    first.send('commit;');
    const a = await first.finish();
    const b = await second.finish();
    assert.equal(a.code, 0, a.stderr);
    assert.equal(b.code, 0, b.stderr);
    assert.match(a.stdout, /linked/);
    assert.match(b.stdout, /linked/); // recognised as the same expense, not refused, not duplicated
  } finally {
    first.kill(); second.kill();
  }
  assert.equal(economyCount(OWNER, 'concurrent-draft'), 1);
  assert.equal(linkCount(OWNER, 'concurrent-draft'), 1);
});

test('CONCURRENCY: many simultaneous requests for one logical id all succeed and leave exactly one row each', async () => {
  const sessions = Array.from({ length: 8 }, () => openSession());
  try {
    for (const session of sessions) session.send(`${asRole(OWNER, '')} ${linkCall({ id: 'storm-draft', amount: '13.37' })};`);
    const results = await Promise.all(sessions.map((session) => session.finish()));
    for (const result of results) {
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /linked/);
    }
  } finally {
    for (const session of sessions) session.kill();
  }
  assert.equal(economyCount(OWNER, 'storm-draft'), 1);
  assert.equal(linkCount(OWNER, 'storm-draft'), 1);
});
