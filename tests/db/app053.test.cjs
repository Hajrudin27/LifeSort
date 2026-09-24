// APP-053: apply the actual additive migration to a disposable local Postgres cluster.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const bin = path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app053-'));
const cluster = path.join(scratch, 'db');
const port = '55453';
const NORMAL = '10000000-0000-4000-8000-000000000001';
const OWNER = '10000000-0000-4000-8000-000000000002';
const EDITOR = '10000000-0000-4000-8000-000000000003';
const SUPPORT = '10000000-0000-4000-8000-000000000004';
const DRAFT = '20000000-0000-4000-8000-000000000001';
const UNCLEARED = '20000000-0000-4000-8000-000000000002';
const ELIGIBLE = '20000000-0000-4000-8000-000000000003';
let started = false;
function sql(source) {
  return execFileSync(path.join(bin, 'psql'), ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', port, '-U', 'postgres', '-d', 'postgres'],
    { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function errorFor(source) {
  try { sql(source); } catch (error) { return String(error.stderr); }
  assert.fail('SQL unexpectedly succeeded');
}
const roleStatement = (role, userId, source) => `set role ${role}; set request.jwt.claim.sub = '${userId}'; ${source}`;
function asRole(role, userId, source) { return sql(roleStatement(role, userId, source)); }

before(() => {
  execFileSync(path.join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-l', path.join(scratch, 'postgres.log'), '-o', `-k ${scratch} -p ${port} -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  sql(`create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create table public.admin_users(
      id uuid primary key,
      role text not null check (role = any(array['owner','editor','support']::text[])),
      full_name text not null,
      created_at timestamptz not null default now()
    );
    alter table public.admin_users enable row level security;
    create policy "Users can check their own admin status" on public.admin_users for select to public using (auth.uid() = id);
    grant select on public.admin_users to authenticated, anon;
    create table public.global_standard_prices(id uuid primary key default gen_random_uuid(), product_name text not null, store text not null, price numeric not null, updated_at timestamptz not null default now());
    alter table public.global_standard_prices enable row level security;
    create table public.global_offers(id uuid primary key default gen_random_uuid(), standard_price_id uuid not null, offer_price numeric not null, valid_from date not null, valid_to date not null, created_at timestamptz not null default now());
    alter table public.global_offers enable row level security;
    grant select, insert, update, delete on public.global_standard_prices, public.global_offers to authenticated;
    grant select on public.global_standard_prices, public.global_offers to anon;
    insert into public.admin_users(id, role, full_name) values
      ('${OWNER}', 'owner', 'Owner'), ('${EDITOR}', 'editor', 'Editor'), ('${SUPPORT}', 'support', 'Support');
    insert into public.global_standard_prices(product_name, store, price) values ('Synthetic eggs', 'Netto', 15);
    insert into public.global_offers(standard_price_id, offer_price, valid_from, valid_to) select id, 10, '2026-09-21', '2026-09-27' from public.global_standard_prices;`);
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260905140726_add_products_table.sql'), 'utf8'));
  sql(`grant select, insert, update, delete on public.products to authenticated;
    grant select on public.products to anon;
    create or replace function public.admin_has_role(p_roles text[])
    returns boolean language sql stable set search_path = public, pg_temp as $$
      select exists (select 1 from public.admin_users a where a.id = auth.uid() and a.role = any(p_roles))
    $$;
    revoke all on function public.admin_has_role(text[]) from public, anon;
    grant execute on function public.admin_has_role(text[]) to authenticated;

    drop policy if exists "Admins can insert products" on public.products;
    create policy "Admins can insert products" on public.products for insert to authenticated with check (public.admin_has_role(array['owner','editor']::text[]));
    drop policy if exists "Admins can update products" on public.products;
    create policy "Admins can update products" on public.products for update to authenticated using (public.admin_has_role(array['owner','editor']::text[])) with check (public.admin_has_role(array['owner','editor']::text[]));
    drop policy if exists "Admins can delete products" on public.products;
    create policy "Admins can delete products" on public.products for delete to authenticated using (public.admin_has_role(array['owner','editor']::text[]));

    create policy "Admins can insert global prices" on public.global_standard_prices for insert to authenticated with check (public.admin_has_role(array['owner','editor']::text[]));
    create policy "Admins can update global prices" on public.global_standard_prices for update to authenticated using (public.admin_has_role(array['owner','editor']::text[])) with check (public.admin_has_role(array['owner','editor']::text[]));
    create policy "Admins can delete global prices" on public.global_standard_prices for delete to authenticated using (public.admin_has_role(array['owner','editor']::text[]));
    create policy "Authenticated users can view global prices" on public.global_standard_prices for select to authenticated using (true);

    create policy "Admins can insert global offers" on public.global_offers for insert to authenticated with check (public.admin_has_role(array['owner','editor']::text[]));
    create policy "Admins can update global offers" on public.global_offers for update to authenticated using (public.admin_has_role(array['owner','editor']::text[])) with check (public.admin_has_role(array['owner','editor']::text[]));
    create policy "Admins can delete global offers" on public.global_offers for delete to authenticated using (public.admin_has_role(array['owner','editor']::text[]));
    create policy "Authenticated users can view global offers" on public.global_offers for select to authenticated using (true);`);
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260924222846_offer_aware_planning.sql'), 'utf8'));
  const standardId = sql('select id from public.global_standard_prices limit 1');
  sql(`insert into public.global_offers(id, standard_price_id, offer_price, valid_from, valid_to, published, licence_cleared) values
    ('${DRAFT}', '${standardId}', 8, '2026-09-21', '2026-09-27', false, true),
    ('${UNCLEARED}', '${standardId}', 9, '2026-09-21', '2026-09-27', true, false),
    ('${ELIGIBLE}', '${standardId}', 10, '2026-09-21', '2026-09-27', true, true);`);
});
after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('actual migration adds nullable family mapping and fail-closed offer metadata', () => {
  const columns = JSON.parse(sql(`select json_object_agg(column_name, json_build_object('nullable', is_nullable, 'default', column_default))
    from information_schema.columns where table_schema='public' and ((table_name='products' and column_name='ingredient_family_id')
    or (table_name='global_offers' and column_name in ('published','licence_cleared','member_condition')))`));
  assert.equal(columns.ingredient_family_id.nullable, 'YES');
  assert.equal(columns.member_condition.nullable, 'YES');
  assert.equal(columns.published.nullable, 'NO');
  assert.equal(columns.licence_cleared.nullable, 'NO');
  assert.equal(columns.published.default, 'false');
  assert.equal(columns.licence_cleared.default, 'false');
  assert.ok(Number(sql('select count(*) from public.global_offers where published=false and licence_cleared=false')) >= 1);
});

test('legacy-column reads are fail-closed for ordinary users and complete for owner/editor curation', () => {
  // Deliberately selects only APP-052-era columns without eligibility predicates.
  // RLS, rather than client awareness of APP-053, must decide row visibility.
  const legacyRead = `select coalesce(string_agg(id::text, ',' order by id), '') from (
    select id, standard_price_id, offer_price, valid_from, valid_to from public.global_offers
    where id in ('${DRAFT}','${UNCLEARED}','${ELIGIBLE}')
  ) legacy_offer_rows`;
  assert.equal(asRole('authenticated', NORMAL, legacyRead), ELIGIBLE);
  assert.equal(asRole('authenticated', SUPPORT, legacyRead), ELIGIBLE);
  assert.equal(asRole('authenticated', OWNER, legacyRead), [DRAFT, UNCLEARED, ELIGIBLE].join(','));
  assert.equal(asRole('authenticated', EDITOR, legacyRead), [DRAFT, UNCLEARED, ELIGIBLE].join(','));
  assert.equal(asRole('anon', NORMAL, legacyRead), '');
});

test('owner/editor offer writes still succeed while normal and support writes remain denied', () => {
  const standardId = sql('select id from public.global_standard_prices limit 1');
  const insert = (id) => `insert into public.global_offers(id, standard_price_id, offer_price, valid_from, valid_to)
    values ('${id}', '${standardId}', 7, '2026-09-21', '2026-09-27') returning id`;
  const ownerRow = '30000000-0000-4000-8000-000000000001';
  const editorRow = '30000000-0000-4000-8000-000000000002';
  assert.equal(asRole('authenticated', OWNER, insert(ownerRow)), ownerRow);
  assert.equal(asRole('authenticated', EDITOR, insert(editorRow)), editorRow);
  assert.match(errorFor(roleStatement('authenticated', NORMAL, insert('30000000-0000-4000-8000-000000000003'))), /row-level security/);
  assert.match(errorFor(roleStatement('authenticated', SUPPORT, insert('30000000-0000-4000-8000-000000000004'))), /row-level security/);
  assert.equal(asRole('authenticated', OWNER, `update public.global_offers set offer_price=6 where id='${ownerRow}' returning offer_price`), '6');
  assert.equal(asRole('authenticated', EDITOR, `delete from public.global_offers where id='${editorRow}' returning id`), editorRow);
});

test('member condition accepts null and rejects blank or whitespace through its named check', () => {
  const standardId = sql('select id from public.global_standard_prices limit 1');
  sql(`insert into public.global_offers(standard_price_id, offer_price, valid_from, valid_to, member_condition)
    values ('${standardId}', 9, '2026-09-21', '2026-09-27', null)`);
  for (const value of ["''", "'   '"]) {
    const error = errorFor(`insert into public.global_offers(standard_price_id, offer_price, valid_from, valid_to, member_condition)
      values ('${standardId}', 8, '2026-09-21', '2026-09-27', ${value})`);
    assert.match(error, /global_offers_member_condition_nonblank/);
  }
});

test('existing offer foreign key and unrelated catalogue RLS boundaries remain intact', () => {
  const fk = sql(`select confrelid::regclass::text from pg_constraint
    where conrelid='public.global_offers'::regclass and conname='global_offers_standard_price_id_fkey' and contype='f'`);
  assert.equal(fk, 'global_standard_prices');
  assert.equal(sql(`select string_agg(relname || ':' || relrowsecurity::text, ',' order by relname)
    from pg_class where oid in ('public.products'::regclass, 'public.global_standard_prices'::regclass, 'public.global_offers'::regclass)`),
    'global_offers:true,global_standard_prices:true,products:true');
  assert.equal(sql(`select count(*) from pg_policies where schemaname='public' and tablename in ('products','global_standard_prices','global_offers')
    and 'anon'=any(roles)`), '0');
  assert.equal(sql(`select count(*) from pg_policies where schemaname='public' and tablename in ('products','global_standard_prices','global_offers')
    and cmd in ('INSERT','UPDATE','DELETE') and policyname not like 'Admins can %'`), '0');
  assert.equal(sql(`select count(*) from pg_policies where schemaname='public' and tablename in ('products','global_standard_prices','global_offers')
    and cmd in ('INSERT','UPDATE','DELETE') and policyname like 'Admins can %'`), '9');
  assert.equal(sql(`select count(*) from pg_policies where schemaname='public' and tablename='global_offers'
    and cmd='SELECT' and 'authenticated'=any(roles)`), '2');
  assert.equal(sql(`select count(*) from pg_policies where schemaname='public' and tablename in ('products','global_standard_prices')
    and cmd='SELECT' and 'authenticated'=any(roles) and qual='true'`), '2');
});
