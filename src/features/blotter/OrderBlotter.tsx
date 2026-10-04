import { useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDark,
  themeAlpine,
  type GridApi,
  type GridOptions,
} from 'ag-grid-community';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';
import type { EditableField } from '../../../shared/protocol/worker-messages.ts';
import { columnDefs } from './columnDefs.ts';
import { useGridSink } from './useGridSink.ts';

ModuleRegistry.registerModules([AllCommunityModule]);

const gridTheme = themeAlpine.withPart(colorSchemeDark);

// Initial row layout skeleton structure, filled in by the first ticks
function createSkeletonRows(): OrderRow[] {
  const rows: OrderRow[] = [];
  for (let i = 1; i <= 500; i++) {
    rows.push({
      orderId: `ORD-${String(i).padStart(4, '0')}`,
      underlying: '---',
      price: 0,
      quantity: 0,
      delta: 0,
    });
  }
  return rows;
}

export function OrderBlotter() {
  const gridApiRef = useRef<GridApi<OrderRow> | null>(null);
  const clientRef = useGridSink(gridApiRef);

  const gridOptions = useMemo<GridOptions<OrderRow>>(
    () => ({
      getRowId: (params) => params.data.orderId,
      rowBuffer: 25,
      asyncTransactionWaitMillis: 16,
      onGridReady: (params) => {
        gridApiRef.current = params.api;
        params.api.applyTransaction({ add: createSkeletonRows() });
      },
      onCellEditingStopped: (event) => {
        if (!event.data) return;
        clientRef.current?.mutate(
          event.data.orderId,
          event.colDef.field as EditableField,
          Number(event.newValue),
        );
      },
    }),
    [clientRef],
  );

  return <AgGridReact theme={gridTheme} columnDefs={columnDefs} gridOptions={gridOptions} />;
}
