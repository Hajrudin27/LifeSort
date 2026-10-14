import { newEntityId } from '@/core/ids';
import { PregnancyProtectedDataError, pregnancyHealthStorageGeneration, readEncryptedPregnancyPayload, writeEncryptedPregnancyPayload } from '@/core/storage/pregnancyHealthEncryptedStorage';
import { PREGNANCY_HEALTH_STORAGE } from '@/core/storage/pregnancyHealthStorageContract';
import type { PregnancyAppointment, PregnancyEntry, PregnancySettings, PregnancySymptomLog } from '@/types/pregnancy';

export type PregnancyEntityType = 'pregnancy' | 'log' | 'appointment' | 'settings';
export type PregnancyLocalTombstone = { entityType: Exclude<PregnancyEntityType, 'settings'>; entityId: string; revision: number; changeSeq?: number };
export type PregnancyQueueStatus = 'pending' | 'failed';
export type PregnancyTerminalReason = 'consent-withdrawn' | 'consent-required';
export type PregnancyQueuedMutation = {
  mutationId: string; entityType: PregnancyEntityType; entityId: string; operation: 'upsert' | 'delete';
  payload?: Record<string, unknown>; baseRevision?: number; consentId?: string; createdAt: string;
  status: PregnancyQueueStatus; attempts: number; nextRetryAt?: string; terminalReason?: PregnancyTerminalReason;
};
export type PregnancyProtectedStateV1 = {
  version: 1; accountId: string; datasetEpoch: number;
  domain: { pregnancies: Record<string, PregnancyEntry>; symptomLogs: Record<string, PregnancySymptomLog>; appointments: Record<string, PregnancyAppointment>; settings: PregnancySettings | null };
  sync: { nextChangeSeq: number; mutations: PregnancyQueuedMutation[]; consent: { activeConsentIdsByPurpose: Record<string, string>; withdrawnConsentIds: Record<string, true> } };
  tombstones: Record<string, PregnancyLocalTombstone>;
};
export type NewPregnancyMutation = Omit<PregnancyQueuedMutation, 'mutationId' | 'createdAt' | 'status' | 'attempts' | 'nextRetryAt' | 'terminalReason'>;
export type PregnancyDomainDraft = PregnancyProtectedStateV1['domain'];

export class PregnancyProtectedRepositoryError extends Error {
  constructor(readonly code: 'account-mismatch' | 'dataset-epoch-mismatch' | 'invalid-protected-state', message: string) {
    super(message); this.name = 'PregnancyProtectedRepositoryError';
  }
}

let tail: Promise<unknown> = Promise.resolve();
let runtimeGeneration = 0;
export type PregnancyQueueEvent =
  | { readonly kind: 'changed'; readonly accountId: string }
  | { readonly kind: 'cleanup' }
  | { readonly kind: 'epoch-invalidated'; readonly accountId?: string };
const listeners = new Set<(event: PregnancyQueueEvent) => void>();
export function subscribePregnancyQueue(listener: (event: PregnancyQueueEvent) => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
function notify(event: PregnancyQueueEvent): void {
  for (const listener of listeners) try { listener(event); } catch { /* Metadata listeners never fault persistence. */ }
}
function serialize<T>(operation: () => Promise<T>): Promise<T> { const result = tail.then(operation); tail = result.catch(() => undefined); return result; }
function invalid(): never { throw new PregnancyProtectedRepositoryError('invalid-protected-state', 'Pregnancy protected state is invalid.'); }
function record(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function text(v: unknown): v is string { return typeof v === 'string' && v.trim().length > 0; }
function integer(v: unknown, minimum = 0): v is number { return Number.isSafeInteger(v) && (v as number) >= minimum; }
function timestamp(v: unknown): v is string { return typeof v === 'string' && Number.isFinite(Date.parse(v)); }
function json(v: unknown, ancestors = new Set<object>()): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (!v || typeof v !== 'object' || ancestors.has(v) || (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)) return false;
  ancestors.add(v); const ok = Object.values(v).every((item) => json(item, ancestors)); ancestors.delete(v); return ok;
}
function validRevision(v: unknown): v is number { return integer(v, 1); }
function optionalDate(v: unknown): boolean { return v === undefined || text(v); }
function optionalTimestamp(v: unknown): boolean { return v === undefined || timestamp(v); }
function optionalText(v: unknown): boolean { return v === undefined || text(v); }
function validEntry(v: unknown, kind: 'pregnancy' | 'log' | 'appointment' | 'settings'): boolean {
  if (!record(v) || !validRevision(v.revision) || !timestamp(v.updatedAt)) return false;
  if (!optionalTimestamp(v.deletedAt)) return false;
  if (kind === 'pregnancy') return text(v.id) && ['lmp', 'conception', 'dueDate'].includes(String(v.method)) && timestamp(v.createdAt) && optionalDate(v.lmpDate) && optionalDate(v.conceptionDate) && optionalDate(v.dueDateOverride) && (v.dueDateSource === undefined || ['user', 'lmp', 'scan', 'clinician'].includes(String(v.dueDateSource))) && optionalDate(v.endedAt) && (v.outcome === undefined || ['birth', 'stillbirth', 'miscarriage', 'termination', 'other', 'preferNotToSay'].includes(String(v.outcome))) && optionalText(v.outcomeNotes) && optionalDate(v.recoveryEndedAt);
  if (kind === 'log') return text(v.id) && text(v.pregnancyId) && text(v.date) && Array.isArray(v.symptoms) && v.symptoms.every((symptom) => ['nausea', 'fatigue', 'backache', 'heartburn', 'swelling', 'cramps', 'moodSwings', 'braxtonHicks', 'insomnia', 'other'].includes(String(symptom))) && (v.weightKg === undefined || (typeof v.weightKg === 'number' && Number.isFinite(v.weightKg))) && (v.bellyMeasurementCm === undefined || (typeof v.bellyMeasurementCm === 'number' && Number.isFinite(v.bellyMeasurementCm))) && optionalText(v.notes);
  if (kind === 'appointment') return text(v.id) && text(v.pregnancyId) && timestamp(v.startsAt) && text(v.timeZone) && text(v.title) && optionalText(v.notes) && typeof v.completed === 'boolean' && typeof v.reminderEnabled === 'boolean';
  return integer(v.recoveryDisplayDays) && typeof v.privacyMode === 'boolean';
}
function validDictionary(v: unknown, kind: 'pregnancy' | 'log' | 'appointment'): boolean { return record(v) && Object.entries(v).every(([id, value]) => text(id) && record(value) && validEntry(value, kind) && value.id === id); }
function validMutation(v: unknown): v is PregnancyQueuedMutation {
  if (!record(v) || !text(v.mutationId) || !['pregnancy', 'log', 'appointment', 'settings'].includes(String(v.entityType)) || !text(v.entityId) || !['upsert', 'delete'].includes(String(v.operation)) || !timestamp(v.createdAt) || !['pending', 'failed'].includes(String(v.status)) || !integer(v.attempts)) return false;
  if (v.payload !== undefined && (!record(v.payload) || !json(v.payload))) return false;
  if (v.baseRevision !== undefined && !integer(v.baseRevision)) return false;
  if (v.nextRetryAt !== undefined && !timestamp(v.nextRetryAt)) return false;
  if (v.terminalReason !== undefined && (typeof v.terminalReason !== 'string' || !['consent-withdrawn', 'consent-required'].includes(v.terminalReason))) return false;
  // A terminal quarantine is a failed upsert with no retry time; anything else could look sendable to a later planner.
  if (v.terminalReason !== undefined && (v.status !== 'failed' || v.nextRetryAt !== undefined || v.operation !== 'upsert')) return false;
  // Settings are one upsert-only row per account (ADR-0062); a delete would be a permanent server refusal.
  if (v.entityType === 'settings' && v.operation === 'delete') return false;
  if (v.operation === 'upsert' ? !text(v.consentId) : v.consentId !== undefined || v.payload !== undefined) return false;
  return true;
}
export function assertPregnancyProtectedState(value: unknown): asserts value is PregnancyProtectedStateV1 {
  if (!record(value) || value.version !== 1 || !text(value.accountId) || !integer(value.datasetEpoch) || !record(value.domain) || !record(value.sync) || !record(value.tombstones)) invalid();
  if (!validDictionary(value.domain.pregnancies, 'pregnancy') || !validDictionary(value.domain.symptomLogs, 'log') || !validDictionary(value.domain.appointments, 'appointment') || (value.domain.settings !== null && !validEntry(value.domain.settings, 'settings'))) invalid();
  if (!integer(value.sync.nextChangeSeq) || !Array.isArray(value.sync.mutations) || !value.sync.mutations.every(validMutation) || new Set(value.sync.mutations.map((m) => m.mutationId)).size !== value.sync.mutations.length || !record(value.sync.consent) || !record(value.sync.consent.activeConsentIdsByPurpose) || !record(value.sync.consent.withdrawnConsentIds)) invalid();
  if (!Object.entries(value.sync.consent.activeConsentIdsByPurpose).every(([purpose, consentId]) => text(purpose) && text(consentId)) || !Object.entries(value.sync.consent.withdrawnConsentIds).every(([consentId, withdrawn]) => text(consentId) && withdrawn === true)) invalid();
  // Withdrawal is terminal for every upsert bound to the withdrawn consent: a pending one could still be sent later.
  const withdrawnIds = value.sync.consent.withdrawnConsentIds as Record<string, true>;
  if ((value.sync.mutations as PregnancyQueuedMutation[]).some((m) => m.operation === 'upsert' && withdrawnIds[m.consentId as string] === true && m.terminalReason !== 'consent-withdrawn')) invalid();
  for (const [key, tombstone] of Object.entries(value.tombstones)) {
    if (!text(key) || !record(tombstone) || !['pregnancy', 'log', 'appointment'].includes(String(tombstone.entityType)) || !text(tombstone.entityId) || !validRevision(tombstone.revision) || (tombstone.changeSeq !== undefined && !integer(tombstone.changeSeq))) invalid();
    // Tombstones are payload-free reconciliation metadata: no key beyond these four may ever be persisted.
    if (!Object.keys(tombstone).every((field) => ['entityType', 'entityId', 'revision', 'changeSeq'].includes(field))) invalid();
  }
}
export function createInitialPregnancyProtectedState(accountId: string, datasetEpoch = 0): PregnancyProtectedStateV1 {
  if (!text(accountId) || !integer(datasetEpoch)) invalid();
  return { version: 1, accountId, datasetEpoch, domain: { pregnancies: {}, symptomLogs: {}, appointments: {}, settings: null }, sync: { nextChangeSeq: 0, mutations: [], consent: { activeConsentIdsByPurpose: {}, withdrawnConsentIds: {} } }, tombstones: {} };
}
export function pregnancyMutationIsAutomaticallyEligible(mutation: PregnancyQueuedMutation): boolean { return mutation.terminalReason === undefined && (mutation.status === 'pending' || mutation.nextRetryAt !== undefined); }
function mutationHasCanonicalState(state: PregnancyProtectedStateV1, mutation: PregnancyQueuedMutation): boolean {
  if (mutation.operation === 'delete') return true;
  if (mutation.entityType === 'pregnancy') return state.domain.pregnancies[mutation.entityId]?.id === mutation.entityId;
  if (mutation.entityType === 'log') return state.domain.symptomLogs[mutation.entityId]?.id === mutation.entityId;
  if (mutation.entityType === 'appointment') return state.domain.appointments[mutation.entityId]?.id === mutation.entityId;
  return state.domain.settings !== null;
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function handleError(code: 'account-mismatch' | 'dataset-epoch-mismatch'): never { throw new PregnancyProtectedRepositoryError(code, code === 'account-mismatch' ? 'Pregnancy account handle is no longer active.' : 'Pregnancy dataset handle is no longer active.'); }

export function invalidatePregnancyProtectedRepositories(): void { runtimeGeneration += 1; notify({ kind: 'cleanup' }); }

// getActiveAccount is mandatory: without a live-session check a stale continuation from a logged-out session could create a fresh
// handle after cleanup and recreate ciphertext and key for the departed account.
export function createPregnancyProtectedRepository(options: { accountId: string; getActiveAccount: () => string | null; datasetEpoch?: number }) {
  const accountId = options.accountId;
  if (!text(accountId) || typeof options.getActiveAccount !== 'function') invalid();
  const active = options.getActiveAccount;
  const handleGeneration = runtimeGeneration;
  const storageGeneration = pregnancyHealthStorageGeneration();
  const expectedEpoch = options.datasetEpoch;
  function assertActive(state?: PregnancyProtectedStateV1): void {
    if (active() !== accountId) handleError('account-mismatch');
    if (runtimeGeneration !== handleGeneration || pregnancyHealthStorageGeneration() !== storageGeneration) handleError('dataset-epoch-mismatch');
    if (state && (state.accountId !== accountId || (expectedEpoch !== undefined && state.datasetEpoch !== expectedEpoch))) handleError(state.accountId !== accountId ? 'account-mismatch' : 'dataset-epoch-mismatch');
  }
  async function load(): Promise<PregnancyProtectedStateV1 | null> {
    assertActive(); const raw = await readEncryptedPregnancyPayload(); assertActive();
    if (raw === null) return null;
    let parsed: unknown; try { parsed = JSON.parse(raw); } catch { invalid(); }
    assertPregnancyProtectedState(parsed); assertActive(parsed); return parsed;
  }
  // Intentionally private: B1 exposes no generic canonical-state write escape hatch.
  // B2 must add a reviewed reconciliation-specific operation when it needs one.
  async function commitProtectedState(derive: (current: Readonly<PregnancyProtectedStateV1 | null>) => PregnancyProtectedStateV1): Promise<PregnancyProtectedStateV1> {
    return serialize(async () => {
      const current = await load(); assertActive(current ?? undefined);
      const next = derive(current === null ? null : clone(current));
      assertPregnancyProtectedState(next); assertActive(next);
      // Account and dataset epoch are fixed once a dataset exists; the epoch moves only through rebaseline().
      if (current !== null && (next.accountId !== current.accountId || next.datasetEpoch !== current.datasetEpoch)) invalid();
      // Serialize once: the caller is told exactly what was persisted, never a caller-owned object mutated during the write.
      const serialized = JSON.stringify(next);
      await writeEncryptedPregnancyPayload(serialized);
      const committed = JSON.parse(serialized) as PregnancyProtectedStateV1; assertActive(committed);
      notify({ kind: 'changed', accountId });
      return committed;
    });
  }
  return {
    hydrate: () => serialize(load),
    initialize: (state: PregnancyProtectedStateV1) => commitProtectedState((current) => { if (current !== null) invalid(); return state; }),
    commitLocalMutation: async (
      mutate: (domain: PregnancyDomainDraft) => PregnancyDomainDraft | void,
      input: NewPregnancyMutation,
    ): Promise<PregnancyQueuedMutation> => {
      const requested = clone(input);
      let created!: PregnancyQueuedMutation;
      await commitProtectedState((current) => {
        if (current === null) invalid();
        // The callback gets only domain state. The queue intent is constructed and
        // appended here, outside caller-controlled mutation code.
        created = {
          mutationId: newEntityId(), entityType: requested.entityType, entityId: requested.entityId, operation: requested.operation,
          ...(requested.payload === undefined ? {} : { payload: clone(requested.payload) }),
          ...(requested.baseRevision === undefined ? {} : { baseRevision: requested.baseRevision }),
          ...(requested.consentId === undefined ? {} : { consentId: requested.consentId }),
          createdAt: new Date().toISOString(), status: 'pending', attempts: 0,
        };
        const draft = clone(current.domain);
        const returnedDomain = mutate(draft);
        const next = clone(current) as PregnancyProtectedStateV1;
        // This clone severs callback-held references before validation/persistence.
        next.domain = clone(returnedDomain ?? draft);
        if (!validMutation(created) || !mutationHasCanonicalState(next, created) || next.sync.mutations.some((item) => item.mutationId === created.mutationId)) invalid();
        next.sync.mutations = [...next.sync.mutations.map(clone), clone(created)];
        return next;
      });
      return clone(created);
    },
    list: () => serialize(async () => (await load())?.sync.mutations.map(clone) ?? []),
    acknowledge: async (mutationId: string) => {
      let changed = false; await commitProtectedState((current) => { if (!current) invalid(); const next = clone(current); const before = next.sync.mutations.length; next.sync.mutations = next.sync.mutations.filter((item) => item.mutationId !== mutationId); changed = next.sync.mutations.length !== before; return next; }); return changed;
    },
    updateMetadata: async (mutationId: string, patch: { status?: PregnancyQueueStatus; attempts?: number; nextRetryAt?: string | null }) => {
      let changed = false; await commitProtectedState((current) => { if (!current) invalid(); const next = clone(current); const item = next.sync.mutations.find((entry) => entry.mutationId === mutationId); if (!item) return next; if (item.terminalReason !== undefined) return next; if (patch.status !== undefined) item.status = patch.status; if (patch.attempts !== undefined) item.attempts = patch.attempts; if (patch.nextRetryAt === null) delete item.nextRetryAt; else if (patch.nextRetryAt !== undefined) item.nextRetryAt = patch.nextRetryAt; if (!validMutation(item)) invalid(); changed = true; return next; }); return changed;
    },
    recordFailure: async (mutationId: string, patch: { status: 'failed'; attempts: number; nextRetryAt: string | null }, terminalReason?: PregnancyTerminalReason) => {
      let changed = false;
      await commitProtectedState((current) => {
        if (!current) invalid(); const next = clone(current); const item = next.sync.mutations.find((entry) => entry.mutationId === mutationId);
        if (!item || item.terminalReason !== undefined) return next;
        item.status = patch.status; item.attempts = patch.attempts;
        if (patch.nextRetryAt === null) delete item.nextRetryAt; else item.nextRetryAt = patch.nextRetryAt;
        if (terminalReason !== undefined) item.terminalReason = terminalReason;
        if (!validMutation(item)) invalid(); changed = true; return next;
      });
      return changed;
    },
    withdrawConsent: async (consentId: string) => commitProtectedState((current) => {
      if (!current || !text(consentId)) invalid(); const next = clone(current); next.sync.consent.withdrawnConsentIds[consentId] = true;
      for (const item of next.sync.mutations) if (item.operation === 'upsert' && item.consentId === consentId) { item.status = 'failed'; item.terminalReason = 'consent-withdrawn'; delete item.nextRetryAt; }
      return next;
    }),
    rebaseline: async () => serialize(async () => {
      const current = await load();
      const next = createInitialPregnancyProtectedState(accountId, (current?.datasetEpoch ?? -1) + 1);
      assertPregnancyProtectedState(next);
      // Stop stale consumers before replacement; B2B will wait for its own
      // authenticated baseline before invoking this destructive primitive.
      runtimeGeneration += 1;
      notify({ kind: 'epoch-invalidated', accountId });
      await writeEncryptedPregnancyPayload(JSON.stringify(next));
      if (active() !== accountId) handleError('account-mismatch');
      notify({ kind: 'changed', accountId });
      // The calling handle intentionally becomes stale at this commit boundary.
      return clone(next);
    }),
    /** Synchronous stale-work guard; it exposes no protected state. */
    isActive: () => {
      try { assertActive(); return true; } catch { return false; }
    },
  };
}
