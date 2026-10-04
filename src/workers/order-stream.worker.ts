/* eslint-disable @typescript-eslint/no-explicit-any */
// src/workers/order-stream.worker.ts
import { Root } from 'protobufjs/light';

const protoDefinition = {
  nested: {
    OptionOrder: {
      fields: {
        orderId: { type: 'string', id: 1 },
        underlying: { type: 'string', id: 2 },
        price: { type: 'double', id: 3 },
        quantity: { type: 'int64', id: 4 },
        delta: { type: 'double', id: 5 },
        timestamp: { type: 'uint64', id: 6 },
      },
    },
  },
};

const root = Root.fromJSON(protoDefinition);
const OptionOrder = root.lookupType('OptionOrder');

let socket: WebSocket | null = null;
let updateBatch: any[] = [];

// 60Hz UI Synchronization Framework Flush Loop
setInterval(() => {
  if (updateBatch.length > 0) {
    const conflatedMap = new Map();
    for (let i = 0; i < updateBatch.length; i++) {
      conflatedMap.set(updateBatch[i].orderId, updateBatch[i]);
    }
    self.postMessage({ type: 'TICK_BATCH', data: Array.from(conflatedMap.values()) });
    updateBatch = [];
  }
}, 16.67);

self.onmessage = function (event) {
  const { type, payload } = event.data;

  if (type === 'CONNECT_STREAM') {
    if (socket) return;

    // Connect directly to the local server port pipeline
    socket = new WebSocket('ws://localhost:9999');
    socket.binaryType = 'arraybuffer'; // Enforce zero-allocation binary transfer

    socket.onmessage = (msgEvent) => {
      const uint8Array = new Uint8Array(msgEvent.data);
      try {
        // High-speed off-thread network parsing execution
        const decoded = OptionOrder.decode(uint8Array);

        updateBatch.push({
          orderId: decoded.orderId,
          underlying: decoded.underlying,
          price: decoded.price,
          quantity: Number(decoded.quantity),
          delta: decoded.delta,
        });
      } catch (err) {
        console.error('Protobuf streaming frame skipped:', err);
      }
    };
  }

  if (type === 'USER_MUTATION') {
    if (socket && socket.readyState === WebSocket.OPEN) {
      // Re-encode inline user cell adjustments to binary before broadcasting back to the server
      const message = OptionOrder.create({
        orderId: payload.orderId,
        price: payload.field === 'price' ? payload.value : undefined,
        quantity: payload.field === 'quantity' ? payload.value : undefined,
        timestamp: Date.now(),
      });
      const binaryPayload = OptionOrder.encode(message).finish();
      const transferablePayload = new ArrayBuffer(binaryPayload.byteLength);
      new Uint8Array(transferablePayload).set(binaryPayload);
      socket.send(transferablePayload);
    }
  }
};
