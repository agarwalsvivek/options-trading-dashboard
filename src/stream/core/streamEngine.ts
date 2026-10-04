import { ClientMessage, ServerMessage, type OptionOrder } from '../../../shared/protocol/codec.ts';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';
import type {
  EditOutcome,
  EditRequest,
  StreamStats,
  WorkerOut,
} from '../../../shared/protocol/worker-messages.ts';
import { ACK_TIMEOUT_MS } from '../connectionPolicy.ts';
import { conflate, splitAddUpdate } from './conflate.ts';
import { EditLedger } from './editLedger.ts';
import { SeqTracker } from './seqTracker.ts';

export interface EngineDeps {
  now(): number;
  post(message: WorkerOut): void;
  send(bytes: ArrayBuffer): void;
}

// What the connection shell must do after a server message
export type EngineSignal = { type: 'snapshot' } | { type: 'resync'; reason: string } | null;

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

// int64/double can't carry these; business rules are the server's job
function unencodableReason(edit: EditRequest): string | null {
  if (!Number.isFinite(edit.value)) return 'not a number';
  if (edit.field === 'quantity' && !Number.isInteger(edit.value)) return 'quantity must be a whole number';
  return null;
}

// The stream's data plane: decodes server messages, keeps the row store, conflates ticks,
// overlays and settles edits. No sockets or timers: the worker shell owns the connection and
// calls in, so this can be tested with a fake clock and real protobuf bytes.
export function createStreamEngine({ now, post, send }: EngineDeps) {
  const seq = new SeqTracker();
  const edits = new EditLedger();
  let pendingRows: OrderRow[] = [];
  // Order ids the grid already has; anything else arriving in a delta is an add
  const knownIds = new Set<string>();
  // Last row the server sent for each order: what a rejected or failed edit rolls back to
  const serverRows = new Map<string, OrderRow>();

  let rowsSinceStats = 0;
  let lagMs = 0;

  // Re-emit the server's row on the next flush (rollback on reject, confirmation on accept)
  function reemitServerRow(orderId: string) {
    const row = serverRows.get(orderId);
    if (row) pendingRows.push(row);
  }

  function postEditResult(edit: EditRequest, outcome: EditOutcome) {
    const { requestId, orderId, field } = edit;
    post({ type: 'EDIT_RESULT', result: { requestId, orderId, field, ...outcome } });
  }

  function settleEdit(requestId: string, outcome: EditOutcome) {
    const edit = edits.settle(requestId);
    if (!edit) return;
    reemitServerRow(edit.orderId);
    postEditResult(edit, outcome);
  }

  function failAllEdits(reason: string) {
    for (const requestId of edits.allIds()) {
      settleEdit(requestId, { outcome: 'rejected', reason });
    }
  }

  function handleMessage(message: ServerMessage): EngineSignal {
    switch (message.body) {
      case 'snapshot': {
        const rows = (message.snapshot?.orders ?? []).map(toRow);
        knownIds.clear();
        serverRows.clear();
        for (const row of rows) {
          knownIds.add(row.orderId);
          serverRows.set(row.orderId, row);
        }
        // Anything buffered predates the snapshot and is now stale
        pendingRows = [];
        seq.onSnapshot(message.snapshot?.seq ?? 0);
        post({ type: 'SNAPSHOT', rows });
        return { type: 'snapshot' };
      }
      case 'deltas': {
        const verdict = seq.onDelta(message.deltas?.seq ?? 0);
        if (verdict.kind === 'gap') return { type: 'resync', reason: verdict.reason };
        if (verdict.kind === 'ignore') return null;
        const orders = message.deltas?.orders ?? [];
        for (let i = 0; i < orders.length; i++) {
          const row = toRow(orders[i]);
          serverRows.set(row.orderId, row);
          pendingRows.push(row);
        }
        rowsSinceStats += orders.length;
        return null;
      }
      case 'ack': {
        const ack = message.ack;
        if (!ack) return null;
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
        return null;
      }
      case 'heartbeat': {
        lagMs = now() - (message.heartbeat?.serverTime ?? 0);
        const verdict = seq.onHeartbeat(message.heartbeat?.seq ?? 0);
        return verdict.kind === 'gap' ? { type: 'resync', reason: verdict.reason } : null;
      }
      default:
        return null;
    }
  }

  return {
    get hasSnapshot() {
      return seq.hasSnapshot;
    },

    // A new socket is opening: nothing applies until its snapshot
    onConnecting() {
      seq.clear();
    },

    // Acks can't arrive on a dead socket; the next snapshot settles the values
    onDisconnected() {
      failAllEdits('connection lost');
    },

    // Throws on malformed bytes; the shell logs and skips the frame
    handleServerMessage(bytes: Uint8Array): EngineSignal {
      return handleMessage(ServerMessage.decode(bytes));
    },

    // Posts one conflated TICK_BATCH (called at ~60 Hz), with unacked edits overlaid
    flush() {
      if (pendingRows.length === 0) return;
      const rows = conflate(pendingRows).map((row) => edits.overlay(row));
      pendingRows = [];
      const { add, update } = splitAddUpdate(rows, knownIds);
      post({ type: 'TICK_BATCH', add, update });
    },

    expireEdits() {
      for (const requestId of edits.expiredIds(now(), ACK_TIMEOUT_MS)) {
        settleEdit(requestId, { outcome: 'rejected', reason: 'timed out' });
      }
    },

    edit(request: EditRequest, canSend: boolean) {
      const reason = canSend ? unencodableReason(request) : 'stream offline';
      if (reason) {
        reemitServerRow(request.orderId);
        postEditResult(request, { outcome: 'rejected', reason });
        return;
      }

      const tracked = edits.track(request, now());
      // Only the edited field is set, so the server can tell it apart from unchanged ones
      const bytes = ClientMessage.encode({
        mutation: {
          orderId: request.orderId,
          [request.field]: request.value,
          timestamp: tracked.sentAt,
          requestId: request.requestId,
        },
      }).finish();
      const transferable = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(transferable).set(bytes);
      send(transferable);
    },

    // Stats since the last call (the shell calls this at 1 Hz)
    takeStats(): StreamStats {
      const stats = { rowsPerSec: rowsSinceStats, lastSeq: seq.lastSeq ?? 0, lagMs };
      rowsSinceStats = 0;
      return stats;
    },
  };
}

export type StreamEngine = ReturnType<typeof createStreamEngine>;
