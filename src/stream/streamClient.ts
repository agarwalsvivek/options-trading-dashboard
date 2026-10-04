import type { OrderRow } from '../../shared/protocol/order-row.ts';
import type { EditableField, WorkerIn, WorkerOut } from '../../shared/protocol/worker-messages.ts';

// Typed main-thread facade over the order stream worker. This is the only module that touches `Worker`.
export interface StreamClient {
  connect(): void;
  mutate(orderId: string, field: EditableField, value: number): void;
  onTicks(listener: (rows: OrderRow[]) => void): () => void;
  dispose(): void;
}

export function createStreamClient(): StreamClient {
  // Vite worker loading instantiation syntax
  const worker = new Worker(new URL('./order-stream.worker.ts', import.meta.url), {
    type: 'module',
  });
  const tickListeners = new Set<(rows: OrderRow[]) => void>();

  const send = (message: WorkerIn) => worker.postMessage(message);

  worker.onmessage = (event: MessageEvent<WorkerOut>) => {
    const message = event.data;
    if (message.type === 'TICK_BATCH') {
      tickListeners.forEach((listener) => listener(message.data));
    }
  };

  return {
    connect: () => send({ type: 'CONNECT_STREAM' }),
    mutate: (orderId, field, value) =>
      send({ type: 'USER_MUTATION', payload: { orderId, field, value } }),
    onTicks(listener) {
      tickListeners.add(listener);
      return () => tickListeners.delete(listener);
    },
    dispose() {
      tickListeners.clear();
      worker.terminate();
    },
  };
}
