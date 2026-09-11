import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

import { newEntityId } from '@/core/ids';
import {
  getDataDomain,
  persistenceSurfaceContainsProfileB,
  type DataDomainId,
} from '@/core/storage/dataProfileRegistry';

export const OUTBOX_STORAGE_KEY = 'lifesort-outbox';

export type OutboxStatus = 'pending' | 'failed';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface OutboxMutation<T extends JsonValue = JsonValue> {
  mutationId: string;
  /** Registered logical domain used only for storage/sensitivity classification. */
  dataDomain: DataDomainId;
  /** Stable LifeSort entity-kind identifier; not authorization or a provider table. */
  entityType: string;
  entityId: string;
  operation: 'upsert' | 'delete';
  payload?: T;
  baseRevision?: number;
  createdAt: string;
  status: OutboxStatus;
  attempts: number;
  nextRetryAt?: string;
}

export type NewOutboxMutation<T extends JsonValue = JsonValue> = Pick<
  OutboxMutation<T>, 'dataDomain' | 'entityType' | 'entityId' | 'operation' | 'payload' | 'baseRevision'
>;

export type OutboxMetadataUpdate = {
  status?: OutboxStatus;
  attempts?: number;
  /** null clears an existing retry timestamp. No retry policy runs here. */
  nextRetryAt?: string | null;
};

type OutboxState = { accountId: string; mutations: OutboxMutation[] };
const storage = createJSONStorage<OutboxState>(() => AsyncStorage)!;

// One serialization lane across every handle in this JS runtime. No cached
// domain data: every operation rehydrates before reading or changing the queue.
let tail: Promise<unknown> = Promise.resolve();
let accountEpoch = 0;
let cleanupDepth = 0;

type OutboxEvent = { kind: 'changed'; accountId: string } | { kind: 'cleanup' };
const listeners = new Set<(event: OutboxEvent) => void>();
/** Metadata-only invalidation; subscribers may reread locally, never send work. */
export function subscribeOutbox(listener: (event: OutboxEvent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function notify(event: OutboxEvent) {
  for (const listener of listeners) {
    try { listener(event); } catch { /* Presentation cannot fail a durable write. */ }
  }
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = tail.then(operation);
  tail = result.catch(() => undefined);
  return result;
}

function invalid(): never {
  // Do not attach payloads or raw storage/JSON errors to diagnostics.
  throw new Error('Invalid or unsupported outbox data.');
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function counter(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function jsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
  ancestors.add(value);
  const values = Array.isArray(value) ? Array.from(value) : Object.values(value);
  const valid = values.every((item) => jsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}

function validateInput(value: Record<string, unknown>): void {
  const domain = typeof value.dataDomain === 'string' ? getDataDomain(value.dataDomain) : null;
  // Conservative first integration boundary: even a Profile A logical domain
  // sharing a sensitive surface is blocked until a reviewed encrypted path exists.
  if (!domain || domain.profile !== 'A' || !domain.expectsServerSync ||
      domain.storageSurfaces.some(persistenceSurfaceContainsProfileB)) invalid();
  if (typeof value.entityType !== 'string' || !value.entityType.trim()) invalid();
  if (typeof value.entityId !== 'string' || !value.entityId.trim()) invalid();
  if (value.operation !== 'upsert' && value.operation !== 'delete') invalid();
  if (value.operation === 'upsert' && value.payload === undefined) invalid();
  if (value.payload !== undefined && !jsonValue(value.payload)) invalid();
  if (value.baseRevision !== undefined && !counter(value.baseRevision)) invalid();
}

function validateMutation(value: unknown): asserts value is OutboxMutation {
  if (!record(value)) invalid();
  validateInput(value);
  if (typeof value.mutationId !== 'string' || !value.mutationId) invalid();
  if (!timestamp(value.createdAt) || !counter(value.attempts)) invalid();
  if (value.status !== 'pending' && value.status !== 'failed') invalid();
  if (value.nextRetryAt !== undefined && !timestamp(value.nextRetryAt)) invalid();
}

async function read(): Promise<OutboxState | null> {
  let stored;
  try {
    stored = await storage.getItem(OUTBOX_STORAGE_KEY);
  } catch {
    // JSON parse errors can include fragments of the stored payload.
    throw new Error('Outbox storage could not be read.');
  }
  if (stored === null) return null;
  if (!record(stored) || stored.version !== 1 || !record(stored.state)) invalid();
  const state = stored.state;
  if (typeof state.accountId !== 'string' || !state.accountId.trim() || !Array.isArray(state.mutations)) invalid();
  state.mutations.forEach(validateMutation);
  if (new Set(state.mutations.map((entry) => entry.mutationId)).size !== state.mutations.length) invalid();
  return state as OutboxState;
}

/**
 * Bind a handle to the authenticated account ID. Await every write before
 * treating it as durable. Handles are revoked by local account cleanup.
 * No production domain is wired to this primitive in APP-031.
 */
export function createOutbox(accountId: string) {
  if (!accountId.trim() || cleanupDepth) throw new Error('Outbox account is unavailable.');
  const epoch = accountEpoch;
  function assertActive() {
    if (cleanupDepth || epoch !== accountEpoch) throw new Error('Outbox account is unavailable.');
  }

  function run<T>(operation: (state: OutboxState) => T, write: boolean): Promise<T> {
    return serialize(async () => {
      assertActive();
      const stored = await read();
      assertActive();
      if (stored && stored.accountId !== accountId && write) {
        throw new Error('Outbox requires account cleanup before writing.');
      }
      const state = stored?.accountId === accountId ? stored : { accountId, mutations: [] };
      const result = operation(state);
      if (write) {
        await storage.setItem(OUTBOX_STORAGE_KEY, { state, version: 1 });
        assertActive();
        notify({ kind: 'changed', accountId });
      }
      return result;
    });
  }

  return {
    async enqueue<T extends JsonValue>(input: NewOutboxMutation<T>): Promise<OutboxMutation<T>> {
      assertActive();
      validateInput(input);
      // Snapshot before awaiting storage; caller edits cannot alter queued data.
      const mutation: OutboxMutation<T> = {
        dataDomain: input.dataDomain,
        entityType: input.entityType,
        entityId: input.entityId,
        operation: input.operation,
        ...(input.payload === undefined ? {} : { payload: JSON.parse(JSON.stringify(input.payload)) as T }),
        ...(input.baseRevision === undefined ? {} : { baseRevision: input.baseRevision }),
        mutationId: newEntityId(),
        createdAt: new Date().toISOString(),
        status: 'pending',
        attempts: 0,
      };
      return run((state) => {
        if (state.mutations.some((entry) => entry.mutationId === mutation.mutationId)) invalid();
        state.mutations.push(mutation);
        return mutation;
      }, true);
    },

    /** All unacknowledged work, including failed entries, in enqueue order. */
    list(): Promise<OutboxMutation[]> {
      return run((state) => state.mutations, false);
    },

    /** Set attempts explicitly; later processors own retry policy. */
    updateMetadata(mutationId: string, update: OutboxMetadataUpdate): Promise<boolean> {
      const patch = { ...update };
      return run((state) => {
        const entry = state.mutations.find((item) => item.mutationId === mutationId);
        if (!entry) return false;
        if (patch.status !== undefined) entry.status = patch.status;
        if (patch.attempts !== undefined) entry.attempts = patch.attempts;
        if (patch.nextRetryAt === null) delete entry.nextRetryAt;
        else if (patch.nextRetryAt !== undefined) entry.nextRetryAt = patch.nextRetryAt;
        validateMutation(entry);
        return true;
      }, true);
    },

    acknowledge(mutationId: string): Promise<boolean> {
      return run((state) => {
        const before = state.mutations.length;
        state.mutations = state.mutations.filter((entry) => entry.mutationId !== mutationId);
        return state.mutations.length !== before;
      }, true);
    },
  };
}

/** APP-021: revoke handles synchronously, drain I/O, then clear before the sweep. */
export async function withOutboxCleanup<T>(cleanup: () => Promise<T>): Promise<T> {
  accountEpoch += 1;
  cleanupDepth += 1;
  notify({ kind: 'cleanup' });
  try {
    let removalFailed = false;
    try {
      await serialize(async () => { await storage.removeItem(OUTBOX_STORAGE_KEY); });
    } catch {
      removalFailed = true;
    }
    // Other local data must still be cleared if the outbox disk removal fails.
    const result = await cleanup();
    if (removalFailed) throw new Error('Outbox storage could not be cleared.');
    return result;
  } finally {
    cleanupDepth -= 1;
  }
}
