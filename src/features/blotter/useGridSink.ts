import { useCallback, useEffect, useRef } from 'react';
import type { GridApi, GridReadyEvent } from 'ag-grid-community';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';
import { useStreamClient } from '../../stream/streamContext.ts';

function applySnapshot(api: GridApi<OrderRow>, rows: OrderRow[]) {
  // Drain queued ticks so they can't land on top of the newer snapshot
  api.flushAsyncTransactions();
  // With getRowId, a repeat snapshot (after a reconnect) updates rows in place
  // (keeps scroll, sort, selection) and removes orders that no longer exist
  api.setGridOption('rowData', rows);
  api.setGridOption('loading', false);
}

// Pipes snapshots and tick batches from the shared stream client straight into the grid,
// bypassing React rendering entirely.
export function useGridSink() {
  const client = useStreamClient();
  const gridApiRef = useRef<GridApi<OrderRow> | null>(null);
  // The snapshot can arrive before the grid is ready; hold it until onGridReady
  const pendingSnapshotRef = useRef<OrderRow[] | null>(null);

  useEffect(() => {
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

    return () => {
      offSnapshot();
      offTicks();
    };
  }, [client]);

  const onGridReady = useCallback((event: GridReadyEvent<OrderRow>) => {
    gridApiRef.current = event.api;
    if (pendingSnapshotRef.current) {
      applySnapshot(event.api, pendingSnapshotRef.current);
      pendingSnapshotRef.current = null;
    }
  }, []);

  return { onGridReady, mutate: client.mutate };
}
