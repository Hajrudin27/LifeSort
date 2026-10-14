import type { RemoteEntitySnapshot } from '@/core/pregnancy/canonicalMappers';
import { createInitialPregnancyProtectedState, assertPregnancyProtectedState, type PregnancyProtectedState, type PregnancyQueuedMutation } from '@/core/pregnancy/protectedRepository';
import { PregnancyReconciliationInputError, reconcilePregnancyState, type PregnancyReconciliationInput, type PregnancySuccessProof } from '@/core/pregnancy/reconciliation';
import type { PregnancyAppointment, PregnancyEntry, PregnancySettings, PregnancySymptomLog } from '@/types/pregnancy';

const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const idOf = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = idOf(1), L = idOf(2), A = idOf(3), L2 = idOf(4);
const AT = '2026-10-14T12:00:00.000Z';

const pregnancy = (revision: number, patch: Partial<PregnancyEntry> = {}): PregnancyEntry => ({ id: P, method: 'lmp', lmpDate: '2026-02-01', createdAt: AT, revision, updatedAt: AT, ...patch });
const log = (revision: number, patch: Partial<PregnancySymptomLog> = {}): PregnancySymptomLog => ({ id: L, pregnancyId: P, date: '2026-10-01', symptoms: ['nausea'], revision, updatedAt: AT, ...patch });
const appointment = (revision: number, patch: Partial<PregnancyAppointment> = {}): PregnancyAppointment => ({ id: A, pregnancyId: P, startsAt: AT, timeZone: 'Europe/Copenhagen', title: 'Scan', completed: false, reminderEnabled: false, revision, updatedAt: AT, ...patch });
const settings = (revision: number, patch: Partial<PregnancySettings> = {}): PregnancySettings => ({ recoveryDisplayDays: 42, privacyMode: false, revision, updatedAt: AT, ...patch });

const livePregnancy = (entity: PregnancyEntry, changeSeq = 1): RemoteEntitySnapshot => ({ entityType: 'pregnancy', entityId: entity.id, metadataRevision: entity.revision, changeSeq, state: { kind: 'live', revision: entity.revision, live: { entityType: 'pregnancy', entity } } });
const liveLog = (entity: PregnancySymptomLog, changeSeq = 1): RemoteEntitySnapshot => ({ entityType: 'log', entityId: entity.id, metadataRevision: entity.revision, changeSeq, state: { kind: 'live', revision: entity.revision, live: { entityType: 'log', entity } } });
const liveAppointment = (entity: PregnancyAppointment, changeSeq = 1): RemoteEntitySnapshot => ({ entityType: 'appointment', entityId: entity.id, metadataRevision: entity.revision, changeSeq, state: { kind: 'live', revision: entity.revision, live: { entityType: 'appointment', entity } } });
const liveSettings = (entity: PregnancySettings, changeSeq = 1): RemoteEntitySnapshot => ({ entityType: 'settings', entityId: ACCOUNT, metadataRevision: entity.revision, changeSeq, state: { kind: 'live', revision: entity.revision, live: { entityType: 'settings', entity } } });
const tombstone = (entityType: 'pregnancy' | 'log' | 'appointment', entityId: string, revision: number, changeSeq = 1): RemoteEntitySnapshot => ({ entityType, entityId, metadataRevision: revision, changeSeq, state: { kind: 'tombstone', revision } });

let counter = 0;
const queued = (patch: Partial<PregnancyQueuedMutation>): PregnancyQueuedMutation => ({
  mutationId: `m${++counter}`, entityType: 'pregnancy', entityId: P, operation: 'upsert', payload: { method: 'lmp', note: 'private health note' }, consentId: 'consent-1',
  createdAt: AT, status: 'pending', attempts: 0, ...patch,
});
const del = (patch: Partial<PregnancyQueuedMutation>): PregnancyQueuedMutation => queued({ operation: 'delete', payload: undefined, consentId: undefined, ...patch });

function state(patch: (s: PregnancyProtectedState) => void = () => undefined): PregnancyProtectedState {
  const s = createInitialPregnancyProtectedState(ACCOUNT); patch(s); assertPregnancyProtectedState(s); return s;
}
const page = (snapshots: RemoteEntitySnapshot[], extra: Partial<PregnancyReconciliationInput> = {}): PregnancyReconciliationInput => ({ fromCursor: 0, toCursor: 10, caughtUp: false, snapshots, proofs: [], ...extra });
function applied(s: PregnancyProtectedState, input: PregnancyReconciliationInput) {
  const result = reconcilePregnancyState(s, input);
  if (result.kind !== 'applied') throw new Error(`expected applied, got halt ${result.cause}`);
  assertPregnancyProtectedState(result.state);
  return result;
}
const proof = (mutation: PregnancyQueuedMutation, serverRevision: number, deleted = mutation.operation === 'delete'): PregnancySuccessProof =>
  ({ mutationId: mutation.mutationId, entityType: mutation.entityType, entityId: mutation.entityId, serverRevision, deleted });
const mutationOf = (s: PregnancyProtectedState, id: string) => s.sync.mutations.find((item) => item.mutationId === id);

describe('APP-076 B2B1 reconciliation: revision ordering', () => {
  it('installs a remote live entity the device has never seen', () => {
    const result = applied(state(), page([livePregnancy(pregnancy(2))]));
    expect(result.state.domain.pregnancies[P]).toEqual(pregnancy(2));
    expect(result.state.sync.nextChangeSeq).toBe(10);
  });

  it('a newer remote revision wins over the local canonical', () => {
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1, { lmpDate: '2026-01-01' }); });
    expect(applied(s, page([livePregnancy(pregnancy(3))])).state.domain.pregnancies[P]).toEqual(pregnancy(3));
  });

  it('the same revision with identical content is an idempotent no-op, however often it repeats', () => {
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(2); });
    const once = applied(s, page([livePregnancy(pregnancy(2))])).state;
    const twice = applied(once, page([livePregnancy(pregnancy(2))], { fromCursor: 10, toCursor: 12 })).state;
    expect(twice.domain).toEqual(s.domain);
    expect(twice.sync.nextChangeSeq).toBe(12);
  });

  it('the same revision with different content halts the backend instead of choosing a side', () => {
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(2, { lmpDate: '2026-01-01' }); });
    expect(reconcilePregnancyState(s, page([livePregnancy(pregnancy(2))]))).toEqual({ kind: 'halt', cause: 'same-revision-divergence' });
  });

  it('an older remote revision never overwrites a newer local canonical, but the cursor still moves', () => {
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(5, { lmpDate: '2026-03-01' }); });
    const result = applied(s, page([livePregnancy(pregnancy(2))]));
    expect(result.state.domain.pregnancies[P]).toEqual(pregnancy(5, { lmpDate: '2026-03-01' }));
    expect(result.state.sync.nextChangeSeq).toBe(10);
  });

  it('updatedAt never orders anything: a later local timestamp does not beat a higher remote revision', () => {
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1, { updatedAt: '2099-01-01T00:00:00.000Z' }); });
    expect(applied(s, page([livePregnancy(pregnancy(2, { updatedAt: '2026-10-14T12:00:01.000Z' }))])).state.domain.pregnancies[P]?.revision).toBe(2);
  });

  it('an entity with a queued edit is not compared at its base revision: the edit legitimately differs', () => {
    const edit = queued({ baseRevision: 2 });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(2, { lmpDate: '2026-01-01' }); draft.sync.mutations = [edit]; });
    const result = applied(s, page([livePregnancy(pregnancy(2))]));
    expect(result.state.domain.pregnancies[P]?.lmpDate).toBe('2026-01-01');
    expect(mutationOf(result.state, edit.mutationId)?.terminalReason).toBeUndefined();
  });

  it('even a terminal consent-refused edit keeps its entity out of the same-revision comparison (no false halt)', () => {
    const refused = queued({ baseRevision: 2, status: 'failed', terminalReason: 'consent-required' });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(2, { lmpDate: '2026-01-01' }); draft.sync.mutations = [refused]; });
    expect(reconcilePregnancyState(s, page([livePregnancy(pregnancy(2))])).kind).toBe('applied');
  });

  it('settings reconcile as one canonical row keyed by the account', () => {
    const result = applied(state(), page([liveSettings(settings(3, { privacyMode: true }))]));
    expect(result.state.domain.settings).toEqual(settings(3, { privacyMode: true }));
    const newer = applied(result.state, page([liveSettings(settings(4))], { fromCursor: 10, toCursor: 11 }));
    expect(newer.state.domain.settings?.revision).toBe(4);
    const older = applied(newer.state, page([liveSettings(settings(2))], { fromCursor: 11, toCursor: 12 }));
    expect(older.state.domain.settings?.revision).toBe(4);
    const divergent = state((draft) => { draft.domain.settings = settings(3, { privacyMode: true }); });
    expect(reconcilePregnancyState(divergent, page([liveSettings(settings(3))]))).toEqual({ kind: 'halt', cause: 'same-revision-divergence' });
  });

  it('rejects settings snapshots for another account or as a tombstone', () => {
    expect(() => reconcilePregnancyState(state(), page([{ ...liveSettings(settings(1)), entityId: idOf(77) }]))).toThrow(PregnancyReconciliationInputError);
    expect(() => reconcilePregnancyState(state(), page([{ entityType: 'settings', entityId: ACCOUNT, metadataRevision: 1, changeSeq: 1, state: { kind: 'tombstone', revision: 2 } }]))).toThrow(PregnancyReconciliationInputError);
  });
});

describe('APP-076 B2B1 reconciliation: remote tombstones', () => {
  it('scrubs the payload, keeps only a payload-free tombstone, and is idempotent', () => {
    const s = state((draft) => { draft.domain.symptomLogs[L] = log(2, { notes: 'private note', weightKg: 70 }); draft.domain.pregnancies[P] = pregnancy(1); });
    const once = applied(s, page([tombstone('log', L, 3, 7)])).state;
    expect(once.domain.symptomLogs[L]).toBeUndefined();
    expect(once.tombstones[`log:${L}`]).toEqual({ entityType: 'log', entityId: L, revision: 3, changeSeq: 7 });
    expect(JSON.stringify(once)).not.toContain('private note');
    const twice = applied(once, page([tombstone('log', L, 3, 7)], { fromCursor: 10, toCursor: 11 })).state;
    expect(twice.tombstones).toEqual(once.tombstones);
    const lower = applied(twice, page([tombstone('log', L, 2, 5)], { fromCursor: 11, toCursor: 12 })).state;
    expect(lower.tombstones[`log:${L}`]).toEqual({ entityType: 'log', entityId: L, revision: 3, changeSeq: 7 });
  });

  it('a tombstone for an entity the device never held still installs the minimal tombstone', () => {
    expect(applied(state(), page([tombstone('appointment', A, 2)])).state.tombstones[`appointment:${A}`]).toMatchObject({ revision: 2 });
  });

  it('a tombstone beats a stale local upsert: terminal remote-deleted, payload scrubbed, never sent again', () => {
    const stale = queued({ entityType: 'log', entityId: L, baseRevision: 1, payload: { pregnancyId: P, date: '2026-10-01', symptoms: [], notes: 'private health note' } });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.domain.symptomLogs[L] = log(1); draft.sync.mutations = [stale]; });
    const result = applied(s, page([tombstone('log', L, 2)]));
    const item = mutationOf(result.state, stale.mutationId)!;
    expect(item).toMatchObject({ terminalReason: 'remote-deleted', status: 'failed' });
    expect(item.nextRetryAt).toBeUndefined();
    expect(item.payload).toBeUndefined();
    expect(JSON.stringify(result.state)).not.toContain('private health note');
    expect(result.terminalized).toBe(1);
  });

  it('a later live row for the same deleted entity never resurrects it', () => {
    const once = applied(state((draft) => { draft.domain.symptomLogs[L] = log(1); }), page([tombstone('log', L, 2)])).state;
    const again = applied(once, page([liveLog(log(5))], { fromCursor: 10, toCursor: 11 })).state;
    expect(again.domain.symptomLogs[L]).toBeUndefined();
  });

  it('a pending delete is retired only by a tombstone at its own resulting revision or beyond', () => {
    const satisfied = del({ entityType: 'log', entityId: L, baseRevision: 2 });
    const s = state((draft) => { draft.sync.mutations = [satisfied]; });
    expect(applied(s, page([tombstone('log', L, 3)])).state.sync.mutations).toEqual([]);
    expect(applied(s, page([tombstone('log', L, 9)])).state.sync.mutations).toEqual([]);
    // A tombstone below base+1 cannot prove this deletion: the mutation is kept as a safe terminal conflict.
    const kept = applied(s, page([tombstone('log', L, 2)])).state;
    expect(mutationOf(kept, satisfied.mutationId)).toMatchObject({ terminalReason: 'revision-conflict' });
    const baseless = del({ entityType: 'log', entityId: L, baseRevision: undefined });
    expect(mutationOf(applied(state((draft) => { draft.sync.mutations = [baseless]; }), page([tombstone('log', L, 5)])).state, baseless.mutationId)?.terminalReason).toBe('revision-conflict');
  });

  it('consent-terminal evidence survives a remote tombstone untouched', () => {
    const refused = queued({ entityType: 'log', entityId: L, status: 'failed', terminalReason: 'consent-required', payload: { pregnancyId: P, date: '2026-10-01', symptoms: [] } });
    const s = state((draft) => { draft.sync.mutations = [refused]; });
    expect(mutationOf(applied(s, page([tombstone('log', L, 2)])).state, refused.mutationId)).toEqual(refused);
  });
});

describe('APP-076 B2B1 reconciliation: root delete', () => {
  const populated = () => state((draft) => {
    draft.domain.pregnancies[P] = pregnancy(2);
    draft.domain.symptomLogs[L] = log(1, { notes: 'private log note' });
    draft.domain.symptomLogs[L2] = log(1, { id: L2, date: '2026-10-02' });
    draft.domain.appointments[A] = appointment(1, { notes: 'private appointment note' });
  });

  it('immediately scrubs the root and every child payload, whatever page their own tombstones arrive on', () => {
    const result = applied(populated(), page([tombstone('pregnancy', P, 3, 9)]));
    expect(result.state.domain).toEqual({ pregnancies: {}, symptomLogs: {}, appointments: {}, settings: null });
    expect(result.state.tombstones[`pregnancy:${P}`]).toMatchObject({ revision: 3 });
    expect(JSON.stringify(result.state)).not.toMatch(/private (log|appointment) note/);
  });

  it('later child tombstones from the ledger are idempotent', () => {
    const afterRoot = applied(populated(), page([tombstone('pregnancy', P, 3, 9)])).state;
    const afterChildren = applied(afterRoot, page([tombstone('log', L, 2, 10), tombstone('log', L2, 2, 11), tombstone('appointment', A, 2, 12)], { fromCursor: 10, toCursor: 12 })).state;
    expect(afterChildren.domain).toEqual(afterRoot.domain);
    expect(Object.keys(afterChildren.tombstones).sort()).toEqual([`appointment:${A}`, `log:${L}`, `log:${L2}`, `pregnancy:${P}`].sort());
  });

  it('children whose own tombstones come first (server ledger order) and then the root are consistent', () => {
    const result = applied(populated(), page([tombstone('log', L, 2, 8), tombstone('log', L2, 2, 8), tombstone('appointment', A, 2, 8), tombstone('pregnancy', P, 3, 9)]));
    expect(result.state.domain.symptomLogs).toEqual({});
    expect(result.state.domain.appointments).toEqual({});
  });

  it('terminalizes a stale child upsert beneath the deleted root as remote-parent-deleted, scrubbing its payload', () => {
    const child = queued({ entityType: 'log', entityId: L, baseRevision: 1, payload: { pregnancyId: P, date: '2026-10-03', symptoms: [], notes: 'private child text' } });
    const appt = queued({ entityType: 'appointment', entityId: A, baseRevision: 1, payload: { pregnancyId: P, startsAt: AT, timeZone: 'Europe/Copenhagen', title: 'private title' } });
    const unrelated = queued({ entityType: 'log', entityId: idOf(50), payload: { pregnancyId: idOf(60), date: '2026-10-03', symptoms: [] } });
    const s = state((draft) => { Object.assign(draft, populated()); draft.sync.mutations = [child, appt, unrelated]; });
    const result = applied(s, page([tombstone('pregnancy', P, 3)]));
    expect(mutationOf(result.state, child.mutationId)).toMatchObject({ terminalReason: 'remote-parent-deleted' });
    expect(mutationOf(result.state, child.mutationId)?.payload).toBeUndefined();
    expect(mutationOf(result.state, appt.mutationId)).toMatchObject({ terminalReason: 'remote-parent-deleted' });
    expect(mutationOf(result.state, unrelated.mutationId)?.terminalReason).toBeUndefined();
    expect(JSON.stringify(result.state)).not.toMatch(/private (child text|title)/);
  });

  it('never resurrects a child beneath a deleted root from a stale live child row', () => {
    const afterRoot = applied(populated(), page([tombstone('pregnancy', P, 3, 9)])).state;
    const again = applied(afterRoot, page([liveLog(log(4))], { fromCursor: 10, toCursor: 11 })).state;
    expect(again.domain.symptomLogs[L]).toBeUndefined();
    const sameBatch = applied(populated(), page([liveLog(log(4)), tombstone('pregnancy', P, 3, 9)])).state;
    expect(sameBatch.domain.symptomLogs[L]).toBeUndefined();
  });

  it('terminalizes the root\'s own stale upsert as remote-deleted', () => {
    const root = queued({ baseRevision: 2 });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(2); draft.sync.mutations = [root]; });
    expect(mutationOf(applied(s, page([tombstone('pregnancy', P, 3)])).state, root.mutationId)).toMatchObject({ terminalReason: 'remote-deleted' });
  });
});

describe('APP-076 B2B1 reconciliation: queued intent versus remote live state', () => {
  it('retires a lost-ACK simple upsert only when the exact next remote revision has the exact requested payload', () => {
    const sent = queued({ baseRevision: 1, payload: { method: 'lmp', lmpDate: '2026-03-03' } });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1, { lmpDate: '2026-03-03' }); draft.sync.mutations = [sent]; });
    const result = applied(s, page([livePregnancy(pregnancy(2, { lmpDate: '2026-03-03' }))]));
    expect(result.acknowledged).toEqual([sent.mutationId]);
    expect(result.state.sync.mutations).toEqual([]);

    // A later revision could hide concurrent history; identical content is not enough.
    const later = applied(s, page([livePregnancy(pregnancy(3, { lmpDate: '2026-03-03' }))]));
    expect(mutationOf(later.state, sent.mutationId)).toMatchObject({ terminalReason: 'revision-conflict' });
    // Pregnancy lifecycle transitions never use this indistinguishable-state shortcut.
    const destructive = queued({ baseRevision: 1, payload: { method: 'lmp', lmpDate: '2026-03-03', endedAt: '2026-10-01', outcome: 'birth' } });
    const destructiveState = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1, { lmpDate: '2026-03-03' }); draft.sync.mutations = [destructive]; });
    const destructiveResult = applied(destructiveState, page([livePregnancy(pregnancy(2, { lmpDate: '2026-03-03', endedAt: '2026-10-01', outcome: 'birth' }))]));
    expect(mutationOf(destructiveResult.state, destructive.mutationId)).toMatchObject({ terminalReason: 'revision-conflict' });
  });

  describe('lost-ACK satisfaction boundary', () => {
    const base = { method: 'lmp', lmpDate: '2026-03-03' };
    const withPending = (patch: Partial<PregnancyQueuedMutation>) => {
      const sent = queued({ baseRevision: 1, payload: base, ...patch });
      return { sent, s: state((draft) => { draft.domain.pregnancies[P] = pregnancy(1, { lmpDate: '2026-03-03' }); draft.sync.mutations = [sent]; }) };
    };
    const conflictOf = (s: PregnancyProtectedState, sent: PregnancyQueuedMutation, snapshot: RemoteEntitySnapshot) =>
      mutationOf(applied(s, page([snapshot])).state, sent.mutationId);

    it('optimistic local state alone never retires the intent: without validated remote evidence nothing is acknowledged', () => {
      const { sent, s } = withPending({});
      const result = applied(s, page([]));
      expect(result.acknowledged).toEqual([]);
      expect(mutationOf(result.state, sent.mutationId)).toEqual(sent);
      // A remote row still at the base revision is not evidence either.
      expect(mutationOf(applied(s, page([livePregnancy(pregnancy(1, { lmpDate: '2026-03-03' })), ])).state, sent.mutationId)).toEqual(sent);
    });

    it.each([2, 10])('a remote revision %i beyond the base (not exactly base + 1) with identical content is a conflict', (extra) => {
      const { sent, s } = withPending({});
      expect(conflictOf(s, sent, livePregnancy(pregnancy(1 + 1 + extra, { lmpDate: '2026-03-03' })))).toMatchObject({ terminalReason: 'revision-conflict' });
    });

    it('a divergent remote payload at base + 1 is a conflict and the remote row wins', () => {
      const { sent, s } = withPending({});
      const result = applied(s, page([livePregnancy(pregnancy(2, { lmpDate: '2026-04-04' }))]));
      expect(result.acknowledged).toEqual([]);
      expect(mutationOf(result.state, sent.mutationId)).toMatchObject({ terminalReason: 'revision-conflict' });
      expect(result.state.domain.pregnancies[P]?.lmpDate).toBe('2026-04-04');
    });

    it.each([
      ['endedAt+outcome', { endedAt: '2026-10-01', outcome: 'birth' }],
      ['outcome alone', { outcome: 'birth' }],
      ['endedAt alone', { endedAt: '2026-10-01' }],
      ['recoveryEndedAt', { recoveryEndedAt: '2026-11-01' }],
    ] as const)('a lifecycle payload (%s) never uses the shortcut, even when the remote row matches exactly', (_name, lifecycle) => {
      const { sent, s } = withPending({ payload: { ...base, ...lifecycle } });
      expect(conflictOf(s, sent, livePregnancy(pregnancy(2, { lmpDate: '2026-03-03', ...lifecycle })))).toMatchObject({ terminalReason: 'revision-conflict' });
    });

    it('a remote row that carries extra lifecycle fields the payload did not request is not a match', () => {
      const { sent, s } = withPending({});
      expect(conflictOf(s, sent, livePregnancy(pregnancy(2, { lmpDate: '2026-03-03', endedAt: '2026-10-01', outcome: 'birth' })))).toMatchObject({ terminalReason: 'revision-conflict' });
    });

    it('extra payload fields, null-for-omitted and string-for-number all fail closed to the conflict path', () => {
      const lg = (payload: Record<string, unknown>) => {
        const sent = queued({ entityType: 'log', entityId: L, baseRevision: 1, payload });
        return { sent, s: state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.domain.symptomLogs[L] = log(1); draft.sync.mutations = [sent]; }) };
      };
      const remote = liveLog(log(2, { weightKg: 60 }));
      for (const payload of [
        { pregnancyId: P, date: '2026-10-01', symptoms: ['nausea'], weightKg: 60, extra: 1 },
        { pregnancyId: P, date: '2026-10-01', symptoms: ['nausea'], weightKg: 60, notes: null },
        { pregnancyId: P, date: '2026-10-01', symptoms: ['nausea'], weightKg: '60' },
      ]) {
        const { sent, s } = lg(payload);
        expect(conflictOf(s, sent, remote)).toMatchObject({ terminalReason: 'revision-conflict' });
      }
      // The exact projection (envelope timestamps ignored) is satisfied, and only that mutation leaves the queue.
      const exact = lg({ pregnancyId: P, date: '2026-10-01', symptoms: ['nausea'], weightKg: 60 });
      expect(applied(exact.s, page([remote])).state.sync.mutations).toEqual([]);
    });

    it('two devices making the identical simple edit: the later device is satisfied, nothing is lost, only that intent leaves the queue', () => {
      const sent = queued({ entityType: 'appointment', entityId: A, baseRevision: 3, payload: { pregnancyId: P, startsAt: AT, timeZone: 'Europe/Copenhagen', title: 'Scan', completed: true, reminderEnabled: false } });
      const other = queued({ entityType: 'log', entityId: L, baseRevision: 1, payload: { pregnancyId: P, date: '2026-10-01', symptoms: [] } });
      const s = state((draft) => {
        draft.domain.pregnancies[P] = pregnancy(1); draft.domain.symptomLogs[L] = log(1);
        draft.domain.appointments[A] = appointment(3, { completed: true }); draft.sync.mutations = [sent, other];
      });
      const result = applied(s, page([liveAppointment(appointment(4, { completed: true }))]));
      expect(result.acknowledged).toEqual([sent.mutationId]);
      expect(result.state.sync.mutations).toEqual([other]);
      expect(result.state.domain.appointments[A]).toMatchObject({ revision: 4, completed: true });
    });

    it('settings: exact next revision and exact projection retire the intent; a different value does not', () => {
      const edit = queued({ entityType: 'settings', entityId: ACCOUNT, baseRevision: 1, payload: { recoveryDisplayDays: 30, privacyMode: true } });
      const s = state((draft) => { draft.domain.settings = settings(1, { recoveryDisplayDays: 30, privacyMode: true }); draft.sync.mutations = [edit]; });
      expect(applied(s, page([liveSettings(settings(2, { recoveryDisplayDays: 30, privacyMode: true }))])).state.sync.mutations).toEqual([]);
      expect(mutationOf(applied(s, page([liveSettings(settings(2, { recoveryDisplayDays: 30, privacyMode: false }))])).state, edit.mutationId)).toMatchObject({ terminalReason: 'revision-conflict' });
    });

    it('a tombstone, a creation and a delete can never be satisfied by the shortcut', () => {
      const { sent, s } = withPending({});
      const result = applied(s, page([tombstone('pregnancy', P, 2)]));
      expect(result.acknowledged).toEqual([]);
      expect(mutationOf(result.state, sent.mutationId)).toMatchObject({ terminalReason: 'remote-deleted' });
      expect(mutationOf(result.state, sent.mutationId)?.payload).toBeUndefined();
      const create = queued({ baseRevision: undefined, payload: base });
      const created = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.sync.mutations = [create]; });
      expect(mutationOf(applied(created, page([livePregnancy(pregnancy(1, { lmpDate: '2026-03-03' }))])).state, create.mutationId)).toMatchObject({ terminalReason: 'revision-conflict' });
      const remove = del({ baseRevision: 1 });
      const removed = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.sync.mutations = [remove]; });
      expect(mutationOf(applied(removed, page([livePregnancy(pregnancy(2))])).state, remove.mutationId)).toMatchObject({ terminalReason: 'revision-conflict' });
    });

    it('historical terminal evidence is never retired or rewritten, even when the remote row matches it exactly', () => {
      for (const terminalReason of ['consent-withdrawn', 'consent-required', 'revision-conflict'] as const) {
        const kept = queued({ baseRevision: 1, payload: base, status: 'failed', terminalReason });
        const state2 = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); if (terminalReason === 'consent-withdrawn') draft.sync.consent.withdrawnConsentIds['consent-1'] = true; draft.sync.mutations = [kept]; });
        const result = applied(state2, page([livePregnancy(pregnancy(2, { lmpDate: '2026-03-03' }))]));
        expect(result.acknowledged).toEqual([]);
        expect(mutationOf(result.state, kept.mutationId)).toEqual(kept);
      }
    });

    it('a mutation with a proof is judged only by its proof, never by the shortcut', () => {
      const { sent, s } = withPending({});
      const result = applied(s, page([livePregnancy(pregnancy(2, { lmpDate: '2026-03-03' }))], { proofs: [proof(sent, 2)] }));
      expect(result.acknowledged).toEqual([sent.mutationId]);
      expect(result.state.sync.mutations).toEqual([]);
    });
  });

  it('a stale local upsert loses: remote canonical installs and the intent becomes a terminal revision-conflict', () => {
    const stale = queued({ entityType: 'log', entityId: L, baseRevision: 1, payload: { pregnancyId: P, date: '2026-10-09', symptoms: [] } });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.domain.symptomLogs[L] = log(1, { date: '2026-10-09' }); draft.sync.mutations = [stale]; });
    const result = applied(s, page([liveLog(log(3, { date: '2026-10-05' }))]));
    expect(result.state.domain.symptomLogs[L]).toEqual(log(3, { date: '2026-10-05' }));
    const item = mutationOf(result.state, stale.mutationId)!;
    expect(item).toMatchObject({ terminalReason: 'revision-conflict', status: 'failed' });
    expect(item.nextRetryAt).toBeUndefined();
    // No rebasing: same mutation id, same base revision, never due again.
    expect(item.baseRevision).toBe(1);
  });

  it('a creation (no base) that meets an existing remote row is stale as well', () => {
    const create = queued({ baseRevision: undefined });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.sync.mutations = [create]; });
    expect(mutationOf(applied(s, page([livePregnancy(pregnancy(1))])).state, create.mutationId)).toMatchObject({ terminalReason: 'revision-conflict' });
  });

  it('a valid pending upsert (remote still at its base) is untouched and keeps its optimistic canonical', () => {
    const pending = queued({ baseRevision: 2 });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(2, { lmpDate: '2026-01-01' }); draft.sync.mutations = [pending]; });
    const result = applied(s, page([livePregnancy(pregnancy(2))]));
    expect(mutationOf(result.state, pending.mutationId)).toEqual(pending);
    expect(result.state.domain.pregnancies[P]?.lmpDate).toBe('2026-01-01');
  });

  it('a stale local delete is a destructive conflict: terminal, never silently rebased, the remote entity returns', () => {
    const stale = del({ entityType: 'log', entityId: L, baseRevision: 1 });
    const s = state((draft) => { draft.sync.mutations = [stale]; });
    const result = applied(s, page([liveLog(log(4))]));
    expect(mutationOf(result.state, stale.mutationId)).toMatchObject({ terminalReason: 'revision-conflict', baseRevision: 1 });
    expect(result.state.domain.symptomLogs[L]).toEqual(log(4));
  });

  it('a pending delete whose base still matches the remote is valid: the entity is not resurrected locally', () => {
    const pending = del({ entityType: 'log', entityId: L, baseRevision: 2 });
    const s = state((draft) => { draft.sync.mutations = [pending]; });
    const result = applied(s, page([liveLog(log(2))]));
    expect(result.state.domain.symptomLogs[L]).toBeUndefined();
    expect(mutationOf(result.state, pending.mutationId)).toEqual(pending);
  });

  it('a transient waiting intent (failed with a retry time) gets the same revision comparison', () => {
    const waiting = queued({ entityType: 'log', entityId: L, baseRevision: 1, status: 'failed', attempts: 2, nextRetryAt: '2026-10-14T12:05:00.000Z', payload: { pregnancyId: P, date: '2026-10-09', symptoms: [] } });
    const s = state((draft) => { draft.domain.symptomLogs[L] = log(1); draft.sync.mutations = [waiting]; });
    const item = mutationOf(applied(s, page([liveLog(log(2))])).state, waiting.mutationId)!;
    expect(item).toMatchObject({ terminalReason: 'revision-conflict' });
    expect(item.nextRetryAt).toBeUndefined();
  });

  it('a blocked refusal awaiting reconciliation is settled by the same comparison', () => {
    const blocked = queued({ baseRevision: 1, status: 'failed', awaiting: 'revision-conflict' });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.sync.mutations = [blocked]; });
    const item = mutationOf(applied(s, page([livePregnancy(pregnancy(2))], { caughtUp: true })).state, blocked.mutationId)!;
    expect(item).toMatchObject({ terminalReason: 'revision-conflict' });
    expect(item.awaiting).toBeUndefined();
  });

  it('never revives or rewrites historical consent-terminal evidence', () => {
    const refused = queued({ baseRevision: 1, status: 'failed', terminalReason: 'consent-withdrawn' });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.sync.consent.withdrawnConsentIds['consent-1'] = true; draft.sync.mutations = [refused]; });
    expect(mutationOf(applied(s, page([livePregnancy(pregnancy(4))])).state, refused.mutationId)).toEqual(refused);
  });
});

describe('APP-076 B2B1 reconciliation: verified acknowledgement', () => {
  it('acknowledges an applied upsert only after installing the server row, in the same result as the cursor', () => {
    const sent = queued({ entityType: 'log', entityId: L, baseRevision: 1, payload: { pregnancyId: P, date: '2026-10-09', symptoms: [] } });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.domain.symptomLogs[L] = log(1, { date: '2026-10-09' }); draft.sync.mutations = [sent]; });
    const result = applied(s, page([liveLog(log(2, { date: '2026-10-09' }))], { proofs: [proof(sent, 2)] }));
    expect(result.acknowledged).toEqual([sent.mutationId]);
    expect(result.state.sync.mutations).toEqual([]);
    expect(result.state.domain.symptomLogs[L]?.revision).toBe(2);
    expect(result.state.sync.nextChangeSeq).toBe(10);
  });

  it('a replay with existing local proof acknowledges without any remote snapshot', () => {
    const sent = queued({ baseRevision: 1 });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(2); draft.sync.mutations = [sent]; });
    const result = applied(s, page([], { fromCursor: 0, toCursor: 0, proofs: [proof(sent, 2)] }));
    expect(result.acknowledged).toEqual([sent.mutationId]);
  });

  it('a replay WITHOUT proof is not acknowledged and (while the ledger continues) keeps the mutation', () => {
    const sent = queued({ baseRevision: 1 });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.sync.mutations = [sent]; });
    const result = applied(s, page([], { toCursor: 0, proofs: [proof(sent, 2)] }));
    expect(result.acknowledged).toEqual([]);
    expect(mutationOf(result.state, sent.mutationId)).toEqual(sent);
  });

  it('a proof that stays unproven on a caught-up pass halts rather than guessing', () => {
    const sent = queued({ baseRevision: 1 });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.sync.mutations = [sent]; });
    expect(reconcilePregnancyState(s, page([], { toCursor: 0, caughtUp: true, proofs: [proof(sent, 2)] }))).toEqual({ kind: 'halt', cause: 'success-unproven' });
  });

  it('a delete is acknowledged only when payload is absent AND the tombstone reaches the server revision', () => {
    const sent = del({ entityType: 'log', entityId: L, baseRevision: 2 });
    const s = state((draft) => { draft.domain.symptomLogs[L] = log(2); draft.sync.mutations = [sent]; });
    // The tombstone proves it: payload scrubbed, tombstone revision 3 >= server revision 3.
    expect(applied(s, page([tombstone('log', L, 3)], { proofs: [proof(sent, 3)] })).acknowledged).toEqual([sent.mutationId]);
    // Payload still present and no tombstone: not acknowledged.
    expect(applied(s, page([], { toCursor: 0, proofs: [proof(sent, 3)] })).acknowledged).toEqual([]);
    // A tombstone below the server revision does not prove it.
    const below = applied(state((draft) => { draft.sync.mutations = [sent]; }), page([tombstone('log', L, 2)], { proofs: [proof(sent, 3)] }));
    expect(below.acknowledged).toEqual([]);
  });

  it('a proof is only honoured for the exact queued mutation it names', () => {
    const sent = queued({ baseRevision: 1 });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(2); draft.sync.mutations = [sent]; });
    const wrongEntity = { ...proof(sent, 2), entityId: idOf(33) };
    const wrongType = { ...proof(sent, 2), entityType: 'log' as const };
    const wrongDeleted = { ...proof(sent, 2), deleted: true };
    const wrongId = { ...proof(sent, 2), mutationId: 'unknown' };
    for (const bad of [wrongEntity, wrongType, wrongDeleted, wrongId]) {
      const result = applied(s, page([], { toCursor: 0, proofs: [bad] }));
      expect(result.acknowledged).toEqual([]);
      expect(mutationOf(result.state, sent.mutationId)).toEqual(sent);
    }
  });

  it('a proof that names a different, existing entity can never retire the mutation (identity is checked, not just state)', () => {
    const sent = queued({ entityType: 'log', entityId: L, baseRevision: 1, payload: { pregnancyId: P, date: '2026-10-09', symptoms: [] } });
    // The pregnancy P exists at revision 2, so a proof for P would "verify" if identity were not matched to the mutation.
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(2); draft.sync.mutations = [sent]; });
    const forged = { mutationId: sent.mutationId, entityType: 'pregnancy' as const, entityId: P, serverRevision: 2, deleted: false };
    const result = applied(s, page([], { toCursor: 0, proofs: [forged] }));
    expect(result.acknowledged).toEqual([]);
    expect(mutationOf(result.state, sent.mutationId)).toEqual(sent);
  });

  it('a proof can never retire a terminal mutation or fabricate canonical state', () => {
    const terminal = queued({ status: 'failed', terminalReason: 'consent-required' });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(2); draft.sync.mutations = [terminal]; });
    const result = applied(s, page([], { toCursor: 0, proofs: [proof(terminal, 2)] }));
    expect(result.acknowledged).toEqual([]);
    expect(mutationOf(result.state, terminal.mutationId)).toEqual(terminal);
    // No canonical entity at all: the proof is false, whatever the caller says.
    const sent = queued({ baseRevision: 1 });
    const empty = state((draft) => { draft.sync.mutations = [sent]; });
    expect(applied(empty, page([], { toCursor: 0, proofs: [proof(sent, 2)] })).acknowledged).toEqual([]);
  });

  it('an upsert acknowledged by the server and then deleted remotely is terminalized, not acknowledged', () => {
    const sent = queued({ entityType: 'log', entityId: L, baseRevision: 1, payload: { pregnancyId: P, date: '2026-10-09', symptoms: [], notes: 'private health note' } });
    const s = state((draft) => { draft.domain.symptomLogs[L] = log(1); draft.sync.mutations = [sent]; });
    const result = applied(s, page([tombstone('log', L, 3)], { proofs: [proof(sent, 2, false)] }));
    expect(result.acknowledged).toEqual([]);
    expect(mutationOf(result.state, sent.mutationId)).toMatchObject({ terminalReason: 'remote-deleted' });
    expect(JSON.stringify(result.state)).not.toContain('private health note');
  });

  it('a chain keeps its valid successor: only the proven mutation is removed, the server row is installed', () => {
    const first = queued({ baseRevision: 1 });
    const second = queued({ baseRevision: 2, payload: { method: 'lmp', note: 'second edit' } });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.sync.mutations = [first, second]; });
    const result = applied(s, page([livePregnancy(pregnancy(2))], { proofs: [proof(first, 2)] }));
    expect(result.acknowledged).toEqual([first.mutationId]);
    expect(result.state.sync.mutations.map((item) => item.mutationId)).toEqual([second.mutationId]);
    expect(result.state.domain.pregnancies[P]?.revision).toBe(2);
  });
});

describe('APP-076 B2B1 reconciliation: caught-up evaluation of refusals', () => {
  it('halts when a refusal awaiting reconciliation is still unexplained after the ledger is exhausted', () => {
    const conflict = queued({ baseRevision: 1, status: 'failed', awaiting: 'revision-conflict' });
    const parent = queued({ entityType: 'log', entityId: L, status: 'failed', awaiting: 'parent-unavailable', payload: { pregnancyId: P, date: '2026-10-09', symptoms: [] } });
    const s1 = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.sync.mutations = [conflict]; });
    const s2 = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.sync.mutations = [parent]; });
    expect(reconcilePregnancyState(s1, page([], { toCursor: 0, caughtUp: true }))).toEqual({ kind: 'halt', cause: 'revision-conflict-unexplained' });
    expect(reconcilePregnancyState(s2, page([], { toCursor: 0, caughtUp: true }))).toEqual({ kind: 'halt', cause: 'parent-unavailable-unexplained' });
    // While the ledger still has pages the refusal simply waits.
    expect(reconcilePregnancyState(s1, page([], { toCursor: 0, caughtUp: false })).kind).toBe('applied');
  });

  it('a parent_unavailable refusal is explained by the parent\'s tombstone: terminal remote-parent-deleted, no halt', () => {
    const parent = queued({ entityType: 'log', entityId: L, status: 'failed', awaiting: 'parent-unavailable', payload: { pregnancyId: P, date: '2026-10-09', symptoms: [], notes: 'private child text' } });
    const s = state((draft) => { draft.sync.mutations = [parent]; });
    const result = applied(s, page([tombstone('pregnancy', P, 4)], { caughtUp: true }));
    expect(mutationOf(result.state, parent.mutationId)).toMatchObject({ terminalReason: 'remote-parent-deleted' });
    expect(JSON.stringify(result.state)).not.toContain('private child text');
  });

  it('a parent_unavailable refusal with a LIVE parent stays unexplained and halts', () => {
    const parent = queued({ entityType: 'log', entityId: L, status: 'failed', awaiting: 'parent-unavailable', payload: { pregnancyId: P, date: '2026-10-09', symptoms: [] } });
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(2); draft.sync.mutations = [parent]; });
    expect(reconcilePregnancyState(s, page([livePregnancy(pregnancy(2))], { caughtUp: true }))).toEqual({ kind: 'halt', cause: 'parent-unavailable-unexplained' });
  });
});

describe('APP-076 B2B1 reconciliation: cursor and input discipline', () => {
  it('requires the page to be read for the stored cursor and never lets the cursor decrease', () => {
    const s = state((draft) => { draft.sync.nextChangeSeq = 5; });
    expect(() => reconcilePregnancyState(s, page([], { fromCursor: 4, toCursor: 9 }))).toThrow(PregnancyReconciliationInputError);
    expect(() => reconcilePregnancyState(s, page([], { fromCursor: 5, toCursor: 4 }))).toThrow(PregnancyReconciliationInputError);
    expect(() => reconcilePregnancyState(s, page([], { fromCursor: 5, toCursor: Number.MAX_SAFE_INTEGER + 2 }))).toThrow(PregnancyReconciliationInputError);
    expect(applied(s, page([], { fromCursor: 5, toCursor: 5 })).state.sync.nextChangeSeq).toBe(5);
  });

  it('rejects incoherent snapshots instead of installing them', () => {
    const wrongId = { ...livePregnancy(pregnancy(2)), entityId: idOf(9) };
    const wrongKind = { ...livePregnancy(pregnancy(2)), entityType: 'log' as const };
    const wrongRevision = { ...livePregnancy(pregnancy(2)), state: { kind: 'live' as const, revision: 9, live: { entityType: 'pregnancy' as const, entity: pregnancy(2) } } };
    const duplicate = [livePregnancy(pregnancy(2)), livePregnancy(pregnancy(3))];
    for (const bad of [[wrongId], [wrongKind], [wrongRevision], duplicate]) {
      expect(() => reconcilePregnancyState(state(), page(bad))).toThrow(PregnancyReconciliationInputError);
    }
  });

  it('does not mutate the state it was given', () => {
    const s = state((draft) => { draft.domain.pregnancies[P] = pregnancy(1); draft.domain.symptomLogs[L] = log(1); });
    const before = JSON.stringify(s);
    applied(s, page([tombstone('pregnancy', P, 4)]));
    expect(JSON.stringify(s)).toBe(before);
  });
});
