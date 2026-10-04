import { beforeEach, describe, expect, it } from 'vitest';
import { ClientMessage, ServerMessage } from '../../../shared/protocol/codec.ts';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';
import type { EditRequest, WorkerOut } from '../../../shared/protocol/worker-messages.ts';
import { ACK_TIMEOUT_MS } from '../connectionPolicy.ts';
import { createStreamEngine, type StreamEngine } from './streamEngine.ts';

const row = (orderId: string, price: number, quantity = 100): OrderRow => ({
  orderId,
  underlying: 'AAPL',
  price,
  quantity,
  delta: 0.25,
});

// Real wire bytes, encoded with the shared codec
const bytes = (message: Parameters<typeof ServerMessage.encode>[0]) =>
  ServerMessage.encode(message).finish();
const snapshot = (seq: number, orders: OrderRow[]) => bytes({ snapshot: { seq, orders } });
const deltas = (seq: number, orders: OrderRow[]) => bytes({ deltas: { seq, orders } });
const heartbeat = (seq: number, serverTime: number) => bytes({ heartbeat: { seq, serverTime } });
const ack = (requestId: string, accepted: boolean, order?: OrderRow, reason = '') =>
  bytes({ ack: { requestId, accepted, reason, order } });

const priceEdit = (requestId: string, orderId: string, value: number): EditRequest => ({
  requestId,
  orderId,
  field: 'price',
  value,
});

let clock: number;
let posted: WorkerOut[];
let sent: ArrayBuffer[];
let engine: StreamEngine;

const ofType = <T extends WorkerOut['type']>(type: T) =>
  posted.filter((m): m is Extract<WorkerOut, { type: T }> => m.type === type);
const lastTick = () => ofType('TICK_BATCH').at(-1)!;
const lastResult = () => ofType('EDIT_RESULT').at(-1)!.result;

beforeEach(() => {
  clock = 1_000_000;
  posted = [];
  sent = [];
  engine = createStreamEngine({ now: () => clock, post: (m) => posted.push(m), send: (b) => sent.push(b) });
  engine.onConnecting();
});

describe('snapshot', () => {
  it('posts the rows and signals the shell', () => {
    const signal = engine.handleServerMessage(snapshot(5, [row('A', 10), row('B', 20)]));
    expect(signal).toEqual({ type: 'snapshot' });
    expect(engine.hasSnapshot).toBe(true);
    expect(ofType('SNAPSHOT')[0].rows).toEqual([row('A', 10), row('B', 20)]);
  });

  it('discards buffered rows that predate it', () => {
    engine.handleServerMessage(snapshot(0, [row('A', 10)]));
    engine.handleServerMessage(deltas(1, [row('A', 11)]));
    engine.handleServerMessage(snapshot(1, [row('A', 50)]));
    engine.flush();
    expect(ofType('TICK_BATCH')).toEqual([]);
  });
});

describe('deltas and flush', () => {
  beforeEach(() => {
    engine.handleServerMessage(snapshot(0, [row('A', 10), row('B', 20)]));
  });

  it('only posts on flush, conflated, with adds split from updates', () => {
    engine.handleServerMessage(deltas(1, [row('A', 11), row('N', 5)]));
    engine.handleServerMessage(deltas(2, [row('A', 12)]));
    expect(ofType('TICK_BATCH')).toEqual([]);

    engine.flush();
    expect(lastTick()).toEqual({ type: 'TICK_BATCH', add: [row('N', 5)], update: [row('A', 12)] });
  });

  it('does not post an empty batch', () => {
    engine.flush();
    expect(ofType('TICK_BATCH')).toEqual([]);
  });

  it('ignores deltas before this connection has a snapshot', () => {
    engine.onConnecting();
    expect(engine.handleServerMessage(deltas(1, [row('A', 99)]))).toBeNull();
    engine.flush();
    expect(ofType('TICK_BATCH')).toEqual([]);
  });

  it('asks for a resync on a seq gap and drops that batch', () => {
    expect(engine.handleServerMessage(deltas(3, [row('A', 99)]))).toEqual({
      type: 'resync',
      reason: 'missed batch (expected seq 1, got 3)',
    });
    engine.flush();
    expect(ofType('TICK_BATCH')).toEqual([]);
  });

  it('asks for a resync when a heartbeat is ahead, and measures lag', () => {
    expect(engine.handleServerMessage(heartbeat(0, clock - 7))).toBeNull();
    expect(engine.takeStats().lagMs).toBe(7);
    expect(engine.handleServerMessage(heartbeat(1, clock))).toMatchObject({ type: 'resync' });
  });

  it('reports rows received since the last stats call', () => {
    engine.handleServerMessage(deltas(1, [row('A', 11), row('B', 21)]));
    expect(engine.takeStats()).toMatchObject({ rowsPerSec: 2, lastSeq: 1 });
    expect(engine.takeStats().rowsPerSec).toBe(0);
  });
});

describe('edits', () => {
  beforeEach(() => {
    engine.handleServerMessage(snapshot(0, [row('A', 10), row('B', 20)]));
  });

  it('sends a mutation with only the edited field set', () => {
    engine.edit(priceEdit('r1', 'A', 42), true);
    const sentMessage = ClientMessage.decode(new Uint8Array(sent[0]));
    expect(sentMessage.mutation).toMatchObject({ orderId: 'A', price: 42, requestId: 'r1', timestamp: clock });
    expect(sentMessage.mutation!.quantity).toBeNull();
  });

  it('overlays the pending value on ticks until the ack arrives', () => {
    engine.edit(priceEdit('r1', 'A', 42), true);
    engine.handleServerMessage(deltas(1, [row('A', 11, 300)]));
    engine.flush();
    // Price stays the user's value; other fields keep ticking
    expect(lastTick().update).toEqual([row('A', 42, 300)]);

    engine.handleServerMessage(ack('r1', true, row('A', 42, 300)));
    expect(lastResult()).toEqual({ requestId: 'r1', orderId: 'A', field: 'price', outcome: 'accepted' });
    engine.handleServerMessage(deltas(2, [row('A', 43, 300)]));
    engine.flush();
    expect(lastTick().update).toEqual([row('A', 43, 300)]);
  });

  it('rolls back to the server row on reject', () => {
    engine.edit(priceEdit('r1', 'A', 5000), true);
    engine.handleServerMessage(ack('r1', false, row('A', 10), 'price outside limits'));
    expect(lastResult()).toMatchObject({ outcome: 'rejected', reason: 'price outside limits' });
    engine.flush();
    expect(lastTick().update).toEqual([row('A', 10)]);
  });

  it('falls back to a generic reason when the server gives none', () => {
    engine.edit(priceEdit('r1', 'A', 1), true);
    engine.handleServerMessage(ack('r1', false, row('A', 10)));
    expect(lastResult()).toMatchObject({ outcome: 'rejected', reason: 'rejected by server' });
  });

  it('times out at the ack timeout and rolls back', () => {
    engine.edit(priceEdit('r1', 'A', 42), true);
    clock += ACK_TIMEOUT_MS - 1;
    engine.expireEdits();
    expect(ofType('EDIT_RESULT')).toEqual([]);

    clock += 1;
    engine.expireEdits();
    expect(lastResult()).toMatchObject({ outcome: 'rejected', reason: 'timed out' });
    engine.flush();
    expect(lastTick().update).toEqual([row('A', 10)]);
  });

  it('a late ack after a timeout updates the row but posts no second result', () => {
    engine.edit(priceEdit('r1', 'A', 42), true);
    clock += ACK_TIMEOUT_MS;
    engine.expireEdits();
    engine.flush();
    engine.handleServerMessage(ack('r1', true, row('A', 42)));
    expect(ofType('EDIT_RESULT')).toHaveLength(1);
    engine.flush();
    expect(lastTick().update).toEqual([row('A', 42)]);
  });

  it('fails every pending edit when the connection drops', () => {
    engine.edit(priceEdit('r1', 'A', 42), true);
    engine.edit(priceEdit('r2', 'B', 43), true);
    engine.onDisconnected();
    expect(ofType('EDIT_RESULT').map((m) => [m.result.requestId, m.result.outcome])).toEqual([
      ['r1', 'rejected'],
      ['r2', 'rejected'],
    ]);
    expect(lastResult()).toMatchObject({ reason: 'connection lost' });
  });

  it('rejects locally without sending when offline or unencodable', () => {
    engine.edit(priceEdit('r1', 'A', 42), false);
    expect(lastResult()).toMatchObject({ outcome: 'rejected', reason: 'stream offline' });
    engine.edit(priceEdit('r2', 'A', NaN), true);
    expect(lastResult()).toMatchObject({ reason: 'not a number' });
    engine.edit({ requestId: 'r3', orderId: 'A', field: 'quantity', value: 20.5 }, true);
    expect(lastResult()).toMatchObject({ reason: 'quantity must be a whole number' });
    expect(sent).toEqual([]);
  });

  it('ignores acks for unknown requests without crashing', () => {
    expect(engine.handleServerMessage(bytes({ ack: { requestId: 'ghost', accepted: true } }))).toBeNull();
    expect(ofType('EDIT_RESULT')).toEqual([]);
  });
});

it('throws on malformed bytes so the shell can skip the frame', () => {
  expect(() => engine.handleServerMessage(new Uint8Array([0xff, 0xff, 0xff]))).toThrow();
});
