// server/mock-server.ts
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { ClientMessage, ServerMessage } from '../shared/protocol/codec.ts';
import type { OrderRow } from '../shared/protocol/order-row.ts';

interface OrderRecord extends OrderRow {
  timestamp: number;
}

const PORT = Number(process.env.PORT ?? 9999);
// Simulated order mutations per second across the whole book (override with MUTATIONS_PER_SEC=...)
const MUTATIONS_PER_SEC = Number(process.env.MUTATIONS_PER_SEC ?? 1000);
const SIM_INTERVAL_MS = 10;
// One conflated delta batch per ~60 Hz frame
const BATCH_INTERVAL_MS = 16;
const HEARTBEAT_INTERVAL_MS = 1000;
// Terminate clients that miss a ping/pong round (browsers answer pings automatically)
const PING_INTERVAL_MS = 10_000;

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
// Fault injection: when paused the server goes silent (no snapshot, deltas or heartbeats)
let paused = false;
const alive = new WeakSet<WebSocket>();

function broadcast(buffer: Uint8Array) {
  if (paused) return;
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(buffer);
  }
}

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

// Broadcast loop: one encoded DeltaBatch, sent as the same buffer to every client.
// Keeps advancing seq while paused, so resuming exercises client gap detection.
setInterval(() => {
  if (dirty.size === 0) return;

  const orders = Array.from(dirty, (id) => orderBook.get(id)!);
  dirty.clear();
  seq++;

  broadcast(ServerMessage.encode({ deltas: { seq, orders } }).finish());
}, BATCH_INTERVAL_MS);

// Heartbeat loop: lets clients tell a quiet market from a dead connection
setInterval(() => {
  broadcast(ServerMessage.encode({ heartbeat: { seq, serverTime: Date.now() } }).finish());
}, HEARTBEAT_INTERVAL_MS);

// Ping/pong loop: drop clients whose connection died without a close frame
setInterval(() => {
  for (const client of wss.clients) {
    if (!alive.has(client)) {
      client.terminate();
      continue;
    }
    alive.delete(client);
    client.ping();
  }
}, PING_INTERVAL_MS);

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
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));

  // Snapshot first; Node is single-threaded, so no delta can slip in before it
  if (!paused) {
    ws.send(ServerMessage.encode({ snapshot: { seq, orders: Array.from(orderBook.values()) } }).finish());
  }

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

// Fault injection keys for exercising client resilience (typed in a terminal, or piped by a test script)
function handleKey(key: string) {
  if (key === '\u0003') process.exit(0);
  if (key === 'd') {
    console.log(`💥 Dropping ${wss.clients.size} connection(s).`);
    for (const client of wss.clients) client.terminate();
  }
  if (key === 'p') {
    paused = !paused;
    console.log(paused ? '⏸️  Paused: server is silent.' : '▶️  Resumed sending.');
  }
}

if (process.stdin.isTTY) {
  console.log('⌨️  Keys: [d] drop all connections · [p] pause/resume sending · [Ctrl+C] quit');
  process.stdin.setRawMode(true);
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data: string) => {
  for (const key of data) handleKey(key);
});
