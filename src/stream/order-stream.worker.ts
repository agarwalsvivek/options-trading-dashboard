// src/stream/order-stream.worker.ts
import { ClientMessage, ServerMessage, type OptionOrder } from '../../shared/protocol/codec.ts';
import type { OrderRow } from '../../shared/protocol/order-row.ts';
import type { ConnectionStatus, WorkerIn, WorkerOut } from '../../shared/protocol/worker-messages.ts';
import {
  LIVENESS_CHECK_INTERVAL_MS,
  SNAPSHOT_TIMEOUT_MS,
  backoffDelay,
  evaluateLiveness,
} from './connectionPolicy.ts';

let url: string | null = null;
let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
// Consecutive failed attempts; reset only once a snapshot arrives, not on socket open
let attempt = 0;
let status: ConnectionStatus = { state: 'connecting', attempt: 0 };
let lastMessageAt = 0;
let connectStartedAt = 0;
// Seq of the last applied snapshot/batch; null until this connection's snapshot arrives
let lastSeq: number | null = null;

let updateBatch: OrderRow[] = [];
// Order ids the grid already has; anything else arriving in a delta is an add
const knownIds = new Set<string>();

let rowsThisSecond = 0;
let lagMs = 0;

// One frame at 60 Hz: 1000 ms / 60 frames per second ≈ 16.67 ms per frame
const TARGET_FPS = 60;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

function post(message: WorkerOut) {
  self.postMessage(message);
}

const attemptOf = (s: ConnectionStatus) => ('attempt' in s ? s.attempt : -1);

function setStatus(next: ConnectionStatus) {
  if (next.state === status.state && attemptOf(next) === attemptOf(status)) return;
  status = next;
  post({ type: 'STATUS', status });
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

// ---- Connection lifecycle -------------------------------------------------

function openSocket() {
  if (!url) return;
  retryTimer = null;
  lastSeq = null;
  // Counts as activity so a connect that hangs is caught by the dead-connection timeout
  lastMessageAt = connectStartedAt = Date.now();
  setStatus({ state: 'connecting', attempt });

  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer'; // Enforce zero-allocation binary transfer
  socket = ws;
  let opened = false;

  ws.onopen = () => {
    opened = true;
  };

  ws.onmessage = (msgEvent: MessageEvent<ArrayBuffer>) => {
    // Ignore late events from a socket we already abandoned
    if (socket !== ws) return;
    lastMessageAt = Date.now();
    if (status.state === 'stale') setStatus({ state: 'live' });
    try {
      // High-speed off-thread network parsing execution
      handleServerMessage(ServerMessage.decode(new Uint8Array(msgEvent.data)));
    } catch (err) {
      console.error('Protobuf streaming frame skipped:', err);
    }
  };

  ws.onclose = (closeEvent) => {
    if (socket !== ws) return;
    socket = null;
    scheduleReconnect(closeEvent.reason || (opened ? 'connection lost' : 'server unreachable'));
  };
}

// Abandon the current socket (its handlers become no-ops) and retry with backoff
function dropSocket(reason: string) {
  const ws = socket;
  socket = null;
  ws?.close();
  scheduleReconnect(reason);
}

function scheduleReconnect(reason: string) {
  const delay = backoffDelay(attempt);
  attempt++;
  setStatus({ state: 'reconnecting', attempt, retryAt: Date.now() + delay, reason });
  retryTimer = setTimeout(openSocket, delay);
}

function reconnectNow() {
  if (status.state === 'live') return;
  if (retryTimer) clearTimeout(retryTimer);
  const ws = socket;
  socket = null;
  ws?.close();
  openSocket();
}

// ---- Server messages ------------------------------------------------------

function handleServerMessage(message: ServerMessage) {
  switch (message.body) {
    case 'snapshot': {
      const rows = (message.snapshot?.orders ?? []).map(toRow);
      knownIds.clear();
      rows.forEach((row) => knownIds.add(row.orderId));
      // Anything buffered predates the snapshot and is now stale
      updateBatch = [];
      lastSeq = message.snapshot?.seq ?? 0;
      attempt = 0;
      post({ type: 'SNAPSHOT', rows });
      setStatus({ state: 'live' });
      break;
    }
    case 'deltas': {
      if (lastSeq === null) return;
      const seq = message.deltas?.seq ?? 0;
      if (seq !== lastSeq + 1) {
        dropSocket(`missed batch (expected seq ${lastSeq + 1}, got ${seq})`);
        return;
      }
      lastSeq = seq;
      const orders = message.deltas?.orders ?? [];
      for (let i = 0; i < orders.length; i++) {
        updateBatch.push(toRow(orders[i]));
      }
      rowsThisSecond += orders.length;
      break;
    }
    case 'heartbeat': {
      lagMs = Date.now() - (message.heartbeat?.serverTime ?? 0);
      const seq = message.heartbeat?.seq ?? 0;
      if (lastSeq !== null && seq > lastSeq) {
        dropSocket(`missed batch (heartbeat seq ${seq}, have ${lastSeq})`);
      }
      break;
    }
  }
}

// ---- Loops ----------------------------------------------------------------

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

// Liveness loop: a half-open TCP connection may never fire onclose, so detect silence ourselves
setInterval(() => {
  if (!socket) return;
  const now = Date.now();
  const liveness = evaluateLiveness(now, lastMessageAt);
  if (lastSeq === null && now - connectStartedAt >= SNAPSHOT_TIMEOUT_MS) {
    dropSocket('no snapshot from server');
  } else if (liveness === 'dead') {
    dropSocket('no data from server');
  } else if (liveness === 'stale' && status.state === 'live') {
    setStatus({ state: 'stale', lastMessageAt });
  }
}, LIVENESS_CHECK_INTERVAL_MS);

// Stats loop: 1 Hz, only while a snapshot has been applied
setInterval(() => {
  if (status.state === 'live' || status.state === 'stale') {
    post({ type: 'STATS', stats: { rowsPerSec: rowsThisSecond, lastSeq: lastSeq ?? 0, lagMs } });
  }
  rowsThisSecond = 0;
}, 1000);

// ---- Main thread commands -------------------------------------------------

self.onmessage = function (event: MessageEvent<WorkerIn>) {
  const message = event.data;

  switch (message.type) {
    case 'CONNECT_STREAM':
      if (url) return;
      url = message.url;
      openSocket();
      break;

    case 'RECONNECT_NOW':
      reconnectNow();
      break;

    case 'USER_MUTATION': {
      const { orderId, field, value } = message.payload;
      if (status.state !== 'live' || socket?.readyState !== WebSocket.OPEN) {
        console.warn(`Edit to ${orderId} rejected: stream is ${status.state}`);
        return;
      }
      // Only the edited field is set, so the server can tell it apart from unchanged ones
      const binaryPayload = ClientMessage.encode({
        mutation: { orderId, [field]: value, timestamp: Date.now() },
      }).finish();
      const transferablePayload = new ArrayBuffer(binaryPayload.byteLength);
      new Uint8Array(transferablePayload).set(binaryPayload);
      socket.send(transferablePayload);
      break;
    }
  }
};
