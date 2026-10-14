import { newEntityId } from '@/core/ids';
import {
  PregnancyReconciliationInputError, reconcilePregnancyState,
  type PregnancyReconciliationInput, type PregnancySuccessProof,
} from '@/core/pregnancy/reconciliation';
import { PregnancyProtectedDataError, pregnancyHealthStorageGeneration, readEncryptedPregnancyPayload, writeEncryptedPregnancyPayload } from '@/core/storage/pregnancyHealthEncryptedStorage';
import { PREGNANCY_HEALTH_STORAGE } from '@/core/storage/pregnancyHealthStorageContract';
import type { PregnancyAppointment, PregnancyEntry, PregnancySettings, PregnancySymptomLog } from '@/types/pregnancy';

export type PregnancyEntityType = 'pregnancy' | 'log' | 'appointment' | 'settings';
export type PregnancyLocalTombstone = { entityType: Exclude<PregnancyEntityType, 'settings'>; entityId: string; revision: number; changeSeq?: number };
export type PregnancyQueueStatus = 'pending' | 'failed';
/**
 * A terminal mutation is retained evidence and is never sent again. The consent reasons
 * are B1/B2A; `revision-conflict` and the two remote-deletion reasons are B2B1.
 */
export type PregnancyTerminalReason =
  | 'consent-withdrawn' | 'consent-required' | 'revision-conflict' | 'remote-deleted' | 'remote-parent-deleted';
const CONSENT_TERMINAL_REASONS: readonly PregnancyTerminalReason[] = ['consent-withdrawn', 'consent-required'];
const TERMINAL_REASONS: readonly PregnancyTerminalReason[] = [...CONSENT_TERMINAL_REASONS, 'revision-conflict', 'remote-deleted', 'remote-parent-deleted'];
/** A refusal that only reconciliation can settle; the mutation stays blocked, never retried, meanwhile. */
export type PregnancyAwaiting = 'revision-conflict' | 'parent-unavailable';
export type PregnancyQueuedMutation = {
  mutationId: string; entityType: PregnancyEntityType; entityId: string; operation: 'upsert' | 'delete';
  payload?: Record<string, unknown>; baseRevision?: number; consentId?: string; createdAt: string;
  status: PregnancyQueueStatus; attempts: number; nextRetryAt?: string; terminalReason?: PregnancyTerminalReason; awaiting?: PregnancyAwaiting;
};
/** Payload-free technical cause of a backend-wide halt. Never a server string, never a value. */
export type PregnancyBackendHaltCause =
  | 'mutation-id-conflict' | 'unknown-conflict' | 'parent-unavailable-unexplained'
  | 'revision-conflict-unexplained' | 'same-revision-divergence' | 'success-unproven';
const HALT_CAUSES: readonly PregnancyBackendHaltCause[] = ['mutation-id-conflict', 'unknown-conflict', 'parent-unavailable-unexplained', 'revision-conflict-unexplained', 'same-revision-divergence', 'success-unproven'];
export type PregnancyBackendHalt = { kind: 'recovery-required' | 'conflict'; cause: PregnancyBackendHaltCause; recordedAt: string };
export type PregnancyProtectedState = {
  version: 2; accountId: string; datasetEpoch: number;
  domain: { pregnancies: Record<string, PregnancyEntry>; symptomLogs: Record<string, PregnancySymptomLog>; appointments: Record<string, PregnancyAppointment>; settings: PregnancySettings | null };
  sync: { nextChangeSeq: number; mutations: PregnancyQueuedMutation[]; consent: { activeConsentIdsByPurpose: Record<string, string>; withdrawnConsentIds: Record<string, true> }; halt: PregnancyBackendHalt | null };
  tombstones: Record<string, PregnancyLocalTombstone>;
};
/** The B1/B2A on-disk shape. It exists only so it can be upgraded; nothing writes it any more. */
export type PregnancyProtectedStateV1 = Omit<PregnancyProtectedState, 'version' | 'sync'> & {
  version: 1; sync: Omit<PregnancyProtectedState['sync'], 'halt'>;
};
export const PREGNANCY_PROTECTED_STATE_VERSION = 2;
export type NewPregnancyMutation = Omit<PregnancyQueuedMutation, 'mutationId' | 'createdAt' | 'status' | 'attempts' | 'nextRetryAt' | 'terminalReason'>;
export type PregnancyDomainDraft = PregnancyProtectedState['domain'];

export class PregnancyProtectedRepositoryError extends Error {
  constructor(readonly code: 'account-mismatch' | 'dataset-epoch-mismatch' | 'invalid-protected-state' | 'cursor-mismatch' | 'backend-halted', message: string) {
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
  // The server accepts only a non-negative expected revision. Keeping the same
  // invariant locally means a malformed encrypted intent cannot enter a retry
  // loop that the RPC will permanently reject.
  if (v.baseRevision !== undefined && (!integer(v.baseRevision) || v.baseRevision < 0)) return false;
  if (v.nextRetryAt !== undefined && !timestamp(v.nextRetryAt)) return false;
  if (v.terminalReason !== undefined && (typeof v.terminalReason !== 'string' || !TERMINAL_REASONS.includes(v.terminalReason as PregnancyTerminalReason))) return false;
  // A terminal quarantine is a failed mutation with no retry time; anything else could look sendable to a later planner.
  if (v.terminalReason !== undefined && (v.status !== 'failed' || v.nextRetryAt !== undefined)) return false;
  // Consent reasons are about an upsert's consent; the other reasons may end a delete too.
  if (CONSENT_TERMINAL_REASONS.includes(v.terminalReason as PregnancyTerminalReason) && v.operation !== 'upsert') return false;
  // Data the server has deleted must not survive in a retained mutation.
  if ((v.terminalReason === 'remote-deleted' || v.terminalReason === 'remote-parent-deleted') && v.payload !== undefined) return false;
  // A refusal awaiting reconciliation is blocked: failed, never scheduled, never terminal.
  if (v.awaiting !== undefined && (!['revision-conflict', 'parent-unavailable'].includes(String(v.awaiting)) || v.status !== 'failed' || v.nextRetryAt !== undefined || v.terminalReason !== undefined)) return false;
  // Settings are one upsert-only row per account (ADR-0062); a delete would be a permanent server refusal.
  if (v.entityType === 'settings' && v.operation === 'delete') return false;
  if (v.operation === 'upsert' ? !text(v.consentId) : v.consentId !== undefined || v.payload !== undefined) return false;
  return true;
}
function validHalt(v: unknown): boolean {
  return v === null || (record(v) && Object.keys(v).every((key) => ['kind', 'cause', 'recordedAt'].includes(key)) &&
    ['recovery-required', 'conflict'].includes(String(v.kind)) && HALT_CAUSES.includes(v.cause as PregnancyBackendHaltCause) && timestamp(v.recordedAt));
}
export function assertPregnancyProtectedState(value: unknown): asserts value is PregnancyProtectedState {
  if (!record(value) || value.version !== PREGNANCY_PROTECTED_STATE_VERSION || !text(value.accountId) || !integer(value.datasetEpoch) || !record(value.domain) || !record(value.sync) || !record(value.tombstones)) invalid();
  if (!validDictionary(value.domain.pregnancies, 'pregnancy') || !validDictionary(value.domain.symptomLogs, 'log') || !validDictionary(value.domain.appointments, 'appointment') || (value.domain.settings !== null && !validEntry(value.domain.settings, 'settings'))) invalid();
  if (!integer(value.sync.nextChangeSeq) || !Array.isArray(value.sync.mutations) || !value.sync.mutations.every(validMutation) || new Set(value.sync.mutations.map((m) => m.mutationId)).size !== value.sync.mutations.length || !record(value.sync.consent) || !record(value.sync.consent.activeConsentIdsByPurpose) || !record(value.sync.consent.withdrawnConsentIds) || !validHalt(value.sync.halt)) invalid();
  if (!Object.entries(value.sync.consent.activeConsentIdsByPurpose).every(([purpose, consentId]) => text(purpose) && text(consentId)) || !Object.entries(value.sync.consent.withdrawnConsentIds).every(([consentId, withdrawn]) => text(consentId) && withdrawn === true)) invalid();
  // Withdrawal is terminal for every upsert bound to the withdrawn consent: a pending one could still be sent later.
  const withdrawnIds = value.sync.consent.withdrawnConsentIds as Record<string, true>;
  if ((value.sync.mutations as PregnancyQueuedMutation[]).some((m) => m.operation === 'upsert' && withdrawnIds[m.consentId as string] === true && m.terminalReason !== 'consent-withdrawn')) invalid();
  for (const [key, tombstone] of Object.entries(value.tombstones)) {
    if (!text(key) || !record(tombstone) || !['pregnancy', 'log', 'appointment'].includes(String(tombstone.entityType)) || !text(tombstone.entityId) || !validRevision(tombstone.revision) || (tombstone.changeSeq !== undefined && !integer(tombstone.changeSeq))) invalid();
    // Tombstones are payload-free reconciliation metadata: no key beyond these four may ever be persisted.
    if (!Object.keys(tombstone).every((field) => ['entityType', 'entityId', 'revision', 'changeSeq'].includes(field))) invalid();
    // The key is derived, never chosen: a tombstone can only ever be looked up by the entity it describes.
    if (key !== `${tombstone.entityType}:${tombstone.entityId}`) invalid();
  }
  // Deleted health data must not survive anywhere in canonical state: a tombstoned entity, and every
  // child of a tombstoned root, is absent from the domain.
  const tombstones = value.tombstones as Record<string, PregnancyLocalTombstone>;
  const domain = value.domain as PregnancyProtectedState['domain'];
  if (Object.keys(domain.pregnancies).some((id) => tombstones[`pregnancy:${id}`]) || Object.keys(domain.symptomLogs).some((id) => tombstones[`log:${id}`]) || Object.keys(domain.appointments).some((id) => tombstones[`appointment:${id}`])) invalid();
  if (Object.values(domain.symptomLogs).some((log) => tombstones[`pregnancy:${log.pregnancyId}`]) || Object.values(domain.appointments).some((appointment) => tombstones[`pregnancy:${appointment.pregnancyId}`])) invalid();
}
/**
 * Deterministic, fail-closed upgrade of a decrypted dataset to the current shape. Version 1 (B1/B2A)
 * gains an empty technical halt; every other version, and every v1 payload that does not satisfy the
 * current rules, is refused. The caller persists the result under the same key in the same ciphertext.
 */
export function upgradePregnancyProtectedState(parsed: unknown): { state: PregnancyProtectedState; upgraded: boolean } {
  if (record(parsed) && parsed.version === 1) {
    if (!record(parsed.sync) || 'halt' in parsed.sync) invalid();
    const upgraded = { ...parsed, version: PREGNANCY_PROTECTED_STATE_VERSION, sync: { ...parsed.sync, halt: null } };
    assertPregnancyProtectedState(upgraded);
    return { state: upgraded, upgraded: true };
  }
  assertPregnancyProtectedState(parsed);
  return { state: parsed, upgraded: false };
}
export function createInitialPregnancyProtectedState(accountId: string, datasetEpoch = 0): PregnancyProtectedState {
  if (!text(accountId) || !integer(datasetEpoch)) invalid();
  return { version: PREGNANCY_PROTECTED_STATE_VERSION, accountId, datasetEpoch, domain: { pregnancies: {}, symptomLogs: {}, appointments: {}, settings: null }, sync: { nextChangeSeq: 0, mutations: [], consent: { activeConsentIdsByPurpose: {}, withdrawnConsentIds: {} }, halt: null }, tombstones: {} };
}
export function pregnancyMutationIsAutomaticallyEligible(mutation: PregnancyQueuedMutation): boolean { return mutation.terminalReason === undefined && (mutation.status === 'pending' || mutation.nextRetryAt !== undefined); }
function mutationHasCanonicalState(state: PregnancyProtectedState, mutation: PregnancyQueuedMutation): boolean {
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
  function assertActive(state?: PregnancyProtectedState): void {
    if (active() !== accountId) handleError('account-mismatch');
    if (runtimeGeneration !== handleGeneration || pregnancyHealthStorageGeneration() !== storageGeneration) handleError('dataset-epoch-mismatch');
    if (state && (state.accountId !== accountId || (expectedEpoch !== undefined && state.datasetEpoch !== expectedEpoch))) handleError(state.accountId !== accountId ? 'account-mismatch' : 'dataset-epoch-mismatch');
  }
  async function load(): Promise<PregnancyProtectedState | null> {
    assertActive(); const raw = await readEncryptedPregnancyPayload(); assertActive();
    if (raw === null) return null;
    let parsed: unknown; try { parsed = JSON.parse(raw); } catch { invalid(); }
    const { state, upgraded } = upgradePregnancyProtectedState(parsed); assertActive(state);
    if (upgraded) {
      // In-place encrypted schema upgrade: the same key and ciphertext slot, one atomic replacement. A failed
      // write leaves the readable old version untouched and surfaces as a protected-storage failure.
      await writeEncryptedPregnancyPayload(JSON.stringify(state)); assertActive(state);
    }
    return state;
  }
  // Intentionally private: B1 exposes no generic canonical-state write escape hatch.
  // B2 must add a reviewed reconciliation-specific operation when it needs one.
  async function commitProtectedState(derive: (current: Readonly<PregnancyProtectedState | null>) => PregnancyProtectedState): Promise<PregnancyProtectedState> {
    return serialize(async () => {
      const current = await load(); assertActive(current ?? undefined);
      const next = derive(current === null ? null : clone(current));
      assertPregnancyProtectedState(next); assertActive(next);
      // Account and dataset epoch are fixed once a dataset exists; the epoch moves only through rebaseline().
      if (current !== null && (next.accountId !== current.accountId || next.datasetEpoch !== current.datasetEpoch)) invalid();
      // Serialize once: the caller is told exactly what was persisted, never a caller-owned object mutated during the write.
      const serialized = JSON.stringify(next);
      await writeEncryptedPregnancyPayload(serialized);
      const committed = JSON.parse(serialized) as PregnancyProtectedState; assertActive(committed);
      notify({ kind: 'changed', accountId });
      return committed;
    });
  }
  return {
    hydrate: () => serialize(load),
    initialize: (state: PregnancyProtectedState) => commitProtectedState((current) => { if (current !== null) invalid(); return state; }),
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
        const next = clone(current) as PregnancyProtectedState;
        // This clone severs callback-held references before validation/persistence.
        next.domain = clone(returnedDomain ?? draft);
        if (!validMutation(created) || !mutationHasCanonicalState(next, created) || next.sync.mutations.some((item) => item.mutationId === created.mutationId)) invalid();
        next.sync.mutations = [...next.sync.mutations.map(clone), clone(created)];
        return next;
      });
      return clone(created);
    },
    list: () => serialize(async () => (await load())?.sync.mutations.map(clone) ?? []),
    updateMetadata: async (mutationId: string, patch: { status?: PregnancyQueueStatus; attempts?: number; nextRetryAt?: string | null }) => {
      let changed = false; await commitProtectedState((current) => { if (!current) invalid(); const next = clone(current); const item = next.sync.mutations.find((entry) => entry.mutationId === mutationId); if (!item) return next; if (item.terminalReason !== undefined) return next; if (patch.status !== undefined) item.status = patch.status; if (patch.attempts !== undefined) item.attempts = patch.attempts; if (patch.nextRetryAt === null) delete item.nextRetryAt; else if (patch.nextRetryAt !== undefined) item.nextRetryAt = patch.nextRetryAt; if (patch.status === 'pending' || (typeof patch.nextRetryAt === 'string')) delete item.awaiting; if (!validMutation(item)) invalid(); changed = true; return next; }); return changed;
    },
    recordFailure: async (
      mutationId: string, patch: { status: 'failed'; attempts: number; nextRetryAt: string | null }, terminalReason?: PregnancyTerminalReason,
      extra?: { awaiting?: PregnancyAwaiting; halt?: { kind: PregnancyBackendHalt['kind']; cause: PregnancyBackendHaltCause } },
    ) => {
      let changed = false;
      await commitProtectedState((current) => {
        if (!current) invalid(); const next = clone(current); const item = next.sync.mutations.find((entry) => entry.mutationId === mutationId);
        if (!item || item.terminalReason !== undefined) return next;
        item.status = patch.status; item.attempts = patch.attempts;
        if (patch.nextRetryAt === null) delete item.nextRetryAt; else item.nextRetryAt = patch.nextRetryAt;
        if (terminalReason !== undefined) item.terminalReason = terminalReason;
        if (extra?.awaiting !== undefined) item.awaiting = extra.awaiting;
        // The failure and the backend-wide halt it earns are one commit: a crash can leave neither half.
        if (extra?.halt !== undefined && next.sync.halt === null) next.sync.halt = { kind: extra.halt.kind, cause: extra.halt.cause, recordedAt: new Date().toISOString() };
        if (!validMutation(item)) invalid(); changed = true; return next;
      });
      return changed;
    },
    /** The queue and cursor as the backend needs them; it exposes no canonical domain state. */
    readSyncView: () => serialize(async () => {
      const state = await load();
      return state === null ? null : { cursor: state.sync.nextChangeSeq, halt: clone(state.sync.halt), mutations: state.sync.mutations.map(clone) };
    }),
    /**
     * The one narrow write path for remote truth. It takes typed, already-validated instructions and applies
     * them with the repository's own reducer, so no caller code ever runs over protected state. Canonical
     * state or tombstones, the cursor and any mutation acknowledgement land in ONE encrypted commit, and a
     * mutation is removed only if the resulting state proves the server's result for it. A page that cannot
     * be applied (stale cursor, halted backend, rejected state) writes nothing.
     */
    commitRemoteReconciliation: async (input: PregnancyReconciliationInput): Promise<{ cursor: number; acknowledged: readonly string[]; terminalized: number; halted: boolean }> => {
      let outcome: { cursor: number; acknowledged: readonly string[]; terminalized: number; halted: boolean } = { cursor: input.fromCursor, acknowledged: [], terminalized: 0, halted: false };
      await commitProtectedState((current) => {
        if (current === null) invalid();
        if (current.sync.halt !== null) throw new PregnancyProtectedRepositoryError('backend-halted', 'Pregnancy sync is halted.');
        if (current.sync.nextChangeSeq !== input.fromCursor) throw new PregnancyProtectedRepositoryError('cursor-mismatch', 'Pregnancy cursor is no longer the one this page was read for.');
        let result: ReturnType<typeof reconcilePregnancyState>;
        try { result = reconcilePregnancyState(current, input); }
        catch (error) { if (error instanceof PregnancyReconciliationInputError) invalid(); throw error; }
        if (result.kind === 'halt') {
          // An unexplainable page persists the halt and nothing else: no partial effects, no cursor move.
          const halted = clone(current);
          halted.sync.halt = { kind: 'conflict', cause: result.cause, recordedAt: new Date().toISOString() };
          outcome = { cursor: current.sync.nextChangeSeq, acknowledged: [], terminalized: 0, halted: true };
          return halted;
        }
        outcome = { cursor: result.state.sync.nextChangeSeq, acknowledged: result.acknowledged, terminalized: result.terminalized, halted: false };
        return result.state;
      });
      return outcome;
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
