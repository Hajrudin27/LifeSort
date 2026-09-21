// APP-048: exercise the actual catalogue migration in disposable local Postgres.
// No remote URL, credentials, existing database or remote migration is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const bin = path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app048-'));
const cluster = path.join(scratch, 'db');
let started = false;
function sql(source) {
  return execFileSync(path.join(bin, 'psql'), ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', '55448', '-U', 'postgres', '-d', 'postgres'], { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
before(() => {
  execFileSync(path.join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-l', path.join(scratch, 'postgres.log'), '-o', `-k ${scratch} -p 55448 -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  sql("create role authenticated; create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid'; create table public.admin_users(id uuid);");
  const schema = fs.readFileSync(path.join(root, 'supabase/migrations/20260902112000_remote_schema.sql'), 'utf8');
  for (const table of ['global_standard_prices', 'global_offers']) {
    const definition = schema.match(new RegExp(`CREATE TABLE "public"\\."${table}" \\([\\s\\S]*?\\n\\);`));
    assert.ok(definition);
    sql(definition[0]);
  }
  sql("insert into global_standard_prices(product_name, store, price) values ('Synthetic eggs', 'Netto', 15); insert into global_offers(standard_price_id, offer_price, valid_from, valid_to) select id, 10, '2026-09-21', '2026-09-27' from global_standard_prices;");
  sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260905140726_add_products_table.sql'), 'utf8'));
});
after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  fs.rmSync(scratch, { recursive: true, force: true });
});
test('catalogue reads follow both real foreign keys after product_name removal', () => {
  assert.equal(sql("select count(*) from information_schema.columns where table_name='global_standard_prices' and column_name='product_name'"), '0');
  const result = JSON.parse(sql(`select json_build_object('product', p.name, 'store', s.store, 'price', s.price, 'offer', o.offer_price, 'from', o.valid_from, 'to', o.valid_to) from products p join global_standard_prices s on s.product_id=p.id join global_offers o on o.standard_price_id=s.id`));
  assert.deepEqual(result, { product: 'Synthetic eggs', store: 'Netto', price: 15, offer: 10, from: '2026-09-21', to: '2026-09-27' });
  assert.equal(sql("select count(*) from pg_constraint where contype='f' and conrelid in ('global_standard_prices'::regclass, 'global_offers'::regclass)"), '2');
});
test('standard price schema provides no observed/published/campaign timestamp', () => {
  assert.equal(sql("select count(*) from information_schema.columns where table_name='global_standard_prices' and column_name in ('observed_at','published_at','valid_from','valid_to')"), '0');
  assert.equal(sql("select count(*) from information_schema.columns where table_name='global_standard_prices' and column_name='updated_at'"), '1');
});
