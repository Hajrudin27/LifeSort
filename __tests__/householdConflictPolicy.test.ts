import { getConflictPolicy, resolveConflict, type ConfirmedConflictEntity } from '@/core/sync/conflictPolicies';
import type { HouseholdTask } from '@/types/household';

const value: HouseholdTask = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'cleaning',
  title: 'Kitchen',
  frequency: 'weekly',
  assignedTo: 'me',
  rotates: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  timeZone: 'Europe/Copenhagen',
};
const confirmed = (
  task: HouseholdTask,
  revision: string,
  deletedAt: string | null = null,
): ConfirmedConflictEntity<Readonly<HouseholdTask>> => ({
  entityId: task.id,
  revision,
  updatedAt: `2026-01-0${Math.min(Number(revision), 9)}T00:00:00Z`,
  deletedAt,
  value: task,
});
const input = (local: HouseholdTask, remote: HouseholdTask, deletedAt: string | null = null) => ({
  dataDomain: 'home.household' as const,
  entityType: 'home-task' as const,
  entityId: value.id,
  base: confirmed(value, '5'),
  local: { operation: 'upsert' as const, baseRevision: 5, value: local },
  remote: confirmed(remote, '6', deletedAt),
});

describe('APP-061 coupled Home task conflict policy', () => {
  it('is explicitly registered and does not borrow Todo field merging', () => {
    expect(getConflictPolicy('home.household', 'home-task')).toBe('home-task-coupled');
  });
  it('fails closed for edit versus edit', () => {
    expect(resolveConflict(input({ ...value, title: 'Mine' }, { ...value, title: 'Theirs' })))
      .toEqual({ kind: 'unresolved', reason: 'home-task-conflict' });
  });
  it('accepts identical complete versus complete', () => {
    const complete = { ...value, lastDone: '2026-01-07', assignedTo: 'partner' as const };
    expect(resolveConflict(input(complete, complete))).toMatchObject({ kind: 'accept-remote' });
  });
  it('merges a title edit with a remote completion without re-rotating', () => {
    expect(resolveConflict(input(
      { ...value, title: 'Edited' },
      { ...value, lastDone: '2026-01-07', assignedTo: 'partner' },
    ))).toEqual({ kind: 'merged', baseRevision: '6',
      value: { ...value, title: 'Edited', lastDone: '2026-01-07', assignedTo: 'partner' } });
  });
  it('merges a local completion with a remote title edit', () => {
    expect(resolveConflict(input(
      { ...value, lastDone: '2026-01-07', assignedTo: 'partner' },
      { ...value, title: 'Theirs' },
    ))).toMatchObject({ kind: 'merged', value: { title: 'Theirs', lastDone: '2026-01-07', assignedTo: 'partner' } });
  });
  it.each([
    ['assignee edit vs completion', { assignedTo: 'partner' as const }, { lastDone: '2026-01-07', assignedTo: 'partner' as const }],
    ['rotation toggle vs completion', { rotates: false }, { lastDone: '2026-01-07', assignedTo: 'partner' as const }],
    ['completions on different dates', { lastDone: '2026-01-08', assignedTo: 'partner' as const },
      { lastDone: '2026-01-07', assignedTo: 'partner' as const }],
  ])('fails closed when both sides touch the coupled schedule: %s', (_label, mine, theirs) => {
    expect(resolveConflict(input({ ...value, ...mine }, { ...value, ...theirs })))
      .toEqual({ kind: 'unresolved', reason: 'home-task-conflict' });
  });
  it('accepts the confirmed tombstone over a stale active update', () => {
    expect(resolveConflict(input(
      { ...value, title: 'Stale' },
      value,
      '2026-01-07T00:00:00Z',
    ))).toMatchObject({ kind: 'accept-remote', remote: { deletedAt: '2026-01-07T00:00:00Z' } });
  });
});
