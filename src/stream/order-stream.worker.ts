// src/stream/order-stream.worker.ts
// Connection shell: owns the WebSocket, reconnect/backoff and the timers. All data handling
// (decode, conflation, edits) lives in core/streamEngine.ts.
import type { ConnectionStatus, WorkerIn, WorkerOut } from '../../shared/protocol/worker-messages.ts';
import {
  LIVENESS_CHECK_INTERVAL_MS,
  SNAPSHOT_TIMEOUT_MS,
  backoffDelay,
  evaluateLiveness,
} from './connectionPolicy.ts';
import { createStreamEngine } from './core/streamEngine.ts';

let url: string | null = null;
let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
// Consecutive failed attempts; reset only once a snapshot arrives, not on socket open
let attempt = 0;
let status: ConnectionStatus = { state: 'connecting', attempt: 0 };
let lastMessageAt = 0;
let connectStartedAt = 0;

// One frame at 60 Hz: 1000 ms / 60 frames per second ≈ 16.67 ms per frame
const TARGET_FPS = 60;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

function post(message: WorkerOut) {
  self.postMessage(message);
}

const engine = createStreamEngine({
  now: Date.now,
  post,
  send: (bytes) => socket?.send(bytes),
});

const attemptOf = (s: ConnectionStatus) => ('attempt' in s ? s.attempt : -1);

function setStatus(next: ConnectionStatus) {
  if (next.state === status.state && attemptOf(next) === attemptOf(status)) return;
  status = next;
  post({ type: 'STATUS', status });
}

// ---- Connection lifecycle -------------------------------------------------

function openSocket() {
  if (!url) return;
  retryTimer = null;
  engine.onConnecting();
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
      const signal = engine.handleServerMessage(new Uint8Array(msgEvent.data));
      if (signal?.type === 'snapshot') {
        attempt = 0;
        setStatus({ state: 'live' });
      } else if (signal?.type === 'resync') {
        dropSocket(signal.reason);
      }
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
  engine.onDisconnected();
  const delay = backoffDelay(attempt);
  attempt++;
  setStatus({ state: 'reconnecting', attempt, retryAt: Date.now() + delay, reason });
  retryTimer = setTimeout(openSocket, delay);
}

function reconnectNow() {
  if (status.state === 'live') return;
  if (retryTimer) clearTimeout(retryTimer);
  engine.onDisconnected();
  const ws = socket;
  socket = null;
  ws?.close();
  openSocket();
}

// ---- Loops ----------------------------------------------------------------

// 60Hz UI Synchronization Framework Flush Loop
setInterval(() => engine.flush(), FRAME_INTERVAL_MS);

// Liveness loop: a half-open TCP connection may never fire onclose, so detect silence ourselves.
// Also expires edits whose ack never came.
setInterval(() => {
  engine.expireEdits();
  if (!socket) return;

  const now = Date.now();
  const liveness = evaluateLiveness(now, lastMessageAt);
  if (!engine.hasSnapshot && now - connectStartedAt >= SNAPSHOT_TIMEOUT_MS) {
    dropSocket('no snapshot from server');
  } else if (liveness === 'dead') {
    dropSocket('no data from server');
  } else if (liveness === 'stale' && status.state === 'live') {
    setStatus({ state: 'stale', lastMessageAt });
  }
}, LIVENESS_CHECK_INTERVAL_MS);

// Stats loop: 1 Hz, posted only while a snapshot has been applied
setInterval(() => {
  const stats = engine.takeStats();
  if (status.state === 'live' || status.state === 'stale') post({ type: 'STATS', stats });
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

    case 'USER_MUTATION':
      engine.edit(message.payload, status.state === 'live' && socket?.readyState === WebSocket.OPEN);
      break;
  }
};
