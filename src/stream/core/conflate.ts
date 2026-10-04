import type { OrderRow } from '../../../shared/protocol/order-row.ts';

// Rows are full rows, so only the last update per order matters. Orders keep the position of
// their first appearance in the batch.
export function conflate(rows: readonly OrderRow[]): OrderRow[] {
  const latest = new Map<string, OrderRow>();
  for (let i = 0; i < rows.length; i++) {
    latest.set(rows[i].orderId, rows[i]);
  }
  return Array.from(latest.values());
}

// Splits rows into grid adds (order not seen before) and updates. Records new orders in knownIds.
export function splitAddUpdate(
  rows: readonly OrderRow[],
  knownIds: Set<string>,
): { add: OrderRow[]; update: OrderRow[] } {
  const add: OrderRow[] = [];
  const update: OrderRow[] = [];
  for (const row of rows) {
    if (knownIds.has(row.orderId)) {
      update.push(row);
    } else {
      knownIds.add(row.orderId);
      add.push(row);
    }
  }
  return { add, update };
}
