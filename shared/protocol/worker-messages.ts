import type { OrderRow } from './order-row.ts';

export type EditableField = 'price' | 'quantity';

// Main thread -> worker
export type WorkerIn =
  | { type: 'CONNECT_STREAM' }
  | { type: 'USER_MUTATION'; payload: { orderId: string; field: EditableField; value: number } };

// Worker -> main thread
export type WorkerOut =
  | { type: 'SNAPSHOT'; rows: OrderRow[] }
  | { type: 'TICK_BATCH'; add: OrderRow[]; update: OrderRow[] };
