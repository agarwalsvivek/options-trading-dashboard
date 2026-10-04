// src/stream/order-stream.worker.ts
import { ClientMessage, ServerMessage, type OptionOrder } from '../../shared/protocol/codec.ts';
import type { OrderRow } from '../../shared/protocol/order-row.ts';
import type { WorkerIn, WorkerOut } from '../../shared/protocol/worker-messages.ts';

let socket: WebSocket | null = null;
let updateBatch: OrderRow[] = [];
// Order ids the grid already has; anything else arriving in a delta is an add
const knownIds = new Set<string>();

// One frame at 60 Hz: 1000 ms / 60 frames per second ≈ 16.67 ms per frame
const TARGET_FPS = 60;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

function post(message: WorkerOut) {
  self.postMessage(message);
}

// Nested decoded messages are typed with nullable fields; proto3 defaults are '' / 0
function toRow(order: OptionOrder.$Properties): OrderRow {
  return {
    orderId: order.orderId ?? '',
    underlying: order.underlying ?? '',
    price: order.price ?? 0,
    quantity: order.quantity ?? 0,
    delta: order.delta ?? 0,
  };
}

// 60Hz UI Synchronization Framework Flush Loop
setInterval(() => {
  if (updateBatch.length > 0) {
    const conflatedMap = new Map<string, OrderRow>();
    for (let i = 0; i < updateBatch.length; i++) {
      conflatedMap.set(updateBatch[i].orderId, updateBatch[i]);
    }
    updateBatch = [];

    const add: OrderRow[] = [];
    const update: OrderRow[] = [];
    for (const row of conflatedMap.values()) {
      if (knownIds.has(row.orderId)) {
        update.push(row);
      } else {
        knownIds.add(row.orderId);
        add.push(row);
      }
    }
    post({ type: 'TICK_BATCH', add, update });
  }
}, FRAME_INTERVAL_MS);

function handleServerMessage(message: ServerMessage) {
  switch (message.body) {
    case 'snapshot': {
      const rows = (message.snapshot?.orders ?? []).map(toRow);
      knownIds.clear();
      rows.forEach((row) => knownIds.add(row.orderId));
      // Anything buffered predates the snapshot and is now stale
      updateBatch = [];
      post({ type: 'SNAPSHOT', rows });
      break;
    }
    case 'deltas': {
      const orders = message.deltas?.orders ?? [];
      for (let i = 0; i < orders.length; i++) {
        updateBatch.push(toRow(orders[i]));
      }
      break;
    }
  }
}

self.onmessage = function (event: MessageEvent<WorkerIn>) {
  const message = event.data;

  if (message.type === 'CONNECT_STREAM') {
    if (socket) return;

    // Connect directly to the local server port pipeline
    socket = new WebSocket('ws://localhost:9999');
    socket.binaryType = 'arraybuffer'; // Enforce zero-allocation binary transfer

    socket.onmessage = (msgEvent: MessageEvent<ArrayBuffer>) => {
      try {
        // High-speed off-thread network parsing execution
        handleServerMessage(ServerMessage.decode(new Uint8Array(msgEvent.data)));
      } catch (err) {
        console.error('Protobuf streaming frame skipped:', err);
      }
    };
  }

  if (message.type === 'USER_MUTATION') {
    const { orderId, field, value } = message.payload;
    if (socket && socket.readyState === WebSocket.OPEN) {
      // Only the edited field is set, so the server can tell it apart from unchanged ones
      const binaryPayload = ClientMessage.encode({
        mutation: { orderId, [field]: value, timestamp: Date.now() },
      }).finish();
      const transferablePayload = new ArrayBuffer(binaryPayload.byteLength);
      new Uint8Array(transferablePayload).set(binaryPayload);
      socket.send(transferablePayload);
    }
  }
};
