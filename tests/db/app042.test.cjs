// APP-042 migration check: the recurrence columns, their backfill, the strict
// coherence constraint, and the legacy-write compatibility trigger that keeps the
// previous app version working. Uses the established scratch-Postgres workflow
// (docs/migration-verification.md).
// No .env, Supabase CLI, remote URL, project link, existing database or reset is used.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const bin = process.env.APP042_PG_BIN || path.dirname(execFileSync('which', ['postgres'], { encoding: 'utf8' }).trim());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesort-app042-'));
const cluster = path.join(scratch, 'db');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MIGRATION = 'supabase/migrations/20260917120000_expenses_recurrence_frequency.sql';
const CONSTRAINT = /expenses_recurrence_frequency_coherent/;
const psqlArgs = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', scratch, '-p', '55432', '-U', 'postgres', '-d', 'postgres'];
function sql(source) {
  return execFileSync(path.join(bin, 'psql'), psqlArgs, { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function fails(source) {
  try { sql(source); } catch (error) { return String(error.stderr ?? error.message); }
  assert.fail('statement unexpectedly succeeded');
}
const migrate = () => sql(fs.readFileSync(path.join(root, MIGRATION), 'utf8'));
/** cadence/anchor/date/name of one row, as one readable token. */
const row = (id) => sql(`select coalesce(recurrence_frequency, 'null') || '/' || coalesce(recurrence_anchor_day::text, 'null')
  || '/' || next_payment_date || '/' || name from public.expenses where id = '${id}'`);
const state = () =>
  sql(`select string_agg(id || '=' || coalesce(recurrence_frequency, 'null') || '/' ||
       coalesce(recurrence_anchor_day::text, 'null'), ',' order by id) from public.expenses`);

/** Exactly what the previous app version writes: an upsert with no recurrence columns. */
const legacyUpsert = (id, recurring, { name = 'Synthetic', amount = '125.50', date = '2026-09-30' } = {}) =>
  `insert into public.expenses (id, user_id, series_id, is_recurring, name, amount, category, next_payment_date)
   values ('${id}', '${A}', '${id}', ${recurring}, '${name}', ${amount}, 'bill', '${date}')
   on conflict (user_id, id) do update set
     name = excluded.name, amount = excluded.amount,
     is_recurring = excluded.is_recurring, next_payment_date = excluded.next_payment_date;`;
/** What the APP-042 client writes: every column, explicitly. */
const modernUpsert = (id, recurring, frequency, anchorDay, { name = 'Synthetic', date = '2026-09-30' } = {}) =>
  `insert into public.expenses (id, user_id, series_id, is_recurring, recurrence_frequency, recurrence_anchor_day, name, amount, category, next_payment_date)
   values ('${id}', '${A}', '${id}', ${recurring}, ${frequency}, ${anchorDay}, '${name}', 10.00, 'bill', '${date}')
   on conflict (user_id, id) do update set
     name = excluded.name, amount = excluded.amount, is_recurring = excluded.is_recurring,
     recurrence_frequency = excluded.recurrence_frequency, recurrence_anchor_day = excluded.recurrence_anchor_day,
     next_payment_date = excluded.next_payment_date;`;

let started = false;
before(() => {
  execFileSync(path.join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe' });
  execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-l', path.join(scratch, 'postgres.log'), '-o', `-k ${scratch} -p 55432 -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  // The historical table definition, unmodified, plus rows written before APP-042.
  const schema = fs.readFileSync(path.join(root, 'supabase/migrations/20260902112000_remote_schema.sql'), 'utf8');
  const definition = schema.match(/CREATE TABLE "public"\."expenses" \([\s\S]*?\n\);/);
  assert.ok(definition, 'remote schema defines public.expenses');
  sql(definition[0]);
  sql(legacyUpsert('recurring-31', true, { date: '2026-01-31' })
    + legacyUpsert('recurring-15', true, { date: '2026-09-15' })
    + legacyUpsert('one-time-1', false));
});
after(() => {
  if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
  console.log(`Scratch cluster ${started ? 'stopped' : 'not started'}; local test evidence retained at ${scratch}`);
});

test('the historical schema has neither recurrence column, so the migration is required', () => {
  assert.equal(sql(`select count(*) from information_schema.columns where table_schema='public'
    and table_name='expenses' and column_name in ('recurrence_frequency','recurrence_anchor_day')`), '0');
});

// A. Historical backfill.
test('the migration adds both columns, backfills recurring rows and leaves one-time rows NULL', () => {
  migrate();
  assert.equal(sql(`select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name)
    from information_schema.columns where table_schema='public' and table_name='expenses'
    and column_name in ('recurrence_frequency','recurrence_anchor_day')`),
    'recurrence_anchor_day:smallint:YES,recurrence_frequency:text:YES');
  assert.equal(state(), 'one-time-1=null/null,recurring-15=monthly/15,recurring-31=monthly/31');
});

// J. Canonical modern writes.
test('modern writes carrying every column pass unchanged, for each supported cadence', () => {
  for (const [id, frequency, day] of [['m', 'monthly', 1], ['q', 'quarterly', 28], ['y', 'yearly', 31]]) {
    sql(modernUpsert(id, true, `'${frequency}'`, day, { date: '2026-10-01' }));
    assert.equal(row(id), `${frequency}/${day}/2026-10-01/Synthetic`);
  }
  sql(modernUpsert('one-time-2', false, 'null', 'null', { date: '2026-10-01' }));
  assert.equal(row('one-time-2'), 'null/null/2026-10-01/Synthetic');
  // A modern edit of its own row keeps exactly what it sends. The client derives the
  // anchor from the date it is storing, so a re-dated row arrives with the new day.
  sql(modernUpsert('q', true, `'quarterly'`, 31, { name: 'Renamed', date: '2026-12-31' }));
  assert.equal(row('q'), 'quarterly/31/2026-12-31/Renamed');
  // Changing only the cadence leaves the anchor exactly as sent.
  sql(modernUpsert('q', true, `'yearly'`, 31, { name: 'Renamed', date: '2026-12-31' }));
  assert.equal(row('q'), 'yearly/31/2026-12-31/Renamed');
});

test('documented limitation: a write that moves the date while re-sending the stored anchor is re-anchored', () => {
  // In a BEFORE trigger, "cadence and anchor equal to the stored row" is exactly what
  // an old client's date edit looks like, so the new date wins. The APP-042 client
  // always re-derives the anchor from the date it stores, so this only affects a
  // caller that deliberately moves the date while keeping an older anchor.
  sql(modernUpsert('limit-1', true, `'monthly'`, 28, { date: '2026-03-28' }));
  sql(modernUpsert('limit-1', true, `'monthly'`, 28, { name: 'Moved', date: '2026-03-15' }));
  assert.equal(row('limit-1'), 'monthly/15/2026-03-15/Moved');
  // Sending a different anchor is the caller's own input and is stored as sent.
  sql(modernUpsert('limit-1', true, `'monthly'`, 28, { name: 'Explicit', date: '2026-03-15' }));
  assert.equal(row('limit-1'), 'monthly/28/2026-03-15/Explicit');
});

test('documented ambiguity: an UPDATE re-sending the stored cadence and anchor reads as legacy', () => {
  // A row trigger cannot tell "column omitted" from "caller re-sent the stored value".
  // On a plain UPDATE that changes is_recurring while re-sending the stored recurrence
  // columns, the write therefore takes the compatibility path: turning recurrence off
  // clears both columns instead of being rejected as an incoherent one-time row.
  sql(modernUpsert('ambiguous-off', true, `'monthly'`, 15, { date: '2026-08-15' }));
  sql(`update public.expenses set is_recurring = false, recurrence_frequency = 'monthly',
       recurrence_anchor_day = 15, name = 'Off with stale metadata' where id = 'ambiguous-off';`);
  assert.equal(row('ambiguous-off'), 'null/null/2026-08-15/Off with stale metadata');

  // The same values sent as an UPSERT are still rejected: PostgreSQL validates the
  // proposed INSERT row, which is incoherent, before it ever resolves the conflict.
  sql(modernUpsert('ambiguous-upsert', true, `'monthly'`, 15, { date: '2026-08-15' }));
  assert.match(fails(modernUpsert('ambiguous-upsert', false, `'monthly'`, 15, { date: '2026-08-15' })), CONSTRAINT);
  assert.equal(row('ambiguous-upsert'), 'monthly/15/2026-08-15/Synthetic');

  // The mirror image: turning recurrence on while the stored row has no metadata
  // normalizes to the pre-APP-042 default rather than failing.
  sql(modernUpsert('ambiguous-on', false, 'null', 'null', { date: '2026-08-09' }));
  sql(modernUpsert('ambiguous-on', true, 'null', 'null', { name: 'On with no metadata', date: '2026-08-09' }));
  assert.equal(row('ambiguous-on'), 'monthly/9/2026-08-09/On with no metadata');

  // Metadata that differs from the stored row is the caller's own input: it is left
  // alone, so an incoherent one-time write is still rejected, update or upsert.
  sql(modernUpsert('ambiguous-strict', true, `'monthly'`, 15, { date: '2026-08-15' }));
  assert.match(fails(`update public.expenses set is_recurring = false, recurrence_frequency = 'yearly',
    recurrence_anchor_day = 15 where id = 'ambiguous-strict';`), CONSTRAINT);
  assert.match(fails(`update public.expenses set is_recurring = false, recurrence_anchor_day = 9 where id = 'ambiguous-strict';`), CONSTRAINT);
  assert.equal(row('ambiguous-strict'), 'monthly/15/2026-08-15/Synthetic');
});

// I. Invalid modern metadata is still rejected by the strict CHECK.
test('the constraint rejects every incoherent combination, including an out-of-range anchor', () => {
  for (const [name, statement] of [
    ['cadence without an anchor', modernUpsert('bad-1', true, `'quarterly'`, 'null')],
    ['anchor without a cadence', modernUpsert('bad-2', true, 'null', 15)],
    ['unknown cadence', modernUpsert('bad-3', true, `'weekly'`, 15)],
    ['case-variant cadence', modernUpsert('bad-4', true, `'MONTHLY'`, 15)],
    ['anchor 0', modernUpsert('bad-5', true, `'monthly'`, 0)],
    ['anchor 32', modernUpsert('bad-6', true, `'monthly'`, 32)],
    ['one-time with a cadence', modernUpsert('bad-7', false, `'monthly'`, 'null')],
    ['one-time with an anchor', modernUpsert('bad-8', false, 'null', 15)],
  ]) {
    assert.match(fails(statement), CONSTRAINT, name);
  }
  // Direct updates cannot reach an incoherent state either.
  assert.match(fails(`update public.expenses set recurrence_anchor_day = 32 where id = 'm';`), CONSTRAINT);
  assert.match(fails(`update public.expenses set recurrence_frequency = 'weekly' where id = 'm';`), CONSTRAINT);
  assert.match(fails(`update public.expenses set recurrence_frequency = null where id = 'm';`), CONSTRAINT);
  assert.equal(sql(`select count(*) from public.expenses where id like 'bad-%'`), '0');
});

// B. Old client, brand new row.
test('an old client can still create a recurring expense: monthly, anchored to the date it sent', () => {
  sql(legacyUpsert('old-new', true, { date: '2026-11-30' }));
  assert.equal(row('old-new'), 'monthly/30/2026-11-30/Synthetic');
  sql(legacyUpsert('old-one-time', false, { date: '2026-11-05' }));
  assert.equal(row('old-one-time'), 'null/null/2026-11-05/Synthetic');
});

// C, D, E. Old client edits of an existing row must not rewrite the cadence.
test('an old client editing name or amount preserves monthly, quarterly and yearly schedules', () => {
  for (const [id, frequency, day] of [['keep-m', 'monthly', 15], ['keep-q', 'quarterly', 28], ['keep-y', 'yearly', 31]]) {
    sql(modernUpsert(id, true, `'${frequency}'`, day, { date: '2026-05-31' }));
    sql(legacyUpsert(id, true, { name: 'Renamed by old client', amount: '42.00', date: '2026-05-31' }));
    assert.equal(row(id), `${frequency}/${day}/2026-05-31/Renamed by old client`);
    assert.equal(sql(`select amount from public.expenses where id = '${id}'`), '42.00');
  }
});

// F. Old client date edit: cadence preserved, anchor follows the new date.
test('an old client changing the date keeps the cadence and re-anchors to the new day', () => {
  sql(modernUpsert('redate', true, `'quarterly'`, 28, { date: '2026-05-28' }));
  sql(legacyUpsert('redate', true, { date: '2026-05-09' }));
  assert.equal(row('redate'), 'quarterly/9/2026-05-09/Synthetic');
  // An edit that does not move the date leaves the anchor exactly as it was,
  // including an anchor the date itself cannot show (30 April, anchored to 31).
  sql(modernUpsert('anchored', true, `'yearly'`, 31, { date: '2026-04-30' }));
  sql(legacyUpsert('anchored', true, { name: 'Same date', date: '2026-04-30' }));
  assert.equal(row('anchored'), 'yearly/31/2026-04-30/Same date');
});

// G, H. Old client toggling recurrence.
test('an old client can turn recurrence on and off', () => {
  sql(modernUpsert('toggle', false, 'null', 'null', { date: '2026-06-10' }));
  sql(legacyUpsert('toggle', true, { name: 'Now recurring', date: '2026-06-21' }));
  assert.equal(row('toggle'), 'monthly/21/2026-06-21/Now recurring');

  sql(modernUpsert('off', true, `'yearly'`, 31, { date: '2026-07-31' }));
  sql(legacyUpsert('off', false, { name: 'No longer recurring', date: '2026-07-31' }));
  assert.equal(row('off'), 'null/null/2026-07-31/No longer recurring');
  // A plain UPDATE from an old client behaves the same way.
  sql(modernUpsert('off-2', true, `'monthly'`, 15, { date: '2026-07-15' }));
  sql(`update public.expenses set is_recurring = false, name = 'Off by update' where id = 'off-2';`);
  assert.equal(row('off-2'), 'null/null/2026-07-15/Off by update');
});

test('the trigger never invents metadata for partial modern input, and stores only coherent rows', () => {
  // Partial metadata is the caller's own input, so it is left alone and rejected.
  assert.match(fails(modernUpsert('keep-q', true, `'quarterly'`, 'null', { date: '2026-05-31' })), CONSTRAINT);
  assert.match(fails(modernUpsert('keep-q', true, 'null', 15, { date: '2026-05-31' })), CONSTRAINT);
  // The row it targeted is untouched.
  assert.equal(row('keep-q'), 'quarterly/28/2026-05-31/Renamed by old client');
  assert.equal(sql(`select count(*) from public.expenses
    where (is_recurring and (recurrence_frequency is null or recurrence_anchor_day is null))
       or (not is_recurring and (recurrence_frequency is not null or recurrence_anchor_day is not null))`), '0');
});

// K. Re-running the whole migration stays safe.
test('re-running the migration is idempotent and rewrites no existing recurrence values', () => {
  const before = state();
  migrate();
  assert.equal(state(), before);
  // The trigger and its function exist exactly once after a re-run.
  assert.equal(sql(`select count(*) from pg_trigger where tgrelid = 'public.expenses'::regclass
    and tgname = 'expenses_legacy_recurrence_defaults'`), '1');
  assert.equal(sql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'expenses_legacy_recurrence_defaults'`), '1');
});
