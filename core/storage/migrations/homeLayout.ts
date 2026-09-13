import type { LocalMigrationDefinition } from './harness';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): boolean => Array.isArray(v) && v.every((item) => typeof item === 'string');
const details = (v: unknown): boolean => record(v) && Object.values(v).every((item) => item === 'full' || item === 'masked');

function knownState(v: unknown, current: boolean): boolean {
  if (!record(v) || !record(v.state)) return false;
  const s = v.state;
  return Object.keys(v).every((key) => key === 'state' || key === 'version') &&
    Object.keys(s).every((key) => ['pinned', 'hidden', 'lastOpenedAt', 'detail'].includes(key)) &&
    strings(s.pinned) && strings(s.hidden) && record(s.lastOpenedAt) &&
    Object.values(s.lastOpenedAt).every((item) => typeof item === 'string' && Number.isFinite(Date.parse(item))) &&
    (current ? details(s.detail) : (s.detail === undefined || details(s.detail)));
}

/** c4715e6 lacked detail; 5898ce5/d417466 added it without changing Zustand v0.
 * Keep both real v0 shapes; v1 makes the existing privacy default explicit.
 */
export const homeLayoutMigration: LocalMigrationDefinition = {
  storeId: 'async-storage:lifesort-home-layout',
  storageKey: 'lifesort-home-layout',
  currentVersion: 1,
  detectVersion: (v) => {
    if (!record(v)) return null;
    if ('version' in v) return typeof v.version === 'number' ? v.version : NaN;
    return knownState(v, false) ? 0 : null;
  },
  steps: {
    0: (v) => {
      if (!knownState(v, false)) throw new Error('unknown-legacy-shape');
      const envelope = v as { state: Record<string, unknown> };
      return { ...envelope, state: { ...envelope.state, detail: envelope.state.detail ?? {} }, version: 1 };
    },
  },
  validateCurrent: (v) => record(v) && v.version === 1 && knownState(v, true),
};
