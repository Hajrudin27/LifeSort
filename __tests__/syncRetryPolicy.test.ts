import {
  isTransientSyncFailure,
  planFailedAttempt,
  retryDelayMs,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  SYNC_BATCH_LIMIT,
  SYNC_CONTINUATION_DELAY_MS,
} from '@/core/sync/retryPolicy';
import type { SyncSafeErrorCode } from '@/core/sync/syncStatus';

/**
 * APP-037 — backoff arithmetic.
 *
 * The point of jitter is that two phones that lost the network together do not
 * come back together, so the interesting property is the *window*, not a value.
 * Everything here injects the random source, so nothing sleeps and nothing flakes.
 */

const NOW = Date.parse('2026-09-11T10:00:00.000Z');

it('never retries before half the window, and never after all of it', () => {
  // attempt: [floor, ceiling] in milliseconds
  const windows: [number, number][] = [
    [1, 5_000], [2, 10_000], [3, 20_000], [4, 40_000], [5, 80_000], [6, 160_000], [7, 300_000],
  ];
  for (const [attempt, ceiling] of windows) {
    expect(retryDelayMs(attempt, () => 0)).toBe(ceiling / 2);
    expect(retryDelayMs(attempt, () => 1)).toBe(ceiling);
    expect(retryDelayMs(attempt, () => 0.5)).toBe(ceiling * 0.75);
    for (const random of [0, 0.13, 0.5, 0.999]) {
      const delay = retryDelayMs(attempt, () => random);
      expect(delay).toBeGreaterThanOrEqual(ceiling / 2);
      expect(delay).toBeLessThanOrEqual(ceiling);
    }
  }
  expect(retryDelayMs(1, () => 0)).toBe(RETRY_BASE_DELAY_MS / 2);
});

it('doubles until the five-minute cap and then stops growing', () => {
  const growth = [1, 2, 3, 4, 5, 6].map((attempt) => retryDelayMs(attempt, () => 0));
  expect(growth).toEqual([2_500, 5_000, 10_000, 20_000, 40_000, 80_000]);
  for (const attempt of [7, 8, 20, 53, 64, 1_000, Number.MAX_SAFE_INTEGER]) {
    // No overflow to NaN or Infinity, however many failures are behind it.
    expect(retryDelayMs(attempt, () => 1)).toBe(RETRY_MAX_DELAY_MS);
    expect(retryDelayMs(attempt, () => 0)).toBe(RETRY_MAX_DELAY_MS / 2);
  }
});

it('treats a nonsensical attempt count as the first failure rather than failing', () => {
  for (const attempt of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 1.7]) {
    expect(retryDelayMs(attempt, () => 0)).toBe(2_500);
  }
});

it('is deterministic for an injected source and clamps a misbehaving one', () => {
  const sequence = [0.25, 0.75];
  let index = 0;
  const random = () => sequence[index++ % sequence.length];
  expect([retryDelayMs(2, random), retryDelayMs(2, random)]).toEqual([6_250, 8_750]);
  expect(retryDelayMs(1, () => 5)).toBe(5_000);
  expect(retryDelayMs(1, () => -5)).toBe(2_500);
});

it('classifies only a transient result as automatically retryable', () => {
  const codes: SyncSafeErrorCode[] = ['unavailable', 'auth-required', 'conflict', 'validation', 'unknown'];
  expect(codes.filter(isTransientSyncFailure)).toEqual(['unavailable']);
});

it('counts one completed failed send and schedules the next one', () => {
  const plan = planFailedAttempt(0, 'unavailable', NOW, () => 0);
  expect(plan).toEqual({ status: 'failed', attempts: 1, nextRetryAt: '2026-09-11T10:00:02.500Z' });
  expect(planFailedAttempt(3, 'unavailable', NOW, () => 1)).toEqual({
    status: 'failed', attempts: 4, nextRetryAt: '2026-09-11T10:00:40.000Z',
  });
});

it.each(['auth-required', 'conflict', 'validation', 'unknown'] as const)(
  '%s stops the schedule instead of waiting for a timer',
  (code) => {
    const plan = planFailedAttempt(2, code, NOW, () => 0);
    // The attempt still happened; only the automatic future is removed.
    expect(plan).toEqual({ status: 'failed', attempts: 3, nextRetryAt: null });
  },
);

it('keeps the attempt count a safe integer forever', () => {
  expect(planFailedAttempt(Number.MAX_SAFE_INTEGER, 'unavailable', NOW, () => 0).attempts)
    .toBe(Number.MAX_SAFE_INTEGER);
  expect(planFailedAttempt(-1 as number, 'unavailable', NOW, () => 0).attempts).toBe(1);
  expect(Number.isSafeInteger(planFailedAttempt(7, 'unavailable', NOW, () => 0.4).attempts)).toBe(true);
});

it('keeps the batch and continuation constants bounded and non-zero', () => {
  expect(SYNC_BATCH_LIMIT).toBe(10);
  expect(SYNC_CONTINUATION_DELAY_MS).toBeGreaterThan(0);
  expect(RETRY_MAX_DELAY_MS).toBe(300_000);
});
