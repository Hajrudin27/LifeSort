// APP-040 regression: the Economy numeric transport the mobile money boundary relies on.
// Uses the established scratch-Postgres workflow with the real Economy table definitions.
// No .env, Supabase CLI, remote URL, existing database or schema change is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const bin = process.env.APP040_PG_BIN || path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app040-'));
const cluster = path.join(scratch, 'db');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const psqlArgs = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', '55432', '-U', 'postgres', '-d', 'postgres'];
function sql(source) {
  return execFileSync(path.join(bin, 'psql'), psqlArgs, { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
const ECONOMY_MONEY = {
  expenses: ['amount'],
  expense_category_budgets: ['monthly_limit'],
  income: ['amount'],
  savings_goals: ['target_amount', 'saved_amount'],
  savings_history: ['amount'],
  savings_extra: ['amount'],
};
/** Exact decimal text the client sends for MinorUnits (mirrors core/money/decimal.ts). */
const decimal = (minor) => {
  const digits = String(Math.abs(minor)).padStart(3, '0');
  return `${minor < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
};
// Includes the edge of the client's contiguous supported range: ±2^33 DKK and the cents on either side of it.
const MINOR_UNITS = [0, 1, -1, 50, 1250, -2575, 858993459199, 858993459200, -858993459200, 858993459201];
/** PostgREST's insert shape: only the body's columns, populated from the JSON body, so defaults still apply. */
function insertLikePostgrest(table, rows) {
  const columns = Object.keys(rows[0]).map((column) => `"${column}"`).join(',');
  sql(`insert into public.${table} (${columns}) select ${columns} from json_populate_recordset(null::public.${table}, $json$${JSON.stringify(rows)}$json$);`);
}

let started = false;
before(() => {
  execFileSync(path.join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-l', path.join(scratch, 'postgres.log'), '-o', `-k ${scratch} -p 55432 -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  const schema = fs.readFileSync(path.join(root, 'supabase/migrations/20260902112000_remote_schema.sql'), 'utf8');
  for (const table of Object.keys(ECONOMY_MONEY)) {
    const definition = schema.match(new RegExp(`CREATE TABLE "public"\\."${table}" \\([\\s\\S]*?\\n\\);`));
    assert.ok(definition, `migration defines public.${table}`);
    sql(definition[0]);
  }
});
after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
  console.log(`Scratch cluster ${started ? 'stopped' : 'not started'}; local test evidence retained at ${scratch}`);
});

test('every Economy money column is unconstrained numeric (server canonical stays major-unit DKK)', () => {
  for (const [table, columns] of Object.entries(ECONOMY_MONEY)) {
    for (const column of columns) {
      assert.equal(sql(`select data_type || ':' || coalesce(numeric_scale::text, 'none') from information_schema.columns
        where table_schema='public' and table_name='${table}' and column_name='${column}'`), 'numeric:none');
    }
  }
});

test('decimal strings in a JSON body populate numeric exactly, as PostgREST inserts them', () => {
  const rows = MINOR_UNITS.map((minor, i) => ({ id: `e${i}`, user_id: A, name: 'Synthetic', amount: decimal(minor), category: 'other', next_payment_date: '2026-09-01' }));
  insertLikePostgrest('expenses', rows);
  const stored = sql(`select string_agg(amount::text, ',' order by id) from public.expenses`).split(',');
  assert.deepEqual(stored, MINOR_UNITS.map(decimal)); // ids e0..e9 sort in input order
});

test('numeric is emitted as an unquoted JSON number literal that JSON.parse turns into a JS number', () => {
  const body = sql(`select coalesce(json_agg(t order by t.id), '[]') from (select id, amount from public.expenses) t`);
  const parsed = JSON.parse(body);
  for (const row of parsed) {
    const minor = MINOR_UNITS[Number(row.id.slice(1))];
    assert.equal(typeof row.amount, 'number');
    assert.ok(body.includes(`"amount":${decimal(minor)}`), 'literal keeps the stored decimal text');
    assert.equal(row.amount, Number(decimal(minor)));
  }
});

test('legacy sub-cent values are stored verbatim, so the client must reject them rather than trust the column', () => {
  // A pre-APP-040 client sent JS numbers; a third decimal was accepted unchanged, at any magnitude.
  insertLikePostgrest('income', [
    { user_id: A, month_key: '2026-09', amount: 12.345 },
    { user_id: A, month_key: '2026-10', amount: '5000000000.001' },
  ]);
  assert.equal(sql(`select string_agg(amount::text, ',' order by month_key) from public.income`), '12.345,5000000000.001');
  const body = sql(`select json_agg(t order by t.month_key) from (select month_key, amount from public.income) t`);
  assert.match(body, /"amount":12\.345/);
  assert.match(body, /"amount":5000000000\.001/);
  // After JSON.parse the high-magnitude value is not the double of any cent: exact client ingress rejects it.
  const parsed = JSON.parse(body)[1].amount;
  assert.notEqual(parsed, Number('5000000000.00'));
  assert.notEqual(parsed, Number('5000000000.01'));
});

test('a high-magnitude sub-cent numeric reaches JSON.parse as exactly a cent double, so the client must refuse that double', () => {
  // numeric keeps 20000000000000.001 exactly, and PostgREST emits it verbatim; only JSON.parse loses the third decimal.
  const stored = ['20000000000000.001', '-20000000000000.001', '20000000000000.00'];
  insertLikePostgrest('savings_history', stored.map((amount, i) => ({ id: `h${i}`, user_id: A, goal_id: 'g', amount, date: '2026-09-01T00:00:00Z' })));
  assert.equal(sql(`select string_agg(amount::text, ',' order by id) from public.savings_history`), stored.join(','));
  const body = sql(`select json_agg(t order by t.id) from (select id, amount from public.savings_history) t`);
  for (const amount of stored) assert.ok(body.includes(`"amount":${amount}`), 'literal keeps the stored decimal text');
  const [aliased, negative, exactCent] = JSON.parse(body).map((row) => row.amount);
  // The sub-cent row and the whole-cent row are the same JS number: no exact-cent test can tell them apart.
  assert.equal(aliased, Number('20000000000000.00'));
  assert.equal(aliased, exactCent);
  assert.equal(negative, Number('-20000000000000.00'));
  // The sub-cent probe the client applies (core/money/decimal.ts isSubCentDistinguishable) fails for this cent,
  // so serverNumericToMinorUnits rejects both rows (proved against the client code in __tests__/money.test.ts).
  assert.equal(Number('20000000000000.000001'), exactCent);
  // At the supported edge the same probe distinguishes both neighbours of the cent.
  assert.notEqual(Number('8589934592.000001'), Number('8589934592.00'));
  assert.notEqual(Number('8589934591.999999'), Number('8589934592.00'));
});
