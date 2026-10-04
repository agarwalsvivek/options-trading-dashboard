export type SeqVerdict = { kind: 'apply' } | { kind: 'ignore' } | { kind: 'gap'; reason: string };

// Tracks batch sequence numbers for one connection. Batches arrive in order on a single socket,
// so a gap means data was lost and the client must resync from a fresh snapshot.
export class SeqTracker {
  // null until this connection's snapshot arrives
  private last: number | null = null;

  get lastSeq(): number | null {
    return this.last;
  }

  get hasSnapshot(): boolean {
    return this.last !== null;
  }

  // New connection: nothing applies until its snapshot
  clear() {
    this.last = null;
  }

  onSnapshot(seq: number) {
    this.last = seq;
  }

  onDelta(seq: number): SeqVerdict {
    if (this.last === null) return { kind: 'ignore' };
    if (seq !== this.last + 1) {
      return { kind: 'gap', reason: `missed batch (expected seq ${this.last + 1}, got ${seq})` };
    }
    this.last = seq;
    return { kind: 'apply' };
  }

  // Heartbeats carry the server's latest seq; being behind it means a batch never arrived
  onHeartbeat(seq: number): SeqVerdict {
    if (this.last === null) return { kind: 'ignore' };
    if (seq > this.last) {
      return { kind: 'gap', reason: `missed batch (heartbeat seq ${seq}, have ${this.last})` };
    }
    return { kind: 'apply' };
  }
}
