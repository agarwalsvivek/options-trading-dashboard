// server/mock-server.ts
import { WebSocketServer, type RawData } from 'ws';
import { ClientMessage, ServerMessage } from '../shared/protocol/codec.ts';
import type { OrderRow } from '../shared/protocol/order-row.ts';

interface OrderRecord extends OrderRow {
  timestamp: number;
}

const PORT = 9999;
// Simulated order mutations per second across the whole book (override with MUTATIONS_PER_SEC=...)
const MUTATIONS_PER_SEC = Number(process.env.MUTATIONS_PER_SEC ?? 1000);
const SIM_INTERVAL_MS = 10;
// One conflated delta batch per ~60 Hz frame
const BATCH_INTERVAL_MS = 16;

// Spin up a dedicated Mock WebSocket Gateway Server
const wss = new WebSocketServer({ port: PORT });
console.log(
  `🚀 High-Frequency Protobuf Mock Server running on ws://localhost:${PORT} (${MUTATIONS_PER_SEC} mutations/s)`,
);

const tickers = ['AAPL', 'TSLA', 'NVDA', 'AMZN', 'MSFT'];
const orderBook = new Map<string, OrderRecord>();
// Orders changed since the last broadcast; a Set conflates repeat changes server-side
const dirty = new Set<string>();
let seq = 0;

// Initialize 500 options orders in memory
for (let i = 1; i <= 500; i++) {
  const id = `ORD-${String(i).padStart(4, '0')}`;
  orderBook.set(id, {
    orderId: id,
    underlying: tickers[Math.floor(Math.random() * tickers.length)],
    price: Math.random() * 150 + 5,
    quantity: Math.floor(Math.random() * 50) * 10,
    delta: Math.random() * 2 - 1,
    timestamp: Date.now(),
  });
}
const orderIds = Array.from(orderBook.keys());

// Global simulation loop, shared by all clients, paced by elapsed time
let lastSimAt = performance.now();
let mutationCarry = 0;
setInterval(() => {
  const now = performance.now();
  mutationCarry += (MUTATIONS_PER_SEC * (now - lastSimAt)) / 1000;
  lastSimAt = now;

  const count = Math.floor(mutationCarry);
  mutationCarry -= count;

  for (let k = 0; k < count; k++) {
    const record = orderBook.get(orderIds[Math.floor(Math.random() * orderIds.length)])!;

    // Induce artificial options price & numeric changes
    record.price += (Math.random() - 0.5) * 0.4;
    record.quantity = Math.max(10, record.quantity + (Math.floor(Math.random() * 3) - 1) * 10);
    record.delta = Math.max(-1, Math.min(1, record.delta + (Math.random() - 0.5) * 0.01));
    record.timestamp = Date.now();
    dirty.add(record.orderId);
  }
}, SIM_INTERVAL_MS);

// Broadcast loop: one encoded DeltaBatch, sent as the same buffer to every client
setInterval(() => {
  if (dirty.size === 0) return;

  const orders = Array.from(dirty, (id) => orderBook.get(id)!);
  dirty.clear();
  seq++;

  const buffer = ServerMessage.encode({ deltas: { seq, orders } }).finish();
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(buffer);
  }
}, BATCH_INTERVAL_MS);

function applyMutation(messageBuffer: RawData) {
  const message = ClientMessage.decode(new Uint8Array(messageBuffer as Buffer));
  if (message.body !== 'mutation' || !message.mutation) return;

  const mutation = message.mutation;
  const record = mutation.orderId ? orderBook.get(mutation.orderId) : undefined;
  if (!record) return;

  // Presence checks (not truthiness) so 0 is a valid edit
  if (mutation.price != null) record.price = mutation.price;
  if (mutation.quantity != null) record.quantity = mutation.quantity;
  record.timestamp = Date.now();

  // Echo the authoritative value to every client in the next batch
  dirty.add(record.orderId);
  console.log(`✍️ User Edit Applied to Server Engine: ${mutation.orderId}`);
}

wss.on('connection', (ws) => {
  console.log(`🔌 Client attached to stream (${wss.clients.size} connected).`);

  // Snapshot first; Node is single-threaded, so no delta can slip in before it
  ws.send(ServerMessage.encode({ snapshot: { seq, orders: Array.from(orderBook.values()) } }).finish());

  // Handle incoming user modifications flowing back from the client-side ag-Grid edits
  ws.on('message', (messageBuffer: RawData) => {
    try {
      applyMutation(messageBuffer);
    } catch (err) {
      console.error('Failed to parse incoming client message buffer:', err);
    }
  });

  ws.on('close', () => {
    console.log(`❌ Client disconnected (${wss.clients.size} connected).`);
  });
});
