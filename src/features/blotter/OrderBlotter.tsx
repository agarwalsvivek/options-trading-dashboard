import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDark,
  themeAlpine,
  type GridOptions,
} from 'ag-grid-community';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';
import type { EditableField } from '../../../shared/protocol/worker-messages.ts';
import { columnDefs } from './columnDefs.ts';
import { useGridSink } from './useGridSink.ts';

ModuleRegistry.registerModules([AllCommunityModule]);

const gridTheme = themeAlpine.withPart(colorSchemeDark);

export function OrderBlotter() {
  const { onGridReady, mutate } = useGridSink();

  // Rows come from the server snapshot; show the loading overlay until it arrives
  const gridOptions = useMemo<GridOptions<OrderRow>>(
    () => ({
      getRowId: (params) => params.data.orderId,
      loading: true,
      rowBuffer: 25,
      asyncTransactionWaitMillis: 16,
      onGridReady,
      onCellEditingStopped: (event) => {
        if (!event.data) return;
        mutate(event.data.orderId, event.colDef.field as EditableField, Number(event.newValue));
      },
    }),
    [onGridReady, mutate],
  );

  return <AgGridReact theme={gridTheme} columnDefs={columnDefs} gridOptions={gridOptions} />;
}
