import type { OrderRow } from '../../shared/protocol/order-row.ts';
import type {
  ConnectionStatus,
  EditResult,
  EditableField,
  StreamStats,
  WorkerIn,
  WorkerOut,
} from '../../shared/protocol/worker-messages.ts';

export interface TickBatch {
  add: OrderRow[];
  update: OrderRow[];
}

// Typed main-thread facade over the order stream worker. This is the only module that touches `Worker`.
// Status and stats are exposed in the subscribe/getSnapshot shape `useSyncExternalStore` expects.
export interface StreamClient {
  connect(url: string): void;
  disconnect(): void;
  reconnectNow(): void;
  // Returns the requestId; exactly one onEditResult event follows for it
  mutate(orderId: string, field: EditableField, value: number): string;
  onSnapshot(listener: (rows: OrderRow[]) => void): () => void;
  onTicks(listener: (batch: TickBatch) => void): () => void;
  onEditResult(listener: (result: EditResult) => void): () => void;
  getStatus(): ConnectionStatus;
  subscribeStatus(listener: () => void): () => void;
  getStats(): StreamStats | null;
  subscribeStats(listener: () => void): () => void;
}

const INITIAL_STATUS: ConnectionStatus = { state: 'connecting', attempt: 0 };

function listenerSet<T extends unknown[]>() {
  const listeners = new Set<(...args: T) => void>();
  return {
    add(listener: (...args: T) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (...args: T) => listeners.forEach((listener) => listener(...args)),
  };
}

export function createStreamClient(): StreamClient {
  // Created lazily in connect() so constructing a client (e.g. in a StrictMode double render) is free
  let worker: Worker | null = null;
  let status = INITIAL_STATUS;
  let stats: StreamStats | null = null;

  const snapshotListeners = listenerSet<[OrderRow[]]>();
  const tickListeners = listenerSet<[TickBatch]>();
  const editResultListeners = listenerSet<[EditResult]>();
  const statusListeners = listenerSet<[]>();
  const statsListeners = listenerSet<[]>();

  const send = (message: WorkerIn) => worker?.postMessage(message);

  function handleMessage(event: MessageEvent<WorkerOut>) {
    const message = event.data;
    switch (message.type) {
      case 'SNAPSHOT':
        snapshotListeners.emit(message.rows);
        break;
      case 'TICK_BATCH':
        tickListeners.emit({ add: message.add, update: message.update });
        break;
      case 'STATUS':
        status = message.status;
        statusListeners.emit();
        break;
      case 'STATS':
        stats = message.stats;
        statsListeners.emit();
        break;
      case 'EDIT_RESULT':
        editResultListeners.emit(message.result);
        break;
    }
  }

  return {
    connect(url) {
      if (worker) return;
      // Vite worker loading instantiation syntax
      worker = new Worker(new URL('./order-stream.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = handleMessage;
      send({ type: 'CONNECT_STREAM', url });
    },
    disconnect() {
      worker?.terminate();
      worker = null;
      status = INITIAL_STATUS;
      stats = null;
      statusListeners.emit();
      statsListeners.emit();
    },
    reconnectNow: () => send({ type: 'RECONNECT_NOW' }),
    mutate(orderId, field, value) {
      // Generated here so the UI can mark the cell pending without a worker round trip
      const requestId = crypto.randomUUID();
      if (worker) {
        send({ type: 'USER_MUTATION', payload: { requestId, orderId, field, value } });
      } else {
        queueMicrotask(() =>
          editResultListeners.emit({ requestId, orderId, field, outcome: 'rejected', reason: 'stream offline' }),
        );
      }
      return requestId;
    },
    onSnapshot: snapshotListeners.add,
    onTicks: tickListeners.add,
    onEditResult: editResultListeners.add,
    getStatus: () => status,
    subscribeStatus: statusListeners.add,
    getStats: () => stats,
    subscribeStats: statsListeners.add,
  };
}
