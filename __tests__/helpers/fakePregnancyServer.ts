/**
 * An in-memory model of the Phase-A Pregnancy server contract (apply_pregnancy_sync_mutation,
 * pull_pregnancy_sync_state and the owner-only SELECTs). It mirrors the SQL semantics the client
 * depends on: revisions, soft-delete scrubbing, a root delete that writes the children's ledger rows
 * first, receipts keyed by mutation id, and a strictly ascending change ledger. It exists only in tests.
 */
export type FakeEntityType = 'pregnancy' | 'log' | 'appointment' | 'settings';
type Row = Record<string, unknown>;
export type FakeLedgerRow = { changeSeq: number; entityType: FakeEntityType; entityId: string; revision: number; deleted: boolean };
type ApplyArgs = {
  p_mutation_id: string; p_entity_type: FakeEntityType; p_entity_id: string; p_operation: 'upsert' | 'delete';
  p_expected_revision: number | null; p_payload: Record<string, unknown> | null; p_consent_id: string | null;
};
export type FakeServerError = { code: string; message: string; status: number };
const ok = (data: unknown) => ({ data, error: null, status: 200 });
const fail = (error: FakeServerError) => ({ data: null, error: { code: error.code, message: error.message }, status: error.status });
const T = '2026-10-14T12:00:00.000000+00:00';

export class FakePregnancyServer {
  rows: Record<FakeEntityType, Map<string, Row>> = { pregnancy: new Map(), log: new Map(), appointment: new Map(), settings: new Map() };
  ledger: FakeLedgerRow[] = [];
  receipts = new Map<string, { hash: string; entityType: FakeEntityType; entityId: string; revision: number; deleted: boolean }>();
  applyCalls: ApplyArgs[] = [];
  pullCalls: number[] = [];
  selectCalls: string[] = [];
  /** Scripted behaviour. Return an error to fail the call, or undefined to run normally. */
  beforeApply?: (args: ApplyArgs) => FakeServerError | undefined;
  beforePull?: (after: number) => FakeServerError | undefined;
  beforeSelect?: (table: string) => FakeServerError | undefined;
  /** Rewrites a returned row, to model a malformed or surprising server. */
  mutateRow?: (table: string, row: Row) => Row;
  private seq = 0;

  constructor(readonly account: string) {}

  /** A second device (or an admin) changing server state directly, with its own ledger rows. */
  seedLive(entityType: Exclude<FakeEntityType, 'settings'>, entityId: string, fields: Row, revision = 1): void {
    this.rows[entityType].set(entityId, { id: entityId, user_id: this.account, ...fields, revision, updated_at: T, deleted_at: null, ...(entityType === 'pregnancy' ? { created_at: T } : {}) });
    this.record(entityType, entityId, revision, false);
  }
  seedSettings(fields: Row, revision = 1): void {
    this.rows.settings.set(this.account, { user_id: this.account, recovery_display_days: 42, privacy_mode: false, ...fields, revision, updated_at: T });
    this.record('settings', this.account, revision, false);
  }
  private record(entityType: FakeEntityType, entityId: string, revision: number, deleted: boolean): number {
    this.seq += 1; this.ledger.push({ changeSeq: this.seq, entityType, entityId, revision, deleted }); return this.seq;
  }
  get nextSeq() { return this.seq; }

  /** Another device edits an entity: bumps its revision and writes a ledger row. */
  remoteEdit(entityType: Exclude<FakeEntityType, 'settings'>, entityId: string, fields: Row): number {
    const row = this.rows[entityType].get(entityId)!;
    const revision = (row.revision as number) + 1;
    this.rows[entityType].set(entityId, { ...row, ...fields, revision, updated_at: T });
    return this.record(entityType, entityId, revision, false);
  }
  remoteDelete(entityType: Exclude<FakeEntityType, 'settings'>, entityId: string): void {
    const now = '2026-10-14T13:00:00+00:00';
    if (entityType === 'pregnancy') {
      for (const kind of ['log', 'appointment'] as const) {
        for (const [id, child] of this.rows[kind]) {
          if (child.pregnancy_id === entityId && child.deleted_at === null) {
            const revision = (child.revision as number) + 1;
            this.rows[kind].set(id, this.scrubbed(kind, child, revision, now));
            this.record(kind, id, revision, true);
          }
        }
      }
    }
    const row = this.rows[entityType].get(entityId)!;
    const revision = (row.revision as number) + 1;
    this.rows[entityType].set(entityId, this.scrubbed(entityType, row, revision, now));
    this.record(entityType, entityId, revision, true);
  }
  private scrubbed(entityType: FakeEntityType, row: Row, revision: number, deletedAt: string): Row {
    const keep = { id: row.id, user_id: row.user_id, pregnancy_id: row.pregnancy_id, created_at: row.created_at };
    const clinical: Record<string, Row> = {
      pregnancy: { method: null, lmp_date: null, conception_date: null, due_date_override: null, due_date_source: null, ended_at: null, outcome: null, outcome_notes: null, recovery_ended_at: null },
      log: { date: null, symptoms: null, weight_kg: null, belly_measurement_cm: null, notes: null },
      appointment: { starts_at: null, time_zone: null, title: null, notes: null, completed: false, reminder_enabled: false },
      settings: {},
    };
    return { ...keep, ...clinical[entityType], revision, updated_at: deletedAt, deleted_at: deletedAt };
  }

  async rpc(name: string, args: Record<string, unknown>) {
    if (name === 'pull_pregnancy_sync_state') return this.pull(args.p_after_change_seq as number, args.p_limit as number);
    if (name === 'apply_pregnancy_sync_mutation') return this.apply(args as unknown as ApplyArgs);
    throw new Error(`unexpected rpc ${name}`);
  }

  private pull(after: number, limit: number) {
    this.pullCalls.push(after);
    const failure = this.beforePull?.(after); if (failure) return fail(failure);
    const changes = this.ledger.filter((row) => row.changeSeq > after).slice(0, Math.max(1, Math.min(limit, 100)));
    return ok({ changes, nextChangeSeq: changes.length ? changes[changes.length - 1].changeSeq : after });
  }

  private apply(args: ApplyArgs) {
    this.applyCalls.push(args);
    const failure = this.beforeApply?.(args); if (failure) return fail(failure);
    const hash = JSON.stringify([args.p_entity_type, args.p_entity_id, args.p_operation, args.p_expected_revision, args.p_payload, args.p_consent_id]);
    const receipt = this.receipts.get(args.p_mutation_id);
    if (receipt) {
      if (receipt.hash !== hash) return fail({ code: 'PT409', message: 'mutation_id_conflict', status: 409 });
      return ok({ status: 'replayed', entityType: receipt.entityType, entityId: receipt.entityId, revision: receipt.revision, deleted: receipt.deleted });
    }
    const conflict = (message: string) => fail({ code: 'PT409', message, status: 409 });
    const { p_entity_type: type, p_entity_id: id, p_operation: op, p_expected_revision: expected, p_payload: payload } = args;
    let revision: number; let deleted = false;
    if (type === 'settings') {
      if (id !== this.account) return fail({ code: 'PT401', message: 'not_authorized', status: 401 });
      const existing = this.rows.settings.get(id);
      if (existing) {
        if (expected === null || existing.revision !== expected) return conflict('revision_conflict');
        revision = (existing.revision as number) + 1;
      } else if (expected !== null) return conflict('revision_conflict'); else revision = 1;
      this.rows.settings.set(id, { user_id: this.account, recovery_display_days: payload?.recoveryDisplayDays ?? 42, privacy_mode: payload?.privacyMode ?? false, revision, updated_at: T });
    } else if (op === 'delete') {
      const existing = this.rows[type].get(id);
      if (!existing || existing.deleted_at !== null || expected === null || existing.revision !== expected) return conflict('revision_conflict');
      if (type === 'pregnancy') {
        // Children first (as the SQL's ledger order), then the root.
        this.remoteDelete('pregnancy', id);
        revision = (existing.revision as number) + 1; deleted = true;
        const seq = this.ledger[this.ledger.length - 1].changeSeq;
        this.receipts.set(args.p_mutation_id, { hash, entityType: type, entityId: id, revision, deleted });
        return ok({ status: 'applied', entityType: type, entityId: id, revision, deleted, changeSeq: seq });
      }
      revision = (existing.revision as number) + 1; deleted = true;
      this.rows[type].set(id, this.scrubbed(type, existing, revision, '2026-10-14T13:00:00+00:00'));
    } else {
      const existing = this.rows[type].get(id);
      if (type !== 'pregnancy') {
        const parent = typeof payload?.pregnancyId === 'string' ? this.rows.pregnancy.get(payload.pregnancyId) : undefined;
        if (!parent || parent.deleted_at !== null) return conflict('parent_unavailable');
      }
      if (existing) {
        if (existing.deleted_at !== null || expected === null || existing.revision !== expected) return conflict('revision_conflict');
        revision = (existing.revision as number) + 1;
      } else if (expected !== null) return conflict('revision_conflict'); else revision = 1;
      this.rows[type].set(id, { ...this.fromPayload(type, id, payload ?? {}), revision, updated_at: T, deleted_at: null, created_at: existing?.created_at ?? T });
    }
    const seq = this.record(type, id, revision, deleted);
    this.receipts.set(args.p_mutation_id, { hash, entityType: type, entityId: id, revision, deleted });
    return ok({ status: 'applied', entityType: type, entityId: id, revision, deleted, changeSeq: seq });
  }

  private fromPayload(type: Exclude<FakeEntityType, 'settings'>, id: string, p: Row): Row {
    if (type === 'pregnancy') return { id, user_id: this.account, method: p.method, lmp_date: p.lmpDate ?? null, conception_date: p.conceptionDate ?? null, due_date_override: p.dueDateOverride ?? null, due_date_source: p.dueDateSource ?? null, ended_at: p.endedAt ?? null, outcome: p.outcome ?? null, outcome_notes: p.outcomeNotes ?? null, recovery_ended_at: p.recoveryEndedAt ?? null };
    if (type === 'log') return { id, user_id: this.account, pregnancy_id: p.pregnancyId, date: p.date, symptoms: p.symptoms, weight_kg: p.weightKg ?? null, belly_measurement_cm: p.bellyMeasurementCm ?? null, notes: p.notes ?? null };
    return { id, user_id: this.account, pregnancy_id: p.pregnancyId, starts_at: p.startsAt, time_zone: p.timeZone, title: p.title, notes: p.notes ?? null, completed: p.completed ?? false, reminder_enabled: p.reminderEnabled ?? false };
  }

  private static tables: Record<string, FakeEntityType> = { pregnancies: 'pregnancy', pregnancy_symptom_logs: 'log', pregnancy_appointments: 'appointment', pregnancy_settings: 'settings' };

  /** A chainable owner SELECT: select(cols).eq('user_id', account).in('id', ids).setHeader().retry(false). */
  from(table: string) {
    const server = this; const state: { cols: string[]; ids?: string[]; owner?: string } = { cols: [] };
    const builder: Record<string, unknown> = {
      select: (cols: string) => { state.cols = cols.split(','); return builder; },
      eq: (_column: string, value: string) => { state.owner = value; return builder; },
      in: (_column: string, ids: string[]) => { state.ids = ids; return builder; },
      setHeader: () => builder,
      retry: () => builder,
      then: (resolve: (value: unknown) => unknown) => {
        server.selectCalls.push(table);
        const failure = server.beforeSelect?.(table);
        if (failure) return resolve(fail(failure));
        const type = FakePregnancyServer.tables[table];
        const rows = [...server.rows[type].entries()]
          .filter(([key, row]) => row.user_id === state.owner && (!state.ids || state.ids.includes(key)))
          .map(([, row]) => {
            const projected = Object.fromEntries(state.cols.map((column) => [column, row[column] === undefined ? null : row[column]]));
            return server.mutateRow ? server.mutateRow(table, projected) : projected;
          });
        return resolve({ data: rows, error: null, status: 200 });
      },
    };
    return builder;
  }
}
