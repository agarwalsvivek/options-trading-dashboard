import { describe, expect, it } from 'vitest';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';
import type { EditRequest } from '../../../shared/protocol/worker-messages.ts';
import { EditLedger } from './editLedger.ts';

const serverRow: OrderRow = { orderId: 'A', underlying: 'AAPL', price: 10, quantity: 100, delta: 0.5 };

const edit = (requestId: string, field: EditRequest['field'], value: number, orderId = 'A'): EditRequest => ({
  requestId,
  orderId,
  field,
  value,
});

describe('EditLedger.overlay', () => {
  it('returns the same row when nothing is pending', () => {
    const ledger = new EditLedger();
    expect(ledger.overlay(serverRow)).toBe(serverRow);
  });

  it('replaces only the pending fields and leaves the server row untouched', () => {
    const ledger = new EditLedger();
    ledger.track(edit('r1', 'price', 99), 0);
    const shown = ledger.overlay(serverRow);
    expect(shown).toEqual({ ...serverRow, price: 99 });
    expect(serverRow.price).toBe(10);
  });

  it('overlays several fields of the same order', () => {
    const ledger = new EditLedger();
    ledger.track(edit('r1', 'price', 99), 0);
    ledger.track(edit('r2', 'quantity', 500), 0);
    expect(ledger.overlay(serverRow)).toEqual({ ...serverRow, price: 99, quantity: 500 });
  });

  it('does not touch other orders', () => {
    const ledger = new EditLedger();
    ledger.track(edit('r1', 'price', 99, 'B'), 0);
    expect(ledger.overlay(serverRow)).toBe(serverRow);
  });

  it('shows the newest edit when a cell is edited twice', () => {
    const ledger = new EditLedger();
    ledger.track(edit('r1', 'price', 100), 0);
    ledger.track(edit('r2', 'price', 200), 0);
    expect(ledger.overlay(serverRow).price).toBe(200);
  });
});

describe('EditLedger.settle', () => {
  it('returns the edit and clears its overlay', () => {
    const ledger = new EditLedger();
    ledger.track(edit('r1', 'price', 99), 5);
    expect(ledger.settle('r1')).toMatchObject({ requestId: 'r1', sentAt: 5 });
    expect(ledger.overlay(serverRow)).toBe(serverRow);
    expect(ledger.size).toBe(0);
  });

  it('settling a superseded edit keeps the newer edit overlaid', () => {
    const ledger = new EditLedger();
    ledger.track(edit('r1', 'price', 100), 0);
    ledger.track(edit('r2', 'price', 200), 0);
    ledger.settle('r1');
    expect(ledger.overlay(serverRow).price).toBe(200);
    ledger.settle('r2');
    expect(ledger.overlay(serverRow)).toBe(serverRow);
  });

  it('returns null for unknown or already-settled edits (e.g. a late ack)', () => {
    const ledger = new EditLedger();
    ledger.track(edit('r1', 'price', 99), 0);
    ledger.settle('r1');
    expect(ledger.settle('r1')).toBeNull();
    expect(ledger.settle('nope')).toBeNull();
  });

  it('keeps other pending fields of the order when one settles', () => {
    const ledger = new EditLedger();
    ledger.track(edit('r1', 'price', 99), 0);
    ledger.track(edit('r2', 'quantity', 500), 0);
    ledger.settle('r1');
    expect(ledger.overlay(serverRow)).toEqual({ ...serverRow, quantity: 500 });
  });
});

describe('EditLedger expiry and listing', () => {
  it('expires edits at exactly the timeout, not before', () => {
    const ledger = new EditLedger();
    ledger.track(edit('old', 'price', 1), 1000);
    ledger.track(edit('new', 'price', 2, 'B'), 2500);
    expect(ledger.expiredIds(3999, 3000)).toEqual([]);
    expect(ledger.expiredIds(4000, 3000)).toEqual(['old']);
    expect(ledger.expiredIds(5500, 3000)).toEqual(['old', 'new']);
  });

  it('lists every in-flight edit', () => {
    const ledger = new EditLedger();
    ledger.track(edit('r1', 'price', 1), 0);
    ledger.track(edit('r2', 'quantity', 10, 'B'), 0);
    expect(ledger.allIds()).toEqual(['r1', 'r2']);
  });
});
