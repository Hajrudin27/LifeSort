// APP-071 data-only preservation migration against a disposable local PostgreSQL cluster.
// The legacy cycles / symptom_logs / cycle_settings / profiles tables are lifted from the remote schema
// migration, and the user_modules history (APP-010, APP-032, APP-033, APP-034) is applied in order, so the
// migration is proven on the real baseline, including the revision trigger. No Supabase CLI, remote URL,
// .env or existing database is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bin = process.env.APP071_PG_BIN || path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app071-'));
const cluster = path.join(scratch, 'db');
const port = '55471';
const MIGRATION = path.join(root, 'supabase/migrations/20261013120000_app071_preserve_cycle_choice.sql');
const migrationsDir = path.join(root, 'supabase/migrations');
let started = false;

const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', port, '-U', 'postgres', '-d', 'postgres'];
const sql = (source) => execFileSync(path.join(bin, 'psql'), args, {
  input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
}).trim();
const quote = (value) => value === null || value === undefined ? 'null' : `'${String(value).replaceAll("'", "''")}'`;

// Fixture users. Each name states the situation; the gender is part of the fixture only to prove it has no effect.
const user = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const USERS = {
  withCycle: user(1),
  withSymptoms: user(2),
  withSettings: user(3),
  noData: user(4),
  femaleNoData: user(5),
  otherWithData: user(6),
  missingGenderWithData: user(7),
  explicitFalseWithData: user(8),
  explicitTrueWithData: user(9),
  explicitTrueNoData: user(10),
  explicitFalseNoData: user(11),
  withAllThree: user(12),
  withBoth: user(13),
  otherModuleOnly: user(14),
};

const cycleRow = (userId) => sql(`select enabled::text from public.user_modules where user_id=${quote(userId)} and module_id='cycle'`);
const cycleRowCount = (userId) => Number(sql(`select count(*) from public.user_modules where user_id=${quote(userId)} and module_id='cycle'`));
const allRows = () => sql(`select string_agg(user_id::text||'|'||module_id||'|'||enabled::text||'|'||revision::text||'|'||updated_at::text||'|'||coalesce(deleted_at::text,''), E'\\n' order by user_id, module_id)
  from public.user_modules`);
const healthSnapshot = () => sql(`select
  (select coalesce(string_agg(id||user_id::text||start_date::text||coalesce(end_date::text,''), ',' order by user_id, id), '') from public.cycles) || '#' ||
  (select coalesce(string_agg(id||user_id::text||date::text||symptoms::text||coalesce(flow,'')||coalesce(notes,''), ',' order by user_id, id), '') from public.symptom_logs) || '#' ||
  (select coalesce(string_agg(user_id::text||avg_cycle_length||'/'||luteal_phase_length||'/'||reminder_enabled||'/'||reminder_days_before, ',' order by user_id), '') from public.cycle_settings)`);
const columns = (table) => sql(`select string_agg(column_name||':'||data_type||':'||is_nullable, '|' order by ordinal_position)
  from information_schema.columns where table_schema='public' and table_name=${quote(table)}`);
const policies = () => sql(`select coalesce(string_agg(tablename||':'||policyname||':'||cmd, '|' order by tablename, policyname), '') from pg_policies where schemaname='public'`);
const grants = () => sql(`select coalesce(string_agg(grantee||':'||privilege_type, ',' order by grantee, privilege_type), '')
  from information_schema.role_table_grants where table_schema='public' and table_name='user_modules'`);

/** The legacy DDL for the tables the migration reads, exactly as the remote schema migration declares it. */
function legacyStatements() {
  const text = fs.readFileSync(path.join(migrationsDir, '20260902112000_remote_schema.sql'), 'utf8');
  const tables = ['profiles', 'cycles', 'symptom_logs', 'cycle_settings'];
  return text.split(/;\s*\n/).map((s) => `${s};`).filter((statement) =>
    tables.some((table) => statement.includes(`CREATE TABLE "public"."${table}"`)
      || (statement.includes(`ALTER TABLE "public"."${table}"`) && /ADD CONSTRAINT/.test(statement))));
}

before(() => {
  execFileSync(path.join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-l', path.join(scratch, 'postgres.log'),
    '-o', `-k ${scratch} -p ${port} -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    insert into auth.users select unnest(array[${Object.values(USERS).map(quote).join(',')}]::uuid[]);`);

  const legacy = legacyStatements();
  assert.equal(legacy.filter((s) => /CREATE TABLE/.test(s)).length, 4, 'all four legacy tables found');
  sql(legacy.join('\n'));

  // The user_modules history in order, exactly as it reaches a database.
  for (const file of ['20260908233100_user_modules.sql', '20260911065428_idempotent_server_mutations.sql',
    '20260911075104_user_modules_revisions.sql', '20260911081953_user_modules_tombstones.sql']) {
    sql(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }

  // Profiles first: the genders are only there to prove they change nothing.
  const genders = {
    withCycle: 'female', withSymptoms: 'male', withSettings: 'unspecified', noData: 'unspecified',
    femaleNoData: 'female', otherWithData: 'other', missingGenderWithData: null,
    explicitFalseWithData: 'female', explicitTrueWithData: 'male', explicitTrueNoData: 'male',
    explicitFalseNoData: 'female', withAllThree: 'other', withBoth: null, otherModuleOnly: 'female',
  };
  for (const [name, id] of Object.entries(USERS)) {
    sql(`insert into public.profiles (id, gender) values (${quote(id)}, ${quote(genders[name])});`);
  }

  // Server-side evidence of use. Real-looking health payloads are included on purpose: the migration must
  // never copy any of them.
  const cycle = (id, n) => `insert into public.cycles (id, user_id, start_date, end_date) values ('c${n}', ${quote(id)}, '2026-09-0${n}', '2026-09-0${n + 4}');`;
  const symptom = (id, n) => `insert into public.symptom_logs (id, user_id, date, symptoms, flow, notes) values ('s${n}', ${quote(id)}, '2026-09-1${n}', '["cramps"]', 'heavy', 'private note ${n}');`;
  const settings = (id) => `insert into public.cycle_settings (user_id, avg_cycle_length, reminder_enabled) values (${quote(id)}, 30, true);`;
  sql([
    cycle(USERS.withCycle, 1), symptom(USERS.withSymptoms, 2), settings(USERS.withSettings),
    cycle(USERS.otherWithData, 3), symptom(USERS.missingGenderWithData, 4),
    cycle(USERS.explicitFalseWithData, 5), cycle(USERS.explicitTrueWithData, 6),
    cycle(USERS.withAllThree, 7), symptom(USERS.withAllThree, 8), settings(USERS.withAllThree),
    cycle(USERS.withBoth, 9), settings(USERS.withBoth),
    cycle(USERS.otherModuleOnly, 1),
  ].join('\n'));

  // Explicit choices that exist before the migration, and an unrelated module that must not count as a cycle choice.
  sql(`insert into public.user_modules (user_id, module_id, enabled) values
    (${quote(USERS.explicitFalseWithData)}, 'cycle', false),
    (${quote(USERS.explicitTrueWithData)}, 'cycle', true),
    (${quote(USERS.explicitTrueNoData)}, 'cycle', true),
    (${quote(USERS.explicitFalseNoData)}, 'cycle', false),
    (${quote(USERS.otherModuleOnly)}, 'travel', false);`);
});

after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});

let beforeMigration;
test('BASELINE: before the migration, nobody without an explicit row has a cycle choice', () => {
  for (const name of ['withCycle', 'withSymptoms', 'withSettings', 'noData', 'femaleNoData', 'otherWithData',
    'missingGenderWithData', 'withAllThree', 'withBoth', 'otherModuleOnly']) {
    assert.equal(cycleRowCount(USERS[name]), 0, name);
  }
  assert.equal(sql(`select count(*) from public.profiles`), String(Object.keys(USERS).length));
  beforeMigration = {
    health: healthSnapshot(), columns: columns('user_modules'), policies: policies(), grants: grants(),
    explicit: allRows(),
    cycleColumns: columns('cycles') + columns('symptom_logs') + columns('cycle_settings'),
  };
  assert.ok(beforeMigration.health.length > 20, 'the health fixture is not vacuous');
  sql(fs.readFileSync(MIGRATION, 'utf8'));
});

test('1. a user with cycle data and no cycle choice gets an explicit true row', () => {
  assert.equal(cycleRow(USERS.withCycle), 'true');
});

test('2. a user with symptom logs and no cycle choice gets an explicit true row', () => {
  assert.equal(cycleRow(USERS.withSymptoms), 'true');
});

test('3. a user with cycle settings and no cycle choice gets an explicit true row', () => {
  assert.equal(cycleRow(USERS.withSettings), 'true');
});

test('4. a user with no health data and no choice gets no row, and so keeps the health default (off)', () => {
  assert.equal(cycleRowCount(USERS.noData), 0);
});

test('5. a profile with gender female and no health data gets no row: gender is never evidence', () => {
  assert.equal(cycleRowCount(USERS.femaleNoData), 0);
});

test('6. another or missing gender with health data gets a true row: gender does not block preservation', () => {
  assert.equal(cycleRow(USERS.otherWithData), 'true');
  assert.equal(cycleRow(USERS.missingGenderWithData), 'true');
  assert.equal(cycleRow(USERS.withSymptoms), 'true');
});

test('7. an explicit false stays false even with health data', () => {
  assert.equal(cycleRow(USERS.explicitFalseWithData), 'false');
  assert.equal(cycleRow(USERS.explicitFalseNoData), 'false');
});

test('8. an explicit true stays true, with or without health data', () => {
  assert.equal(cycleRow(USERS.explicitTrueWithData), 'true');
  assert.equal(cycleRow(USERS.explicitTrueNoData), 'true');
});

test('one row per user however many evidence tables they appear in', () => {
  assert.equal(cycleRowCount(USERS.withAllThree), 1);
  assert.equal(cycleRowCount(USERS.withBoth), 1);
  assert.equal(cycleRow(USERS.withAllThree), 'true');
  assert.equal(cycleRow(USERS.withBoth), 'true');
});

test('an unrelated module choice is not a cycle choice: that user is still preserved', () => {
  assert.equal(cycleRow(USERS.otherModuleOnly), 'true');
  assert.equal(sql(`select enabled::text from public.user_modules where user_id=${quote(USERS.otherModuleOnly)} and module_id='travel'`), 'false');
});

test('exactly the evidenced users without a choice were inserted, and nothing else', () => {
  const inserted = sql(`select string_agg(user_id::text, ',' order by user_id) from public.user_modules
    where module_id='cycle' and revision=1 and user_id not in (${[USERS.explicitFalseWithData, USERS.explicitTrueWithData,
    USERS.explicitTrueNoData, USERS.explicitFalseNoData].map(quote).join(',')})`);
  const expected = [USERS.withCycle, USERS.withSymptoms, USERS.withSettings, USERS.otherWithData,
    USERS.missingGenderWithData, USERS.withAllThree, USERS.withBoth, USERS.otherModuleOnly].sort().join(',');
  assert.equal(inserted, expected);
  assert.equal(sql(`select count(*) from public.user_modules where module_id <> 'cycle'`), '1', 'no other module row was added');
  assert.equal(sql(`select count(*) from public.user_modules where module_id='cycle'`), '12');
});

test('inserted rows are ordinary active rows stamped by the APP-033/034 triggers, never tombstones', () => {
  assert.equal(sql(`select revision::text||'|'||(deleted_at is null)::text||'|'||(updated_at is not null)::text
    from public.user_modules where user_id=${quote(USERS.withCycle)} and module_id='cycle'`), '1|true|true');
});

test('explicit rows are byte-for-byte untouched: revision and updated_at did not move', () => {
  const explicitIds = [USERS.explicitFalseWithData, USERS.explicitTrueWithData, USERS.explicitTrueNoData, USERS.explicitFalseNoData];
  const before = beforeMigration.explicit.split('\n').filter((line) => explicitIds.some((id) => line.startsWith(id)));
  assert.equal(before.length, 4);
  const after = allRows().split('\n');
  for (const line of before) assert.ok(after.includes(line), `unchanged: ${line}`);
});

test('NO HEALTH DATA CHANGE: cycles, symptom_logs and cycle_settings are exactly as they were', () => {
  assert.equal(healthSnapshot(), beforeMigration.health);
});

test('NO PAYLOAD COPIED: user_modules carries only the choice, never anything from the health tables', () => {
  assert.equal(columns('user_modules'), beforeMigration.columns);
  assert.equal(sql(`select count(*) from public.user_modules where module_id='cycle' and (user_id::text||module_id) ~* '(cramps|heavy|private note)'`), '0');
});

test('NO SCHEMA, RLS OR GRANT CHANGE', () => {
  assert.equal(columns('user_modules'), beforeMigration.columns);
  assert.equal(columns('cycles') + columns('symptom_logs') + columns('cycle_settings'), beforeMigration.cycleColumns);
  assert.equal(policies(), beforeMigration.policies);
  assert.equal(grants(), beforeMigration.grants);
});

test('9. IDEMPOTENT: re-running changes nothing, not even revision or updated_at', () => {
  const before = { rows: allRows(), health: healthSnapshot(), policies: policies(), grants: grants() };
  sql(fs.readFileSync(MIGRATION, 'utf8'));
  sql(fs.readFileSync(MIGRATION, 'utf8'));
  assert.deepEqual({ rows: allRows(), health: healthSnapshot(), policies: policies(), grants: grants() }, before);
});

test('a later explicit choice is never overwritten by a re-run, and gender is never read', () => {
  sql(`update public.user_modules set enabled=false where user_id=${quote(USERS.withCycle)} and module_id='cycle'`);
  sql(`update public.profiles set gender='male' where id=${quote(USERS.femaleNoData)}`);
  sql(fs.readFileSync(MIGRATION, 'utf8'));
  assert.equal(cycleRow(USERS.withCycle), 'false');
  assert.equal(cycleRowCount(USERS.femaleNoData), 0);
});

test('the migration does not mention gender or profiles in its statements', () => {
  const statements = fs.readFileSync(MIGRATION, 'utf8').split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(statements, /gender|profiles/i);
});
