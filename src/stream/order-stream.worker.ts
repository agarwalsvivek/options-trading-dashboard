// src/stream/order-stream.worker.ts
import { OptionOrder } from '../../shared/protocol/codec.ts';
import type { OrderRow } from '../../shared/protocol/order-row.ts';
import type { WorkerIn, WorkerOut } from '../../shared/protocol/worker-messages.ts';

let socket: WebSocket | null = null;
let updateBatch: OrderRow[] = [];

// One frame at 60 Hz: 1000 ms / 60 frames per second ≈ 16.67 ms per frame
const TARGET_FPS = 60;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

function post(message: WorkerOut) {
  self.postMessage(message);
}

// 60Hz UI Synchronization Framework Flush Loop
setInterval(() => {
  if (updateBatch.length > 0) {
    const conflatedMap = new Map<string, OrderRow>();
    for (let i = 0; i < updateBatch.length; i++) {
      conflatedMap.set(updateBatch[i].orderId, updateBatch[i]);
    }
    post({ type: 'TICK_BATCH', data: Array.from(conflatedMap.values()) });
    updateBatch = [];
  }
}, FRAME_INTERVAL_MS);

self.onmessage = function (event: MessageEvent<WorkerIn>) {
  const message = event.data;

  if (message.type === 'CONNECT_STREAM') {
    if (socket) return;

    // Connect directly to the local server port pipeline
    socket = new WebSocket('ws://localhost:9999');
    socket.binaryType = 'arraybuffer'; // Enforce zero-allocation binary transfer

    socket.onmessage = (msgEvent: MessageEvent<ArrayBuffer>) => {
      const uint8Array = new Uint8Array(msgEvent.data);
      try {
        // High-speed off-thread network parsing execution
        const decoded = OptionOrder.decode(uint8Array);

        updateBatch.push({
          orderId: decoded.orderId,
          underlying: decoded.underlying,
          price: decoded.price,
          quantity: decoded.quantity,
          delta: decoded.delta,
        });
      } catch (err) {
        console.error('Protobuf streaming frame skipped:', err);
      }
    };
  }

  if (message.type === 'USER_MUTATION') {
    const { payload } = message;
    if (socket && socket.readyState === WebSocket.OPEN) {
      // Re-encode inline user cell adjustments to binary before broadcasting back to the server
      const mutation = OptionOrder.create({
        orderId: payload.orderId,
        price: payload.field === 'price' ? payload.value : undefined,
        quantity: payload.field === 'quantity' ? payload.value : undefined,
        timestamp: Date.now(),
      });
      const binaryPayload = OptionOrder.encode(mutation).finish();
      const transferablePayload = new ArrayBuffer(binaryPayload.byteLength);
      new Uint8Array(transferablePayload).set(binaryPayload);
      socket.send(transferablePayload);
    }
  }
};
