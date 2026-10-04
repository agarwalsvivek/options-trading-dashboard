import { useCallback, useEffect, useRef } from 'react';
import type { GridApi, GridReadyEvent } from 'ag-grid-community';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';
import type { EditableField } from '../../../shared/protocol/worker-messages.ts';
import { createStreamClient, type StreamClient } from '../../stream/streamClient.ts';

function applySnapshot(api: GridApi<OrderRow>, rows: OrderRow[]) {
  // Drain queued ticks so they can't land on top of the newer snapshot
  api.flushAsyncTransactions();
  // With getRowId, a repeat snapshot updates rows in place (keeps scroll, sort, selection)
  api.setGridOption('rowData', rows);
  api.setGridOption('loading', false);
}

// Owns the stream client for the component's lifetime and pipes snapshots and tick batches
// straight into the grid, bypassing React rendering entirely.
export function useGridSink() {
  const gridApiRef = useRef<GridApi<OrderRow> | null>(null);
  const clientRef = useRef<StreamClient | null>(null);
  // The snapshot can arrive before the grid is ready; hold it until onGridReady
  const pendingSnapshotRef = useRef<OrderRow[] | null>(null);

  useEffect(() => {
    const client = createStreamClient();
    clientRef.current = client;

    const offSnapshot = client.onSnapshot((rows) => {
      if (gridApiRef.current) {
        applySnapshot(gridApiRef.current, rows);
      } else {
        pendingSnapshotRef.current = rows;
      }
    });
    const offTicks = client.onTicks(({ add, update }) => {
      gridApiRef.current?.applyTransactionAsync({ add, update });
    });
    client.connect();

    return () => {
      offSnapshot();
      offTicks();
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  const onGridReady = useCallback((event: GridReadyEvent<OrderRow>) => {
    gridApiRef.current = event.api;
    if (pendingSnapshotRef.current) {
      applySnapshot(event.api, pendingSnapshotRef.current);
      pendingSnapshotRef.current = null;
    }
  }, []);

  const mutate = useCallback((orderId: string, field: EditableField, value: number) => {
    clientRef.current?.mutate(orderId, field, value);
  }, []);

  return { onGridReady, mutate };
}
