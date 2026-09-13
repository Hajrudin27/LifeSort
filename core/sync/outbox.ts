import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

import { newEntityId } from '@/core/ids';
import {
  type DataDomainId,
} from '@/core/storage/dataProfileRegistry';

import { validateInput, validateMutation } from './outboxValidation';
import { migrateLocalStore } from '@/core/storage/migrations/harness';
import { ensureLocalMigrations } from '@/core/storage/migrations/runtime';
import { outboxMigration } from '@/core/storage/migrations/outbox';

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

async function read(): Promise<OutboxState | null> {
  // Every read remains inside the outbox serialization lane. Validation uses
  // the same schema as enqueue/update; current v1 bytes are never rewritten.
  const { raw } = await migrateLocalStore(outboxMigration, AsyncStorage);
  return raw === null ? null : JSON.parse(raw).state as OutboxState;
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
      await ensureLocalMigrations();
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
        if (state.mutations.some((entry) => entry.mutationId === mutation.mutationId)) throw new Error('Invalid or unsupported outbox data.');
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
