import { getDataDomain, persistenceSurfaceContainsProfileB } from '@/core/storage/dataProfileRegistry';
import type { OutboxMutation } from './outbox';

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

export function validateInput(value: Record<string, unknown>): void {
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

export function validateMutation(value: unknown): asserts value is OutboxMutation {
  if (!record(value)) invalid();
  validateInput(value);
  if (typeof value.mutationId !== 'string' || !value.mutationId) invalid();
  if (!timestamp(value.createdAt) || !counter(value.attempts)) invalid();
  if (value.status !== 'pending' && value.status !== 'failed') invalid();
  if (value.nextRetryAt !== undefined && !timestamp(value.nextRetryAt)) invalid();
}

export function validateOutboxEnvelope(stored: unknown): boolean {
  if (!record(stored) || stored.version !== 1 || !record(stored.state)) return false;
  const state = stored.state;
  if (typeof state.accountId !== 'string' || !state.accountId.trim() || !Array.isArray(state.mutations)) return false;
  try { state.mutations.forEach(validateMutation); } catch { return false; }
  return new Set(state.mutations.map((entry) => entry.mutationId)).size === state.mutations.length;
}
