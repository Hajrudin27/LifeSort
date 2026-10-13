// APP-074: apply the actual clinical-governance migration on top of the REAL historical migrations.
// No hosted Supabase project, credentials or CLI connection is used: a disposable local cluster only.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const migrations = path.join(root, 'supabase/migrations');
const bin = process.env.APP074_PG_BIN || path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app074-'));
const cluster = path.join(scratch, 'db');
const port = '55474';
const migration = fs.readdirSync(migrations).find((file) => file.endsWith('_app074_clinical_content_governance.sql'));
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EDITOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SUPPORT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NIL = '00000000-0000-0000-0000-000000000000';
let started = false;
let before_snapshot;

const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', port, '-U', 'postgres', '-d', 'postgres'];
const sql = (source) => execFileSync(path.join(bin, 'psql'), args, { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const errorFor = (source) => { try { sql(source); } catch (error) { return String(error.stderr); } assert.fail('SQL unexpectedly succeeded'); };
// Same psql, but concurrent: lets two sessions overlap so lock ordering is actually exercised.
const sqlAsync = (source) => new Promise((resolve) => {
  const child = spawn(path.join(bin, 'psql'), args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr }));
  child.stdin.end(source);
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const auth = (id, role = 'authenticated') => (id === 'anon' ? 'set role anon;' : `set role ${role}; ${id ? `set request.jwt.claim.sub='${id}';` : ''}`);
const as = (id, source) => sql(`${auth(id)} ${source}`);
const errAs = (id, source) => errorFor(`${auth(id)} ${source}`);
const lit = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const copenhagen = (offset) => sql(`select ((now() at time zone 'Europe/Copenhagen')::date + ${offset})::text`);
const today = () => copenhagen(0);
const tomorrow = () => copenhagen(1);
const yesterday = () => copenhagen(-1);

// One descriptor per governed table keeps every lifecycle assertion identical for both.
const kinds = {
  symptom: {
    table: 'symptom_glossary', entity: 'symptom_glossary',
    fn: { create: 'admin_create_symptom_glossary_draft', next: 'admin_create_next_symptom_glossary_revision', update: 'admin_update_symptom_glossary_draft', submit: 'admin_submit_symptom_glossary_for_review', approve: 'admin_approve_symptom_glossary_review', ret: 'admin_return_symptom_glossary_to_draft', publish: 'admin_publish_symptom_glossary', withdraw: 'admin_withdraw_symptom_glossary', list: 'admin_list_symptom_glossary_revisions' },
    body: (o) => `${lit(o.da)},${lit(o.en)},${lit(o.da)},${lit(o.en)}`,
    nilCreate: `'m-'||gen_random_uuid()::text,'a','b','c','d',null,null,null`,
    nilUpdate: `'${NIL}','a','b','c','d',null,null,null`,
  },
  health: {
    table: 'health_conditions', entity: 'health_condition',
    fn: { create: 'admin_create_health_condition_draft', next: 'admin_create_next_health_condition_revision', update: 'admin_update_health_condition_draft', submit: 'admin_submit_health_condition_for_review', approve: 'admin_approve_health_condition_review', ret: 'admin_return_health_condition_to_draft', publish: 'admin_publish_health_condition', withdraw: 'admin_withdraw_health_condition', list: 'admin_list_health_condition_revisions' },
    body: (o) => `${lit(o.da)},${lit(o.en)},${lit(o.da)},${lit(o.en)},${lit(o.da)},${lit(o.en)},${o.symptoms},${lit(o.da)},${lit(o.en)},${lit(o.da)},${lit(o.en)}`,
    nilCreate: `'m-'||gen_random_uuid()::text,'a','b','c','d','e','f','{}','g','h','i','j',null,null,null`,
    nilUpdate: `'${NIL}','a','b','c','d','e','f','{}','g','h','i','j',null,null,null`,
  },
};
const opts = (o = {}) => ({ da: 'DA', en: 'EN', source: 'source', url: null, due: tomorrow(), symptoms: 'array[]::text[]', ...o });
const call = (kind, op, ...parameters) => `select public.${kinds[kind].fn[op]}(${parameters.join(',')})`;
const create = (kind, who, id, o) => { const v = opts(o); return as(who, call(kind, 'create', lit(id), kinds[kind].body(v), lit(v.source), lit(v.url), lit(v.due))); };
const update = (kind, who, rev, o) => { const v = opts(o); return call(kind, 'update', lit(rev), kinds[kind].body(v), lit(v.source), lit(v.url), lit(v.due)); };
const step = (kind, who, op, rev) => as(who, call(kind, op, lit(rev)));
const status = (kind, rev) => sql(`select status from public.${kinds[kind].table} where revision_id='${rev}'`);
const states = (kind, id) => sql(`select string_agg('v'||content_version||'='||status, ',' order by content_version) from public.${kinds[kind].table} where id='${id}'`);
const row = (kind, rev, column) => sql(`select ${column}::text from public.${kinds[kind].table} where revision_id='${rev}'`);
const auditCount = () => Number(sql('select count(*) from public.activity_log'));
// draft -> in_review -> reviewed (by the editor) : the state an owner may publish.
const reviewed = (kind, id, o) => { const rev = create(kind, EDITOR, id, o); step(kind, EDITOR, 'submit', rev); step(kind, EDITOR, 'approve', rev); return rev; };
const published = (kind, id, o) => { const rev = reviewed(kind, id, o); step(kind, OWNER, 'publish', rev); return rev; };
const visible = (kind, who) => as(who, `select coalesce(string_agg(id, ',' order by id), '') from public.${kinds[kind].table}`);

before(() => {
  assert.ok(migration, 'APP-074 migration exists');
  started = true; // set first so a failed start still reaches the stop in `after`
  execFileSync(path.join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-l', path.join(scratch, 'postgres.log'), '-o', `-k ${scratch} -p ${port} -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  // Supabase platform stand-ins: roles, auth.uid(), and the default privileges every hosted public object receives.
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    insert into auth.users values ('${OWNER}'),('${EDITOR}'),('${SUPPORT}'),('${USER}');
    -- admin_users exactly as 20260902112000_remote_schema.sql defines it
    create table public.admin_users (id uuid not null, role text not null, full_name text not null, created_at timestamptz not null default now(),
      constraint admin_users_pkey primary key (id), constraint admin_users_role_check check (role = any (array['owner','editor','support'])),
      constraint admin_users_id_fkey foreign key (id) references auth.users(id) on delete cascade);
    alter table public.admin_users enable row level security;
    create policy "Users can check their own admin status" on public.admin_users for select to public using (auth.uid() = id);
    insert into public.admin_users(id, role, full_name) values ('${OWNER}','owner','Owner'),('${EDITOR}','editor','Editor'),('${SUPPORT}','support','Support');`);
  // The REAL historical migrations that define the governed tables, their seed and the audit table.
  const history = (name) => fs.readFileSync(path.join(migrations, name), 'utf8');
  sql(history('20260904091630_add_health_info_content.sql'));
  sql(history('20260904091836_seed_health_info_content.sql'));
  const auditCreate = history('20260903002859_add_activity_log_and_recipe_images.sql');
  sql(auditCreate.slice(0, auditCreate.indexOf('-- Billeder')));
  for (const name of ['20260905181729_activity_log_entity_id.sql', '20260906153000_expand_activity_log_audit_actions.sql', '20260906210000_protect_activity_log.sql']) sql(history(name));
  // Historical audit rows of every legacy shape: the constraint rewrite must keep all of them valid.
  sql(`insert into public.activity_log(actor_id,actor_name,action,entity_type,entity_label,entity_id) values
    ('${OWNER}','Owner','created','price','p','1'),('${OWNER}','Owner','confirmed','waitlist_signup','w','2'),('${EDITOR}','Editor','deleted','recipe','r','3'),
    ('${SUPPORT}','Support','replied','ticket','t','4'),('${OWNER}','Owner','invited','admin_user','a','5');`);
  const hc = `md5(string_agg(concat_ws('|',id,name_da,name_en,summary_da,summary_en,what_it_is_da,what_it_is_en,array_to_string(common_symptoms,','),what_helps_da,what_helps_en,when_to_see_doctor_da,when_to_see_doctor_en,updated_at::text),'#' order by id))`;
  const sg = `md5(string_agg(concat_ws('|',id,name_da,name_en,description_da,description_en,updated_at::text),'#' order by id))`;
  before_snapshot = {
    hcIds: sql('select string_agg(id, \',\' order by id) from public.health_conditions'), sgIds: sql('select string_agg(id, \',\' order by id) from public.symptom_glossary'),
    hcCount: Number(sql('select count(*) from public.health_conditions')), sgCount: Number(sql('select count(*) from public.symptom_glossary')),
    hcMd5: sql(`select ${hc} from public.health_conditions`), sgMd5: sql(`select ${sg} from public.symptom_glossary`),
    hcMd5Sql: hc, sgMd5Sql: sg, audit: auditCount(),
    dangling: Number(sql('select count(*) from public.health_conditions h, unnest(h.common_symptoms) s where not exists (select 1 from public.symptom_glossary g where g.id = s)')),
  };
  sql(fs.readFileSync(path.join(migrations, migration), 'utf8'));
});

after(() => {
  if (started) {
    try { execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' }); }
    catch { try { execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' }); } catch { /* nothing left running */ } }
  }
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('real historical seed becomes ungoverned v1 drafts: ids, content and references survive, nothing is fabricated', () => {
  const s = before_snapshot;
  assert.ok(s.hcCount > 0 && s.sgCount > 0, 'the real seed is present before the migration');
  assert.equal(s.dangling, 0, 'seed common_symptoms reference real symptom ids');
  assert.equal(sql('select count(*) from public.health_conditions'), String(s.hcCount));
  assert.equal(sql('select count(*) from public.symptom_glossary'), String(s.sgCount));
  assert.equal(sql('select string_agg(id, \',\' order by id) from public.health_conditions'), s.hcIds, 'logical ids preserved exactly');
  assert.equal(sql('select string_agg(id, \',\' order by id) from public.symptom_glossary'), s.sgIds);
  assert.equal(sql(`select ${s.hcMd5Sql} from public.health_conditions`), s.hcMd5, 'content (incl. common_symptoms and updated_at) untouched');
  assert.equal(sql(`select ${s.sgMd5Sql} from public.symptom_glossary`), s.sgMd5);
  for (const table of ['health_conditions', 'symptom_glossary']) {
    assert.equal(sql(`select count(*) filter (where content_version=1 and status='draft' and source_reference is null and source_url is null and reviewed_by is null and reviewed_at is null and review_due_at is null and published_at is null)=count(*) from public.${table}`), 't');
    assert.equal(sql(`select attnotnull from pg_attribute where attrelid='public.${table}'::regclass and attname='id'`), 't', 'logical id stays NOT NULL after the primary-key swap');
    assert.equal(sql(`select count(*) from pg_constraint where conrelid='public.${table}'::regclass and contype='p'`), '1');
    assert.equal(sql(`select a.attname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1] where c.conrelid='public.${table}'::regclass and c.contype='p'`), 'revision_id');
  }
  assert.equal(sql(`select count(*)=count(distinct revision_id) from (select revision_id from public.health_conditions union all select revision_id from public.symptom_glossary) x`), 't');
  assert.match(errorFor(`insert into public.health_conditions(revision_id,id,content_version,status,name_da,name_en,summary_da,summary_en,what_it_is_da,what_it_is_en,common_symptoms,what_helps_da,what_helps_en,when_to_see_doctor_da,when_to_see_doctor_en) select gen_random_uuid(),id,1,'draft','a','b','c','d','e','f','{}','g','h','i','j' from public.health_conditions limit 1`), /health_conditions_id_content_version_key/);
  assert.match(errorFor(`insert into public.symptom_glossary(revision_id,id,content_version,status,name_da,name_en,description_da,description_en) values(gen_random_uuid(),'bad',0,'draft','a','b','c','d')`), /symptom_glossary_content_version_positive/);
  assert.match(errorFor(`insert into public.symptom_glossary(id,content_version,status,name_da,name_en,description_da,description_en) values('x',1,'bogus','a','b','c','d')`), /symptom_glossary_status_check/);
  assert.match(errorFor(`insert into public.symptom_glossary(id,content_version,status,name_da,name_en,description_da,description_en,reviewed_by) values('x',1,'draft','a','b','c','d','${OWNER}')`), /symptom_glossary_reviewed_pair_check/);
  assert.equal(sql(`select count(*) from public.activity_log where action in ('created','confirmed','deleted','replied','invited') and entity_type in ('price','waitlist_signup','recipe','ticket','admin_user')`), '5', 'historical audit rows survive');
  assert.match(errorFor(`insert into public.activity_log(actor_name,action,entity_type,entity_label) values('x','exfiltrated','price','x')`), /activity_log_action_check/);
});

for (const kind of ['symptom', 'health']) {
  test(`${kind}: ordinary reads expose only published, unexpired rows - for users, support, editors AND owners`, () => {
    const t = kinds[kind].table;
    const one = (id, o) => create(kind, EDITOR, id, o);
    const rv = {
      draft: one(`${kind}-r-draft`), inReview: one(`${kind}-r-review`), withdrawn: published(kind, `${kind}-r-withdrawn`),
      live: published(kind, `${kind}-r-live`), today: published(kind, `${kind}-r-today`), yesterday: published(kind, `${kind}-r-yday`), noDue: published(kind, `${kind}-r-nodue`),
    };
    step(kind, EDITOR, 'submit', rv.inReview);
    step(kind, OWNER, 'withdraw', rv.withdrawn);
    sql(`update public.${t} set review_due_at='${today()}' where revision_id='${rv.today}'; update public.${t} set review_due_at='${yesterday()}' where revision_id='${rv.yesterday}'; update public.${t} set review_due_at=null where revision_id='${rv.noDue}'`);
    const expected = [`${kind}-r-live`, `${kind}-r-today`].sort().join(',');
    for (const who of [USER, SUPPORT, EDITOR, OWNER]) {
      const seen = as(who, `select coalesce(string_agg(id, ',' order by id), '') from public.${t} where id like '${kind}-r-%'`);
      assert.equal(seen, expected, `${who} sees only published rows due today or later`);
    }
    assert.match(errAs('anon', `select count(*) from public.${t}`), /permission denied/);
    // Private lifecycle states are reachable only through the role-checked admin read.
    assert.equal(as(EDITOR, `select count(*) from public.${kinds[kind].fn.list}() where id like '${kind}-r-%'`), '7');
    assert.match(errAs(SUPPORT, `select count(*) from public.${kinds[kind].fn.list}()`), /clinical_not_authorized/);
    assert.match(errAs(USER, `select count(*) from public.${kinds[kind].fn.list}()`), /clinical_not_authorized/);
  });

  test(`${kind}: no direct table mutation for any API role, including TRUNCATE`, () => {
    const t = kinds[kind].table;
    const insert = kind === 'symptom'
      ? `insert into public.${t}(id,content_version,status,name_da,name_en,description_da,description_en,review_due_at) values('bypass',1,'published','a','b','c','d','${tomorrow()}')`
      : `insert into public.${t}(id,content_version,status,name_da,name_en,summary_da,summary_en,what_it_is_da,what_it_is_en,what_helps_da,what_helps_en,when_to_see_doctor_da,when_to_see_doctor_en,review_due_at) values('bypass',1,'published','a','b','c','d','e','f','g','h','i','j','${tomorrow()}')`;
    for (const who of ['anon', USER, SUPPORT, EDITOR, OWNER]) {
      for (const statement of [insert, `update public.${t} set status='published'`, `update public.${t} set name_en='x'`, `delete from public.${t}`, `truncate public.${t}`]) {
        assert.match(errAs(who, statement), /permission denied/, `${who}: ${statement.slice(0, 40)}`);
      }
    }
  });

  test(`${kind}: every editorial RPC enforces its role internally (nil revision: the role gate precedes any lookup)`, () => {
    const k = kinds[kind];
    const calls = {
      list: `select count(*) from public.${k.fn.list}()`, create: `select public.${k.fn.create}(${k.nilCreate})`, next: `select public.${k.fn.next}('${NIL}')`,
      update: `select public.${k.fn.update}(${k.nilUpdate})`, submit: `select public.${k.fn.submit}('${NIL}')`, approve: `select public.${k.fn.approve}('${NIL}')`,
      ret: `select public.${k.fn.ret}('${NIL}')`, publish: `select public.${k.fn.publish}('${NIL}')`, withdraw: `select public.${k.fn.withdraw}('${NIL}')`,
    };
    // A caller "passes the gate" when the call succeeds or fails for a non-authorization reason (e.g. the nil revision).
    const passesGate = (who, statement) => { try { as(who, statement); return true; } catch (error) { return !/clinical_(not_authorized|owner_required)/.test(String(error.stderr)); } };
    for (const [op, statement] of Object.entries(calls)) {
      const ownerOnly = op === 'publish' || op === 'withdraw';
      assert.match(errAs('anon', statement), /permission denied for function/, `anon ${op}`);
      for (const who of [USER, SUPPORT]) assert.match(errAs(who, statement), ownerOnly ? /clinical_owner_required/ : /clinical_not_authorized/, `${who} ${op}`);
      if (ownerOnly) assert.match(errAs(EDITOR, statement), /clinical_owner_required/, `editor ${op}`);
      else assert.ok(passesGate(EDITOR, statement), `editor may ${op}`);
      assert.ok(passesGate(OWNER, statement), `owner may ${op}`);
    }
  });
}

test('the clinical surface is exactly the reviewed set of definer functions with a locked search_path and narrow grants', () => {
  const grantee = `case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end`;
  const rows = sql(`select p.proname||'|'||p.prosecdef||'|'||coalesce(p.proconfig::text,'NONE')||'|'||
      coalesce((select string_agg(${grantee}, ',' order by ${grantee}) from aclexplode(p.proacl) a),'NULL-ACL')
    from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like 'admin\\_%' or p.proname like 'app074\\_%') order by p.proname`);
  const lines = rows.split('\n');
  assert.equal(lines.length, 19, 'exactly 18 admin RPCs + 1 audit helper: a new definer function needs its own review');
  for (const line of lines) {
    const [name, secdef, config, grantees] = line.split('|');
    assert.equal(secdef, 'true', `${name} is SECURITY DEFINER`);
    assert.equal(config, '{"search_path=\\"\\""}', `${name} locks search_path to empty`);
    assert.ok(!/PUBLIC|anon|service_role/.test(grantees), `${name} is not executable by PUBLIC/anon/service_role (${grantees})`);
    assert.equal(grantees, name.startsWith('app074_') ? 'postgres' : 'authenticated,postgres', `${name} grantees`);
  }
});

for (const kind of ['symptom', 'health']) {
  test(`${kind}: review and publication are separate; review evidence is server-derived and publication is immutable`, () => {
    const id = `${kind}-lifecycle`;
    const rev = create(kind, EDITOR, id);
    assert.match(errAs(OWNER, call(kind, 'publish', lit(rev))), /clinical_publication_requires_review/, 'a draft cannot be published');
    step(kind, EDITOR, 'submit', rev);
    assert.match(errAs(OWNER, call(kind, 'publish', lit(rev))), /clinical_publication_requires_review/, 'in_review without a recorded review cannot be published');
    assert.match(errAs(EDITOR, update(kind, EDITOR, rev)), /clinical_draft_not_found_or_immutable/, 'content is frozen while in review');
    assert.match(errAs(OWNER, call(kind, 'approve', `'${NIL}'`)), /clinical_review_not_pending/);
    step(kind, EDITOR, 'approve', rev);
    assert.equal(row(kind, rev, 'reviewed_by'), EDITOR, 'reviewer is the authenticated actor, never a parameter');
    assert.equal(row(kind, rev, 'reviewed_at is not null'), 'true');
    assert.match(errAs(OWNER, call(kind, 'approve', lit(rev))), /clinical_review_not_pending/, 'a review cannot be re-stamped');
    assert.equal(row(kind, rev, 'reviewed_by'), EDITOR);
    step(kind, EDITOR, 'ret', rev);
    assert.equal(status(kind, rev), 'draft');
    assert.equal(sql(`select (reviewed_by is null and reviewed_at is null)::text from public.${kinds[kind].table} where revision_id='${rev}'`), 'true', 'returning clears the review evidence');
    assert.match(errAs(OWNER, call(kind, 'publish', lit(rev))), /clinical_publication_requires_review/);
    step(kind, EDITOR, 'submit', rev);
    assert.equal(sql(`select (reviewed_by is null and reviewed_at is null)::text from public.${kinds[kind].table} where revision_id='${rev}'`), 'true', 'resubmitting starts a fresh review');
    step(kind, EDITOR, 'approve', rev);
    assert.match(errAs(EDITOR, call(kind, 'publish', lit(rev))), /clinical_owner_required/);
    step(kind, OWNER, 'publish', rev);
    assert.equal(status(kind, rev), 'published');
    const frozen = sql(`select md5(t::text) from public.${kinds[kind].table} t where revision_id='${rev}'`);
    for (const statement of [update(kind, OWNER, rev, { da: 'changed' }), call(kind, 'submit', lit(rev)), call(kind, 'approve', lit(rev)), call(kind, 'ret', lit(rev)), call(kind, 'publish', lit(rev))]) {
      for (const who of [EDITOR, OWNER]) assert.match(errAs(who, statement), /clinical_(draft_not_found_or_immutable|review_not_pending|review_not_found|publication_requires_review|owner_required)/);
    }
    assert.equal(sql(`select md5(t::text) from public.${kinds[kind].table} t where revision_id='${rev}'`), frozen, 'a published revision is unchanged by every lifecycle call');
    for (const who of [EDITOR, SUPPORT]) assert.match(errAs(who, call(kind, 'withdraw', lit(rev))), /clinical_owner_required/);
    step(kind, OWNER, 'withdraw', rev);
    assert.equal(status(kind, rev), 'withdrawn');
    assert.match(errAs(OWNER, call(kind, 'withdraw', lit(rev))), /clinical_published_revision_not_found/);
    assert.match(errAs(OWNER, call(kind, 'publish', lit(rev))), /clinical_publication_requires_review/, 'a withdrawn revision is never republished');
    assert.ok(step(kind, EDITOR, 'next', rev), 'changing content requires a new revision');
  });

  test(`${kind}: publication requires a nonblank source, a current Copenhagen due date and complete DA/EN content`, () => {
    const attempt = (id, o) => { const rev = reviewed(kind, id, o); return errAs(OWNER, call(kind, 'publish', lit(rev))); };
    assert.match(attempt(`${kind}-nosource`, { source: null }), /clinical_publication_prerequisites_not_met/);
    assert.match(attempt(`${kind}-blanksource`, { source: '   ' }), /clinical_publication_prerequisites_not_met/);
    assert.match(attempt(`${kind}-nodue`, { due: null }), /clinical_publication_prerequisites_not_met/);
    assert.match(attempt(`${kind}-expired`, { due: yesterday() }), /clinical_publication_prerequisites_not_met/);
    assert.match(attempt(`${kind}-blankda`, { da: ' ' }), /clinical_publication_prerequisites_not_met/);
    assert.match(attempt(`${kind}-blanken`, { en: '' }), /clinical_publication_prerequisites_not_met/);
    const dueToday = reviewed(kind, `${kind}-due-today`, { due: today() });
    step(kind, OWNER, 'publish', dueToday);
    assert.equal(status(kind, dueToday), 'published', 'a review date of today (Copenhagen) is still current');
  });
}

test('health: published common_symptoms must reference existing logical symptom ids', () => {
  const unknown = reviewed('health', 'health-unknown-symptom', { symptoms: `array['no-such-symptom']` });
  assert.match(errAs(OWNER, call('health', 'publish', lit(unknown))), /clinical_unknown_symptom_logical_id/);
  const nullElement = reviewed('health', 'health-null-symptom', { symptoms: `array[null]::text[]` });
  assert.match(errAs(OWNER, call('health', 'publish', lit(nullElement))), /clinical_unknown_symptom_logical_id/);
  const known = reviewed('health', 'health-known-symptom', { symptoms: `array['cramps']` });
  step('health', OWNER, 'publish', known);
  assert.equal(status('health', known), 'published');
});

test('one published revision per logical id: replacement is atomic, serialized and never leaves two current revisions', async () => {
  const v1 = published('symptom', 'sym-one-published');
  assert.match(errorFor(`insert into public.symptom_glossary(id,content_version,status,name_da,name_en,description_da,description_en,review_due_at) values('sym-one-published',9,'published','a','b','c','d','${tomorrow()}')`), /symptom_glossary_one_published_revision_per_id/);
  const v2 = step('symptom', EDITOR, 'next', v1);
  const v3 = step('symptom', EDITOR, 'next', v1);
  for (const rev of [v2, v3]) { step('symptom', EDITOR, 'submit', rev); step('symptom', EDITOR, 'approve', rev); }
  assert.equal(states('symptom', 'sym-one-published'), 'v1=published,v2=in_review,v3=in_review');
  const publish = (rev, hold) => sqlAsync(`${auth(OWNER)} begin; select public.admin_publish_symptom_glossary('${rev}'); ${hold ? `select pg_sleep(${hold});` : ''} commit;`);
  const first = publish(v2, 1.2);
  await delay(400);
  const second = publish(v3, 0);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, `the second publication waits for the first and then replaces it: ${b.stderr}`);
  assert.equal(states('symptom', 'sym-one-published'), 'v1=withdrawn,v2=withdrawn,v3=published');
  assert.equal(sql(`select count(*) from public.symptom_glossary where id='sym-one-published' and status='published'`), '1');
  // Concurrent next-revision creation must hand out distinct versions, not collide on (id, content_version).
  const base = published('symptom', 'sym-next-race');
  const slow = sqlAsync(`${auth(EDITOR)} begin; select public.admin_create_next_symptom_glossary_revision('${base}'); select pg_sleep(1); commit;`);
  await delay(300);
  const quick = sqlAsync(`${auth(OWNER)} begin; select public.admin_create_next_symptom_glossary_revision('${base}'); commit;`);
  const [c, d] = await Promise.all([slow, quick]);
  assert.equal(c.code, 0, c.stderr);
  assert.equal(d.code, 0, d.stderr);
  assert.equal(sql(`select string_agg(content_version::text, ',' order by content_version) from public.symptom_glossary where id='sym-next-race'`), '1,2,3');
  assert.equal(sql(`select count(*) from public.activity_log where entity_label like 'sym-next-race@v%' and action='revised'`), '2');
});

test('audit: server-derived actor, no content, append-only, and every lifecycle write is atomic with its audit row', () => {
  const rev = create('symptom', EDITOR, 'sym-audit', { da: 'SECRET-ARTICLE-BODY-DA', en: 'SECRET-ARTICLE-BODY-EN' });
  step('symptom', EDITOR, 'submit', rev);
  step('symptom', EDITOR, 'approve', rev);
  step('symptom', OWNER, 'publish', rev);
  const rows = sql(`select action||'|'||actor_id||'|'||entity_type||'|'||entity_label||'|'||(entity_id='${rev}')::text from public.activity_log where entity_id='${rev}' order by created_at, action`).split('\n');
  assert.deepEqual(rows.map((line) => line.split('|')[0]).sort(), ['created', 'published', 'reviewed', 'submitted']);
  assert.ok(rows.every((line) => line.endsWith('|symptom_glossary|sym-audit@v1|true')), `label is id@version and entity_id is the revision uuid: ${rows.join(' ; ')}`);
  assert.equal(sql(`select actor_id from public.activity_log where entity_id='${rev}' and action='published'`), OWNER);
  assert.equal(sql(`select actor_id from public.activity_log where entity_id='${rev}' and action='reviewed'`), EDITOR);
  assert.equal(sql(`select count(*) from public.activity_log where entity_label ilike '%SECRET-ARTICLE%' or actor_name ilike '%SECRET%'`), '0', 'article text never enters the audit log');
  for (const who of ['anon', USER, SUPPORT, EDITOR, OWNER]) {
    for (const statement of [`insert into public.activity_log(actor_name,action,entity_type,entity_label) values('forged','published','symptom_glossary','x')`, `update public.activity_log set actor_name='x'`, 'delete from public.activity_log', 'truncate public.activity_log']) {
      assert.match(errAs(who, statement), /permission denied/, `${who}: ${statement.slice(0, 30)}`);
    }
  }
  assert.ok(as(EDITOR, 'select count(*) from public.activity_log') > 0, 'admins keep read access to the trail');
  assert.equal(as(USER, 'select count(*) from public.activity_log'), '0', 'non-admins never read it');

  // Make the audit append fail for one action at a time and prove the clinical change rolled back with it.
  sql(`create function public.zz_fail_audit() returns trigger language plpgsql as $$ begin if new.action = current_setting('app.fail_action', true) then raise exception 'AUDIT_FAIL(%)', new.action; end if; return new; end $$;
    create trigger zz_fail_audit before insert on public.activity_log for each row execute function public.zz_fail_audit();`);
  try {
    const fails = (who, action, statement) => errAs(who, `set app.fail_action='${action}'; ${statement}`);
    const snapshot = (id) => `${sql(`select string_agg(content_version||':'||status||':'||coalesce(reviewed_by::text,'-')||':'||(published_at is not null)::text, '|' order by content_version) from public.symptom_glossary where id='${id}'`)}#${auditCount()}`;
    const live = published('symptom', 'sym-atomic');
    const next = step('symptom', EDITOR, 'next', live);
    step('symptom', EDITOR, 'submit', next);
    const baseline = snapshot('sym-atomic');
    assert.match(fails(EDITOR, 'reviewed', call('symptom', 'approve', lit(next))), /AUDIT_FAIL\(reviewed\)/);
    assert.equal(snapshot('sym-atomic'), baseline, 'review rolled back');
    step('symptom', EDITOR, 'approve', next);
    const reviewedBaseline = snapshot('sym-atomic');
    assert.match(fails(OWNER, 'withdrawn', call('symptom', 'publish', lit(next))), /AUDIT_FAIL\(withdrawn\)/);
    assert.equal(snapshot('sym-atomic'), reviewedBaseline, 'predecessor audit failure leaves predecessor published and successor in review');
    assert.match(fails(OWNER, 'published', call('symptom', 'publish', lit(next))), /AUDIT_FAIL\(published\)/);
    assert.equal(snapshot('sym-atomic'), reviewedBaseline, 'final audit failure rolls the whole replacement back');
    assert.match(fails(EDITOR, 'revised', call('symptom', 'next', lit(live))), /AUDIT_FAIL\(revised\)/);
    assert.equal(snapshot('sym-atomic'), reviewedBaseline, 'no revision without its audit row');
    assert.match(fails(EDITOR, 'created', `select public.admin_create_symptom_glossary_draft('sym-ghost','a','b','c','d',null,null,null)`), /AUDIT_FAIL\(created\)/);
    assert.equal(sql(`select count(*) from public.symptom_glossary where id='sym-ghost'`), '0');
    assert.match(fails(OWNER, 'withdrawn', call('symptom', 'withdraw', lit(live))), /AUDIT_FAIL\(withdrawn\)/);
    assert.equal(status('symptom', live), 'published');
    const draft = create('symptom', EDITOR, 'sym-atomic-2');
    assert.match(fails(EDITOR, 'submitted', call('symptom', 'submit', lit(draft))), /AUDIT_FAIL\(submitted\)/);
    assert.equal(status('symptom', draft), 'draft');
    assert.match(fails(EDITOR, 'updated', update('symptom', EDITOR, draft, { da: 'changed' })), /AUDIT_FAIL\(updated\)/);
    assert.equal(row('symptom', draft, 'name_da'), 'DA', 'draft edit rolled back');
    step('symptom', EDITOR, 'submit', draft);
    assert.match(fails(EDITOR, 'returned', call('symptom', 'ret', lit(draft))), /AUDIT_FAIL\(returned\)/);
    assert.equal(status('symptom', draft), 'in_review');
  } finally {
    sql('drop trigger zz_fail_audit on public.activity_log; drop function public.zz_fail_audit();');
  }
});
