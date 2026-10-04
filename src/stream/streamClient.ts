import type { OrderRow } from '../../shared/protocol/order-row.ts';
import type { EditableField, WorkerIn, WorkerOut } from '../../shared/protocol/worker-messages.ts';

export interface TickBatch {
  add: OrderRow[];
  update: OrderRow[];
}

// Typed main-thread facade over the order stream worker. This is the only module that touches `Worker`.
export interface StreamClient {
  connect(): void;
  mutate(orderId: string, field: EditableField, value: number): void;
  onSnapshot(listener: (rows: OrderRow[]) => void): () => void;
  onTicks(listener: (batch: TickBatch) => void): () => void;
  dispose(): void;
}

export function createStreamClient(): StreamClient {
  // Vite worker loading instantiation syntax
  const worker = new Worker(new URL('./order-stream.worker.ts', import.meta.url), {
    type: 'module',
  });
  const snapshotListeners = new Set<(rows: OrderRow[]) => void>();
  const tickListeners = new Set<(batch: TickBatch) => void>();

  const send = (message: WorkerIn) => worker.postMessage(message);

  worker.onmessage = (event: MessageEvent<WorkerOut>) => {
    const message = event.data;
    switch (message.type) {
      case 'SNAPSHOT':
        snapshotListeners.forEach((listener) => listener(message.rows));
        break;
      case 'TICK_BATCH':
        tickListeners.forEach((listener) => listener({ add: message.add, update: message.update }));
        break;
    }
  };

  return {
    connect: () => send({ type: 'CONNECT_STREAM' }),
    mutate: (orderId, field, value) =>
      send({ type: 'USER_MUTATION', payload: { orderId, field, value } }),
    onSnapshot(listener) {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
    onTicks(listener) {
      tickListeners.add(listener);
      return () => tickListeners.delete(listener);
    },
    dispose() {
      snapshotListeners.clear();
      tickListeners.clear();
      worker.terminate();
    },
  };
}
