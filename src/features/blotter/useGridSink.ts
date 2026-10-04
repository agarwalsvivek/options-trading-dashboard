import { useEffect, useRef, type RefObject } from 'react';
import type { GridApi } from 'ag-grid-community';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';
import { createStreamClient, type StreamClient } from '../../stream/streamClient.ts';

// Owns the stream client for the component's lifetime and pipes tick batches straight
// into the grid, bypassing React rendering entirely.
export function useGridSink(
  gridApiRef: RefObject<GridApi<OrderRow> | null>,
): RefObject<StreamClient | null> {
  const clientRef = useRef<StreamClient | null>(null);

  useEffect(() => {
    const client = createStreamClient();
    clientRef.current = client;

    const unsubscribe = client.onTicks((rows) => {
      gridApiRef.current?.applyTransactionAsync({ update: rows });
    });
    client.connect();

    return () => {
      unsubscribe();
      client.dispose();
      clientRef.current = null;
    };
  }, [gridApiRef]);

  return clientRef;
}
