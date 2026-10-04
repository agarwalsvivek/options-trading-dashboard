import { describe, expect, it } from 'vitest';
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  DEAD_AFTER_MS,
  STALE_AFTER_MS,
  backoffDelay,
  evaluateLiveness,
} from './connectionPolicy.ts';

const almostOne = () => 0.999999;

describe('backoffDelay', () => {
  it('is 0 at the bottom of the jitter range', () => {
    expect(backoffDelay(0, () => 0)).toBe(0);
    expect(backoffDelay(10, () => 0)).toBe(0);
  });

  it('doubles the ceiling each attempt', () => {
    expect(backoffDelay(0, almostOne)).toBe(BACKOFF_BASE_MS - 1);
    expect(backoffDelay(1, almostOne)).toBe(BACKOFF_BASE_MS * 2 - 1);
    expect(backoffDelay(3, almostOne)).toBe(BACKOFF_BASE_MS * 8 - 1);
  });

  it('never exceeds the cap', () => {
    for (const attempt of [5, 6, 10, 50]) {
      expect(backoffDelay(attempt, almostOne)).toBeLessThan(BACKOFF_CAP_MS);
    }
  });

  it('uses full jitter: halfway through the range gives half the ceiling', () => {
    expect(backoffDelay(2, () => 0.5)).toBe((BACKOFF_BASE_MS * 4) / 2);
  });
});

describe('evaluateLiveness', () => {
  it('is fresh, then stale, then dead at the exact thresholds', () => {
    expect(evaluateLiveness(STALE_AFTER_MS - 1, 0)).toBe('fresh');
    expect(evaluateLiveness(STALE_AFTER_MS, 0)).toBe('stale');
    expect(evaluateLiveness(DEAD_AFTER_MS - 1, 0)).toBe('stale');
    expect(evaluateLiveness(DEAD_AFTER_MS, 0)).toBe('dead');
  });
});
