// src/stream/order-stream.worker.ts
import { ClientMessage, ServerMessage, type OptionOrder } from '../../shared/protocol/codec.ts';
import type { OrderRow } from '../../shared/protocol/order-row.ts';
import type {
  ConnectionStatus,
  EditOutcome,
  EditRequest,
  EditableField,
  WorkerIn,
  WorkerOut,
} from '../../shared/protocol/worker-messages.ts';
import {
  ACK_TIMEOUT_MS,
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
// Last row the server sent for each order: what a rejected or failed edit rolls back to
const serverRows = new Map<string, OrderRow>();

interface InFlightEdit extends EditRequest {
  sentAt: number;
}
// Edits awaiting an ack, by requestId
const inFlight = new Map<string, InFlightEdit>();
// Latest unacked edit per order and field; overlaid on outgoing rows so ticks can't revert it
const pendingByOrder = new Map<string, Map<EditableField, InFlightEdit>>();

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

// ---- Edits ----------------------------------------------------------------

// Re-emit the server's row on the next flush (rollback on reject, confirmation on accept)
function reemitServerRow(orderId: string) {
  const row = serverRows.get(orderId);
  if (row) updateBatch.push(row);
}

function postEditResult(edit: EditRequest, outcome: EditOutcome) {
  const { requestId, orderId, field } = edit;
  post({ type: 'EDIT_RESULT', result: { requestId, orderId, field, ...outcome } });
}

function settleEdit(requestId: string, outcome: EditOutcome) {
  const edit = inFlight.get(requestId);
  // Already settled, e.g. an ack arriving after its timeout
  if (!edit) return;
  inFlight.delete(requestId);

  // Only clear the overlay if no newer edit to the same cell superseded this one
  const cells = pendingByOrder.get(edit.orderId);
  if (cells?.get(edit.field)?.requestId === requestId) {
    cells.delete(edit.field);
    if (cells.size === 0) pendingByOrder.delete(edit.orderId);
  }

  reemitServerRow(edit.orderId);
  postEditResult(edit, outcome);
}

function failAllEdits(reason: string) {
  for (const requestId of Array.from(inFlight.keys())) {
    settleEdit(requestId, { outcome: 'rejected', reason });
  }
}

// int64/double can't carry these; business rules are the server's job
function unencodableReason(edit: EditRequest): string | null {
  if (!Number.isFinite(edit.value)) return 'not a number';
  if (edit.field === 'quantity' && !Number.isInteger(edit.value)) return 'quantity must be a whole number';
  return null;
}

function sendEdit(edit: EditRequest) {
  const reason =
    status.state !== 'live' || socket?.readyState !== WebSocket.OPEN
      ? 'stream offline'
      : unencodableReason(edit);
  if (reason || !socket) {
    reemitServerRow(edit.orderId);
    postEditResult(edit, { outcome: 'rejected', reason: reason ?? 'stream offline' });
    return;
  }

  const pendingEdit = { ...edit, sentAt: Date.now() };
  inFlight.set(edit.requestId, pendingEdit);
  let cells = pendingByOrder.get(edit.orderId);
  if (!cells) pendingByOrder.set(edit.orderId, (cells = new Map()));
  cells.set(edit.field, pendingEdit);

  // Only the edited field is set, so the server can tell it apart from unchanged ones
  const binaryPayload = ClientMessage.encode({
    mutation: {
      orderId: edit.orderId,
      [edit.field]: edit.value,
      timestamp: pendingEdit.sentAt,
      requestId: edit.requestId,
    },
  }).finish();
  const transferablePayload = new ArrayBuffer(binaryPayload.byteLength);
  new Uint8Array(transferablePayload).set(binaryPayload);
  socket.send(transferablePayload);
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
  // Acks can't arrive on a dead socket; the next snapshot settles the values
  failAllEdits('connection lost');
  const delay = backoffDelay(attempt);
  attempt++;
  setStatus({ state: 'reconnecting', attempt, retryAt: Date.now() + delay, reason });
  retryTimer = setTimeout(openSocket, delay);
}

function reconnectNow() {
  if (status.state === 'live') return;
  if (retryTimer) clearTimeout(retryTimer);
  failAllEdits('connection lost');
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
      serverRows.clear();
      rows.forEach((row) => {
        knownIds.add(row.orderId);
        serverRows.set(row.orderId, row);
      });
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
        const row = toRow(orders[i]);
        serverRows.set(row.orderId, row);
        updateBatch.push(row);
      }
      rowsThisSecond += orders.length;
      break;
    }
    case 'ack': {
      const ack = message.ack;
      if (!ack) return;
      // The ack's row is authoritative either way, even if the edit already timed out locally
      if (ack.order) {
        const row = toRow(ack.order);
        serverRows.set(row.orderId, row);
      }
      settleEdit(
        ack.requestId ?? '',
        ack.accepted
          ? { outcome: 'accepted' }
          : { outcome: 'rejected', reason: ack.reason || 'rejected by server' },
      );
      if (ack.order?.orderId) reemitServerRow(ack.order.orderId);
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
    for (const serverRow of conflatedMap.values()) {
      // Keep showing the user's unacked values; other fields keep ticking
      const cells = pendingByOrder.get(serverRow.orderId);
      let row = serverRow;
      if (cells) {
        row = { ...serverRow };
        for (const [field, edit] of cells) row[field] = edit.value;
      }
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

// Liveness loop: a half-open TCP connection may never fire onclose, so detect silence ourselves.
// Also expires edits whose ack never came.
setInterval(() => {
  const now = Date.now();
  for (const edit of Array.from(inFlight.values())) {
    if (now - edit.sentAt >= ACK_TIMEOUT_MS) {
      settleEdit(edit.requestId, { outcome: 'rejected', reason: 'timed out' });
    }
  }

  if (!socket) return;
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

    case 'USER_MUTATION':
      sendEdit(message.payload);
      break;
  }
};
