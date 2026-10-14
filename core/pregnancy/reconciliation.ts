import type { RemoteEntitySnapshot } from '@/core/pregnancy/canonicalMappers';
import type {
  PregnancyBackendHaltCause, PregnancyProtectedState, PregnancyQueuedMutation, PregnancyTerminalReason,
} from '@/core/pregnancy/protectedRepository';
import type { PregnancyAppointment, PregnancyEntry, PregnancySymptomLog } from '@/types/pregnancy';

/**
 * What the server told the client about one of its own mutations. It is evidence to
 * be checked against protected state, never an instruction: the repository removes
 * the mutation only if the resulting state proves the server's result is represented.
 */
export type PregnancySuccessProof = {
  readonly mutationId: string;
  readonly entityType: PregnancyQueuedMutation['entityType'];
  readonly entityId: string;
  readonly serverRevision: number;
  readonly deleted: boolean;
};

export type PregnancyReconciliationInput = {
  /** Must equal the stored cursor; a concurrent change makes the page stale. */
  readonly fromCursor: number;
  /** Where the validated page ends. Never below `fromCursor`. */
  readonly toCursor: number;
  /** The page was short: the ledger is exhausted as of this read. */
  readonly caughtUp: boolean;
  readonly snapshots: readonly RemoteEntitySnapshot[];
  readonly proofs: readonly PregnancySuccessProof[];
};

export type PregnancyReconciliationResult =
  | { readonly kind: 'applied'; readonly state: PregnancyProtectedState; readonly acknowledged: readonly string[]; readonly terminalized: number }
  | { readonly kind: 'halt'; readonly cause: PregnancyBackendHaltCause };

export class PregnancyReconciliationInputError extends Error {
  constructor() { super('Pregnancy reconciliation input is invalid.'); this.name = 'PregnancyReconciliationInputError'; }
}

type Draft = PregnancyProtectedState;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const keyOf = (entityType: string, entityId: string) => `${entityType}:${entityId}`;
const isSettings = (entityType: string) => entityType === 'settings';

/**
 * Envelope timestamps are server/client bookkeeping, not clinical content: a locally minted `createdAt`
 * or `updatedAt` legitimately differs from the server's row at the same revision, and must not halt sync.
 */
const withoutEnvelopeTimestamps = (value: object): object =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'updatedAt' && key !== 'createdAt'));

/** Order-insensitive structural equality for protected JSON-only values. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

type Located = PregnancyEntry | PregnancySymptomLog | PregnancyAppointment;
function localEntity(draft: Draft, entityType: string, entityId: string): Located | { revision: number } | undefined {
  if (entityType === 'pregnancy') return draft.domain.pregnancies[entityId];
  if (entityType === 'log') return draft.domain.symptomLogs[entityId];
  if (entityType === 'appointment') return draft.domain.appointments[entityId];
  return draft.domain.settings ?? undefined;
}
function removeEntity(draft: Draft, entityType: string, entityId: string): void {
  if (entityType === 'pregnancy') delete draft.domain.pregnancies[entityId];
  else if (entityType === 'log') delete draft.domain.symptomLogs[entityId];
  else if (entityType === 'appointment') delete draft.domain.appointments[entityId];
}
function scrubChildren(draft: Draft, pregnancyId: string): void {
  for (const [id, log] of Object.entries(draft.domain.symptomLogs)) if (log.pregnancyId === pregnancyId) delete draft.domain.symptomLogs[id];
  for (const [id, appointment] of Object.entries(draft.domain.appointments)) if (appointment.pregnancyId === pregnancyId) delete draft.domain.appointments[id];
}
function parentOf(mutation: PregnancyQueuedMutation): string | undefined {
  const parent = mutation.payload?.pregnancyId;
  return typeof parent === 'string' ? parent : undefined;
}
function terminalize(mutation: PregnancyQueuedMutation, reason: PregnancyTerminalReason): void {
  mutation.status = 'failed';
  mutation.terminalReason = reason;
  delete mutation.nextRetryAt;
  delete mutation.awaiting;
  // A mutation for data the server has deleted must not keep a copy of that data.
  if (reason === 'remote-deleted' || reason === 'remote-parent-deleted') delete mutation.payload;
}

function omitUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

/**
 * A crash can lose the process-local applied-success proof after the server has
 * committed a simple edit. We may retire that intent from a later pull only
 * when the remote row itself proves that the requested state is already met:
 * exactly the next revision, the exact wire payload, and no Pregnancy
 * lifecycle transition. This deliberately does not claim authorship (another
 * device may have made the same simple edit); it only recognizes a satisfied
 * non-destructive desired state. Every other case is left for receipt replay
 * or the normal explicit conflict path.
 */
function simplePayloadMatchesRemote(mutation: PregnancyQueuedMutation, snapshot: RemoteEntitySnapshot): boolean {
  if (mutation.operation !== 'upsert' || mutation.baseRevision === undefined ||
      snapshot.state.kind !== 'live' || snapshot.state.revision !== mutation.baseRevision + 1 ||
      !mutation.payload) return false;
  const live = snapshot.state.live;
  let projection: Record<string, unknown>;
  if (mutation.entityType === 'pregnancy' && live.entityType === 'pregnancy') {
    // Outcome/end/recovery transitions carry destructive lifecycle meaning and
    // therefore never use the indistinguishable-same-state shortcut.
    if (mutation.payload.endedAt !== undefined || mutation.payload.outcome !== undefined || mutation.payload.recoveryEndedAt !== undefined) return false;
    const entity = live.entity;
    projection = omitUndefined({
      method: entity.method, lmpDate: entity.lmpDate, conceptionDate: entity.conceptionDate,
      dueDateOverride: entity.dueDateOverride, dueDateSource: entity.dueDateSource,
      endedAt: entity.endedAt, outcome: entity.outcome, outcomeNotes: entity.outcomeNotes,
      recoveryEndedAt: entity.recoveryEndedAt,
    });
  } else if (mutation.entityType === 'log' && live.entityType === 'log') {
    const entity = live.entity;
    projection = omitUndefined({
      pregnancyId: entity.pregnancyId, date: entity.date, symptoms: entity.symptoms,
      weightKg: entity.weightKg, bellyMeasurementCm: entity.bellyMeasurementCm, notes: entity.notes,
    });
  } else if (mutation.entityType === 'appointment' && live.entityType === 'appointment') {
    const entity = live.entity;
    projection = omitUndefined({
      pregnancyId: entity.pregnancyId, startsAt: entity.startsAt, timeZone: entity.timeZone,
      title: entity.title, notes: entity.notes, completed: entity.completed, reminderEnabled: entity.reminderEnabled,
    });
  } else if (mutation.entityType === 'settings' && live.entityType === 'settings') {
    const entity = live.entity;
    projection = { recoveryDisplayDays: entity.recoveryDisplayDays, privacyMode: entity.privacyMode };
  } else return false;
  return stable(mutation.payload) === stable(projection);
}

/**
 * Pure revision-ordered reconciliation of one validated ledger page. It receives the
 * whole decision surface as typed values; the repository alone decides whether to
 * persist the result, in the same encrypted commit as the cursor.
 *
 * It never acknowledges anything it was merely told about: a mutation is removed only
 * when the resulting canonical state or tombstone proves the server's result.
 */
export function reconcilePregnancyState(current: Readonly<PregnancyProtectedState>, input: PregnancyReconciliationInput): PregnancyReconciliationResult {
  if (input.fromCursor !== current.sync.nextChangeSeq || !Number.isSafeInteger(input.toCursor) || input.toCursor < input.fromCursor) {
    throw new PregnancyReconciliationInputError();
  }
  const draft = clone(current) as Draft;
  const accountId = draft.accountId;
  const snapshotByKey = new Map<string, RemoteEntitySnapshot>();
  for (const snapshot of input.snapshots) {
    const key = keyOf(snapshot.entityType, snapshot.entityId);
    if (snapshotByKey.has(key) || !snapshot.entityId || !Number.isSafeInteger(snapshot.metadataRevision) || !Number.isSafeInteger(snapshot.changeSeq)) throw new PregnancyReconciliationInputError();
    if (isSettings(snapshot.entityType) && (snapshot.entityId !== accountId || snapshot.state.kind !== 'live')) throw new PregnancyReconciliationInputError();
    if (snapshot.state.kind === 'live') {
      const { live } = snapshot.state;
      const id = live.entityType === 'settings' ? accountId : live.entity.id;
      if (live.entityType !== snapshot.entityType || id !== snapshot.entityId || live.entity.revision !== snapshot.state.revision) throw new PregnancyReconciliationInputError();
    }
    snapshotByKey.set(key, snapshot);
  }

  // A proof counts only for the exact queued, non-terminal mutation it names.
  const proofs = new Map<string, PregnancySuccessProof>();
  for (const proof of input.proofs) {
    const queued = draft.sync.mutations.find((item) => item.mutationId === proof.mutationId);
    if (!queued || queued.terminalReason !== undefined) continue;
    if (queued.entityType !== proof.entityType || queued.entityId !== proof.entityId) continue;
    if (proof.deleted !== (queued.operation === 'delete') || !Number.isSafeInteger(proof.serverRevision) || proof.serverRevision < 1) continue;
    proofs.set(proof.mutationId, proof);
  }

  let terminalized = 0;
  const nonTerminalFor = (entityType: string, entityId: string) =>
    draft.sync.mutations.filter((item) => item.entityType === entityType && item.entityId === entityId && item.terminalReason === undefined);
  const anyQueuedFor = (entityType: string, entityId: string) =>
    draft.sync.mutations.some((item) => item.entityType === entityType && item.entityId === entityId);

  // A stale mutation is judged against the revision the server now holds.
  function staleAgainstLive(mutation: PregnancyQueuedMutation, remoteRevision: number): boolean {
    if (mutation.operation === 'upsert') return remoteRevision > (mutation.baseRevision ?? 0);
    return mutation.baseRevision === undefined || remoteRevision > mutation.baseRevision;
  }
  function settleAgainstTombstone(mutation: PregnancyQueuedMutation, tombstoneRevision: number): void {
    if (mutation.operation === 'upsert') { terminalize(mutation, 'remote-deleted'); terminalized += 1; return; }
    // A delete is satisfied only by a tombstone at the revision its own deletion would produce.
    if (mutation.baseRevision !== undefined && tombstoneRevision >= mutation.baseRevision + 1) {
      draft.sync.mutations = draft.sync.mutations.filter((item) => item.mutationId !== mutation.mutationId);
    } else { terminalize(mutation, 'revision-conflict'); terminalized += 1; }
  }

  // Roots first, so a root tombstone has scrubbed its children before any child row is judged.
  const rank: Record<string, number> = { pregnancy: 0, log: 1, appointment: 1, settings: 2 };
  const ordered = [...snapshotByKey.values()].sort((a, b) => rank[a.entityType] - rank[b.entityType]);
  const acknowledged: string[] = [];

  for (const snapshot of ordered) {
    const { entityType, entityId, state } = snapshot;
    const key = keyOf(entityType, entityId);
    const pending = nonTerminalFor(entityType, entityId);
    const exempt = pending.filter((item) => proofs.has(item.mutationId));
    const judged = pending.filter((item) => !proofs.has(item.mutationId));
    const known = draft.tombstones[key];

    if (state.kind === 'tombstone') {
      removeEntity(draft, entityType, entityId);
      if (entityType === 'pregnancy') {
        scrubChildren(draft, entityId);
        // A queued child upsert beneath a deleted root must never resurrect it.
        for (const child of draft.sync.mutations) {
          if (child.terminalReason === undefined && child.operation === 'upsert' && (child.entityType === 'log' || child.entityType === 'appointment') && parentOf(child) === entityId && !proofs.has(child.mutationId)) {
            terminalize(child, 'remote-parent-deleted'); terminalized += 1;
          }
        }
      }
      draft.tombstones[key] = {
        entityType: entityType as 'pregnancy' | 'log' | 'appointment', entityId, revision: Math.max(known?.revision ?? 0, state.revision),
        changeSeq: Math.max(known?.changeSeq ?? 0, snapshot.changeSeq),
      };
      for (const mutation of judged) settleAgainstTombstone(mutation, state.revision);
      continue;
    }

    // A live row for something the client already knows to be deleted is stale: deleted data never returns.
    if (known) continue;
    const { live } = state;
    if (live.entityType === 'log' || live.entityType === 'appointment') {
      if (draft.tombstones[keyOf('pregnancy', live.entity.pregnancyId)]) continue;
    }
    const local = localEntity(draft, entityType, entityId);
    const install = () => {
      const entity = clone(live.entity);
      if (live.entityType === 'pregnancy') draft.domain.pregnancies[entityId] = entity as PregnancyEntry;
      else if (live.entityType === 'log') draft.domain.symptomLogs[entityId] = entity as PregnancySymptomLog;
      else if (live.entityType === 'appointment') draft.domain.appointments[entityId] = entity as PregnancyAppointment;
      else draft.domain.settings = entity as Draft['domain']['settings'];
    };
    // A lost applied ACK is indistinguishable from another device making the
    // identical simple edit. In either case the requested state is already
    // safely true, so retire only that exact one-revision intent. This happens
    // before stale-conflict terminalization, while all broader cases still use
    // replay or explicit conflict handling.
    const satisfiedWithoutReceipt = judged.filter((item) => simplePayloadMatchesRemote(item, snapshot));
    if (satisfiedWithoutReceipt.length > 0) {
      install();
      const satisfiedIds = new Set(satisfiedWithoutReceipt.map((item) => item.mutationId));
      draft.sync.mutations = draft.sync.mutations.filter((item) => !satisfiedIds.has(item.mutationId));
      for (const item of satisfiedWithoutReceipt) acknowledged.push(item.mutationId);
    }
    const stale = judged.filter((item) => !satisfiedWithoutReceipt.includes(item) && staleAgainstLive(item, state.revision));
    for (const mutation of stale) { terminalize(mutation, 'revision-conflict'); terminalized += 1; }
    const valid = judged.filter((item) => !satisfiedWithoutReceipt.includes(item) && !stale.includes(item));
    // A proof is about server state, so the server's own row (its timestamps included) is installed
    // before the proof is checked, even when an optimistic local revision happens to equal it.
    if (exempt.length > 0 && (!local || state.revision >= local.revision)) { install(); continue; }
    if (valid.length > 0) continue;
    // A rejected local edit never outranks the server's row, even where an optimistic local revision equals it.
    if (stale.length > 0 || !local || state.revision > local.revision) { install(); continue; }
    if (state.revision === local.revision) {
      // Only a never-queued entity can be compared: a queued edit legitimately differs from the server at its base revision.
      if (!anyQueuedFor(entityType, entityId) && stable(withoutEnvelopeTimestamps(local)) !== stable(withoutEnvelopeTimestamps(live.entity))) return { kind: 'halt', cause: 'same-revision-divergence' };
    }
  }

  // The unsatisfied proof of a mutation the server did apply may still be stale (for instance, deleted afterwards).
  for (const proof of proofs.values()) {
    const mutation = draft.sync.mutations.find((item) => item.mutationId === proof.mutationId);
    if (!mutation) continue;
    const key = keyOf(proof.entityType, proof.entityId);
    let satisfied = false;
    if (!proof.deleted) {
      const entity = localEntity(draft, proof.entityType, proof.entityId);
      satisfied = !!entity && entity.revision >= proof.serverRevision && !draft.tombstones[key];
    } else if (!isSettings(proof.entityType)) {
      const tombstone = draft.tombstones[key];
      satisfied = !localEntity(draft, proof.entityType, proof.entityId) && !!tombstone && tombstone.revision >= proof.serverRevision;
    }
    if (satisfied) {
      draft.sync.mutations = draft.sync.mutations.filter((item) => item.mutationId !== proof.mutationId);
      acknowledged.push(proof.mutationId);
      continue;
    }
    const snapshot = snapshotByKey.get(key);
    if (!snapshot || mutation.terminalReason !== undefined) continue;
    if (snapshot.state.kind === 'tombstone') settleAgainstTombstone(mutation, snapshot.state.revision);
    else if (staleAgainstLive(mutation, snapshot.state.revision)) { terminalize(mutation, 'revision-conflict'); terminalized += 1; }
  }

  if (input.caughtUp) {
    // The ledger is exhausted. A refusal that remote state still cannot explain, or a server
    // success that no canonical state proves, is an invariant failure: stop rather than guess.
    for (const mutation of draft.sync.mutations) {
      if (mutation.terminalReason !== undefined) continue;
      if (mutation.awaiting === 'revision-conflict') return { kind: 'halt', cause: 'revision-conflict-unexplained' };
      if (mutation.awaiting === 'parent-unavailable') return { kind: 'halt', cause: 'parent-unavailable-unexplained' };
    }
    for (const proof of proofs.values()) {
      if (draft.sync.mutations.some((item) => item.mutationId === proof.mutationId && item.terminalReason === undefined)) return { kind: 'halt', cause: 'success-unproven' };
    }
  }

  draft.sync.nextChangeSeq = input.toCursor;
  return { kind: 'applied', state: draft, acknowledged, terminalized };
}
