import type { OrderRow } from './order-row.ts';

export type EditableField = 'price' | 'quantity';

export type ConnectionStatus =
  | { state: 'connecting'; attempt: number }
  | { state: 'live' }
  | { state: 'stale'; lastMessageAt: number }
  | { state: 'reconnecting'; attempt: number; retryAt: number; reason: string };

export interface StreamStats {
  rowsPerSec: number;
  lastSeq: number;
  lagMs: number;
}

export interface EditRequest {
  requestId: string;
  orderId: string;
  field: EditableField;
  value: number;
}

export type EditOutcome = { outcome: 'accepted' } | { outcome: 'rejected'; reason: string };

export type EditResult = Omit<EditRequest, 'value'> & EditOutcome;

// Main thread -> worker
export type WorkerIn =
  | { type: 'CONNECT_STREAM'; url: string }
  | { type: 'RECONNECT_NOW' }
  | { type: 'USER_MUTATION'; payload: EditRequest };

// Worker -> main thread
export type WorkerOut =
  | { type: 'SNAPSHOT'; rows: OrderRow[] }
  | { type: 'TICK_BATCH'; add: OrderRow[]; update: OrderRow[] }
  // Posted on state transitions only, never at tick rate
  | { type: 'STATUS'; status: ConnectionStatus }
  // Posted at 1 Hz while connected
  | { type: 'STATS'; stats: StreamStats }
  // One per USER_MUTATION: server ack, server reject, timeout, or connection failure
  | { type: 'EDIT_RESULT'; result: EditResult };
