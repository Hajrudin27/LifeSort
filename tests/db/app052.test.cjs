// APP-052 runs the actual migration only in a fresh disposable PostgreSQL cluster.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const bin = path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app052-'));
const cluster = path.join(scratch, 'db');
const owner = '11111111-1111-4111-8111-111111111111';
const stranger = '22222222-2222-4222-8222-222222222222';
let started = false;
function sql(source) {
  return execFileSync(path.join(bin, 'psql'), ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', '55452', '-U', 'postgres', '-d', 'postgres'],
    { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function asUser(id, statement) {
  return sql(`set role authenticated; set request.jwt.claim.sub = '${id}'; ${statement}; reset role;`);
}
function rejected(statement) { assert.throws(() => sql(statement)); }
function rejectedByConstraint(statement, constraint) {
  assert.throws(() => sql(statement), (error) => {
    assert.match(error.stderr.toString(), new RegExp(`violates check constraint "${constraint}"`));
    return true;
  });
}
before(() => {
  execFileSync(path.join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-l', path.join(scratch, 'postgres.log'), '-o', `-k ${scratch} -p 55452 -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  sql(`create schema auth; create role authenticated;
    create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    create table public.food_shopping_items(id text not null, user_id uuid not null, label text not null, checked boolean not null default false, primary key(user_id,id));
    alter table public.food_shopping_items enable row level security;
    create policy "select own" on public.food_shopping_items for select to authenticated using ((select auth.uid()) = user_id);
    create policy "insert own" on public.food_shopping_items for insert to authenticated with check ((select auth.uid()) = user_id);
    create policy "update own" on public.food_shopping_items for update to authenticated using ((select auth.uid()) = user_id);
    create policy "delete own" on public.food_shopping_items for delete to authenticated using ((select auth.uid()) = user_id);
    grant usage on schema public, auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant select,insert,update,delete on public.food_shopping_items to authenticated;
    insert into public.food_shopping_items values ('old','${owner}','Manual milk',true);`);
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260921182524_shopping_list_derivation.sql'), 'utf8'));
});
after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('historical item is manual; owner can create/read/update/delete and base deletion cascades', () => {
  assert.equal(sql("select source_kind || ':' || label || ':' || checked from food_shopping_items where id='old'"), 'manual:Manual milk:true');
  asUser(owner, `insert into food_shopping_items(id,user_id,label,source_kind) values ('derived','${owner}','Potatoes','meal_plan')`);
  asUser(owner, `insert into food_shopping_item_derivations(user_id,shopping_item_id,week_key,identity_kind,family_id,identity_unit,amount_kind,current_quantity,current_unit,provenance)
    values ('${owner}','derived','2026-W39','family','potato','g','structured',500,'g','[{"recipeId":"r"}]')`);
  assert.equal(asUser(owner, "select count(*) from food_shopping_item_derivations where shopping_item_id='derived'"), '1');
  asUser(owner, "update food_shopping_item_derivations set current_quantity=600 where shopping_item_id='derived'");
  assert.equal(sql("select current_quantity from food_shopping_item_derivations where shopping_item_id='derived'"), '600');
  asUser(owner, "delete from food_shopping_item_derivations where shopping_item_id='derived'");
  assert.equal(sql("select count(*) from food_shopping_item_derivations where shopping_item_id='derived'"), '0');
  asUser(owner, `insert into food_shopping_item_derivations(user_id,shopping_item_id,week_key,identity_kind,family_id,identity_unit,amount_kind,current_quantity,current_unit,provenance)
    values ('${owner}','derived','2026-W39','family','potato','g','structured',600,'g','[{"recipeId":"r"}]')`);
  asUser(owner, "delete from food_shopping_items where id='derived'");
  assert.equal(sql("select count(*) from food_shopping_item_derivations where shopping_item_id='derived'"), '0');
});

test('old-shaped conflict upsert cannot downgrade source or erase child provenance', () => {
  asUser(owner, `insert into food_shopping_items(id,user_id,label,source_kind) values ('compat','${owner}','Potatoes','meal_plan')`);
  asUser(owner, `insert into food_shopping_item_derivations(user_id,shopping_item_id,week_key,identity_kind,family_id,identity_unit,amount_kind,current_quantity,current_unit,provenance)
    values ('${owner}','compat','2026-W39','family','potato','g','structured',500,'g','[{"recipeId":"r"}]')`);
  // PostgREST upsert updates all inserted columns, including the defaulted discriminator.
  asUser(owner, `insert into food_shopping_items(id,user_id,label,checked) values ('compat','${owner}','Edited on old client',true)
    on conflict(user_id,id) do update set label=excluded.label, checked=excluded.checked, source_kind=excluded.source_kind`);
  assert.equal(sql("select source_kind || ':' || label from food_shopping_items where id='compat'"), 'meal_plan:Edited on old client');
  assert.equal(sql("select week_key || ':' || current_quantity || ':' || (provenance->0->>'recipeId') from food_shopping_item_derivations where shopping_item_id='compat'"), '2026-W39:500:r');
});

test('constraints reject invalid source, quantity, units and malformed pair', () => {
  rejectedByConstraint(`insert into food_shopping_items values ('bad','${owner}','Bad',false,'other')`, 'food_shopping_source_kind_check');
  const cases = [
    ['zero', '0', "'g'", `'[{"recipeId":"r"}]'`, 'food_shopping_derivation_amount_check'],
    ['negative', '-1', "'g'", `'[{"recipeId":"r"}]'`, 'food_shopping_derivation_amount_check'],
    ['nan', "'NaN'::numeric", "'g'", `'[{"recipeId":"r"}]'`, 'food_shopping_derivation_amount_check'],
    ['infinity', "'Infinity'::numeric", "'g'", `'[{"recipeId":"r"}]'`, 'food_shopping_derivation_amount_check'],
    ['null-quantity', 'null', "'g'", `'[{"recipeId":"r"}]'`, 'food_shopping_derivation_amount_check'],
    ['null-unit', '1', 'null', `'[{"recipeId":"r"}]'`, 'food_shopping_derivation_amount_check'],
    ['invalid-unit', '1', "'kg'", `'[{"recipeId":"r"}]'`, 'food_shopping_derivation_amount_check'],
    ['malformed-provenance', '1', "'g'", "'{}'", 'food_shopping_item_derivations_provenance_check'],
  ];
  for (const [id, quantity, unit, provenance, constraint] of cases) {
    // A distinct valid parent and unused child key ensure PK/FK cannot mask the CHECK.
    asUser(owner, `insert into food_shopping_items(id,user_id,label,source_kind) values ('${id}','${owner}','Item','meal_plan')`);
    assert.equal(sql(`select count(*) from food_shopping_item_derivations where shopping_item_id='${id}'`), '0');
    rejectedByConstraint(`insert into food_shopping_item_derivations(user_id,shopping_item_id,week_key,identity_kind,family_id,identity_unit,amount_kind,current_quantity,current_unit,provenance)
      values ('${owner}','${id}','2026-W39','family','potato','g','structured',${quantity},${unit},${provenance})`, constraint);
    assert.equal(sql(`select count(*) from food_shopping_item_derivations where shopping_item_id='${id}'`), '0');
  }
});

test('cross-user RLS denies SELECT, UPDATE and DELETE of base and derivation rows', () => {
  assert.equal(asUser(stranger, "select count(*) from food_shopping_items where id='compat'"), '0');
  assert.equal(asUser(stranger, "select count(*) from food_shopping_item_derivations where shopping_item_id='compat'"), '0');
  assert.equal(asUser(stranger, "update food_shopping_items set label='Stranger edit', checked=false, source_kind='manual' where id='compat' returning id"), '');
  assert.equal(sql("select label || ':' || checked || ':' || source_kind from food_shopping_items where id='compat'"), 'Edited on old client:true:meal_plan');
  assert.equal(asUser(stranger, "update food_shopping_item_derivations set current_quantity=9 where shopping_item_id='compat' returning shopping_item_id"), '');
  assert.equal(asUser(stranger, "delete from food_shopping_item_derivations where shopping_item_id='compat' returning shopping_item_id"), '');
  assert.equal(asUser(stranger, "delete from food_shopping_items where id='compat' returning id"), '');
  sql(`insert into food_shopping_items(id,user_id,label,source_kind) values ('foreign-base','${owner}','Item','meal_plan')`);
  rejected(`set role authenticated; set request.jwt.claim.sub = '${stranger}'; insert into food_shopping_item_derivations(user_id,shopping_item_id,week_key,identity_kind,family_id,identity_unit,amount_kind,current_quantity,current_unit,provenance)
    values ('${owner}','foreign-base','2026-W39','family','potato','g','structured',1,'g','[{"recipeId":"r"}]')`);
  rejected(`set role authenticated; set request.jwt.claim.sub = '${owner}'; update food_shopping_item_derivations set user_id='${stranger}' where shopping_item_id='compat'`);
  assert.equal(sql("select count(*) from food_shopping_item_derivations where shopping_item_id='compat'"), '1');
});
