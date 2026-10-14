import type { PregnancyQueuedMutation } from '@/core/pregnancy/protectedRepository';
import { planPregnancySyncWork } from '@/core/pregnancy/syncQueue';

const at = '2026-10-14T12:00:00.000Z';
const now = Date.parse(at);
const queued = (mutationId: string, patch: Partial<PregnancyQueuedMutation> = {}): PregnancyQueuedMutation => ({
  mutationId, entityType: 'pregnancy', entityId: 'pregnancy-1', operation: 'upsert',
  payload: { private: 'never leaves this planner' }, consentId: 'consent-1', createdAt: at,
  status: 'pending', attempts: 0, ...patch,
});

describe('APP-076 B2A Pregnancy queue planner', () => {
  it('preserves per-entity FIFO while allowing independent entity heads in a bounded pass', () => {
    const first = queued('first');
    const laterSameEntity = queued('later-same');
    const other = queued('other', { entityType: 'log', entityId: 'log-1' });
    expect(planPregnancySyncWork([first, laterSameEntity, other], now, 10).due)
      .toEqual([first, other]);
    expect(planPregnancySyncWork([first, laterSameEntity, other], now, 1).due).toEqual([first]);
  });

  it('holds a failed chain until its retry time and reports the earliest wake-up', () => {
    const retryAt = new Date(now + 60_000).toISOString();
    const failed = queued('failed', { status: 'failed', attempts: 1, nextRetryAt: retryAt });
    const later = queued('later');
    expect(planPregnancySyncWork([failed, later], now, 10)).toEqual({ due: [], nextRetryAtMs: now + 60_000 });
    expect(planPregnancySyncWork([failed, later], now + 60_000, 10).due).toEqual([failed]);
  });

  it.each(['consent-withdrawn', 'consent-required'] as const)('skips terminal %s upserts but permits their later payload-free delete', (terminalReason) => {
    const blocked = queued('blocked', { status: 'failed', attempts: 1, terminalReason });
    const deleteIntent = queued('delete', {
      operation: 'delete', payload: undefined, consentId: undefined, status: 'pending', attempts: 0,
    });
    expect(planPregnancySyncWork([blocked, deleteIntent], now, 10).due).toEqual([deleteIntent]);
  });

  it('lets a later upsert proceed in order behind a terminal one, keeps its own later delete behind it, and never revives the terminal', () => {
    const blocked = queued('blocked', { status: 'failed', attempts: 1, terminalReason: 'consent-withdrawn' });
    const regrantedUpsert = queued('regranted', { consentId: 'consent-2' });
    const laterDelete = queued('delete', { operation: 'delete', payload: undefined, consentId: undefined });
    expect(planPregnancySyncWork([blocked, regrantedUpsert, laterDelete], now, 10).due).toEqual([regrantedUpsert]);
    expect(planPregnancySyncWork([blocked, regrantedUpsert, laterDelete], now + 10 ** 12, 10).due).toEqual([regrantedUpsert]);
    // A permanent (non-terminal) refusal, by contrast, still blocks its whole chain.
    const refused = queued('refused', { status: 'failed', attempts: 1 });
    expect(planPregnancySyncWork([refused, laterDelete], now, 10).due).toEqual([]);
  });

  it('never treats an invalid or terminal queue item as a timer source', () => {
    const terminal = queued('terminal', { status: 'failed', attempts: 1, terminalReason: 'consent-withdrawn' });
    const malformedSchedule = queued('malformed', { entityId: 'pregnancy-2', status: 'failed', attempts: 1, nextRetryAt: 'not-a-date' });
    expect(planPregnancySyncWork([terminal, malformedSchedule], now, 10)).toEqual({ due: [], nextRetryAtMs: null });
  });
});
