import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { CellEditingStoppedEvent, GridApi } from 'ag-grid-community';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';
import type { EditableField } from '../../../shared/protocol/worker-messages.ts';
import { useStreamClient } from '../../stream/streamContext.ts';
import { pushToast } from '../../ui/toasts.ts';
import type { BlotterContext } from './columnDefs.ts';

const REJECTED_HIGHLIGHT_MS = 1500;

const cellKey = (orderId: string, field: EditableField) => `${orderId}:${field}`;

// Visual side of edits: which cells are pending or were just rejected. The worker owns the data
// side (overlaying pending values on ticks, rolling back on reject).
export function useEditTracking(gridApiRef: RefObject<GridApi<OrderRow> | null>) {
  const client = useStreamClient();
  // cell -> requestId of its latest unacked edit
  const pendingRef = useRef(new Map<string, string>());
  const rejectedRef = useRef(new Set<string>());

  // Forced: on accept the value doesn't change, so the grid wouldn't re-run cellClassRules itself
  const refreshCell = useCallback(
    (orderId: string, field: EditableField) => {
      const api = gridApiRef.current;
      const rowNode = api?.getRowNode(orderId);
      if (api && rowNode) api.refreshCells({ rowNodes: [rowNode], columns: [field], force: true });
    },
    [gridApiRef],
  );

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const offEditResult = client.onEditResult((result) => {
      const { requestId, orderId, field } = result;
      const key = cellKey(orderId, field);
      // An older edit to a cell that has since been edited again doesn't change its marks
      const isLatest = pendingRef.current.get(key) === requestId;
      if (isLatest) pendingRef.current.delete(key);

      if (result.outcome === 'rejected') {
        pushToast(`${orderId} ${field} rejected: ${result.reason}`);
        if (isLatest) {
          rejectedRef.current.add(key);
          const timer = setTimeout(() => {
            timers.delete(timer);
            rejectedRef.current.delete(key);
            refreshCell(orderId, field);
          }, REJECTED_HIGHLIGHT_MS);
          timers.add(timer);
        }
      }
      refreshCell(orderId, field);
    });

    return () => {
      offEditResult();
      timers.forEach(clearTimeout);
    };
  }, [client, refreshCell]);

  const editContext = useMemo<Pick<BlotterContext, 'isPending' | 'isRejected'>>(
    () => ({
      isPending: (orderId, field) => pendingRef.current.has(cellKey(orderId, field)),
      isRejected: (orderId, field) => rejectedRef.current.has(cellKey(orderId, field)),
    }),
    [],
  );

  const onCellEditingStopped = useCallback(
    (event: CellEditingStoppedEvent<OrderRow>) => {
      if (!event.data || !event.valueChanged) return;
      const { orderId } = event.data;
      const field = event.colDef.field as EditableField;
      // A cleared number editor gives null; let the worker reject it rather than sending 0
      const value = typeof event.newValue === 'number' ? event.newValue : NaN;

      const key = cellKey(orderId, field);
      pendingRef.current.set(key, client.mutate(orderId, field, value));
      rejectedRef.current.delete(key);
      refreshCell(orderId, field);
    },
    [client, refreshCell],
  );

  return { editContext, onCellEditingStopped };
}
