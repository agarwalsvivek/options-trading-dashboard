import { describe, expect, it } from 'vitest';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';
import { conflate, splitAddUpdate } from './conflate.ts';

const row = (orderId: string, price: number): OrderRow => ({
  orderId,
  underlying: 'AAPL',
  price,
  quantity: 10,
  delta: 0.5,
});

describe('conflate', () => {
  it('keeps only the last update per order', () => {
    const result = conflate([row('A', 1), row('B', 1), row('A', 2), row('A', 3)]);
    expect(result).toEqual([row('A', 3), row('B', 1)]);
  });

  it('keeps orders in first-seen position', () => {
    const result = conflate([row('B', 1), row('A', 1), row('B', 2)]);
    expect(result.map((r) => r.orderId)).toEqual(['B', 'A']);
  });

  it('returns an empty array for no rows', () => {
    expect(conflate([])).toEqual([]);
  });
});

describe('splitAddUpdate', () => {
  it('treats known orders as updates and new orders as adds', () => {
    const known = new Set(['A']);
    const { add, update } = splitAddUpdate([row('A', 1), row('N', 1)], known);
    expect(update.map((r) => r.orderId)).toEqual(['A']);
    expect(add.map((r) => r.orderId)).toEqual(['N']);
  });

  it('records added orders so the next batch updates them', () => {
    const known = new Set<string>();
    splitAddUpdate([row('N', 1)], known);
    const { add, update } = splitAddUpdate([row('N', 2)], known);
    expect(add).toEqual([]);
    expect(update).toEqual([row('N', 2)]);
  });
});
