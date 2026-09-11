import fs from 'fs';
import path from 'path';
import {
  CONFLICT_POLICIES, getConflictPolicy, resolveConflict, resolveSavingsHistory,
  type ConfirmedConflictEntity, type ConflictInput, type ConflictVersions,
  type Preferences, type DocumentIdentity,
} from '@/core/sync/conflictPolicies';
import { DATA_DOMAINS, getDataDomain } from '@/core/storage/dataProfileRegistry';
import type { TodoItem } from '@/types/life';
import type { SavingsContribution } from '@/types/savingsGoal';

const time = '2026-09-11T00:00:00.123456Z';
const prefs: Preferences = { language: null, mode: 'system' };
const todo: TodoItem = { id: 'task-1', title: 'Buy milk', completed: false,
  dueDate: '2026-09-11', importance: 'medium', createdAt: time };
const contribution: SavingsContribution = { id: 'log-1', goalId: 'goal-1', amount: 10, date: time };
const document: DocumentIdentity = { id: 'doc-1', name: 'Synthetic receipt', kind: 'document', contentIdentity: 'version-a' };
const confirmed = <T>(value: T, rev = '5', entityId = 'entity-1'): ConfirmedConflictEntity<T> => ({
  value, revision: rev, entityId, updatedAt: time, deletedAt: null,
});
function versions<T>(value: T, entityId: string): ConflictVersions<T> {
  return { entityId, base: confirmed(value, '5', entityId),
    local: { operation: 'upsert', value: { ...value }, baseRevision: 5 },
    remote: confirmed({ ...value }, '6', entityId) };
}
const settings = (local: Partial<Preferences> = {}, remote: Partial<Preferences> = {}) => ({
  ...versions(prefs, 'preferences'), dataDomain: 'core.preferences' as const, entityType: 'preferences' as const,
  local: { operation: 'upsert' as const, value: { ...prefs, ...local }, baseRevision: 5 },
  remote: confirmed({ ...prefs, ...remote }, '6', 'preferences'),
});
const task = (local: Partial<TodoItem> = {}, remote: Partial<TodoItem> = {}) => ({
  ...versions(todo, todo.id), dataDomain: 'tasks.todos' as const, entityType: 'todo' as const,
  local: { operation: 'upsert' as const, value: { ...todo, ...local }, baseRevision: 5 },
  remote: confirmed({ ...todo, ...remote }, '6', todo.id),
});
const doc = (local: Partial<DocumentIdentity> = {}, remote: Partial<DocumentIdentity> = {}) => ({
  ...versions(document, document.id), dataDomain: 'warranties.attachments' as const, entityType: 'attachment' as const,
  local: { operation: 'upsert' as const, value: { ...document, ...local }, baseRevision: 5 },
  remote: confirmed({ ...document, ...remote }, '6', document.id),
});
const log = () => ({ ...versions(contribution, contribution.id),
  dataDomain: 'economy.savings' as const, entityType: 'savings-contribution' as const });
const valueOf = <T>(result: { kind: string; value?: T; remote?: { value: T } }): T | undefined => result.value ?? result.remote?.value;
const unsafe = (input: unknown) => resolveConflict(input as ConflictInput);

describe('APP-035 registry and deterministic boundary', () => {
  it.each([
    ['core.preferences', 'preferences', 'setting-rebase', 'A'],
    ['economy.savings', 'savings-contribution', 'append-only', 'A'],
    ['tasks.todos', 'todo', 'task-fields', 'A'],
    ['warranties.attachments', 'attachment', 'document-manual', 'B'],
  ])('explicitly registers %s / %s', (domain, entity, policy, profile) => {
    expect(getConflictPolicy(domain, entity)).toBe(policy);
    expect(getDataDomain(domain)?.profile).toBe(profile);
  });
  it('reviews exactly four families and never fabricates a default for other domains or kinds', () => {
    expect(CONFLICT_POLICIES.map((p) => p.policy)).toEqual(['setting-rebase', 'append-only', 'task-fields', 'document-manual']);
    expect(Object.isFrozen(CONFLICT_POLICIES)).toBe(true);
    for (const domain of DATA_DOMAINS) {
      expect(getConflictPolicy(domain.id, 'unreviewed')).toBeNull();
      for (const entry of CONFLICT_POLICIES) {
        expect(getConflictPolicy(domain.id, entry.entityType)).toBe(domain.id === entry.dataDomain ? entry.policy : null);
      }
    }
  });
  it.each(['__proto__', 'constructor', 'toString', '', 'unknown'])('runtime lookup rejects %p', (key) => {
    expect(getConflictPolicy(key, 'preferences')).toBeNull();
    expect(getConflictPolicy('core.preferences', key)).toBeNull();
    expect(unsafe({ ...settings(), dataDomain: key })).toEqual({ kind: 'unresolved', reason: 'unclassified' });
  });
  it('does not classify savings goals or mutable habit toggles as append-only', () => {
    expect(getConflictPolicy('economy.savings', 'savings-goal')).toBeNull();
    expect(getConflictPolicy('habits.habits', 'habit-log')).toBeNull();
  });
  it('rejects a known kind routed under the wrong domain', () => {
    expect(unsafe({ ...task(), dataDomain: 'core.preferences' })).toEqual({ kind: 'unresolved', reason: 'unclassified' });
  });
  it('is deterministic without reading the wall clock', () => {
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock read'); });
    try {
      for (const input of [settings({ language: 'en' }), task({ completed: true }), doc(), log()]) {
        expect(resolveConflict(input)).toEqual(resolveConflict(input));
      }
    } finally { clock.mockRestore(); }
  });
  it('keeps the policy module pure and has no timestamp sorting or LWW branch', () => {
    const source = fs.readFileSync(path.join(__dirname, '../core/sync/conflictPolicies.ts'), 'utf8');
    expect(source).not.toMatch(/Date\.now|new Date|Math\.random|last-write-wins|console\.|JSON\.stringify|fetch\(|setTimeout|supabase|zustand/i);
    expect(source).not.toMatch(/updatedAt\s*[<>]|[<>]\s*\w+\.updatedAt/);
  });
});

describe('APP-035 settings', () => {
  it('rebases local preference when remote is exactly the base', () => {
    const input = settings({ language: 'en' });
    expect(resolveConflict({ ...input, remote: input.base })).toMatchObject({ kind: 'rebase-local', baseRevision: '5', value: { language: 'en' } });
  });
  it('preserves independent language and theme changes', () => {
    expect(resolveConflict(settings({ language: 'en' }, { mode: 'dark' }))).toEqual({ kind: 'rebase-local', baseRevision: '6', value: { language: 'en', mode: 'dark' } });
  });
  it('reapplies changed simple reversible preference over a concurrent preference', () => {
    expect(valueOf(resolveConflict(settings({ language: 'en' }, { language: 'da' })))).toEqual({ language: 'en', mode: 'system' });
  });
  it('preserves explicit pending intent that writes the base value', () => {
    const input = settings({}, { mode: 'dark' });
    expect(valueOf(resolveConflict({ ...input, local: { ...input.local, changedFields: ['mode'] } }))).toEqual(prefs);
  });
  it('does not equate unchanged local fields with pending local wins', () => {
    expect(resolveConflict(settings({}, { mode: 'dark' })).kind).toBe('accept-remote');
    expect(resolveConflict(task({ title: 'Mine' }, { title: 'Theirs' })).kind).toBe('unresolved');
  });
  it('ignores timestamp order when choosing the preference', () => {
    const input = settings({ language: 'en' }, { language: 'da' });
    const result = resolveConflict(input);
    expect(resolveConflict({ ...input, remote: { ...input.remote, updatedAt: '1900-01-01T00:00:00Z' } })).toEqual(result);
  });
  it('does not invent a revision for a new local preference', () => {
    const input = settings({ language: 'en' });
    expect(resolveConflict({ ...input, base: null, remote: null, local: { operation: 'upsert', value: input.local.value } })).toMatchObject({ kind: 'rebase-local', baseRevision: null });
  });
});

describe('APP-035 logs/history', () => {
  it('unions independent event IDs without overwriting either record', () => {
    const other = { ...contribution, id: 'log-2', amount: -2 };
    const result = resolveSavingsHistory({ base: [],
      local: [{ entityId: contribution.id, operation: 'upsert', value: contribution }],
      remote: [confirmed(other, '1', other.id)] });
    expect(result.kind).toBe('merged');
    if (result.kind === 'merged') {
      expect(result.entries.map((e) => e.entityId)).toEqual(['log-1', 'log-2']);
      expect(result.entries.map((e) => valueOf(e.resolution))).toEqual([contribution, other]);
    }
  });
  it('deduplicates same ID and identical content across local and remote', () => {
    const result = resolveSavingsHistory({ base: [],
      local: [{ entityId: contribution.id, operation: 'upsert', value: contribution }],
      remote: [confirmed(contribution, '1', contribution.id)] });
    expect(result).toMatchObject({ kind: 'merged', entries: [{ entityId: contribution.id, resolution: { kind: 'accept-remote' } }] });
    if (result.kind === 'merged') expect(result.entries).toHaveLength(1);
  });
  it('fails same-ID divergent content regardless of timestamps', () => {
    const input = log();
    for (const updatedAt of ['1900-01-01T00:00:00Z', '2099-01-01T00:00:00Z']) {
      expect(resolveConflict({ ...input, remote: { ...input.remote!, updatedAt, value: { ...contribution, amount: 20 } } })).toEqual({ kind: 'invariant-error', reason: 'append-content-conflict' });
    }
  });
  it('rejects a confirmed append record edit even without a pending local intent', () => {
    const input = log();
    expect(resolveConflict({ ...input, local: null, remote: { ...input.remote!, value: { ...contribution, date: 'different' } } })).toMatchObject({ kind: 'invariant-error' });
  });
  it('rejects a newer tombstone that changes immutable append content', () => {
    const input = log();
    const remote = { ...input.remote!, deletedAt: time, value: { ...contribution, amount: 99 } };
    expect(resolveConflict({ ...input, remote })).toEqual({ kind: 'invariant-error', reason: 'append-content-conflict' });
  });
  it('accepts a newer tombstone with unchanged append content over stale active intent', () => {
    const input = log();
    const remote = { ...input.remote!, deletedAt: time };
    expect(resolveConflict({ ...input, remote })).toEqual({ kind: 'accept-remote', remote });
  });
  it('history union rejects a newer tombstone that changes immutable append content', () => {
    const input = log();
    const remote = { ...input.remote!, deletedAt: time, value: { ...contribution, amount: 99 } };
    expect(resolveSavingsHistory({ base: [input.base!],
      local: [{ ...input.local!, entityId: input.entityId }], remote: [remote] })).toEqual({
      kind: 'invariant-error', reason: 'append-content-conflict',
    });
  });
  it('history union retains a valid newer tombstone with unchanged append content', () => {
    const input = log();
    const remote = { ...input.remote!, deletedAt: time };
    expect(resolveSavingsHistory({ base: [input.base!],
      local: [{ ...input.local!, entityId: input.entityId }], remote: [remote] })).toEqual({
      kind: 'merged', entries: [{ entityId: input.entityId, resolution: { kind: 'accept-remote', remote } }],
    });
  });
  it('rejects editing an existing local append record', () => {
    const input = log();
    expect(resolveConflict({ ...input, local: { operation: 'upsert', baseRevision: 5, value: { ...contribution, amount: 30 } } })).toMatchObject({ kind: 'invariant-error', reason: 'append-content-conflict' });
  });
  it('never infers a history deletion from an omitted remote row', () => {
    expect(resolveConflict({ ...log(), remote: null })).toEqual({ kind: 'unresolved', reason: 'missing-remote' });
  });
  it('retains tombstones in the union alongside independent new events', () => {
    const input = log();
    const remote = { ...input.remote!, deletedAt: time };
    expect(resolveSavingsHistory({ base: [], local: [{ entityId: 'log-2', operation: 'upsert', value: { ...contribution, id: 'log-2' } }], remote: [remote] })).toMatchObject({ kind: 'merged', entries: [
      { entityId: 'log-1', resolution: { kind: 'accept-remote', remote } },
      { entityId: 'log-2', resolution: { kind: 'rebase-local' } },
    ] });
  });
  it('rejects ambiguous duplicate snapshots rather than selecting by input order', () => {
    expect(resolveSavingsHistory({ base: [], local: [], remote: [confirmed(contribution, '1', contribution.id), confirmed({ ...contribution, amount: 99 }, '1', contribution.id)] })).toEqual({ kind: 'unresolved', reason: 'invalid-input' });
  });
  it('deduplicates repeated identical snapshots and append intents within each input side', () => {
    const remote = confirmed(contribution, '1', contribution.id);
    const pending = { entityId: contribution.id, operation: 'upsert' as const, value: contribution };
    const result = resolveSavingsHistory({ base: [], local: [pending, { ...pending }], remote: [remote, { ...remote }] });
    expect(result.kind).toBe('merged');
    if (result.kind === 'merged') expect(result.entries).toHaveLength(1);
  });
  it('union ordering is deterministic and never changes records', () => {
    const rows = [confirmed(contribution, '1', contribution.id), confirmed({ ...contribution, id: 'log-2' }, '1', 'log-2')];
    expect(resolveSavingsHistory({ base: [], local: [], remote: rows })).toEqual(resolveSavingsHistory({ base: [], local: [], remote: [...rows].reverse() }));
  });
});

describe('APP-035 tasks', () => {
  it('retains a local-only title change', () => {
    expect(valueOf(resolveConflict(task({ title: 'Buy oat milk' })))).toMatchObject({ title: 'Buy oat milk' });
  });
  it('retains a remote-only due date change', () => {
    expect(resolveConflict(task({}, { dueDate: '2026-09-12' })).kind).toBe('accept-remote');
  });
  it('merges completion with unrelated remote due date', () => {
    expect(resolveConflict(task({ completed: true }, { dueDate: '2026-09-12' }))).toEqual({ kind: 'merged', baseRevision: '6', value: { ...todo, completed: true, dueDate: '2026-09-12' } });
  });
  it('accepts identical concurrent field results', () => {
    expect(resolveConflict(task({ title: 'Same' }, { title: 'Same' })).kind).toBe('accept-remote');
  });
  it('fails divergent title edits without including the title in the error', () => {
    expect(resolveConflict(task({ title: 'Mine' }, { title: 'Theirs' }))).toEqual({ kind: 'unresolved', reason: 'field-conflict' });
  });
  it('treats reopening as an ordinary edit, never monotonic true-wins', () => {
    const input = task({ completed: false }, { completed: true });
    expect(valueOf(resolveConflict({ ...input, base: confirmed({ ...todo, completed: true }, '5', todo.id) }))).toMatchObject({ completed: false });
  });
  it('fails completion versus a known intervening remote reopen to the base value', () => {
    expect(resolveConflict({ ...task({ completed: true }), remoteChangedFields: ['completed'] })).toEqual({ kind: 'unresolved', reason: 'field-conflict' });
  });
  it('fails explicit local reopen versus concurrent remote completion', () => {
    const input = task({}, { completed: true });
    expect(resolveConflict({ ...input, local: { ...input.local, changedFields: ['completed'] } })).toEqual({ kind: 'unresolved', reason: 'field-conflict' });
  });
  it('does not infer hidden workflow history from revision advancement alone', () => {
    expect(resolveConflict(task({ completed: true })).kind).toBe('merged');
  });
  it('supports removing optional fields as an explicit edit', () => {
    expect(valueOf(resolveConflict(task({ dueDate: undefined }, { title: 'New title' })))).toMatchObject({ title: 'New title', dueDate: undefined });
  });
  it.each(['recurrence', 'tags'])('fails closed for unreviewed complex field %s', (field) => {
    const input = task();
    expect(unsafe({ ...input, local: { ...input.local, value: { ...todo, [field]: ['local'] } },
      remote: { ...input.remote, value: { ...todo, [field]: ['remote'] } } })).toEqual({ kind: 'unresolved', reason: 'invalid-input' });
  });
  it('rejects creation metadata edits and mismatched entity identity', () => {
    expect(resolveConflict(task({ createdAt: 'other' }))).toEqual({ kind: 'unresolved', reason: 'invalid-input' });
    expect(resolveConflict(task({ id: 'another-task' }))).toEqual({ kind: 'unresolved', reason: 'invalid-input' });
  });
  it('does not mutate base, local or remote, including frozen input objects', () => {
    const input = task({ completed: true }, { dueDate: '2026-09-12' });
    const before = JSON.stringify(input);
    Object.freeze(input.base!.value); Object.freeze(input.local.value); Object.freeze(input.remote.value);
    Object.freeze(input.base); Object.freeze(input.local); Object.freeze(input.remote); Object.freeze(input);
    expect(resolveConflict(input).kind).toBe('merged');
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('APP-035 documents', () => {
  it('requires manual resolution for divergent content identities', () => {
    expect(resolveConflict(doc({ contentIdentity: 'version-b' }, { contentIdentity: 'version-c' }))).toEqual({ kind: 'unresolved', reason: 'document-conflict' });
  });
  it('never selects binary versions by timestamp', () => {
    const input = doc({ contentIdentity: 'version-b' }, { contentIdentity: 'version-c' });
    const expected = resolveConflict(input);
    expect(resolveConflict({ ...input, remote: { ...input.remote, updatedAt: '2099-01-01T00:00:00Z' } })).toEqual(expected);
  });
  it('fails meaningful divergent metadata', () => {
    expect(resolveConflict(doc({ name: 'Local receipt' }, { name: 'Remote receipt' }))).toEqual({ kind: 'unresolved', reason: 'document-conflict' });
  });
  it('also leaves non-overlapping metadata/content edits for explicit reconciliation', () => {
    expect(resolveConflict(doc({ name: 'New name' }, { contentIdentity: 'version-b' })).kind).toBe('unresolved');
  });
  it('accepts identical known versions idempotently', () => {
    const input = doc();
    expect(resolveConflict(input)).toEqual({ kind: 'accept-remote', remote: input.remote });
    expect(resolveConflict(input)).toEqual(resolveConflict(input));
  });
  it('does not treat absent content identity as proof of identical binary bytes', () => {
    expect(resolveConflict(doc({ contentIdentity: null }, { contentIdentity: null }))).toEqual({ kind: 'unresolved', reason: 'unknown-content' });
  });
  it('does not read unexpected raw content or log sensitive input', () => {
    const input = doc();
    const read = jest.fn(() => { throw new Error('raw content read'); });
    const value = Object.defineProperty({ ...document }, 'rawContent', { get: read, enumerable: true });
    const logger = jest.spyOn(console, 'log');
    try {
      expect(unsafe({ ...input, local: { ...input.local, value } })).toEqual({ kind: 'unresolved', reason: 'invalid-input' });
      expect(read).not.toHaveBeenCalled(); expect(logger).not.toHaveBeenCalled();
    } finally { logger.mockRestore(); }
  });
  it('rejects paths and emits no sensitive metadata in conflict errors', () => {
    const input = doc({ name: '/private/synthetic-sensitive-name', contentIdentity: 'private-version' });
    expect(resolveConflict(input)).toEqual({ kind: 'unresolved', reason: 'document-conflict' });
    expect(unsafe({ ...input, local: { ...input.local, value: { ...document, uri: 'file:///private/fixture' } } })).toEqual({ kind: 'unresolved', reason: 'invalid-input' });
  });
});

describe('APP-035 deletion and revision invariants', () => {
  const examples = [settings({ language: 'en' }), log(), task({ completed: true }), doc({ contentIdentity: 'version-b' })];
  it.each(examples)('confirmed newer tombstone overrides $entityType active intent', (input) => {
    const remote = { ...input.remote!, deletedAt: time };
    expect(unsafe({ ...input, remote })).toEqual({ kind: 'accept-remote', remote });
  });
  it.each(examples)('pending delete versus newer active $entityType remains unresolved', (input) => {
    expect(unsafe({ ...input, local: { operation: 'delete', baseRevision: 5 } })).toEqual({ kind: 'unresolved', reason: 'pending-delete' });
  });
  it.each(examples)('contradictory equal $entityType revision fails before policy', (input) => {
    expect(unsafe({ ...input, remote: { ...input.remote!, revision: '5', deletedAt: time } })).toEqual({ kind: 'invariant-error', reason: 'equal-revision-contradiction' });
  });
  it.each(examples)('older $entityType remote cannot regress confirmed state', (input) => {
    expect(unsafe({ ...input, remote: { ...input.remote!, revision: '4', updatedAt: '2099-01-01T00:00:00Z' } })).toEqual({ kind: 'unresolved', reason: 'stale-remote' });
  });
  it('equal revision and identical state is idempotent', () => {
    const input = settings();
    expect(resolveConflict({ ...input, remote: input.base })).toEqual({ kind: 'accept-remote', remote: input.base });
  });
  it('equal revision and contradictory active content is an invariant error', () => {
    const input = settings({}, { mode: 'dark' });
    expect(resolveConflict({ ...input, remote: { ...input.remote, revision: '5' } })).toEqual({ kind: 'invariant-error', reason: 'equal-revision-contradiction' });
  });
  it('equal revision requires identical timestamp metadata without rounding microseconds', () => {
    const input = settings();
    expect(resolveConflict({ ...input, remote: { ...input.remote, revision: '5', updatedAt: '2026-09-11T00:00:00.123457Z' } })).toMatchObject({ kind: 'invariant-error' });
  });
  it('refuses even a newer active version after a confirmed base tombstone', () => {
    const input = settings();
    expect(resolveConflict({ ...input, base: { ...input.base!, deletedAt: time } })).toEqual({ kind: 'invariant-error', reason: 'restore-forbidden' });
  });
  it('retains repeated confirmed tombstones', () => {
    const input = doc();
    const tombstone = { ...input.base!, deletedAt: time };
    expect(resolveConflict({ ...input, base: tombstone, remote: tombstone })).toEqual({ kind: 'accept-remote', remote: tombstone });
  });
  it('refuses a missing remote row without interpreting it as deletion', () => {
    expect(resolveConflict({ ...settings(), remote: null })).toEqual({ kind: 'unresolved', reason: 'missing-remote' });
  });
  it('requires a known pending base and rejects mismatches', () => {
    const input = settings();
    expect(resolveConflict({ ...input, local: { ...input.local, baseRevision: undefined } })).toEqual({ kind: 'unresolved', reason: 'missing-base' });
    expect(resolveConflict({ ...input, local: { ...input.local, baseRevision: 4 } })).toEqual({ kind: 'invariant-error', reason: 'base-revision-mismatch' });
  });
  it('compares full bigint revisions exactly and returns newest rebase target', () => {
    const input = settings({ language: 'en' });
    expect(resolveConflict({ ...input, base: { ...input.base!, revision: '9007199254740992' },
      local: { ...input.local, baseRevision: '9007199254740992' },
      remote: { ...input.remote, revision: '9007199254740993' } })).toMatchObject({ kind: 'rebase-local', baseRevision: '9007199254740993' });
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '05', '9223372036854775808'])('rejects invalid baseRevision %p', (baseRevision) => {
    const input = settings();
    expect(resolveConflict({ ...input, local: { ...input.local, baseRevision } }).kind).toBe('invariant-error');
  });
  it('does not invent a base for concurrent creates', () => {
    const input = settings();
    expect(resolveConflict({ ...input, base: null, local: { operation: 'upsert', value: input.local.value } })).toEqual({ kind: 'unresolved', reason: 'concurrent-create' });
  });
  it('rejects unknown changed fields and malformed version metadata', () => {
    expect(unsafe({ ...task(), remoteChangedFields: ['recurrence'] })).toEqual({ kind: 'unresolved', reason: 'invalid-input' });
    expect(unsafe({ ...task(), remote: { ...task().remote, revision: 6 } })).toEqual({ kind: 'unresolved', reason: 'invalid-input' });
  });
  it('unchanged remote revision cannot claim intervening field changes', () => {
    const input = task({ completed: true });
    expect(resolveConflict({ ...input, remote: input.base, remoteChangedFields: ['completed'] })).toEqual({ kind: 'unresolved', reason: 'invalid-input' });
  });
});
