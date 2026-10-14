const mockSession = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => mockSession(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import {
  buildPregnancyRemoteSnapshots, mapPregnancyCanonicalRow, pregnancyEntityKey, PREGNANCY_CANONICAL_COLUMNS, type RemoteEntityState,
} from '@/core/pregnancy/canonicalMappers';
import { readPregnancyCanonicalStates } from '@/core/pregnancy/canonicalReaders';

const account = 'a0000000-0000-4000-8000-000000000001';
const idOf = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = idOf(1), L = idOf(2), A = idOf(3);
const T0 = '2026-10-14T12:00:00.123456+00:00';

const pregnancyRow = (patch: Record<string, unknown> = {}) => ({
  id: P, user_id: account, method: 'lmp', lmp_date: '2026-02-01', conception_date: '2026-02-15', due_date_override: '2026-11-08', due_date_source: 'scan',
  ended_at: null, outcome: null, outcome_notes: null, recovery_ended_at: null, revision: 3, updated_at: T0, deleted_at: null, created_at: '2026-02-20T08:00:00+00:00', ...patch,
});
const logRow = (patch: Record<string, unknown> = {}) => ({
  id: L, user_id: account, pregnancy_id: P, date: '2026-10-01', symptoms: ['nausea', 'other'], weight_kg: 71.5, belly_measurement_cm: 96, notes: 'private note',
  revision: 2, updated_at: T0, deleted_at: null, ...patch,
});
const appointmentRow = (patch: Record<string, unknown> = {}) => ({
  id: A, user_id: account, pregnancy_id: P, starts_at: '2026-10-20T09:30:00+00:00', time_zone: 'Europe/Copenhagen', title: 'Midwife', notes: null,
  completed: false, reminder_enabled: true, revision: 4, updated_at: T0, deleted_at: null, ...patch,
});
const settingsRow = (patch: Record<string, unknown> = {}) => ({ user_id: account, recovery_display_days: 42, privacy_mode: true, revision: 5, updated_at: T0, ...patch });

const map = (type: 'pregnancy' | 'log' | 'appointment' | 'settings', row: unknown, id?: string) =>
  mapPregnancyCanonicalRow(type, row, account, id ?? (type === 'settings' ? account : type === 'pregnancy' ? P : type === 'log' ? L : A));

describe('APP-076 B2B1 strict canonical mappers: field mapping', () => {
  it('maps every pregnancy column to the domain shape without extra keys', () => {
    expect(map('pregnancy', pregnancyRow())).toEqual({ kind: 'live', revision: 3, live: { entityType: 'pregnancy', entity: {
      id: P, method: 'lmp', lmpDate: '2026-02-01', conceptionDate: '2026-02-15', dueDateOverride: '2026-11-08', dueDateSource: 'scan',
      revision: 3, updatedAt: T0, createdAt: '2026-02-20T08:00:00+00:00',
    } } });
    const ended = map('pregnancy', pregnancyRow({ ended_at: '2026-10-01', outcome: 'birth', outcome_notes: 'ok', recovery_ended_at: '2026-11-12' }));
    expect(ended).toMatchObject({ live: { entity: { endedAt: '2026-10-01', outcome: 'birth', outcomeNotes: 'ok', recoveryEndedAt: '2026-11-12' } } });
  });

  it('maps the log, appointment and settings columns', () => {
    expect(map('log', logRow())).toEqual({ kind: 'live', revision: 2, live: { entityType: 'log', entity: {
      id: L, pregnancyId: P, date: '2026-10-01', symptoms: ['nausea', 'other'], weightKg: 71.5, bellyMeasurementCm: 96, notes: 'private note', revision: 2, updatedAt: T0,
    } } });
    expect(map('appointment', appointmentRow())).toEqual({ kind: 'live', revision: 4, live: { entityType: 'appointment', entity: {
      id: A, pregnancyId: P, startsAt: '2026-10-20T09:30:00+00:00', timeZone: 'Europe/Copenhagen', title: 'Midwife', completed: false, reminderEnabled: true, revision: 4, updatedAt: T0,
    } } });
    expect(map('settings', settingsRow())).toEqual({ kind: 'live', revision: 5, live: { entityType: 'settings', entity: { recoveryDisplayDays: 42, privacyMode: true, revision: 5, updatedAt: T0 } } });
  });

  it('turns null optional columns into absent fields, never the string "null"', () => {
    const entity = (map('log', logRow({ weight_kg: null, belly_measurement_cm: null, notes: null })) as unknown as { live: { entity: Record<string, unknown> } }).live.entity;
    expect(Object.keys(entity)).not.toContain('weightKg');
    expect(Object.keys(entity)).not.toContain('notes');
  });
});

describe('APP-076 B2B1 strict canonical mappers: rejection', () => {
  const bad: Array<[string, 'pregnancy' | 'log' | 'appointment' | 'settings', unknown]> = [
    ['not a record', 'pregnancy', 'row'],
    ['an unexpected extra column', 'pregnancy', pregnancyRow({ secret: 1 })],
    ['another account', 'pregnancy', pregnancyRow({ user_id: idOf(99) })],
    ['a missing owner', 'log', (({ user_id, ...rest }) => rest)(logRow())],
    ['a different row id than requested', 'pregnancy', pregnancyRow({ id: idOf(77) })],
    ['a malformed uuid', 'pregnancy', pregnancyRow({ id: 'pregnancy-1' })],
    ['a zero revision', 'pregnancy', pregnancyRow({ revision: 0 })],
    ['an unsafe revision', 'pregnancy', pregnancyRow({ revision: 2 ** 53 })],
    ['a string revision', 'pregnancy', pregnancyRow({ revision: '3' })],
    ['an unknown method', 'pregnancy', pregnancyRow({ method: 'guess' })],
    ['a null method on a live row', 'pregnancy', pregnancyRow({ method: null })],
    ['an unknown due-date source', 'pregnancy', pregnancyRow({ due_date_source: 'friend' })],
    ['an impossible calendar date', 'pregnancy', pregnancyRow({ lmp_date: '2026-02-30' })],
    ['a date with a time', 'pregnancy', pregnancyRow({ lmp_date: '2026-02-01T00:00:00Z' })],
    ['an end date without an outcome', 'pregnancy', pregnancyRow({ ended_at: '2026-10-01' })],
    ['an outcome without an end date', 'pregnancy', pregnancyRow({ outcome: 'birth' })],
    ['an unknown outcome', 'pregnancy', pregnancyRow({ ended_at: '2026-10-01', outcome: 'other-thing' })],
    ['a malformed updated_at', 'pregnancy', pregnancyRow({ updated_at: 'yesterday' })],
    ['a missing created_at', 'pregnancy', pregnancyRow({ created_at: null })],
    ['a missing deleted_at key', 'pregnancy', (({ deleted_at, ...rest }) => rest)(pregnancyRow())],
    ['a non-string note', 'pregnancy', pregnancyRow({ outcome_notes: 7 })],
    ['a malformed parent id', 'log', logRow({ pregnancy_id: 'x' })],
    ['an unknown symptom', 'log', logRow({ symptoms: ['nausea', 'flu'] })],
    ['a non-array symptom list', 'log', logRow({ symptoms: 'nausea' })],
    ['a null symptom list on a live row', 'log', logRow({ symptoms: null })],
    ['a null date on a live row', 'log', logRow({ date: null })],
    ['a string weight', 'log', logRow({ weight_kg: '71.5' })],
    ['a non-finite measurement', 'log', logRow({ belly_measurement_cm: Number.POSITIVE_INFINITY })],
    ['a malformed start instant', 'appointment', appointmentRow({ starts_at: '2026-10-20' })],
    ['an empty time zone', 'appointment', appointmentRow({ time_zone: ' ' })],
    ['an empty title', 'appointment', appointmentRow({ title: '' })],
    ['a string completed flag', 'appointment', appointmentRow({ completed: 'false' })],
    ['a numeric reminder flag', 'appointment', appointmentRow({ reminder_enabled: 1 })],
    ['a null reminder flag', 'appointment', appointmentRow({ reminder_enabled: null })],
    ['settings for another account', 'settings', settingsRow({ user_id: idOf(5) })],
    ['a string privacy flag', 'settings', settingsRow({ privacy_mode: 'true' })],
    ['a negative recovery span', 'settings', settingsRow({ recovery_display_days: -1 })],
    ['a fractional recovery span', 'settings', settingsRow({ recovery_display_days: 4.5 })],
    ['settings with a deleted_at column', 'settings', settingsRow({ deleted_at: T0 })],
    ['a malformed tombstone timestamp', 'log', logRow({ deleted_at: 'whenever' })],
  ];
  it.each(bad)('rejects %s', (_label, type, row) => { expect(map(type, row)).toBeNull(); });

  it('rejects a settings row whose identity is not the account', () => {
    expect(mapPregnancyCanonicalRow('settings', settingsRow(), account, idOf(1))).toBeNull();
  });
});

describe('APP-076 B2B1 tombstoned rows are race-forward evidence, not malformed rows', () => {
  const scrubbed = {
    pregnancy: pregnancyRow({ method: null, lmp_date: null, conception_date: null, due_date_override: null, due_date_source: null, outcome_notes: null, revision: 4, deleted_at: T0 }),
    log: logRow({ date: null, symptoms: null, weight_kg: null, belly_measurement_cm: null, notes: null, revision: 3, deleted_at: T0 }),
    appointment: appointmentRow({ starts_at: null, time_zone: null, title: null, notes: null, completed: false, reminder_enabled: false, revision: 5, deleted_at: T0 }),
  };
  it.each([['pregnancy', 4], ['log', 3], ['appointment', 5]] as const)('maps a scrubbed %s tombstone without validating its null clinical columns', (type, revision) => {
    expect(map(type, scrubbed[type])).toEqual({ kind: 'tombstone', revision });
  });

  it('never carries a clinical value out of a tombstone, even one the server failed to scrub', () => {
    const leaky = map('log', logRow({ deleted_at: T0, notes: 'private note' }));
    expect(JSON.stringify(leaky)).not.toContain('private');
    expect(leaky).toEqual({ kind: 'tombstone', revision: 2 });
  });

  it('a tombstone still has to be this owner\'s row with a real revision', () => {
    expect(map('log', logRow({ deleted_at: T0, user_id: idOf(9) }))).toBeNull();
    expect(map('log', logRow({ deleted_at: T0, revision: 0 }))).toBeNull();
    expect(map('log', logRow({ deleted_at: T0, id: idOf(9) }))).toBeNull();
  });

  it('the combiner accepts live metadata explained by a now-tombstoned row, at the same or a higher revision', () => {
    const tombstone: RemoteEntityState = { kind: 'tombstone', revision: 3 };
    const out = buildPregnancyRemoteSnapshots([{ changeSeq: 4, entityType: 'log', entityId: L, revision: 2, deleted: false }], new Map([[pregnancyEntityKey('log', L), tombstone]]));
    expect(out).toEqual([{ entityType: 'log', entityId: L, metadataRevision: 2, changeSeq: 4, state: tombstone }]);
  });
});

describe('APP-076 B2B1 ledger/canonical combiner', () => {
  const live = (type: 'pregnancy' | 'log', revision: number): RemoteEntityState =>
    map(type, type === 'pregnancy' ? pregnancyRow({ revision }) : logRow({ revision }))!;
  it('reduces repeated ledger rows to one snapshot at the highest revision and last position', () => {
    const states = new Map([[pregnancyEntityKey('pregnancy', P), live('pregnancy', 3)]]);
    const out = buildPregnancyRemoteSnapshots([
      { changeSeq: 1, entityType: 'pregnancy', entityId: P, revision: 1, deleted: false },
      { changeSeq: 2, entityType: 'pregnancy', entityId: P, revision: 3, deleted: false },
    ], states)!;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ metadataRevision: 3, changeSeq: 2 });
  });
  it('fails closed when an announced entity has no row, a lower revision, or is live yet announced deleted', () => {
    const one = [{ changeSeq: 1, entityType: 'log' as const, entityId: L, revision: 3, deleted: false }];
    expect(buildPregnancyRemoteSnapshots(one, new Map())).toBeNull();
    expect(buildPregnancyRemoteSnapshots(one, new Map([[pregnancyEntityKey('log', L), live('log', 2)]]))).toBeNull();
    expect(buildPregnancyRemoteSnapshots([{ ...one[0], deleted: true }], new Map([[pregnancyEntityKey('log', L), live('log', 3)]]))).toBeNull();
  });
  it('accepts a row that is newer than the ledger announced (race forward)', () => {
    const out = buildPregnancyRemoteSnapshots([{ changeSeq: 1, entityType: 'log', entityId: L, revision: 2, deleted: false }], new Map([[pregnancyEntityKey('log', L), live('log', 6)]]));
    expect(out?.[0].state.revision).toBe(6);
  });
});

function chain(result: { data: unknown; error: unknown; status?: number }, calls: unknown[][]) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'setHeader', 'retry']) {
    builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder; };
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ status: 200, ...result });
  return builder;
}

describe('APP-076 B2B1 canonical readers', () => {
  const live = () => true;
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.mockResolvedValue({ data: { session: { user: { id: account }, access_token: 'token' } }, error: null });
  });

  it('reads only requested ids, per type, with explicit columns, the owner filter and a pinned token', async () => {
    const calls: Record<string, unknown[][]> = {};
    mockFrom.mockImplementation((table: string) => {
      calls[table] = [];
      const rows = table === 'pregnancies' ? [pregnancyRow()] : table === 'pregnancy_symptom_logs' ? [logRow()] : [];
      return chain({ data: rows, error: null }, calls[table]);
    });
    const result = await readPregnancyCanonicalStates(account, { pregnancy: [P, P], log: [L], appointment: [], settings: false }, live);
    expect(result.ok).toBe(true);
    expect(Object.keys(calls).sort()).toEqual(['pregnancies', 'pregnancy_symptom_logs']);
    expect(calls.pregnancies).toEqual([
      ['select', PREGNANCY_CANONICAL_COLUMNS.pregnancy], ['eq', 'user_id', account], ['in', 'id', [P]],
      ['setHeader', 'Authorization', 'Bearer token'], ['retry', false],
    ]);
    expect(PREGNANCY_CANONICAL_COLUMNS.pregnancy).not.toContain('*');
    if (result.ok) expect([...result.states.keys()].sort()).toEqual([pregnancyEntityKey('log', L), pregnancyEntityKey('pregnancy', P)].sort());
  });

  it('reads settings by the owner filter alone and maps the single row', async () => {
    mockFrom.mockImplementation(() => chain({ data: [settingsRow()], error: null }, []));
    const result = await readPregnancyCanonicalStates(account, { pregnancy: [], log: [], appointment: [], settings: true }, live);
    expect(result.ok && result.states.get(pregnancyEntityKey('settings', account))?.kind).toBe('live');
  });

  it('makes no query for an empty request and none after a stale guard', async () => {
    await expect(readPregnancyCanonicalStates(account, { pregnancy: [], log: [], appointment: [], settings: false }, live)).resolves.toMatchObject({ ok: true });
    expect(mockFrom).not.toHaveBeenCalled();
    await expect(readPregnancyCanonicalStates(account, { pregnancy: [P], log: [], appointment: [], settings: false }, () => false)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: false });
    expect(mockSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a row nobody asked for', [pregnancyRow({ id: idOf(40) })]],
    ['a duplicate row', [pregnancyRow(), pregnancyRow()]],
    ['a malformed row', [pregnancyRow({ method: 'guess' })]],
    ['a non-array response', { not: 'rows' }],
    ['another account\'s row', [pregnancyRow({ user_id: idOf(77) })]],
  ])('fails closed on %s', async (_label, data) => {
    mockFrom.mockImplementation(() => chain({ data, error: null }, []));
    await expect(readPregnancyCanonicalStates(account, { pregnancy: [P], log: [], appointment: [], settings: false }, live))
      .resolves.toEqual({ ok: false, reason: 'invalid-response', attempted: true });
  });

  it('classifies errors without surfacing them, and discards a result read for a stale session', async () => {
    mockFrom.mockImplementation(() => chain({ data: null, error: { code: 'PGRST301', message: 'private diagnostics' }, status: 401 }, []));
    const refused = await readPregnancyCanonicalStates(account, { pregnancy: [P], log: [], appointment: [], settings: false }, live);
    expect(refused).toEqual({ ok: false, reason: 'authorization', attempted: true });
    mockFrom.mockImplementation(() => chain({ data: null, error: { message: 'private diagnostics' }, status: 500 }, []));
    const down = await readPregnancyCanonicalStates(account, { pregnancy: [P], log: [], appointment: [], settings: false }, live);
    expect(down).toEqual({ ok: false, reason: 'unavailable', attempted: true });
    expect(JSON.stringify([refused, down])).not.toContain('private');
    let active = true;
    mockFrom.mockImplementation(() => { active = false; return chain({ data: [pregnancyRow()], error: null }, []); });
    await expect(readPregnancyCanonicalStates(account, { pregnancy: [P], log: [], appointment: [], settings: false }, () => active))
      .resolves.toEqual({ ok: false, reason: 'authorization', attempted: true });
  });

  it('does not read with a session that is another account or unreadable', async () => {
    mockSession.mockResolvedValue({ data: { session: { user: { id: idOf(99) }, access_token: 'x' } }, error: null });
    await expect(readPregnancyCanonicalStates(account, { pregnancy: [P], log: [], appointment: [], settings: false }, live)).resolves.toEqual({ ok: false, reason: 'authorization', attempted: false });
    mockSession.mockRejectedValue(new Error('keychain'));
    await expect(readPregnancyCanonicalStates(account, { pregnancy: [P], log: [], appointment: [], settings: false }, live)).resolves.toEqual({ ok: false, reason: 'unavailable', attempted: false });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
