/// <reference types="node" />

import fs from 'fs';
import path from 'path';

import type { OutboxMutation } from '@/core/sync/outbox';
import { entityChainKey, getEntityChainHeads, planSyncWork } from '@/core/sync/syncEligibility';

/**
 * APP-037 — what may be sent, and in which order.
 *
 * The rule that matters is per-entity: "off, on" must never arrive as "on, off",
 * and a stuck module must not take every other module down with it.
 */

const NOW = Date.parse('2026-09-11T10:00:00.000Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

let sequence = 0;
function mutation(overrides: Partial<OutboxMutation> = {}): OutboxMutation {
  sequence += 1;
  return {
    mutationId: `0000000${sequence}-0000-4000-8000-000000000000`.slice(-36),
    dataDomain: 'core.module-choice',
    entityType: 'module-choice',
    entityId: 'habits',
    operation: 'upsert',
    payload: { enabled: true },
    createdAt: iso(-60_000),
    status: 'pending',
    attempts: 0,
    ...overrides,
  };
}

beforeEach(() => { sequence = 0; });

it('shares a pure first-outstanding definition using all three identity parts', () => {
  const first = mutation({ mutationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', status: 'failed' });
  const follower = mutation({ mutationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  const domain = mutation({ dataDomain: 'tasks.todos' });
  const type = mutation({ entityType: 'other' });
  const entity = mutation({ entityId: 'food' });
  const snapshot = Object.freeze([first, follower, domain, type, entity]);
  expect(getEntityChainHeads(snapshot)).toEqual([first, domain, type, entity]);
  expect(getEntityChainHeads(snapshot.slice(1))).toEqual([follower, domain, type, entity]);
  expect(snapshot).toEqual([first, follower, domain, type, entity]);
});

it('sends pending work immediately and honours a future retry timestamp', () => {
  const ready = mutation({ entityId: 'habits' });
  const overdue = mutation({ entityId: 'food', status: 'failed', attempts: 2, nextRetryAt: iso(-1) });
  const waiting = mutation({ entityId: 'travel', status: 'failed', attempts: 1, nextRetryAt: iso(30_000) });

  const plan = planSyncWork([ready, overdue, waiting], NOW, 10);
  expect(plan.due).toEqual([ready, overdue]);
  expect(plan.nextRetryAtMs).toBe(NOW + 30_000);
});

it('never automatically retries a failure with no scheduled retry', () => {
  const permanent = mutation({ entityId: 'habits', status: 'failed', attempts: 1 });
  const plan = planSyncWork([permanent], NOW, 10);
  expect(plan).toEqual({ due: [], nextRetryAtMs: null });
});

it('refuses an unsupported envelope before it can reach the transport', () => {
  const unsupported = [
    mutation({ entityId: 'habits', entityType: 'not-a-module-choice' }),
    mutation({ entityId: 'habits', payload: { enabled: true, extra: 1 } }),
    mutation({ entityId: 'habits', baseRevision: 3 }),
    mutation({ entityId: 'unknown-module' }),
    mutation({ entityId: 'habits', mutationId: 'not-a-uuid' }),
  ];
  expect(planSyncWork(unsupported, NOW, 10).due).toEqual([]);
});

it('lets only the oldest mutation of an entity move, in persisted order', () => {
  const first = mutation({ entityId: 'habits', payload: { enabled: false } });
  const second = mutation({ entityId: 'habits', payload: { enabled: true } });
  const third = mutation({ entityId: 'habits', operation: 'delete', payload: undefined });

  const plan = planSyncWork([first, second, third], NOW, 10);
  expect(plan.due).toEqual([first]);
  // Acknowledging the head is what releases the next one — never a reordering.
  expect(planSyncWork([second, third], NOW, 10).due).toEqual([second]);
  expect(planSyncWork([third], NOW, 10).due).toEqual([third]);
});

it.each([
  ['a waiting retry', { status: 'failed' as const, attempts: 1, nextRetryAt: iso(60_000) }],
  ['a permanent failure', { status: 'failed' as const, attempts: 1 }],
  // Unsupported without changing the chain key: a different entityType would be
  // a different entity, and would rightly not block anything.
  ['an unsupported envelope', { baseRevision: 3 }],
])('%s at the head blocks its own chain and nothing else', (_label, head) => {
  const blocked = mutation({ entityId: 'habits', ...head });
  const behind = mutation({ entityId: 'habits' });
  const other = mutation({ entityId: 'food' });

  expect(planSyncWork([blocked, behind, other], NOW, 10).due).toEqual([other]);
});

it('separates chains by domain, type and entity', () => {
  const a = mutation({ entityId: 'habits' });
  const b = mutation({ entityId: 'habits', entityType: 'module-choice', dataDomain: 'tasks.todos' });
  expect(entityChainKey(a)).not.toBe(entityChainKey(b));
  expect(entityChainKey(a)).toBe(entityChainKey(mutation({ entityId: 'habits' })));
});

it('caps the batch but still reports every waiting chain', () => {
  // Only the ten toggleable modules can form a supported chain today.
  const ready = ['economy', 'food', 'home', 'goals', 'habits', 'tasks', 'travel', 'warranties', 'career']
    .map((entityId) => mutation({ entityId }));
  const waiting = mutation({ entityId: 'cycle', status: 'failed', attempts: 1, nextRetryAt: iso(90_000) });

  const plan = planSyncWork([...ready, waiting], NOW, 5);
  expect(plan.due).toEqual(ready.slice(0, 5));
  expect(plan.nextRetryAtMs).toBe(NOW + 90_000);
  expect(planSyncWork([...ready, waiting], NOW, 10).due).toEqual(ready);
  expect(planSyncWork([...ready, waiting], NOW, 0).due).toEqual([]);
});

it('reports the earliest waiting chain, not the first one it saw', () => {
  const later = mutation({ entityId: 'habits', status: 'failed', attempts: 3, nextRetryAt: iso(180_000) });
  const sooner = mutation({ entityId: 'food', status: 'failed', attempts: 1, nextRetryAt: iso(10_000) });
  expect(planSyncWork([later, sooner], NOW, 10).nextRetryAtMs).toBe(NOW + 10_000);
});

it('ignores a retry timestamp that is not a date at all', () => {
  const broken = { ...mutation({ status: 'failed', attempts: 1 }), nextRetryAt: 'soon' } as OutboxMutation;
  expect(planSyncWork([broken], NOW, 10)).toEqual({ due: [], nextRetryAtMs: null });
});

it('separates key parts with a source escape, never a literal control byte', () => {
  // The separator has to be something no ID can contain, and NUL is the obvious
  // choice — but writing the byte itself into the source makes git call the file
  // binary and stop showing its diff, which is how an unreviewable change gets
  // reviewed. The escape has the same runtime value.
  expect(entityChainKey(mutation({ entityId: 'habits' })))
    .toBe('core.module-choice\u0000module-choice\u0000habits');

  for (const file of ['core/sync/syncEligibility.ts', 'core/sync/mutationClaims.ts']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    expect(source).toContain('\\u0000');
    expect(source.includes('\u0000')).toBe(false);
  }
});
