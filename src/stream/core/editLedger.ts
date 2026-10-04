import type { OrderRow } from '../../../shared/protocol/order-row.ts';
import type { EditRequest, EditableField } from '../../../shared/protocol/worker-messages.ts';

export interface InFlightEdit extends EditRequest {
  sentAt: number;
}

// Book-keeping for edits awaiting an ack. Pure: callers supply the time and act on the results.
export class EditLedger {
  // Edits awaiting an ack, by requestId
  private readonly inFlight = new Map<string, InFlightEdit>();
  // Latest unacked edit per order and field; what overlay() shows instead of the server value
  private readonly pendingByOrder = new Map<string, Map<EditableField, InFlightEdit>>();

  get size() {
    return this.inFlight.size;
  }

  track(edit: EditRequest, now: number): InFlightEdit {
    const inFlightEdit = { ...edit, sentAt: now };
    this.inFlight.set(edit.requestId, inFlightEdit);
    let cells = this.pendingByOrder.get(edit.orderId);
    if (!cells) this.pendingByOrder.set(edit.orderId, (cells = new Map()));
    cells.set(edit.field, inFlightEdit);
    return inFlightEdit;
  }

  // Returns null if the edit is unknown or already settled (e.g. an ack after its timeout)
  settle(requestId: string): InFlightEdit | null {
    const edit = this.inFlight.get(requestId);
    if (!edit) return null;
    this.inFlight.delete(requestId);

    // Only clear the overlay if no newer edit to the same cell superseded this one
    const cells = this.pendingByOrder.get(edit.orderId);
    if (cells?.get(edit.field)?.requestId === requestId) {
      cells.delete(edit.field);
      if (cells.size === 0) this.pendingByOrder.delete(edit.orderId);
    }
    return edit;
  }

  // The row as the user should see it: server values, with any unacked edits on top.
  // Returns the same object when nothing is pending for that order.
  overlay(row: OrderRow): OrderRow {
    const cells = this.pendingByOrder.get(row.orderId);
    if (!cells) return row;
    const shown = { ...row };
    for (const [field, edit] of cells) shown[field] = edit.value;
    return shown;
  }

  expiredIds(now: number, timeoutMs: number): string[] {
    const ids: string[] = [];
    for (const edit of this.inFlight.values()) {
      if (now - edit.sentAt >= timeoutMs) ids.push(edit.requestId);
    }
    return ids;
  }

  allIds(): string[] {
    return Array.from(this.inFlight.keys());
  }
}
