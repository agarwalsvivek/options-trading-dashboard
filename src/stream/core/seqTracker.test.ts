import { describe, expect, it } from 'vitest';
import { SeqTracker } from './seqTracker.ts';

describe('SeqTracker', () => {
  it('ignores deltas and heartbeats before the snapshot', () => {
    const tracker = new SeqTracker();
    expect(tracker.hasSnapshot).toBe(false);
    expect(tracker.onDelta(1)).toEqual({ kind: 'ignore' });
    expect(tracker.onHeartbeat(99)).toEqual({ kind: 'ignore' });
  });

  it('applies consecutive deltas after the snapshot', () => {
    const tracker = new SeqTracker();
    tracker.onSnapshot(10);
    expect(tracker.onDelta(11)).toEqual({ kind: 'apply' });
    expect(tracker.onDelta(12)).toEqual({ kind: 'apply' });
    expect(tracker.lastSeq).toBe(12);
  });

  it('reports a gap when a delta skips ahead, without advancing', () => {
    const tracker = new SeqTracker();
    tracker.onSnapshot(10);
    expect(tracker.onDelta(13)).toEqual({
      kind: 'gap',
      reason: 'missed batch (expected seq 11, got 13)',
    });
    expect(tracker.lastSeq).toBe(10);
  });

  it('reports a gap for a repeated (old) delta', () => {
    const tracker = new SeqTracker();
    tracker.onSnapshot(10);
    expect(tracker.onDelta(10).kind).toBe('gap');
  });

  it('reports a gap when a heartbeat is ahead of the last batch', () => {
    const tracker = new SeqTracker();
    tracker.onSnapshot(10);
    expect(tracker.onHeartbeat(10)).toEqual({ kind: 'apply' });
    expect(tracker.onHeartbeat(11)).toEqual({
      kind: 'gap',
      reason: 'missed batch (heartbeat seq 11, have 10)',
    });
  });

  it('clear() requires a new snapshot; a snapshot resets the baseline', () => {
    const tracker = new SeqTracker();
    tracker.onSnapshot(10);
    tracker.clear();
    expect(tracker.hasSnapshot).toBe(false);
    expect(tracker.onDelta(11)).toEqual({ kind: 'ignore' });
    tracker.onSnapshot(0);
    expect(tracker.onDelta(1)).toEqual({ kind: 'apply' });
  });
});
