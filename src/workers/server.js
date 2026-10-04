// server.js
import { WebSocketServer } from 'ws';
import protobuf from 'protobufjs';

const protoDefinition = {
  nested: {
    OptionOrder: {
      fields: {
        orderId: { type: "string", id: 1 },
        underlying: { type: "string", id: 2 },
        price: { type: "double", id: 3 },
        quantity: { type: "int64", id: 4 },
        delta: { type: "double", id: 5 },
        timestamp: { type: "uint64", id: 6 }
      }
    }
  }
};

const root = protobuf.Root.fromJSON(protoDefinition);
const OptionOrder = root.lookupType("OptionOrder");

// Spin up a dedicated Mock WebSocket Gateway Server on Port 9999
const wss = new WebSocketServer({ port: 9999 });
console.log('🚀 High-Frequency Protobuf Mock Server running on ws://localhost:9999');

const tickers = ['AAPL', 'TSLA', 'NVDA', 'AMZN', 'MSFT'];
const orderBook = {};

// Initialize 500 options orders in memory
for (let i = 1; i <= 500; i++) {
  const id = `ORD-${String(i).padStart(4, '0')}`;
  orderBook[id] = {
    orderId: id,
    underlying: tickers[Math.floor(Math.random() * tickers.length)],
    price: Math.random() * 150 + 5,
    quantity: Math.floor(Math.random() * 50) * 10,
    delta: Math.random() * 2 - 1
  };
}

wss.on('connection', (ws) => {
  console.log('🔌 Client Web Worker thread attached to stream.');
  
  // High-Frequency Tick Loop: Runs every 1ms
  // Generates exactly 17 mutations per loop iterations to hit a ~1,000 ops target
  const streamInterval = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;

    for (let k = 0; k < 17; k++) {
      const targetId = `ORD-${String(Math.floor(Math.random() * 500) + 1).padStart(4, '0')}`;
      const record = orderBook[targetId];
      
      // Induce artificial options price & numeric changes
      record.price += (Math.random() - 0.5) * 0.4;
      record.quantity = Math.max(10, record.quantity + (Math.floor(Math.random() * 3) - 1) * 10);
      record.delta = Math.max(-1, Math.min(1, record.delta + (Math.random() - 0.5) * 0.01));
      record.timestamp = Date.now();

      // Encode the JavaScript object to a strict Protobuf Binary Buffer
      const message = OptionOrder.create(record);
      const binaryBuffer = OptionOrder.encode(message).finish();

      // Broadcast the raw byte array over the active WebSocket channel
      ws.send(binaryBuffer);
    }
  }, 1);

  // Handle incoming user modifications flowing back from the client-side ag-Grid edits
  ws.on('message', (messageBuffer) => {
    try {
      const decodedMutation = OptionOrder.decode(new Uint8Array(messageBuffer));
      const record = orderBook[decodedMutation.orderId];
      
      if (record) {
        console.log(`✍️ User Edit Applied to Server Engine: ${decodedMutation.orderId}`);
        if (decodedMutation.price) record.price = decodedMutation.price;
        if (decodedMutation.quantity) record.quantity = Number(decodedMutation.quantity);
      }
    } catch (err) {
      console.error('Failed to parse incoming client mutation buffer:', err);
    }
  });

  ws.on('close', () => {
    console.log('❌ Client disconnected. Terminating streaming loops.');
    clearInterval(streamInterval);
  });
});
