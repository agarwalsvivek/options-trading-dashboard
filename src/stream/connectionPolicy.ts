// Pure reconnect and liveness rules for the stream worker (no sockets, no timers: unit-testable).

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 10_000;
// The server heartbeats every 1s, so silence beyond these means trouble, not a quiet market
export const STALE_AFTER_MS = 2_500;
export const DEAD_AFTER_MS = 5_000;
// A connection that never delivers its snapshot is useless even if heartbeats keep arriving
export const SNAPSHOT_TIMEOUT_MS = 5_000;
export const LIVENESS_CHECK_INTERVAL_MS = 500;

// Exponential backoff with full jitter: random(0, min(cap, base * 2^attempt))
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

export type Liveness = 'fresh' | 'stale' | 'dead';

export function evaluateLiveness(now: number, lastMessageAt: number): Liveness {
  const silentFor = now - lastMessageAt;
  if (silentFor >= DEAD_AFTER_MS) return 'dead';
  if (silentFor >= STALE_AFTER_MS) return 'stale';
  return 'fresh';
}
