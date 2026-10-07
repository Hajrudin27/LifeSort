// APP-062 Moving template provenance against a disposable local PostgreSQL cluster.
// The pre-existing table, RLS policies, FK and grants are lifted verbatim from the remote
// schema migration, so the new columns are proven on the real baseline. No Supabase CLI,
// remote URL, .env or existing database is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bin = process.env.APP062_PG_BIN || path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app062-'));
const cluster = path.join(scratch, 'db');
const port = '55462';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MIGRATION = path.join(root, 'supabase/migrations/20261007150000_app062_moving_template_provenance.sql');
let started = false;
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', port, '-U', 'postgres', '-d', 'postgres'];
const sql = (source) => execFileSync(path.join(bin, 'psql'), args, {
  input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
}).trim();
function errorFor(source) {
  try { sql(source); } catch (error) { return String(error.stderr); }
  assert.fail('SQL unexpectedly succeeded');
}
const quote = (value) => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const auth = (userId, role = 'authenticated') =>
  `set role ${role}; ${userId ? `set request.jwt.claim.sub='${userId}'; ` : ''}`;
const insert = (user, id, label = 'x', provenance = [null, null, null]) =>
  `insert into public.household_moving_items (id,user_id,label,checked,template_id,template_version,template_item_id)
   values (${quote(id)},${quote(user)},${quote(label)},false,${quote(provenance[0])},${provenance[1] ?? 'null'},${quote(provenance[2])});`;
const row = (user, id) => JSON.parse(sql(`select row_to_json(t) from (select id,label,checked,template_id,template_version,template_item_id
  from public.household_moving_items where user_id='${user}' and id=${quote(id)}) t`));
const snapshot = () => sql(`select
  (select string_agg(policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,''), '|' order by policyname)
     from pg_policies where tablename='household_moving_items'),
  (select string_agg(grantee||':'||privilege_type, '|' order by grantee, privilege_type)
     from information_schema.table_privileges where table_name='household_moving_items')`);

/** Statements of the remote baseline that mention the Moving table, in file order. */
function baselineStatements() {
  const text = fs.readFileSync(path.join(root, 'supabase/migrations/20260902112000_remote_schema.sql'), 'utf8');
  return text.split(/;\s*\n/).filter((statement) => statement.includes('household_moving_items')).map((s) => `${s};`);
}

let before_snapshot;
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
  sql(`insert into public.household_moving_items (id,user_id,label,checked) values
    ('default-internet','${A}','Order internet',true), ('custom-1','${A}','Boxes',false), ('default-internet','${B}','Order internet',false);`);
  before_snapshot = snapshot();
  sql(fs.readFileSync(MIGRATION, 'utf8'));
});

after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('ADDITIVE: three nullable columns, legacy rows untouched, policies and grants unchanged', () => {
  assert.equal(sql(`select string_agg(column_name||':'||data_type||':'||is_nullable, ',' order by column_name)
    from information_schema.columns where table_name='household_moving_items' and column_name like 'template_%'`),
  'template_id:text:YES,template_item_id:text:YES,template_version:integer:YES');
  assert.deepEqual(row(A, 'default-internet'), {
    id: 'default-internet', label: 'Order internet', checked: true, template_id: null, template_version: null, template_item_id: null,
  });
  assert.equal(sql('select count(*) from public.household_moving_items'), '3');
  assert.equal(snapshot(), before_snapshot, 'the migration changed no RLS policy and no grant');
});

test('IDEMPOTENT: the migration can be applied again without error or data change', () => {
  sql(fs.readFileSync(MIGRATION, 'utf8'));
  assert.equal(sql('select count(*) from public.household_moving_items'), '3');
  assert.equal(snapshot(), before_snapshot);
});

test('CONSTRAINT: all-null and all-set are accepted', () => {
  sql(insert(A, 'plain'));
  sql(insert(A, 'copied', 'x', ['moving-home', 1, 'addressChange']));
  assert.deepEqual(row(A, 'copied'), {
    id: 'copied', label: 'x', checked: false, template_id: 'moving-home', template_version: 1, template_item_id: 'addressChange',
  });
});

test('CONSTRAINT: every partial provenance combination is refused', () => {
  const full = ['moving-home', 1, 'addressChange'];
  for (let mask = 1; mask < 7; mask += 1) {
    const partial = full.map((value, index) => (mask & (1 << index)) ? value : null);
    assert.match(errorFor(insert(A, `partial-${mask}`, 'x', partial)), /household_moving_items_template_provenance_check/, `mask ${mask}`);
  }
  assert.equal(sql("select count(*) from public.household_moving_items where id like 'partial-%'"), '0');
});

test('CONSTRAINT: malformed ids and non-positive versions are refused', () => {
  const bad = [
    ['moving-home', 0, 'addressChange'], ['moving-home', -1, 'addressChange'],
    ['Moving Home', 1, 'addressChange'], ['1moving', 1, 'addressChange'], ['', 1, 'addressChange'],
    ['moving-home', 1, 'Change address'], ['moving-home', 1, '1item'], ['moving-home', 1, ''],
    ['moving-home', 1, 'a'.repeat(65)], ['a'.repeat(65), 1, 'addressChange'], ['moving_home', 1, 'addressChange'],
  ];
  bad.forEach((provenance, index) => {
    assert.match(errorFor(insert(A, `bad-${index}`, 'x', provenance)), /household_moving_items_template_provenance_check/, JSON.stringify(provenance));
  });
  assert.equal(sql('select count(*) from public.household_moving_items'), '5');
  // The boundary values are accepted.
  sql(insert(A, 'edge', 'x', ['a'.repeat(64), 2147483647, 'b'.repeat(64)]));
  sql(insert(A, 'edge-camel', 'x', ['moving-home', 1, 'mailForwarding']));
});

test('OLD CLIENT: an upsert that sends only id, user_id, label and checked keeps provenance', () => {
  // PostgREST merge-duplicates builds `DO UPDATE SET` from the payload keys only, so a
  // client that does not know the new columns never lists them. This is that statement.
  const oldClientUpsert = (user, id, label, checked) => `${auth(user)}
    insert into public.household_moving_items (id,user_id,label,checked)
    values (${quote(id)},${quote(user)},${quote(label)},${checked})
    on conflict (user_id,id) do update set id=excluded.id, user_id=excluded.user_id, label=excluded.label, checked=excluded.checked;`;
  sql(oldClientUpsert(A, 'copied', 'Renamed by an old client', true));
  assert.deepEqual(row(A, 'copied'), {
    id: 'copied', label: 'Renamed by an old client', checked: true,
    template_id: 'moving-home', template_version: 1, template_item_id: 'addressChange',
  });
  // A brand-new row from an old client is simply user-created.
  sql(oldClientUpsert(A, 'old-new', 'Written by an old client', false));
  assert.equal(row(A, 'old-new').template_id, null);
  // A toggle from the old client on a legacy default row leaves it provenance-free (derived client-side).
  sql(oldClientUpsert(A, 'default-internet', 'Order internet', false));
  assert.equal(row(A, 'default-internet').template_id, null);
  assert.equal(row(A, 'default-internet').checked, false);
});

test('NEW CLIENT: an upsert that sends provenance sets it, and a partial update is refused', () => {
  sql(`${auth(A)}
    insert into public.household_moving_items (id,user_id,label,checked,template_id,template_version,template_item_id)
    values ('default-internet','${A}','Order internet',true,'moving-home',1,'internet')
    on conflict (user_id,id) do update set label=excluded.label, checked=excluded.checked,
      template_id=excluded.template_id, template_version=excluded.template_version, template_item_id=excluded.template_item_id;`);
  assert.deepEqual(row(A, 'default-internet'), {
    id: 'default-internet', label: 'Order internet', checked: true,
    template_id: 'moving-home', template_version: 1, template_item_id: 'internet',
  });
  // An update that would leave a partial state is refused by the constraint.
  assert.match(errorFor(`${auth(A)} update public.household_moving_items set template_id=null where id='default-internet'`),
    /household_moving_items_template_provenance_check/);
});

test('RLS: an owner reads and writes only their own rows', () => {
  assert.notEqual(sql(`${auth(A)} select count(*) from public.household_moving_items`), '0');
  assert.equal(sql(`${auth(A)} select count(*) from public.household_moving_items where user_id='${B}'`), '0');
  assert.equal(sql(`${auth(B)} select count(*) from public.household_moving_items where user_id='${A}'`), '0');
  assert.equal(sql(`${auth(B)} select count(*) from public.household_moving_items`), '1');
});

test('RLS: another user cannot read, change, delete or insert into the owner\'s rows', () => {
  assert.equal(sql(`${auth(B)} update public.household_moving_items set checked=true, template_id=null, template_version=null, template_item_id=null
    where user_id='${A}' returning id`), '');
  assert.equal(sql(`${auth(B)} delete from public.household_moving_items where user_id='${A}' returning id`), '');
  assert.match(errorFor(`${auth(B)} ${insert(A, 'forged', 'x', ['moving-home', 1, 'internet'])}`), /row-level security/);
  assert.deepEqual(row(A, 'copied').template_id, 'moving-home');
  assert.equal(sql("select count(*) from public.household_moving_items where id='forged'"), '0');
});

test('RLS: anon sees nothing and cannot write', () => {
  assert.equal(sql(`${auth(null, 'anon')} select count(*) from public.household_moving_items`), '0');
  assert.match(errorFor(`${auth(null, 'anon')} ${insert(A, 'anon-write')}`), /row-level security/);
  assert.equal(sql(`${auth(null, 'anon')} update public.household_moving_items set checked=true returning id`), '');
  assert.equal(sql(`${auth(null, 'anon')} delete from public.household_moving_items returning id`), '');
});

test('RLS: an owner cannot move their row to another user', () => {
  assert.match(errorFor(`${auth(A)} update public.household_moving_items set user_id='${B}' where id='plain'`), /row-level security/);
  assert.equal(row(A, 'plain').id, 'plain');
});

test('ACCOUNT DELETION: rows, with their provenance, cascade away', () => {
  assert.notEqual(sql(`select count(*) from public.household_moving_items where user_id='${A}'`), '0');
  sql(`delete from auth.users where id='${A}'`);
  assert.equal(sql(`select count(*) from public.household_moving_items where user_id='${A}'`), '0');
  assert.equal(sql(`select count(*) from public.household_moving_items where user_id='${B}'`), '1');
});
